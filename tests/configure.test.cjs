const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { configure } = require('../manager/ConfigureTavern.cjs');
test('Fresh profile uses local KoboldCpp and Qwen; repair preserves edited settings', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hero-tavern-test-'));
    try {
        fs.mkdirSync(path.join(root, 'default/content'), { recursive: true });
        fs.writeFileSync(path.join(root, 'default/content/settings.json'), JSON.stringify({
            username: 'User', textgenerationwebui_settings: { temp: 0.7 }, power_user: { theme: 'Test' },
        }));
        assert.equal(configure(root), true);
        const dest = path.join(root, 'data/default-user/settings.json');
        const settings = JSON.parse(fs.readFileSync(dest));
        assert.equal(settings.main_api, 'textgenerationwebui');
        assert.equal(settings.textgenerationwebui_settings.type, 'koboldcpp');
        assert.equal(settings.textgenerationwebui_settings.server_urls.koboldcpp, 'http://127.0.0.1:5001');
        assert.equal(settings.textgenerationwebui_settings.temp, 0.7);
        assert.equal(settings.power_user.theme, 'Test');
        assert.match(settings.power_user.instruct.last_output_sequence, /<think>/);
        fs.writeFileSync(dest, '{"username":"Existing user","custom":42}');
        const before = fs.readFileSync(dest);
        assert.equal(configure(root), false);
        assert.deepEqual(fs.readFileSync(dest), before);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
