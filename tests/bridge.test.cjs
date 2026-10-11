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
        assert.match(page, /Your chat interface is already open/);
        const token = /const token='([a-f0-9]+)'/.exec(page)[1];
        const headers = { 'X-Hero-Token': token, 'Content-Type': 'application/json', Origin: origin };
        const state = await (await fetch(origin + '/status', { headers })).json();
        assert.equal(state.selected, '');
        assert.equal(state.backendRunning, false);
        assert.equal(state.catalog.length, 3);
        assert.match(state.catalog[0].Label, /Qwen3 8B/);
        assert.equal((await fetch(origin + '/status')).status, 403);
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
