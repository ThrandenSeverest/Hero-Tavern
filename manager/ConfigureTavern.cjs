// Configure a fresh default profile. Existing user settings are never overwritten.
const fs = require('node:fs');
const path = require('node:path');
function configure(st) {
    const destination = path.join(st, 'data', 'default-user', 'settings.json');
    if (fs.existsSync(destination)) return false;
    const settings = JSON.parse(fs.readFileSync(path.join(st, 'default', 'content', 'settings.json'), 'utf8'));
    settings.firstRun = false;
    settings.main_api = 'textgenerationwebui';
    settings.max_context = 4096;
    settings.amount_gen = 512;
    settings.textgenerationwebui_settings = {
        ...settings.textgenerationwebui_settings, type: 'koboldcpp',
        server_urls: { koboldcpp: 'http://127.0.0.1:5001' }, streaming: true,
    };
    settings.power_user = settings.power_user || {};
    settings.power_user.instruct = {
        ...settings.power_user.instruct, enabled: true, preset: 'Hero Tavern - Qwen ChatML',
        input_sequence: '<|im_start|>user\n', output_sequence: '<|im_start|>assistant\n',
        system_sequence: '<|im_start|>system\n', input_suffix: '<|im_end|>\n',
        output_suffix: '<|im_end|>\n', system_suffix: '<|im_end|>\n', first_output_sequence: '',
        last_output_sequence: '<|im_start|>assistant\n<think>\n\n</think>\n\n',
        stop_sequence: '<|im_end|>', wrap: false, macro: true, names_behavior: 'force',
    };
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, JSON.stringify(settings, null, 2) + '\n', { flag: 'wx' });
    return true;
}
module.exports = { configure };
if (require.main === module) {
    if (!process.argv[2]) throw new Error('Supply the SillyTavern directory');
    console.log(configure(process.argv[2]) ? 'Configured local Qwen connection.' : 'Preserved existing user settings.');
}
