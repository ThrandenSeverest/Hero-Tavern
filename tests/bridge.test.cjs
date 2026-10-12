const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { createBridge, verifyModel, resolveModel } = require('../manager/ModelBridge.cjs');

test('Library opens without a selected model and rejects unauthorized control requests', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hero-ui-test-'));
    let server;
    try {
        for (const name of ['models.json', 'ModelPanel.html']) fs.copyFileSync(path.join(__dirname, '../manager', name), path.join(root, name));
        server = createBridge(root, { port: 0, autoStart: false });
        await once(server, 'listening');
        const origin = 'http://127.0.0.1:' + server.address().port;
        const page = await (await fetch(origin)).text();
        assert.match(page, /chat connection is configured automatically/);
        const token = /const token='([a-f0-9]+)'/.exec(page)[1];
        const headers = { 'X-Hero-Token': token, 'Content-Type': 'application/json', Origin: origin };
        const state = await (await fetch(origin + '/status', { headers })).json();
        assert.equal(state.selected, '');
        assert.equal(state.backendRunning, false);
        assert.equal(state.catalog.length, 8);
        assert.match(state.catalog[0].Label, /Qwen3 8B/);
        assert.equal((await fetch(origin + '/status')).status, 403);
        const diagnostic=await(await fetch(origin+'/diagnostics/text',{method:'POST',headers,body:JSON.stringify({prompt:'Hello'})})).json();assert.equal(diagnostic.ok,false);assert.match(diagnostic.error,/Load a text model/);assert.ok(fs.existsSync(path.join(root,'Diagnostics/latest-text.json')));
        assert.equal((await fetch(origin + '/start', { method: 'POST', headers: { ...headers, Origin: 'https://example.com' }, body: '{}' })).status, 403);
        const start = await fetch(origin + '/start', { method: 'POST', headers, body: '{}' });
        assert.equal(start.status, 400);
        assert.match((await start.json()).error, /Download or select/);
        const badSelection = await fetch(origin + '/select', { method: 'POST', headers, body: JSON.stringify({ name: '../outside.gguf' }) });
        assert.equal(badSelection.status, 400);
    } finally {
        if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('Web downloader validates GGUF bytes, version, size and hash', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hero-gguf-test-'));
    try {
        const file = path.join(root, 'fixture.gguf');
        const bytes = Buffer.alloc(1024 * 1024);
        bytes.write('GGUF'); bytes.writeUInt32LE(3, 4);
        fs.writeFileSync(file, bytes);
        const hash = crypto.createHash('sha256').update(bytes).digest('hex');
        await verifyModel(file, bytes.length, hash);
        await assert.rejects(verifyModel(file, bytes.length + 1, hash), /Incomplete/);
        await assert.rejects(verifyModel(file, bytes.length, '0'.repeat(64)), /SHA-256/);
        bytes[0] = 0; fs.writeFileSync(file, bytes);
        await assert.rejects(verifyModel(file), /Invalid GGUF/);
        assert.throws(() => resolveModel(root, '../outside.gguf'), /Invalid model name/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

async function waitFor(check, ms = 10000) {
    const until = Date.now() + ms;
    while (Date.now() < until) { if (await check()) return; await new Promise(r => setTimeout(r, 100)); }
    throw new Error('Timed out waiting for engine state');
}
async function freePort() {
    const server = require('node:net').createServer().listen(0, '127.0.0.1');
    await once(server, 'listening'); const port = server.address().port;
    await new Promise(r => server.close(r)); return port;
}
test('Selected model auto-starts a real child process with a spaced path and becomes ready', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hero engine with spaces '));
    let server, headers, origin;
    try {
        for (const name of ['models.json', 'ModelPanel.html']) fs.copyFileSync(path.join(__dirname, '../manager', name), path.join(root, name));
        fs.mkdirSync(path.join(root, 'Models'));
        const model = path.join(root, 'Models/model with spaces.gguf'), bytes = Buffer.alloc(1024*1024);
        bytes.write('GGUF');bytes.writeUInt32LE(3,4);fs.writeFileSync(model,bytes);
        fs.writeFileSync(path.join(root,'Models/selected-model.txt'),model);
        fs.writeFileSync(path.join(root,'backend.json'),JSON.stringify({mode:'cpu',gpuLayers:0,contextSize:4096}));
        const enginePort=await freePort();
        server=createBridge(root,{port:0,backendPort:enginePort,backendCommand:process.execPath,backendPrefix:[path.join(__dirname,'fixtures/fake-kobold.cjs')],pollInterval:100});
        await once(server,'listening');origin='http://127.0.0.1:'+server.address().port;
        const page=await(await fetch(origin)).text(),token=/const token='([a-f0-9]+)'/.exec(page)[1];
        headers={'X-Hero-Token':token,'Content-Type':'application/json',Origin:origin};
        let state;
        await waitFor(async()=>{state=await(await fetch(origin+'/status',{headers})).json();return state.backendReady});
        assert.equal(state.runningModel,'model with spaces.gguf');assert.equal(state.engineState,'ready');assert.equal(state.backendError,'');
        assert.equal((await(await fetch('http://127.0.0.1:'+enginePort+'/api/v1/model')).json()).result,'fixture-kobold-model');
        const logs=await(await fetch(origin+'/logs',{headers})).json();assert.match(logs.output,/Fixture model loaded/);
        const hardware=await fetch(origin+'/hardware',{method:'POST',headers,body:JSON.stringify({mode:'cuda',gpuLayers:-1,contextSize:8192})});assert.equal(hardware.status,400);
        await fetch(origin+'/stop',{method:'POST',headers,body:'{}'});
        await waitFor(async()=>!(await(await fetch(origin+'/status',{headers})).json()).backendRunning);
        const stopped=await(await fetch(origin+'/status',{headers})).json();assert.equal(stopped.engineState,'stopped');assert.equal(stopped.backendError,'');
        const saved=await fetch(origin+'/hardware',{method:'POST',headers,body:JSON.stringify({mode:'cpu',gpuLayers:0,contextSize:2048})});assert.equal(saved.status,200);
    } finally {
        if(server)await new Promise(r=>{server.close(r);server.closeAllConnections()});
        // Windows may need a moment to release inherited log handles.
        fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});
    }
});
