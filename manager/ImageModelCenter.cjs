'use strict';
// One source of truth for image generation in Create, character chats and Adventure.
// Never download or install software without explicit confirmation.
const fs=require('node:fs'),path=require('node:path');
const IDS=['flux-klein','z-turbo','sdxl','koboldcpp','custom'],SCOPES=['global','chat','adventure'];
const safe=(x)=>IDS.includes(x);
function createImageModelCenter(root,{studio,comfy,runtime,images}){
 const file=path.join(root,'image-model-choices.json');
 let prefs={global:null,chat:null,adventure:null},operation=null,lastDownload=null;
 try{const saved=JSON.parse(fs.readFileSync(file,'utf8'));for(const k of SCOPES)if(safe(saved[k]))prefs[k]=saved[k]}catch{}
 const save=()=>{const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(prefs,null,2));fs.renameSync(temp,file)};
 const initial=()=>{
  if(prefs.global)return prefs.global;
  if(studio.snapshot().settings.engine==='koboldcpp')return 'koboldcpp';
  const hub=comfy.models.snapshot().settings.selected;
  if(['flux-klein','z-turbo'].includes(hub)&&comfy.models.localStatus().some(p=>p.id===hub&&p.installed))return hub;
  return studio.snapshot().settings.modelPack||'sdxl';
 };
 const choice=scope=>prefs[scope]||initial();
 function rootForModels(){
  const configured=comfy.models.snapshot().settings.modelRoot;
  if(configured&&fs.existsSync(configured))return configured;
  const local=runtime.installed();
  if(local?.models)return local.models;
  return null;
 }
 function configureRoot(){
  const target=rootForModels();
  if(!target)throw Error('No ComfyUI model directory detected. First install managed ComfyUI or choose your existing ComfyUI models directory.');
  fs.mkdirSync(target,{recursive:true});
  if(comfy.models.snapshot().settings.modelRoot!==target)comfy.models.configure({modelRoot:target});
  return target;
 }
 async function status(){
  const [catalog]=await Promise.all([comfy.catalog()]);
  const managed=runtime.status(),download=comfy.models.snapshot().download;
  const local=catalog.packs||[];
  const selectedCheckpoint=studio.snapshot().settings.comfyCheckpoint||'';
  const models=IDS.map(id=>{
   if(id==='koboldcpp'){
    const state=images.snapshot();
    return {id,label:'KoboldCpp · classic models',installed:!!state.selected,ready:!!state.ready,downloaded:!!state.installed?.length,missing:state.installed?.length?[]:['Download a legacy image checkpoint'],engine:'koboldcpp'};
   }
   if(id==='custom')return {id,label:'Custom ComfyUI workflow',installed:true,ready:!!catalog.available,engine:'comfyui',missing:[]};
   const p=local.find(x=>x.id===id);
   const canStart=!catalog.available&&!!managed.detected&&managed.mode==='managed';
   return {...p,id,label:p?.name||id,engine:'comfyui',downloaded:!!p?.downloaded,
    ready:!!p?.installed&&!!catalog.available&&(id!=='sdxl'||!!selectedCheckpoint&&catalog.checkpoints?.includes(selectedCheckpoint)),
    canStart,issue:id==='sdxl'&&p?.installed&&!selectedCheckpoint?'Select an SDXL checkpoint in Models & Setup (FLUX does not need one).':p?.installed?null:p?.downloaded&&catalog.available?
       'Model files exist on disk but are not visible to the running ComfyUI. Verify the model folder and restart managed ComfyUI.':
       !catalog.available&&!managed.detected?'ComfyUI is not running. Connect an existing instance or install Portable.':
       p?.missing?.length?'Missing: '+p.missing.join(', '):null};
  });
  return {choices:{global:initial(),chat:choice('chat'),adventure:choice('adventure'),overrides:{chat:prefs.chat,adventure:prefs.adventure}},
    models,comfy:{connected:!!catalog.available,error:catalog.error||managed.error||'',mode:managed.mode,running:managed.running,detected:managed.detected,devices:catalog.devices||[],warnings:catalog.warnings||[],
      modelsDirectory:rootForModels(),modelDirectorySet:!!comfy.models.snapshot().settings.modelRoot},
    download:download?{kind:'model',...download}:operation?{kind:'model',phase:'starting',packId:operation.id,bytes:0,total:0}:null,
    lastDownload,install:managed.install||null,createdAt:new Date().toISOString()};
 }
 async function select({id,scope='global',inherit=false}={}){
  if(!SCOPES.includes(scope))throw Error('Unknown image-use location');
  if(inherit&&scope!=='global'){prefs[scope]=null;save();return {choices:{...prefs},selected:choice(scope)}}
  if(!safe(id))throw Error('Choose FLUX, Z-Image, SDXL, KoboldCpp or Custom');
  prefs[scope]=id;save();
  if(scope==='global'){
   const checkpoint=id==='sdxl'&&!studio.snapshot().settings.comfyCheckpoint?(await comfy.catalog()).checkpoints?.[0]||'':null;
   await studio.action('/studio/configure',{engine:id==='koboldcpp'?'koboldcpp':'comfyui',modelPack:['flux-klein','z-turbo'].includes(id)?id:'sdxl',...(checkpoint?{comfyCheckpoint:checkpoint}:{})});
   if(['sdxl','flux-klein','z-turbo'].includes(id))comfy.models.select({id});
  }
  return {selected:choice(scope),scope,choices:{...prefs}};
 }
 function forGeneration(input={},scope='global'){
  if(!SCOPES.includes(scope))throw Error('Unknown image-use location');
  const selected=safe(input.modelPack)?input.modelPack:choice(scope);
  const id=safe(input.imageModel)?input.imageModel:selected;
  if(id==='custom'){
   if(!input.workflowId)throw Error('Select a saved custom ComfyUI workflow before generating.');
   return {...input,modelPack:'sdxl',engine:'comfyui'};
  }
  const engine=id==='koboldcpp'?'koboldcpp':id==='sdxl'?(studio.snapshot().settings.engine||'auto'):'comfyui';
  return {...input,modelPack:id==='koboldcpp'?'sdxl':id,engine};
 }
 function startDownload({id,confirm=false}={}){
  if(!['flux-klein','z-turbo','sdxl'].includes(id))throw Error('Select FLUX, Z-Image or SDXL for a downloadable ComfyUI model.');
  if(confirm!==true)throw Error('Confirm downloading the model and all of its dependencies.');
  if(operation||comfy.models.snapshot().download)throw Error('A model download is already running.');
  const folder=configureRoot();
  operation={id};lastDownload=null;
  // Keep this background promise observed. HTTP responds immediately so UI can poll/cancel.
  Promise.resolve().then(()=>comfy.models.downloadPack({id,confirm:true}))
   .then(async x=>{
     if(id==='sdxl'&&!studio.snapshot().settings.comfyCheckpoint)
      await studio.action('/studio/configure',{comfyCheckpoint:'sd_xl_base_1.0.safetensors'});
     lastDownload={ok:true,packId:id,finishedAt:new Date().toISOString(),message:'Model files saved to '+x.modelRoot+'. If ComfyUI was already running, restart it to discover new files.'};
    })
   .catch(e=>{lastDownload={ok:false,packId:id,finishedAt:new Date().toISOString(),message:e.message}})
   .finally(()=>{operation=null});
  return {started:true,packId:id,directory:folder};
 }
 function cancelDownload(){return comfy.models.cancel()}
 return {status,select,choice,forGeneration,startDownload,cancelDownload,configureRoot};
}
module.exports={createImageModelCenter,IDS,SCOPES};
