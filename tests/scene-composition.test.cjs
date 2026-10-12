'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {scenePrompt,regionsForScene,validateScene,comfyRegionalWorkflow}=require('../manager/SceneComposition.cjs');
const {createStudio}=require('../manager/ImageStudio.cjs');
const characters=[
 {description:'Short red-bearded dwarf, axe, at the far left'},
 {description:'Blonde elven archer in green armor'},
 {description:'Blue-robed wizard casting violet magic'},
 {description:'Grey catfolk rogue with striped tail and daggers'}
];
const scene={background:'A candlelit fantasy tavern',layout:'row',characters};
test('Scenes require two to six explicitly described people and preserve all identities',()=>{
 assert.throws(()=>validateScene({background:'tavern',characters:[characters[0]]}),/2–6/);
 assert.throws(()=>validateScene({...scene,characters:[{},characters[0]]}),/Describe character/);
 const prompt=scenePrompt(scene);
 assert.match(prompt,/Exactly 4 distinct characters/);
 for(const c of characters)assert.ok(prompt.includes(c.description));
 assert.match(prompt,/no.*background bystanders/i);
});
test('Spatial boxes partition a canvas and grid placements stay within bounds',()=>{
 const row=regionsForScene(validateScene(scene),1024,768);
 assert.deepEqual(row.map(x=>[x.x,x.y,x.width,x.height]),[[0,0,256,768],[256,0,256,768],[512,0,256,768],[768,0,256,768]]);
 const grid=regionsForScene(validateScene({...scene,layout:'grid'}),1024,768);
 assert.deepEqual(grid.map(x=>[x.x,x.y,x.width,x.height]),[[0,0,512,384],[512,0,512,384],[0,384,512,384],[512,384,512,384]]);
});
test('ComfyUI workflow uses actual separate regional conditionings and no new model download',()=>{
 const r=comfyRegionalWorkflow({scene,checkpoint:'test.safetensors',width:1024,height:768,seed:42});
 const nodes=Object.values(r.workflow),kinds=nodes.map(n=>n.class_type);
 assert.equal(kinds.filter(x=>x==='ConditioningSetArea').length,4);
 assert.equal(kinds.filter(x=>x==='ConditioningCombine').length,4);
 assert.ok(kinds.includes('CheckpointLoaderSimple'));
 assert.ok(kinds.includes('KSampler'));
 assert.equal(nodes.find(n=>n.class_type==='KSampler').inputs.seed,42);
 assert.throws(()=>comfyRegionalWorkflow({scene,checkpoint:'../bad.safetensors'}),/checkpoint/);
});
test('Studio scene mode prepends deterministic character constraints and exports spatial plan without GPU',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-regional-'));fs.mkdirSync(path.join(root,'Images'));
 let sent;
 const studio=createStudio(root,{pipeline:{abort(){}},ensureText:async()=>{},getImageState:()=>({selected:'SDXL.safetensors'}),generateImage:async input=>{sent=input;return {url:'/images/output/123-abcdef123456.png',model:'SDXL'}}});
 try{
  const preview=await studio.action('/studio/scene-preview',{scene});
  assert.match(preview.prompt,/PERSON 4 of 4/);
  const out=await studio.action('/studio/generate',{prompt:'An adventuring party',scene,refine:false,width:1024,height:768});
  assert.match(sent.prompt,/PERSON 4 of 4/);
  assert.match(sent.prompt,/An adventuring party/);
  assert.equal(out.scene.characters.length,4);
  const exported=await studio.action('/studio/scene-export',{scene,checkpoint:'test.safetensors',width:1024,height:768});
  assert.equal(exported.regions.length,4);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
