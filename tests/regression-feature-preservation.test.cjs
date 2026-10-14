'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const panel=read('manager/ModelPanel.html'),nav=read('extension/index.js'),bridge=read('manager/ModelBridge.cjs'),tts=read('manager/TTSService.cjs'),writer=read('manager/Writer.html'),tools=read('manager/SharedTools.js');
test('regression: old diagnostics, multimodal testing and workflow controls remain discoverable',()=>{
 for(const id of ['model-center','model-tests','diagnostics','image-setup','comfy-workflows','models','vision','voices','hardware','generation','memory','creator','trackers','lore','inspector'])assert.ok(panel.includes('id="'+id+'"'),'missing screen '+id);
 for(const page of ['model-center','model-tests','diagnostics','writer','adventure','comfy-workflows','voices'])assert.ok(nav.includes("'"+page+"'"),'missing sidebar route '+page);
 for(const id of ['diagnostic-sequence','diagnostic-text','diagnostic-image','diagnostic-export'])assert.ok(panel.includes('id="'+id+'"'),'missing diagnostic control '+id);
 for(const route of ['/model-tests/record','/model-tests/text','/diagnostics/sample','/diagnostics/check','/diagnostics/text','/diagnostics/image'])assert.ok(bridge.includes(route),'missing backend route '+route);
});
test('regression: selected-model text tool is not Qwen-only Assistant',()=>{
 assert.match(tools,/api\('\/tools\/text'/);assert.match(bridge,/if\(req.url==='\/tools\/text'\)/);
});
test('regression: interrupted TTS install preserves existing env and user voice data',()=>{
 assert.match(tts,/Reusing existing Python 3\.11 environment/);
 assert.match(tts,/Preserved incomplete runtime at/);
 assert.match(tts,/Move-Item -LiteralPath \$target -Destination \$backup/);
 assert.match(tts,/uv pip directly manages environments without needing/);
 assert.doesNotMatch(tts,/Remove-Item.*TTSModels/);
});
test('regression: Writer passage editor occupies available width',()=>{
 assert.match(writer,/#writer-segments\{[^}]*max-width:none/);
 assert.match(writer,/\.writer-passage\{width:100%/);
 assert.match(writer,/Regenerate this/);
});

test('regression: full diagnostic workflow is discoverable and preserves per-stage evidence',()=>{
 const panel=read('manager/ModelPanel.html'),runner=read('manager/ModelTestsPanel.js');
 for(const id of ['model-test-run-diagnostic-flow','model-test-flow-stages','model-test-flow-summary','model-test-flow-export','diagnostic-open-flow'])
  assert.ok(panel.includes('id="'+id+'"'),'missing full flow control '+id);
 for(const stage of ["['preflight'","['text'","['imageA'","['imageB'","['edit'","['vision'","['tts'"])
  assert.ok(runner.includes(stage),'missing stage '+stage);
 for(const marker of ['/diagnostics/check','/diagnostics/sample','/tts/status','/tts/speak','/model-tests/text','/images/cancel','/tts/stop'])
  assert.ok(runner.includes(marker),'flow missing engine interaction '+marker);
 assert.match(runner,/flowReport\.summary=reportSummary\(\)/);
 assert.match(runner,/model-test-flow-export/);
});
