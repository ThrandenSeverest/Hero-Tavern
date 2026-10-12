// Loopback-only model library. All executable paths and arguments are controlled here.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { createPipeline, readSettings, saveSettings } = require('./ReplyPipeline.cjs');
const { filterReply } = require('./ReplyFilters.cjs');

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
function backendArguments(root, model, port = 5001) {
    const configPath = path.join(root, 'backend.json');
    const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '')) : { mode: 'cpu', gpuLayers: 0, contextSize: 4096 };
    if (!['cpu', 'cuda', 'vulkan'].includes(config.mode)) throw new Error('Choose CPU, CUDA or Vulkan in Hardware settings.');
    if (!Number.isInteger(config.contextSize) || config.contextSize < 512 || config.contextSize > 32768) throw new Error('Context size must be 512–32768.');
    if (!Number.isInteger(config.gpuLayers) || config.gpuLayers < -1 || config.gpuLayers > 999) throw new Error('Invalid GPU layer count.');
    const args = ['--model', model, '--contextsize', String(config.contextSize), '--host', '127.0.0.1', '--port', String(port), '--skiplauncher'];
    if (config.mode === 'cpu') args.push('--gpulayers', '0');
    else args.push(config.mode === 'cuda' ? '--usecuda' : '--usevulkan', '--gpulayers', String(config.gpuLayers));
    return { config, args };
}
function logTail(file) {
    if (!fs.existsSync(file)) return '';
    const size = fs.statSync(file).size, length = Math.min(size, 12000);
    const fd = fs.openSync(file, 'r'), bytes = Buffer.alloc(length);
    try { fs.readSync(fd, bytes, 0, length, size - length); } finally { fs.closeSync(fd); }
    return bytes.toString('utf8').trim();
}
function createBridge(root, { port = 8001, autoStart = true, backendCommand, backendPrefix = [], backendPort = 5001, pollInterval = 2000, readinessTimeout = 600000 } = {}) {
    const models = path.join(root, 'Models');
    const logs = path.join(root, 'Logs');
    fs.mkdirSync(models, { recursive: true });
    fs.mkdirSync(logs, { recursive: true });
    const catalog = JSON.parse(fs.readFileSync(path.join(root, 'models.json'), 'utf8'));
    const token = crypto.randomBytes(32).toString('hex');
    let download = null, backend = null, state = 'No model selected', lastAttempt = '', backendReady = false, checking = false;
    let manager = null, starting = false, loadingSince = 0, runningModel = '', backendError = '', engineState = 'idle', stopIntent = '';
    const backendURL = 'http://127.0.0.1:' + backendPort;
    let generationState = 'idle';
    const pipeline = createPipeline({root,backendURL,setState: value => { generationState = value; }});
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
        state = backend ? 'Model selected. Click Load model to switch the running AI.' : 'Model selected; starting AI…';
        if (!backend && autoStart) { lastAttempt = name; await runBackend(); }
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
            await fetch(backendURL + '/api/v1/model', { signal: AbortSignal.timeout(1500) });
            throw new Error('Port 5001 is occupied. Close the other AI server first.');
        } catch (e) { if (e.message.startsWith('Port 5001')) throw e; }
        const executable = backendCommand || path.join(root, 'KoboldCpp', 'koboldcpp.exe');
        if (!fs.existsSync(executable)) throw new Error('KoboldCpp engine is missing. Run Hero Tavern setup to repair it.');
        const { args } = backendArguments(root, resolveModel(models, name), backendPort);
        backendError = ''; stopIntent = ''; runningModel = name; engineState = 'loading'; loadingSince = Date.now();
        const out = fs.openSync(path.join(logs, 'koboldcpp.log'), 'w');
        const err = fs.openSync(path.join(logs, 'koboldcpp-error.log'), 'w');
        try {
            backend = spawn(executable, [...backendPrefix, ...args], { cwd: root, windowsHide: true, stdio: ['ignore', out, err] });
        } finally { fs.closeSync(out); fs.closeSync(err); }
        state = 'Loading AI model… The chat interface remains available.';
        backendReady = false;
        backend.on('error', e => { backendError = e.message; state = 'Could not start KoboldCpp: ' + e.message; engineState = 'error'; backend = null; });
        backend.on('exit', code => {
            backend = null; backendReady = false;
            if (stopIntent === 'stop') { engineState = 'stopped'; backendError = ''; state = 'AI stopped.'; }
            else if (stopIntent === 'timeout') { engineState = 'error'; state = backendError; }
            else {
                engineState = code ? 'error' : 'stopped';
                backendError = code ? (logTail(path.join(logs, 'koboldcpp-error.log')) || logTail(path.join(logs, 'koboldcpp.log')) || 'KoboldCpp exited with code ' + code) : '';
                state = code ? 'KoboldCpp failed to load. Open Diagnostics for the error.' : 'AI stopped.';
            }
        });
        } finally { starting = false; }
    };
    const stopBackend = (intent = 'stop') => {
        if (!backend) return;
        stopIntent = intent;
        if (process.platform === 'win32') spawn('taskkill.exe', ['/PID', String(backend.pid), '/T', '/F'], { windowsHide: true });
        else backend.kill();
    };
    const beginDownload = async index => {
        if (download) throw new Error('A download is already running.');
        if (manager) throw new Error('Close the advanced manager before downloading here.');
        if (!Number.isInteger(index) || !catalog[index]) throw new Error('Invalid model choice.');
        const model = catalog[index];
        const file = resolveModel(models, model.LocalFile || model.File);
        if (fs.existsSync(file)) { await verifyModel(file, 0, model.Hash); await choose(model.LocalFile || model.File); return; }
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
                    await choose(model.LocalFile || model.File);
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
            engineState, runningModel, backendError, apiURL: 'http://127.0.0.1:' + server.address().port + '/inference', engineURL: backendURL, generationState, generation: readSettings(root),
            hardware: backendArguments(root, '').config,
            download: download && { name: download.name, bytes: download.bytes, size: download.size, verifying: download.verifying } };
    };
    const server = http.createServer(async (req, res) => {
        const host = req.headers.host;
        if (host !== '127.0.0.1:' + server.address().port) { res.writeHead(403); res.end('Invalid host'); return; }
        if (await pipeline.handle(req,res)) return;
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors http://127.0.0.1:8000 http://localhost:8000");
        const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
        if (req.method === 'GET' && req.url === '/') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(fs.readFileSync(path.join(root, 'ModelPanel.html'), 'utf8').replaceAll('__TOKEN__', token)); return;
        }
        if (req.headers['x-hero-token'] !== token) { json(403, { error: 'Invalid session token.' }); return; }
        if (req.method === 'GET' && req.url === '/status') { try { json(200, snapshot()); } catch (e) { json(400, {error:e.message}); } return; }
        if (req.method === 'GET' && req.url === '/logs') { json(200, { output: logTail(path.join(logs, 'koboldcpp.log')), error: logTail(path.join(logs, 'koboldcpp-error.log')) }); return; }
        if (req.method !== 'POST' || req.headers.origin !== 'http://' + host) { json(403, { error: 'Invalid request origin.' }); return; }
        try {
            let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 16000) throw new Error('Request too large.'); }
            const data = JSON.parse(body || '{}');
            if (req.url === '/download') await beginDownload(data.index);
            else if (req.url === '/custom') {
                const url = new URL(data.url);
                const match = /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/resolve\/main\/([A-Za-z0-9_./-]+\.gguf)$/.exec(url.pathname);
                if (url.protocol !== 'https:' || url.hostname !== 'huggingface.co' || url.username || url.password || url.search || url.hash || !match || url.pathname.includes('..')) throw new Error('Use a public HTTPS Hugging Face direct GGUF link.');
                const repo = match[1] + '/' + match[2], remote = match[3];
                const index = catalog.push({ Label: 'Custom: ' + path.basename(remote), Repo: repo, File: remote, LocalFile: match[1] + '_' + match[2] + '__' + path.basename(remote), Size: 0, License: 'See model card' }) - 1;
                await beginDownload(index);
            } else if (req.url === '/delete') {
                if (backend && runningModel === data.name) throw new Error('Stop AI before deleting the loaded model.');
                const file = resolveModel(models, data.name);
                if (data.name === selected()) fs.unlinkSync(selection);
                fs.unlinkSync(file); state = 'Model deleted.';
            }
            else if (req.url === '/cancel') {
                if (download?.verifying) throw new Error('Verification is finishing; please wait.');
                if (download) { download.cancelled = true; download.process?.kill(); }
            } else if (req.url === '/select') await choose(data.name);
            else if (req.url === '/start') {
                if (backend && runningModel !== selected()) {
                    const old = backend; const done = new Promise(resolve => old.once('exit', resolve)); stopBackend(); await done;
                }
                lastAttempt = selected(); await runBackend();
            }
            else if (req.url === '/stop') { lastAttempt = selected(); stopBackend(); }
            else if (req.url === '/generation') { saveSettings(root,data); }
            else if (req.url === '/filter-preview') { json(200,{text:filterReply(data.text||'',readSettings(root))}); return; }
            else if (req.url === '/hardware') {
                if (backend || starting) throw new Error('Stop AI before changing hardware settings.');
                const current = fs.existsSync(path.join(root, 'backend.json')) ? fs.readFileSync(path.join(root, 'backend.json')) : null;
                try { fs.writeFileSync(path.join(root, 'backend.json'), JSON.stringify(data)); backendArguments(root, ''); }
                catch (e) { if (current) fs.writeFileSync(path.join(root, 'backend.json'), current); else fs.unlinkSync(path.join(root, 'backend.json')); throw e; }
                state = 'Hardware settings saved. Load your model to apply them.';
            }
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
                if (Date.now() - loadingSince > readinessTimeout) { backendError = 'Model loading timed out. Lower context or choose CPU in Hardware settings.'; state = backendError; stopBackend('timeout'); return; }
                const result = await fetch(backendURL + '/api/v1/model', { signal: AbortSignal.timeout(1500) });
                if (result.ok) { const data = await result.json(); if (data.result && data.result !== 'ReadOnly') { backendReady = true; engineState = 'ready'; state = 'AI ready. Hero Tavern is connecting your chat automatically.'; } }
            }
        } catch (e) { if (!backend) { state = e.message; backendError = e.message; engineState = 'error'; } } finally { checking = false; }
    }, pollInterval);
    server.on('close', () => { clearInterval(timer); pipeline.abort(); download?.process?.kill(); stopBackend(); manager?.kill(); });
    server.listen(port, '127.0.0.1');
    return server;
}
module.exports = { createBridge, verifyModel, resolveModel, backendArguments };
if (require.main === module) {
    const server = createBridge(process.argv[2] || __dirname);
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit()));
}
