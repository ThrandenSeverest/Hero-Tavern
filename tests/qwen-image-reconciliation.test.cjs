'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createModelHub,QWEN_PACKS}=require('../manager/ComfyModelHub.cjs');
const {createImageModelCenter}=require('../manager/ImageModelCenter.cjs');
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'hero-qwen-reconcile-'));
test('Qwen Q5_K_M official filenames use correct Hugging Face sources',()=>{
 const pack=QWEN_PACKS.find(p=>p.id==='qwen21-q5km');
 assert.equal(pack.files[0].source,'qwen-image-2.1-Q5_K_M.gguf');
 assert.equal(pack.files[0].repo,'unsloth/Qwen-Image-2.1-GGUF');
 assert.equal(pack.files[1].source,'text_encoders/qwen3vl_8b_int8_convrot.safetensors');
 assert.equal(pack.files[2].source,'vae/qwen_image_2.1_vae_bf16.safetensors');
});
test('Missing Qwen denoiser never appears installed even when encoder and VAE are on disk',()=>{
 const root=temp(),modelRoot=path.join(root,'Comfy','models');
 try{
  for(const group of ['text_encoders','vae','diffusion_models'])fs.mkdirSync(path.join(modelRoot,group),{recursive:true});
  fs.writeFileSync(path.join(modelRoot,'text_encoders','qwen3vl_8b_int8_convrot.safetensors'),Buffer.alloc(1048576));
  fs.writeFileSync(path.join(modelRoot,'vae','qwen_image_2.1_vae_bf16.safetensors'),Buffer.alloc(1048576));
  fs.writeFileSync(path.join(modelRoot,'diffusion_models','qwen-image-2.1-Q5_K_M.gguf.part'),Buffer.alloc(1048576));
  const hub=createModelHub(root);hub.configure({modelRoot});
  const before=hub.localStatus().find(p=>p.id==='qwen21-q5km');
  assert.equal(before.installed,false);assert.deepEqual(before.missing,['diffusion_models/qwen-image-2.1-Q5_K_M.gguf']);
  fs.writeFileSync(path.join(modelRoot,'diffusion_models','qwen-image-2.1-Q5_K_M.gguf'),'placeholder');
  assert.equal(hub.localStatus().find(p=>p.id==='qwen21-q5km').installed,false);
  fs.writeFileSync(path.join(modelRoot,'diffusion_models','qwen-image-2.1-Q5_K_M.gguf'),Buffer.alloc(1048576));
  assert.equal(hub.localStatus().find(p=>p.id==='qwen21-q5km').installed,true);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('Managed engine reloads after download and refuses to report ready if Comfy model inventory is stale',async()=>{
 const root=temp(),modelRoot=path.join(root,'Comfy','models');fs.mkdirSync(modelRoot,{recursive:true});
 let running=true,loads=0,checks=0;
 const runtime={installed:()=>({models:modelRoot}),status:()=>({mode:'managed',running,error:''}),stop:async()=>{running=false},start:async()=>{loads++;running=true}};
 const studio={snapshot:()=>({settings:{modelPack:'sdxl',engine:'auto'}}),action:async()=>{}};
 const models={snapshot:()=>({settings:{modelRoot,selected:'sdxl'},download:null}),configure:()=>{},localStatus:()=>[],downloadPack:async()=>({modelRoot}),select:()=>{}};
 const comfy={models,available:async()=>running,diagnosePack:async()=>{checks++;return {ok:false,missingFiles:['diffusion_models/qwen-image-2.1-Q5_K_M.gguf'],missingNodes:[],advice:'Reload model list'}},catalog:async()=>({available:running,packs:[]}),snapshot:()=>({})};
 const center=createImageModelCenter(root,{studio,comfy,runtime,images:{snapshot:()=>({})}});
 try{
  center.startDownload({id:'qwen21-q5km',confirm:true});
  for(let i=0;i<40&&!((await center.status()).lastDownload);i++)await new Promise(r=>setTimeout(r,15));
  const status=await center.status();
  assert.equal(loads,1);assert.equal(checks,1);assert.equal(status.lastDownload.ok,false);
  assert.match(status.lastDownload.message,/qwen-image-2.1-Q5_K_M.gguf/);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
