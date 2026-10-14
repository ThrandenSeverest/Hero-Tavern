'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {once}=require('node:events');
const {makeGraph,createComfyAdapter,checkPNG}=require('../manager/ComfyAdapter.cjs');
const params={prompt:'Two warriors in the tavern',negative_prompt:'blurry',width:512,height:512,steps:20,cfg_scale:6,seed:10,sampler_name:'Euler'};
test('ComfyUI txt2img graph creates nodes without external extensions',()=>{
 const {graph,saveId}=makeGraph({checkpoint:'art.safetensors',params});
 assert.equal(graph[saveId].class_type,'SaveImage');
 assert.ok(Object.values(graph).some(v=>v.class_type==='KSampler'));
 assert.ok(!Object.values(graph).some(v=>v.class_type==='LoadImage'));
});
test('Masked image edits composite back into the original and never use a full-scene output',()=>{
 const {graph,saveId}=makeGraph({checkpoint:'art.safetensors',params,source:'source.png',mask:'mask.png'});
 assert.equal(graph[saveId].class_type,'SaveImage');
 const composites=Object.values(graph).filter(v=>v.class_type==='ImageCompositeMasked');
 assert.equal(composites.length,1);
 assert.ok(Object.values(graph).some(v=>v.class_type==='VAEEncodeForInpaint'));
 assert.ok(Object.values(graph).some(v=>v.class_type==='LoadImageMask'));
});
test('Checkpoint name and image headers are checked before using ComfyUI',()=>{
 assert.throws(()=>makeGraph({checkpoint:'../../bad.safetensors',params}),/checkpoint/i);
 assert.throws(()=>checkPNG(Buffer.from('bad')),/PNG/);
});
test('ComfyUI adapter executes a stub local workflow and retains source images',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-comfy-test-'));
 const png=Buffer.alloc(33);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.write('IHDR',12,'ascii');png.writeUInt32BE(512,16);png.writeUInt32BE(512,20);
 let promptGraph=null;
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  let answer=null,body=Buffer.alloc(0);for await(const chunk of req)body=Buffer.concat([body,chunk]);
  if(url.pathname==='/system_stats')answer={devices:[]};
  else if(url.pathname==='/models/checkpoints')answer=['art.safetensors'];
  else if(url.pathname==='/prompt'){promptGraph=JSON.parse(body).prompt;answer={prompt_id:'job-123'};}
  else if(url.pathname==='/history/job-123')answer={'job-123':{status:{completed:true},outputs:{[Object.entries(promptGraph).find(([,v])=>v.class_type==='SaveImage')[0]]:{images:[{filename:'generated.png',subfolder:'',type:'output'}]}}}};
  else if(url.pathname==='/view'){res.setHeader('Content-Type','image/png');res.end(png);return;}
  else if(url.pathname==='/free')answer={};
  else {res.statusCode=404;answer={error:'not supported'};}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(answer));
 }).listen(0,'127.0.0.1');await once(server,'listening');
 try{
  const adapter=createComfyAdapter(root,{port:server.address().port});
  assert.equal(await adapter.available(),true);
  assert.deepEqual(await adapter.checkpoints(),['art.safetensors']);
  const result=await adapter.generate(params,{checkpoint:'art.safetensors'});
  assert.match(result.url,/^\/images\/output\/\d+-[a-f0-9]+\.png$/);
  assert.ok(fs.existsSync(path.join(root,'Images',path.basename(result.url))));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'Images',path.basename(result.url)+'.json'))).engine,'comfyui');
  await adapter.freeMemory({confirm:true});
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true})}
});

test('Disconnected ComfyUI diagnosis never pretends every Qwen node is missing',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-comfy-offline-'));
 try{
  const adapter=createComfyAdapter(root,{fetchFn:async()=>{throw Error('ECONNREFUSED')}});
  const report=await adapter.diagnosePack('qwen21-q5km');
  assert.equal(report.status,'offline');
  assert.equal(report.connected,false);
  assert.deepEqual(report.missingNodes,[]);
  assert.deepEqual(report.missingFiles,[]);
  assert.ok(report.requiredNodesNotChecked.includes('TextEncodeQwenImage21'));
  assert.match(report.advice,/offline|cannot be tested/i);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('Qwen GGUF is discovered through the GGUF loader inventory even when core diffusion list omits it',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-comfy-gguf-')),models=path.join(root,'models');
 try{
  fs.mkdirSync(path.join(models,'diffusion_models'),{recursive:true});
  const adapter=createComfyAdapter(root,{fetchFn:async url=>{
   const route=new URL(url).pathname;
   const data=route==='/system_stats'?{devices:[]}:
    route==='/models/unet_gguf'?['qwen-image-2.1-Q5_K_M.gguf']:
    route==='/models/text_encoders'?['qwen3vl_8b_int8_convrot.safetensors']:
    route==='/models/vae'?['qwen_image_2.1_vae_bf16.safetensors']:
    route==='/object_info'?Object.fromEntries(['UnetLoaderGGUF','CLIPLoader','VAELoader','TextEncodeQwenImage21','LatentUpscale','RepeatLatentBatch','KSampler','VAEDecode','SaveImage'].map(k=>[k,{}])):
    route==='/object_info/KSampler'?{KSampler:{input:{required:{}}}}:[];
   return new Response(JSON.stringify(data),{status:200});
  }});
  const catalog=await adapter.catalog();
  assert.ok(catalog.lists.diffusion_models.includes('qwen-image-2.1-Q5_K_M.gguf'));
  assert.equal(catalog.packs.find(p=>p.id==='qwen21-q5km').installed,true);
  const report=await adapter.diagnosePack('qwen21-q5km');
  assert.equal(report.ok,true);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
