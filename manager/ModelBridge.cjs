// Loopback-only model library. All executable paths and arguments are controlled here.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

async function verifyModel(file, expectedSize = 0, expectedHash = '') {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size < 1024 * 1024) throw new Error('Model file is too small.');
    if (expectedSize && stat.size !== expectedSize) throw new Error('Incomplete model download.');
    const handle = fs.openSync(file, 'r');
    const header = Buffer.alloc(8);
    try { fs.readSync(handle, header, 0, 8, 0); } finally { fs.closeSync(handle); }
    if (header.toString('ascii', 0, 4) !== 'GGUF' || ![2, 3].includes(header.readUInt32LE(4))) throw new Error('Invalid GGUF model.');
    if (expectedHash) {
        const hash = crypto.createHash('sha256');
        for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
        if (hash.digest('hex') !== expectedHash.toLowerCase()) throw new Error('SHA-256 mismatch.');
    }
}
function resolveModel(models, name) {
    if (typeof name !== 'string' || path.basename(name) !== name || !name.endsWith('.gguf')) throw new Error('Invalid model name.');
    const file = path.join(models, name);
    if (fs.existsSync(file) && path.dirname(fs.realpathSync(file)) !== fs.realpathSync(models)) throw new Error('Model path escapes the Models folder.');
    return file;
}
function createBridge(root, { port = 8001, autoStart = true } = {}) {
    const models = path.join(root, 'Models');
    const logs = path.join(root, 'Logs');
    fs.mkdirSync(models, { recursive: true });
    fs.mkdirSync(logs, { recursive: true });
    const catalog = JSON.parse(fs.readFileSync(path.join(root, 'models.json'), 'utf8'));
    const token = crypto.randomBytes(32).toString('hex');
    let download = null, backend = null, state = 'No model selected', lastAttempt = '', backendReady = false, checking = false;
    let manager = null, starting = false;
    const selection = path.join(models, 'selected-model.txt');
    const selected = () => {
        if (!fs.existsSync(selection)) return '';
        const full = fs.readFileSync(selection, 'utf8').replace(/^\uFEFF/, '').trim();
        const name = path.basename(full);
        if (path.resolve(full) !== path.resolve(resolveModel(models, name))) throw new Error('Invalid selected model path.');
        return name;
    };
    const choose = async name => {
        const file = resolveModel(models, name);
        await verifyModel(file);
        fs.writeFileSync(selection, file, 'utf8');
        state = backend ? 'Model selected. Stop AI, then Start AI to switch.' : 'Model selected; starting AI…';
    };
    const runBackend = async () => {
        if (backend || starting) return;
        starting = true;
        try {
        const name = selected();
        if (!name) throw new Error('Download or select a model first.');
        await verifyModel(resolveModel(models, name));
        // Do not start while another process owns KoboldCpp's port.
        try {
            await fetch('http://127.0.0.1:5001/api/v1/model', { signal: AbortSignal.timeout(1500) });
            throw new Error('Port 5001 is occupied. Close the other AI server first.');
        } catch (e) { if (e.message.startsWith('Port 5001')) throw e; }
        const out = fs.openSync(path.join(logs, 'koboldcpp.log'), 'w');
        const err = fs.openSync(path.join(logs, 'koboldcpp-error.log'), 'w');
        try {
            backend = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'LaunchLocalAI.ps1')], { windowsHide: true, stdio: ['ignore', out, err] });
        } finally { fs.closeSync(out); fs.closeSync(err); }
        state = 'Loading AI model… The chat interface remains available.';
        backendReady = false;
        backend.on('error', e => { state = e.message; backend = null; });
        backend.on('exit', code => { backend = null; backendReady = false; state = code ? 'AI stopped with an error. Check Logs/koboldcpp-error.log.' : 'AI stopped.'; });
        } finally { starting = false; }
    };
    const stopBackend = () => {
        if (!backend) return;
        if (process.platform === 'win32') spawn('taskkill.exe', ['/PID', String(backend.pid), '/T', '/F'], { windowsHide: true });
        else backend.kill();
    };
    const beginDownload = async index => {
        if (download) throw new Error('A download is already running.');
        if (manager) throw new Error('Close the advanced manager before downloading here.');
        if (!Number.isInteger(index) || !catalog[index]) throw new Error('Invalid model choice.');
        const model = catalog[index];
        const file = resolveModel(models, model.File);
        if (fs.existsSync(file)) { await verifyModel(file, 0, model.Hash); await choose(model.File); return; }
        const pending = { name: model.File, file, part: file + '.part', size: 0, process: null, hash: model.Hash || '', cancelled: false, verifying: false, bytes: 0 };
        download = pending; // Reserve before awaiting metadata: double clicks cannot start two downloads.
        try {
            try {
                const meta = await fetch('https://huggingface.co/api/models/' + model.Repo + '/tree/main?recursive=true', { signal: AbortSignal.timeout(15000) });
                if (meta.ok) {
                    const files = await meta.json();
                    const entry = files.find(x => x.path === model.File);
                    if (entry) { pending.size = Number(entry.size) || 0; pending.hash ||= entry.lfs?.oid || ''; }
                }
            } catch {} // Default hash is pinned; metadata availability does not block it.
            const space = fs.statfsSync(models);
            const already = fs.existsSync(pending.part) ? fs.statSync(pending.part).size : 0;
            if (space.bavail * space.bsize < (pending.size || model.Size) - already + 150 * 1024 * 1024) throw new Error('Not enough free disk space.');
            if (pending.cancelled) { download = null; return; }
            const url = 'https://huggingface.co/' + model.Repo + '/resolve/main/' + model.File;
            const curl = process.platform === 'win32' ? path.join(process.env.SystemRoot, 'System32', 'curl.exe') : 'curl';
            const errorFile = fs.openSync(path.join(logs, 'download-error.log'), 'w');
            try {
                pending.process = spawn(curl, ['--proto', '=https', '--proto-redir', '=https', '--fail', '--location', '--connect-timeout', '30', '--retry', '3', '--continue-at', '-', '--silent', '--show-error', '--output', pending.part, url], { windowsHide: true, stdio: ['ignore', 'ignore', errorFile] });
            } finally { fs.closeSync(errorFile); }
            pending.process.once('error', e => { state = e.message; if (download === pending) download = null; });
            pending.process.once('exit', async code => {
                if (pending.cancelled || code !== 0) { state = pending.cancelled ? 'Download cancelled. Click Download to resume.' : 'Download failed. Click Download to resume; see Logs/download-error.log.'; if (download === pending) download = null; return; }
                try {
                    state = 'Verifying model SHA-256…'; pending.verifying = true;
                    await verifyModel(pending.part, pending.size, pending.hash);
                    fs.renameSync(pending.part, file);
                    await choose(model.File);
                } catch (e) {
                    if (fs.existsSync(pending.part)) fs.renameSync(pending.part, pending.part + '.corrupt-' + Date.now());
                    state = e.message;
                } finally { if (download === pending) download = null; }
            });
            state = 'Downloading ' + model.File;
        } catch (e) { if (download === pending) download = null; throw e; }
    };
    const snapshot = () => {
        let active = ''; try { active = selected(); } catch (e) { state = e.message; }
        if (download && fs.existsSync(download.part)) download.bytes = fs.statSync(download.part).size;
        return { state, backendRunning: !!backend || starting, backendReady, selected: active,
            catalog, installed: fs.readdirSync(models).filter(x => x.endsWith('.gguf')),
            download: download && { name: download.name, bytes: download.bytes, size: download.size, verifying: download.verifying } };
    };
    const server = http.createServer(async (req, res) => {
        const host = req.headers.host;
        if (host !== '127.0.0.1:' + server.address().port) { res.writeHead(403); res.end('Invalid host'); return; }
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors http://127.0.0.1:8000 http://localhost:8000");
        const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
        if (req.method === 'GET' && req.url === '/') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(fs.readFileSync(path.join(root, 'ModelPanel.html'), 'utf8').replaceAll('__TOKEN__', token)); return;
        }
        if (req.headers['x-hero-token'] !== token) { json(403, { error: 'Invalid session token.' }); return; }
        if (req.method === 'GET' && req.url === '/status') { json(200, snapshot()); return; }
        if (req.method !== 'POST' || req.headers.origin !== 'http://' + host) { json(403, { error: 'Invalid request origin.' }); return; }
        try {
            let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 4096) throw new Error('Request too large.'); }
            const data = JSON.parse(body || '{}');
            if (req.url === '/download') await beginDownload(data.index);
            else if (req.url === '/cancel') {
                if (download?.verifying) throw new Error('Verification is finishing; please wait.');
                if (download) { download.cancelled = true; download.process?.kill(); }
            } else if (req.url === '/select') await choose(data.name);
            else if (req.url === '/start') { lastAttempt = selected(); await runBackend(); }
            else if (req.url === '/stop') { lastAttempt = selected(); stopBackend(); }
            else if (req.url === '/advanced') {
                if (download) throw new Error('Finish or cancel the browser download first.');
                if (!manager) {
                    manager = spawn('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'ModelManager.ps1')], { windowsHide: false, stdio: 'ignore' });
                    manager.on('exit', () => { manager = null; }); manager.on('error', () => { manager = null; });
                }
            } else { json(404, { error: 'Unknown action.' }); return; }
            json(200, snapshot());
        } catch (e) { json(400, { error: e.message }); }
    });
    const timer = setInterval(async () => {
        if (checking || !autoStart) return; checking = true;
        try {
            const name = selected();
            if (!backend && name && name !== lastAttempt) { lastAttempt = name; await runBackend(); }
            if (backend && !backendReady) {
                const result = await fetch('http://127.0.0.1:5001/api/v1/model', { signal: AbortSignal.timeout(1500) });
                if (result.ok) { backendReady = true; state = 'AI ready. Click Connect in SillyTavern API Connections.'; }
            }
        } catch (e) { if (!backend) state = e.message; } finally { checking = false; }
    }, 2000);
    server.on('close', () => { clearInterval(timer); download?.process?.kill(); stopBackend(); manager?.kill(); });
    server.listen(port, '127.0.0.1');
    return server;
}
module.exports = { createBridge, verifyModel, resolveModel };
if (require.main === module) {
    const server = createBridge(process.argv[2] || __dirname);
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit()));
}
