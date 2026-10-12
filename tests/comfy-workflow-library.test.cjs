'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createWorkflowLibrary}=require('../manager/ComfyWorkflowLibrary.cjs');
const {buildWorkflow}=require('../manager/ComfyWorkflows.cjs');
const makeRoot=()=>fs.mkdtempSync(path.join(os.tmpdir(),'hero-comfy-api-'));
const graph={
 '1':{class_type:'UNETLoader',inputs:{unet_name:'z_image_turbo_nvfp4.safetensors',weight_dtype:'default'}},
 '2':{class_type:'CLIPTextEncode',inputs:{text:'{{prompt}}',clip:['5',0]}},
 '3':{class_type:'KSampler',inputs:{model:['1',0],positive:['2',0],negative:['2',0],latent_image:['6',0],seed:'{{seed}}',steps:'{{steps}}',cfg:'{{guidance}}',sampler_name:'euler',scheduler:'normal',denoise:1}},
 '4':{class_type:'SaveImage',inputs:{images:['7',0],filename_prefix:'Hero'}},
 '5':{class_type:'CLIPLoader',inputs:{clip_name:'qwen_3_4b.safetensors',type:'stable_diffusion',device:'default'}},
 '6':{class_type:'EmptyLatentImage',inputs:{width:'{{width}}',height:'{{height}}',batch_size:1}},
 '7':{class_type:'VAEDecode',inputs:{samples:['3',0],vae:['8',0]}},
 '8':{class_type:'VAELoader',inputs:{vae_name:'ae.safetensors'}}
};
test('Imported core-only ComfyUI API graph is local, injectable, persistent and deletable only with confirmation',()=>{
 const root=makeRoot();
 try{
  const lib=createWorkflowLibrary(root);
  assert.throws(()=>lib.importWorkflow({name:'Fast art',workflow:graph}),/Confirm/);
  const saved=lib.importWorkflow({name:'Fast art',workflow:graph,confirm:true});
  assert.equal(saved.nodes,8);assert.equal(lib.list().length,1);
  const compiled=lib.build(saved.id,{prompt:'A bustling tavern',seed:123,steps:8,width:1024,height:768,cfg_scale:5});
  assert.equal(compiled.graph['2'].inputs.text,'A bustling tavern');
  assert.equal(compiled.graph['3'].inputs.seed,123);assert.equal(compiled.graph['6'].inputs.width,1024);
  assert.equal(graph['2'].inputs.text,'{{prompt}}','import must not alter original object');
  assert.throws(()=>lib.remove({id:saved.id}),/Confirm/);
  assert.equal(lib.remove({id:saved.id,confirm:true}).deleted,true);
  assert.equal(lib.list().length,0);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('Unsafe executors, absolute paths and foreign custom nodes cannot import implicitly',()=>{
 const root=makeRoot();
 try{
  const lib=createWorkflowLibrary(root);
  const script={...graph,'9':{class_type:'ExecuteShellCommand',inputs:{command:'shutdown'}}};
  assert.throws(()=>lib.importWorkflow({name:'Bad',workflow:script,confirm:true,allowCustomNodes:true}),/unsafe/i);
  const exotic={...graph,'9':{class_type:'NovelModelSampler',inputs:{model:['1',0]}}};
  assert.throws(()=>lib.importWorkflow({name:'Unreviewed',workflow:exotic,confirm:true}),/custom/i);
  const reviewed=lib.importWorkflow({name:'Reviewed',workflow:exotic,confirm:true,allowCustomNodes:true});
  assert.deepEqual(reviewed.customNodes,['NovelModelSampler']);
  const remote={...graph,'1':{class_type:'UNETLoader',inputs:{unet_name:'https://evil.test/model',weight_dtype:'default'}}};
  assert.throws(()=>lib.importWorkflow({name:'Remote',workflow:remote,confirm:true}),/URL/i);
  assert.throws(()=>lib.get('../../user'),/ID/i);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('Core-node upscaler needs no diffusion checkpoint',()=>{
 const r=buildWorkflow({params:{prompt:'upscale'},source:'image.png',mode:'upscale',upscaleFactor:2});
 assert.ok(Object.values(r.graph).some(n=>n.class_type==='ImageScaleBy'));
});
