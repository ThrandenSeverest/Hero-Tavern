'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {once}=require('node:events');
const {buildWorkflow}=require('../manager/ComfyWorkflows.cjs');
const {createComfyAdapter}=require('../manager/ComfyAdapter.cjs');
const {createImageGallery}=require('../manager/ImageGallery.cjs');
const params={prompt:'Two distinct heroes near a castle',negative_prompt:'blurry',width:512,height:512,steps:20,cfg_scale:6,seed:123,sampler_name:'Euler'};
const types=graph=>Object.values(graph).map(n=>n.class_type);
test('ComfyUI advanced workflows use core nodes for LoRA, batches, img2img, masked edits, scene regions and AI upscale',()=>{
 let a=buildWorkflow({checkpoint:'art.safetensors',params:{...params,batch_size:2},lora:[{name:'styles/folk.safetensors',strength:0.8}]});
 assert.ok(types(a.graph).includes('LoraLoader'));
 assert.equal(Object.values(a.graph).find(n=>n.class_type==='EmptyLatentImage').inputs.batch_size,2);
 a=buildWorkflow({checkpoint:'art.safetensors',params,source:'hero.png',mode:'img2img'});
 assert.ok(types(a.graph).includes('VAEEncode'));assert.ok(!types(a.graph).includes('VAEEncodeForInpaint'));
 a=buildWorkflow({checkpoint:'art.safetensors',params,source:'hero.png',mask:'mask.png'});
 assert.ok(types(a.graph).includes('VAEEncodeForInpaint'));assert.ok(types(a.graph).includes('ImageCompositeMasked'));
 a=buildWorkflow({checkpoint:'art.safetensors',params:{...params,scene:{background:'medieval market',characters:[{description:'red haired elf left'},{description:'dwarf knight right'}],layout:'row'}}});
 assert.equal(types(a.graph).filter(x=>x==='ConditioningSetArea').length,2);
 a=buildWorkflow({checkpoint:'art.safetensors',params:{...params,outpaint:{left:128,top:0,right:128,bottom:0,feathering:24}},source:'hero.png',mode:'outpaint'});
 assert.ok(types(a.graph).includes('ImagePadForOutpaint'));
 assert.ok(types(a.graph).includes('VAEEncodeForInpaint'));
 assert.ok(types(a.graph).includes('ImageCompositeMasked'));
 assert.throws(()=>buildWorkflow({checkpoint:'art.safetensors',params:{...params,outpaint:{left:13}},source:'hero.png',mode:'outpaint'}),/divisible by 8/);
 a=buildWorkflow({checkpoint:'art.safetensors',params,source:'hero.png',mode:'upscale',upscaleModel:'4x-HD.pth'});
 assert.ok(types(a.graph).includes('ImageUpscaleWithModel'));
 a=buildWorkflow({checkpoint:'art.safetensors',params,source:'hero.png',mode:'upscale',upscaleFactor:2});
 assert.ok(types(a.graph).includes('ImageScaleBy'));
 assert.throws(()=>buildWorkflow({checkpoint:'../private.safetensors',params}),/relative/i);
 assert.throws(()=>buildWorkflow({checkpoint:'art.safetensors',params:{...params,batch_size:5}}),/1–4/i);
});
test('Live ComfyUI mock preserves batch PNGs and exact seed in local image gallery',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-comfy-advanced-'));let graph=null;
 const png=Buffer.alloc(33);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.write('IHDR',12,'ascii');png.writeUInt32BE(512,16);png.writeUInt32BE(512,20);
 const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://localhost');
  let body='';for await(const chunk of req)body+=chunk;
  let value;
  switch(u.pathname){
   case '/system_stats':value={devices:[{type:'cuda',name:'Test GPU',vram_total:12884901888,vram_free:8589934592}]};break;
   case '/models/checkpoints':value=['art.safetensors'];break;
   case '/models/diffusion_models':value=['flux-2-klein-4b.safetensors'];break;
   case '/models/text_encoders':value=['qwen_3_4b.safetensors'];break;
   case '/models/vae':value=['flux2-vae.safetensors'];break;
   case '/models/loras':value=['styles/folk.safetensors'];break;
   case '/models/upscale_models':value=['4x-HD.pth'];break;
   case '/prompt':graph=JSON.parse(body).prompt;value={prompt_id:'a-job'};break;
   case '/history/a-job':{
    const id=Object.keys(graph).find(k=>graph[k].class_type==='SaveImage');
    value={'a-job':{status:{completed:true},outputs:{[id]:{images:[{filename:'one.png',subfolder:'',type:'output'},{filename:'two.png',subfolder:'',type:'output'}]}}}};break;
   }
   case '/queue':value={queue_running:[],queue_pending:[]};break;
   case '/view':res.setHeader('Content-Type','image/png');res.end(png);return;
   default:res.statusCode=404;value={error:'unsupported endpoint'};
  }
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));
 }).listen(0,'127.0.0.1');await once(server,'listening');
 try{
  const adapter=createComfyAdapter(root,{port:server.address().port,WebSocketClass:null});
  const catalog=await adapter.catalog();
  assert.equal(catalog.available,true);assert.equal(catalog.loras.length,1);assert.equal(catalog.upscalers.length,1);
  const result=await adapter.generate({...params,batch_size:2,lora:[{name:'styles/folk.safetensors',strength:0.8}]},{checkpoint:'art.safetensors'});
  assert.equal(result.images.length,2);assert.equal(result.seed,123);
  const gal=createImageGallery(root).list();
  assert.equal(gal.total,2);
  for(const item of gal.items){assert.equal(item.seed,123);assert.equal(item.engine,'comfyui');assert.ok(fs.statSync(path.join(root,'Images',item.name)).size>0)}
  assert.ok(fs.readFileSync(path.join(root,'Logs','image-files.jsonl'),'utf8').includes('comfy-image-saved'));
  const fluxPack=catalog.packs.find(p=>p.id==='flux-klein');
  assert.equal(fluxPack.installed,true,'FLUX is ready independently of checkpoint list');
  const flux=await adapter.generate({...params,modelPack:'flux-klein',operation:'txt2img',batch_size:1,lora:[]},{checkpoint:''});
  assert.equal(flux.engine,'comfyui');
  assert.equal(flux.modelPack,'flux-klein');
  assert.ok(Object.values(graph).some(node=>node.class_type==='Flux2Scheduler'));
  assert.ok(Object.values(graph).some(node=>node.class_type==='EmptyFlux2LatentImage'));
  assert.ok(!Object.values(graph).some(node=>node.class_type==='CheckpointLoaderSimple'),'FLUX must not depend on SDXL checkpoint node');

 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true})}
});
test('Local image import does not escape gallery and is protected from accidental deletion',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-comfy-source-'));
 try{
  const gal=createImageGallery(root);
  const png=Buffer.alloc(33);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.write('IHDR',12,'ascii');png.writeUInt32BE(512,16);png.writeUInt32BE(512,20);
  const stored=gal.importPNG({imageData:'data:image/png;base64,'+png.toString('base64'),source:'portrait.png'});
  assert.equal(gal.list().total,1);assert.equal(stored.engine,'import');
  assert.throws(()=>gal.remove({name:stored.name}),/Confirm/);
  assert.throws(()=>gal.importPNG({imageData:'data:image/png;base64,invalid##'}),/PNG/);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
