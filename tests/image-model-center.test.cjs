'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createImageModelCenter}=require('../manager/ImageModelCenter.cjs');
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-unified-image-'));
 const folder=path.join(root,'ComfyUI-Portable','ComfyUI','models');
 let configured='',selected='flux-klein',connected=false,activeModel='sdxl',checkpoint='',engine='auto',downloads=[],done;
 fs.mkdirSync(folder,{recursive:true});
 const packs=[
  {id:'flux-klein',name:'FLUX Klein',installed:connected,downloaded:true,files:[{group:'diffusion_models',name:'flux-2-klein-4b.safetensors'}],missing:connected?[]:['diffusion_models/flux-2-klein-4b.safetensors']},
  {id:'z-turbo',name:'Z-Image Turbo',installed:false,downloaded:false,files:[{group:'diffusion_models',name:'z_image_turbo_nvfp4.safetensors'}],missing:['diffusion_models/z_image_turbo_nvfp4.safetensors']},
  {id:'sdxl',name:'SDXL',installed:connected,downloaded:false,files:[{group:'checkpoints',name:'sd_xl_base_1.0.safetensors'}],missing:[]}
 ];
 const studio={snapshot:()=>({settings:{engine,modelPack:activeModel,comfyCheckpoint:checkpoint}}),action:async(route,data)=>{
  assert.equal(route,'/studio/configure');
  engine=data.engine||engine;activeModel=data.modelPack||activeModel;checkpoint=data.comfyCheckpoint||checkpoint;
  return {settings:{engine,modelPack:activeModel,comfyCheckpoint:checkpoint}};
 }};
 const comfy={
  catalog:async()=>({available:connected,packs,checkpoints:connected?['sd_xl_base_1.0.safetensors']:[],devices:[],error:connected?'':'Connection refused'}),
  models:{
   snapshot:()=>({settings:{modelRoot:configured,selected},download:null}),
   installed:()=>true,
   configure:({modelRoot})=>{configured=modelRoot;return {configured}},
   localStatus:()=>[{id:'flux-klein',installed:true},{id:'z-turbo',installed:false}],
   select:({id})=>{selected=id;return {id}},
   downloadPack:async({id,confirm})=>{assert.equal(confirm,true);downloads.push(id);await new Promise(r=>setTimeout(r,10));return {modelRoot:configured,packId:id}},
   cancel:()=>({cancelled:true})
  }
 };
 const runtime={installed:()=>({models:folder}),status:()=>({mode:'managed',detected:{models:folder},running:false,error:''})};
 const images={snapshot:()=>({selected:'',ready:false,installed:[]})};
 const center=createImageModelCenter(root,{studio,comfy,runtime,images});
 return {root,folder,center,downloads,connect:()=>{connected=true},studio};
}
test('Unified model selection persists across Studio / Chat / Adventure without legacy image checkpoints',async()=>{
 const f=fixture();try{
  let status=await f.center.status();assert.equal(status.choices.global,'flux-klein','Downloaded FLUX becomes initial default');
  assert.equal(status.models.find(x=>x.id==='flux-klein').downloaded,true);
  assert.equal(status.models.find(x=>x.id==='flux-klein').ready,false,'No false connected claim');
  await f.center.select({scope:'global',id:'flux-klein'});
  await f.center.select({scope:'chat',id:'z-turbo'});
  await f.center.select({scope:'adventure',id:'flux-klein'});
  assert.equal(f.center.forGeneration({prompt:'Forest'},'chat').modelPack,'z-turbo');
  assert.equal(f.center.forGeneration({prompt:'Forest'},'adventure').modelPack,'flux-klein');
  assert.equal(f.center.forGeneration({prompt:'Forest'},'adventure').engine,'comfyui');
  assert.equal(f.center.forGeneration({prompt:'Forest'},'global').modelPack,'flux-klein');
  const second=createImageModelCenter(f.root,{studio:f.studio,comfy:{
    catalog:async()=>({available:false,packs:[],error:'',devices:[]}),models:{
      snapshot:()=>({settings:{selected:'sdxl',modelRoot:f.folder}}),localStatus:()=>[],select:()=>{},downloadPack:async()=>{},
    }
   },runtime:{installed:()=>({models:f.folder}),status:()=>({mode:'managed',detected:{models:f.folder}})},images:{snapshot:()=>({})}});
  assert.equal(second.choice('chat'),'z-turbo');assert.equal(second.choice('adventure'),'flux-klein');
  await f.center.select({scope:'chat',inherit:true});assert.equal(f.center.choice('chat'),'flux-klein');
 }finally{fs.rmSync(f.root,{recursive:true,force:true})}
});
test('Managed ComfyUI models directory auto-resolves and model downloads run asynchronously with status',async()=>{
 const f=fixture();try{
  assert.equal(f.center.configureRoot(),f.folder);
  const started=f.center.startDownload({id:'z-turbo',confirm:true});
  assert.deepEqual(started,{started:true,packId:'z-turbo',directory:f.folder});
  let status=await f.center.status();assert.equal(status.download?.packId,'z-turbo');
  await new Promise(resolve=>setTimeout(resolve,35));
  status=await f.center.status();assert.equal(status.download,null);
  assert.equal(status.lastDownload.ok,true);
  assert.deepEqual(f.downloads,['z-turbo']);
  assert.throws(()=>f.center.startDownload({id:'flux-klein'}),/Confirm/);
 }finally{fs.rmSync(f.root,{recursive:true,force:true})}
});
test('SDXL installs through the same model downloader and picks a real checkpoint',async()=>{
 const f=fixture();try{
  f.connect();
  await f.center.select({id:'sdxl',scope:'global'});
  const chosen=await f.center.status();
  assert.equal(chosen.choices.global,'sdxl');
  assert.equal(f.studio.snapshot().settings.comfyCheckpoint,'sd_xl_base_1.0.safetensors');
  const pack=chosen.models.find(x=>x.id==='sdxl');
  assert.equal(pack.ready,true);
  f.center.startDownload({id:'sdxl',confirm:true});
  await new Promise(resolve=>setTimeout(resolve,40));
  assert.ok(f.downloads.includes('sdxl'));
 }finally{fs.rmSync(f.root,{recursive:true,force:true})}
});
test('Native adventure and Tavern providers pass image generation through shared scoped routing',()=>{
 const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
 const adapter=fs.readFileSync(path.join(root,'manager','AdventureAdapter.js'),'utf8');
 const chat=fs.readFileSync(path.join(root,'extension','images.js'),'utf8');
 const bridge=fs.readFileSync(path.join(root,'manager','ModelBridge.cjs'),'utf8');
 assert.match(adapter,/surface:'adventure'/);
 assert.match(adapter,/image\/model-center\/select/);
 assert.match(chat,/surface:'chat'/);
 assert.match(chat,/image\/model-center\/select/);
 assert.match(bridge,/imageCenter\.forGeneration\(data,/);
});
