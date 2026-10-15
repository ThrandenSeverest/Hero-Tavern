'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {DEFAULTS,validateSettings,samplerFor}=require('../manager/ReplyPipeline.cjs');
const qwen={Family:'Qwen3',File:'Qwen3-8B.gguf'};
test('existing settings keep manual native sampling defaults',()=>{
 const s=validateSettings({temperature:0.8,top_p:0.9});
 assert.equal(s.samplerPreset,'manual');assert.equal(s.rep_pen_range,1024);
 assert.equal(samplerFor(s,qwen,'chat').parameters.temperature,0.8);
});
test('mode-specific presets avoid changing chat when Writer uses creative sampling',()=>{
 const s=validateSettings({samplerPreset:'manual',samplerModes:{writer:'creative',state:'precise'}});
 assert.equal(samplerFor(s,qwen,'chat').preset,'manual');
 assert.equal(samplerFor(s,qwen,'writer').parameters.dry_multiplier,0.6);
 assert.equal(samplerFor(s,qwen,'state').parameters.temperature,0.25);
});
test('Qwen3 model preset follows nonthinking family recipe',()=>{
 const s=validateSettings({samplerPreset:'model'});
 const p=samplerFor(s,qwen,'chat').parameters;
 assert.equal(p.temperature,0.7);assert.equal(p.top_p,0.8);assert.equal(p.min_p,0);
});
test('catalog recipe overrides model defaults for third-party fine-tunes',()=>{
 const s=validateSettings({samplerPreset:'model'});
 const p=samplerFor(s,{Family:'Mistral NeMo',Sampler:{temperature:0.88,repetition_penalty:1.04}},'chat').parameters;
 assert.equal(p.temperature,0.88);assert.equal(p.rep_pen,1.04);
});
test('JSON mode retains existing stable temperature',()=>{
 const s=validateSettings({samplerPreset:'creative',samplerModes:{adventure:'creative'}});
 assert.equal(samplerFor(s,qwen,'adventure-json').parameters.temperature,0.35);
});
test('invalid sampler configuration fails before writing settings',()=>{
 assert.throws(()=>validateSettings({dry_multiplier:99}),/Invalid dry_multiplier/);
 assert.throws(()=>validateSettings({samplerModes:{chat:'unknown'}}),/Invalid mode/);
 assert.throws(()=>validateSettings({sampler_seed:1.5}),/Invalid sampler_seed/);
});
test('seed and penalty windows reach native completion payload',()=>{
 const s=validateSettings({sampler_seed:1234,rep_pen_range:250,presence_penalty:0.25,dry_multiplier:0.5});
 const p=samplerFor(s,qwen,'chat').parameters;
 assert.equal(p.sampler_seed,1234);assert.equal(p.rep_pen_range,250);
 assert.equal(p.presence_penalty,0.25);assert.equal(p.dry_multiplier,0.5);
});
