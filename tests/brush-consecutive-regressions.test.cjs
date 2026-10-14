'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const dir=path.join(__dirname,'../manager'),panel=fs.readFileSync(path.join(dir,'ModelPanel.html'),'utf8'),runner=fs.readFileSync(path.join(dir,'ModelTestsPanel.js'),'utf8');
const {createModelTests}=require('../manager/ModelTests.cjs');
test('inpaint brush uses transparent canvas and exports black/white PNG for ComfyUI',()=>{
 assert.match(panel,/heroMaskPixelCtx\.clearRect\(0,0,bitmap\.width,bitmap\.height\)/);
 assert.match(panel,/globalCompositeOperation=heroErase\?'destination-out':'source-over'/);
 assert.match(panel,/function heroMaskExport\(\)/);
 assert.match(panel,/ctx\.fillStyle='#000';ctx\.fillRect\(0,0,png\.width,png\.height\);ctx\.drawImage\(heroMaskPixels,0,0\)/);
 assert.match(panel,/maskData:heroMaskExport\(\)/);
 assert.doesNotMatch(panel,/heroMaskPixelCtx\.fillStyle='#000';heroMaskPixelCtx\.fillRect/);
});
test('installed-model comparison runs identical prompts for each model sequentially',()=>{
 assert.match(panel,/id="model-test-compare-installed"/);
 assert.match(runner,/\.filter\(p=>p\.installed&&p\.id/);
 assert.match(runner,/for\(const second of \[false,true\]\)/);
 assert.match(runner,/model:pack\.id,second,suiteId:runId/);
 assert.match(runner,/base\(model\)/);
 assert.match(runner,/if\(stopRequested\)break/);
});
test('consecutive comparison journal keeps its group id',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-suite-'));
 try{const v=createModelTests(root),r=v.record({kind:'text2text',model:'fixture',status:'passed',text:'BLUE LANTERN',suiteId:'compare-1790000000000'});assert.equal(r.suiteId,'compare-1790000000000');assert.equal(v.history()[0].suiteId,r.suiteId);}finally{fs.rmSync(root,{recursive:true,force:true})}
});

test('inpaint painting keeps reusable preview canvas and single-pointer capture',()=>{
 assert.match(panel,/heroMaskOverlayCtx/);
 assert.match(panel,/heroMaskRenderQueued=true/);
 assert.match(panel,/requestAnimationFrame\(\(\)=>/);
 assert.match(panel,/heroActivePointer=ev.pointerId/);
 assert.match(panel,/heroMaskDirty=heroMaskHasPaint\(\)/);
});
test('image-to-image diagnostics use engine-aborting timeout and Writer has no fixed 1100px cap',()=>{
 assert.match(runner,/callTest\('\/studio\/generate',input,kind,210000\)/);
 const writer=fs.readFileSync(path.join(dir,'Writer.html'),'utf8');
 assert.doesNotMatch(writer,/max-width:1100px/);
});
