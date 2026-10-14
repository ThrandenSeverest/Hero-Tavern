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
  catalog:async()=>({available:connected,packs:packs.map(p=>({...p,installed:connected&&p.id!=='z-turbo'})),checkpoints:connected?['sd_xl_base_1.0.safetensors']:[],devices:[],error:connected?'':'Connection refused'}),
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
test('Trusted embedded iframe forwards shared image model requests and explicitly rejects unsupported routes',()=>{
 const html=require('node:fs').readFileSync(require('node:path').join(__dirname,'../manager/ModelPanel.html'),'utf8');
 assert.match(html,/route\.startsWith\('\/image\/model-center\/'\)/);
 assert.match(html,/Unsupported embedded bridge request/);
 const bridge=require('node:fs').readFileSync(require('node:path').join(__dirname,'../manager/ModelBridge.cjs'),'utf8');
 assert.match(bridge,/req\.url==='\/image\/model-center\/select'/);
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
test('One install action provisions engine, model dependencies, starts and checks readiness before selecting',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-managed-setup-'));let runtimeExists=false,connected=false,modelRoot='',settings={engine:'auto',modelPack:'sdxl'},calls=[];
 const folder=path.join(root,'Portable','models');const runtime={installed:()=>runtimeExists?{models:folder}:null,status:()=>({mode:'managed',running:false,detected:runtimeExists?{models:folder}:null}),installPortable:async({confirm})=>{assert.equal(confirm,true);calls.push('engine');fs.mkdirSync(folder,{recursive:true});runtimeExists=true},start:async()=>{calls.push('start');connected=true},stop:async()=>calls.push('stop'),cancelInstall:()=>{}};
 const comfy={available:async()=>connected,catalog:async()=>({available:connected,packs:[]}),diagnosePack:async()=>{calls.push('diagnose');return {ok:true}},snapshot:()=>({}),models:{snapshot:()=>({settings:{modelRoot},download:null}),configure:d=>{modelRoot=d.modelRoot},downloadPack:async({id})=>{calls.push('dependencies:'+id)},select:()=>calls.push('select'),cancel:()=>({cancelled:true}),localStatus:()=>[]}};
 const center=createImageModelCenter(root,{runtime,comfy,images:{snapshot:()=>({})},studio:{snapshot:()=>({settings}),action:async(_,d)=>{settings={...settings,...d}}}});
 try{assert.throws(()=>center.setup({id:'flux-klein'}),/Click Install/);assert.equal(center.setup({id:'flux-klein',confirm:true}).started,true);assert.throws(()=>center.setup({id:'z-turbo',confirm:true}),/already running/);await new Promise(r=>setTimeout(r,20));assert.deepEqual(calls,['engine','dependencies:flux-klein','start','diagnose','select']);assert.equal(center.choice('global'),'flux-klein');assert.equal((await center.status()).lastSetup.ok,true);}finally{fs.rmSync(root,{recursive:true,force:true})}
});

test('Engine installation and startup are visible without opening Advanced settings',()=>{
 const src=fs.readFileSync(path.join(__dirname,'../manager/ImageModelCenterUI.js'),'utf8');
 assert.match(src,/actions\.append\(install,start,restart,/);
 assert.match(src,/advanced\.append\(summary,note\)/);
 assert.match(src,/Start engine & check workflow/);
 assert.doesNotMatch(src,/actions\.append\(action\([^\n]+,install,start,restart/);
 assert.match(src,/'Download '\+choiceLabel\(model.id\)/);
 assert.match(src,/No separate engine installation or manual launch is needed/);
});

test('Explicit readiness check starts an installed managed ComfyUI runtime and checks actual nodes',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-comfy-readiness-')),modelsDir=path.join(root,'ComfyUI','models');
 let online=false,loads=0;
 const runtime={installed:()=>({models:modelsDir}),status:()=>({mode:'managed',running:online,error:''}),start:async()=>{loads++;online=true}};
 const comfy={available:async()=>online,diagnosePack:async id=>({ok:true,connected:true,missingNodes:[],missingFiles:[],packId:id})};
 const center=createImageModelCenter(root,{runtime,comfy,images:{snapshot:()=>({})},studio:{snapshot:()=>({settings:{engine:'auto',modelPack:'sdxl'}})}});
 try{const report=await center.diagnose({id:'qwen21-q5km',startManaged:true});assert.equal(report.ok,true);assert.equal(report.startedManaged,true);assert.equal(loads,1);
  const repeated=await center.diagnose({id:'qwen21-q5km',startManaged:true});assert.equal(repeated.startedManaged,false);assert.equal(loads,1);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('External ComfyUI is never started by the managed launcher',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-comfy-external-'));let loads=0;
 const runtime={installed:()=>({models:root}),status:()=>({mode:'external',running:false}),start:async()=>{loads++}};
 const comfy={available:async()=>false,diagnosePack:async()=>({ok:false,connected:false,missingNodes:[],missingFiles:[],status:'offline'})};
 const center=createImageModelCenter(root,{runtime,comfy,images:{snapshot:()=>({})},studio:{snapshot:()=>({settings:{engine:'auto'}})}});
 try{const report=await center.diagnose({id:'flux-klein',startManaged:true});assert.equal(report.connected,false);assert.deepEqual(report.missingNodes,[]);assert.equal(loads,0);}finally{fs.rmSync(root,{recursive:true,force:true})}
});
