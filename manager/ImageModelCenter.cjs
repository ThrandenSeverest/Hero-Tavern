'use strict';
// One source of truth for image generation in Create, character chats and Adventure.
// Never download or install software without explicit confirmation.
const fs=require('node:fs'),path=require('node:path');
const {spawn}=require('node:child_process');
const QWEN_IDS=require('./ComfyModelHub.cjs').QWEN_PACKS.map(p=>p.id);
const IDS=[...QWEN_IDS,'flux-klein','z-turbo','sdxl','koboldcpp','custom'],SCOPES=['global','chat','adventure'];
const safe=(x)=>IDS.includes(x);
function createImageModelCenter(root,{studio,comfy,runtime,images}){
 const file=path.join(root,'image-model-choices.json');
 let prefs={global:null,chat:null,adventure:null},operation=null,lastDownload=null,setupJob=null,lastSetup=null;
 try{const saved=JSON.parse(fs.readFileSync(file,'utf8'));for(const k of SCOPES)if(safe(saved[k]))prefs[k]=saved[k]}catch{}
 const save=()=>{const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(prefs,null,2));fs.renameSync(temp,file)};
 const initial=()=>{
  if(prefs.global)return prefs.global;
  if(comfy.models.localStatus().some(p=>p.id==='qwen21-q5km'&&p.installed))return 'qwen21-q5km';
  if(studio.snapshot().settings.engine==='koboldcpp')return 'koboldcpp';
  const hub=comfy.models.snapshot().settings.selected;
  if([...QWEN_IDS,'flux-klein','z-turbo'].includes(hub)&&comfy.models.localStatus().some(p=>p.id===hub&&p.installed))return hub;
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
 function configureRoot({preferManaged=false}={}){
  const managed=runtime.installed()?.models;
  const existing=rootForModels();
  // Preserve the folder containing downloaded weights when Portable is added later.
  // Managed ComfyUI sees it through --extra-model-paths-config rather than redownloading gigabytes.
  const target=existing||(preferManaged?managed:null)||managed;
  if(!target)throw Error('No ComfyUI model directory detected. First install managed ComfyUI or choose your existing ComfyUI models directory.');
  fs.mkdirSync(target,{recursive:true});
  if(comfy.models.snapshot().settings.modelRoot!==target)comfy.models.configure({modelRoot:target});
  return target;
 }
 async function status(){
  // Fresh installs already know their managed Portable folder. Discover it before
  // inspecting files, otherwise all downloaded weights appear missing until manually configured.
  if(runtime.status().mode==='managed'&&runtime.installed()?.models&&!rootForModels()){
   try{configureRoot({preferManaged:true})}catch{}
  }
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
  const generation=comfy.snapshot?.().active||null;
  return {choices:{global:initial(),chat:choice('chat'),adventure:choice('adventure'),overrides:{chat:prefs.chat,adventure:prefs.adventure}},
    models,comfy:{connected:!!catalog.available,error:catalog.error||managed.error||'',mode:managed.mode,running:managed.running,detected:managed.detected,devices:catalog.devices||[],warnings:catalog.warnings||[],
      modelsDirectory:rootForModels(),modelDirectorySet:!!comfy.models.snapshot().settings.modelRoot},
    activeGeneration:generation&&{phase:generation.phase,progress:generation.progress,step:generation.step,totalSteps:generation.totalSteps,elapsedMs:generation.elapsedMs,jobId:generation.id},
    download:download?{kind:'model',...download}:operation?{kind:'model',phase:'starting',packId:operation.id,bytes:0,total:0}:null,
    lastDownload,setup:setupJob&&{packId:setupJob.id,phase:setupJob.phase,startedAt:setupJob.startedAt},lastSetup,install:managed.install||null,createdAt:new Date().toISOString()};
 }
 async function diagnose({id,startManaged=false}={}){
  if(!['flux-klein','z-turbo','sdxl',...QWEN_IDS].includes(id))throw Error('Select an image model before checking its workflow.');
  const before=await comfy.available();
  const managed=runtime.status(),detected=runtime.installed();
  let startedManaged=false;
  if(!before&&startManaged&&managed.mode==='managed'&&detected){
   if(typeof runtime.start!=='function')throw Error('Managed ComfyUI launcher is not available.');
   await runtime.start();startedManaged=true;
   const deadline=Date.now()+90000;
   let online=false;
   do{
    if(await comfy.available()){online=true;break}
    if(runtime.status().error)break;
    await new Promise(resolve=>setTimeout(resolve,1200));
   }while(Date.now()<deadline);
   if(!online){
    const error=runtime.status().error||'Managed ComfyUI did not respond within 90 seconds.';
    const log=path.join(root,'Logs','comfy-engine.log');
    let tail='';try{tail=fs.readFileSync(log,'utf8').split(/\r?\n/).slice(-20).join('\n').slice(-3500)}catch{}
    return {ok:false,connected:false,status:'startup-failed',packId:id,missingNodes:[],missingFiles:[],error,startedManaged,logTail:tail,
     advice:'ComfyUI was found but could not start: '+error+' Check Logs/comfy-engine.log. Do not reinstall image weights until the startup error is resolved.'};
   }
  }
  const report=await comfy.diagnosePack(id);
  return {...report,startedManaged,portableDetected:!!detected,managedMode:managed.mode};
 }
 async function select({id,scope='global',inherit=false}={}){
  if(!SCOPES.includes(scope))throw Error('Unknown image-use location');
  if(inherit&&scope!=='global'){prefs[scope]=null;save();return {choices:{...prefs},selected:choice(scope)}}
  if(!safe(id))throw Error('Choose an installed image model or quantization.');
  prefs[scope]=id;save();
  if(scope==='global'){
   const checkpoint=id==='sdxl'&&!studio.snapshot().settings.comfyCheckpoint?(await comfy.catalog()).checkpoints?.[0]||'':null;
   await studio.action('/studio/configure',{engine:id==='koboldcpp'?'koboldcpp':'comfyui',modelPack:[...QWEN_IDS,'flux-klein','z-turbo'].includes(id)?id:'sdxl',...(checkpoint?{comfyCheckpoint:checkpoint}:{})});
   if(['sdxl','flux-klein','z-turbo',...QWEN_IDS].includes(id))comfy.models.select({id});
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
  if(!['flux-klein','z-turbo','sdxl',...QWEN_IDS].includes(id))throw Error('Select FLUX, Z-Image or SDXL for a downloadable ComfyUI model.');
  if(confirm!==true)throw Error('Confirm downloading the model and all of its dependencies.');
  if(operation||comfy.models.snapshot().download)throw Error('A model download is already running.');
  const folder=configureRoot({preferManaged:runtime.status().mode==='managed'});
  operation={id};lastDownload=null;
  // Keep this background promise observed. HTTP responds immediately so UI can poll/cancel.
  Promise.resolve().then(()=>comfy.models.downloadPack({id,confirm:true}))
   .then(async x=>{
    // Download success must not be mistaken for ComfyUI model readiness.
    // Managed ComfyUI caches its model inventory until restarted.
    if(runtime.status().mode==='managed'&&runtime.installed()?.models&&runtime.status().running){
     if(typeof runtime.stop!=='function'||typeof runtime.start!=='function')throw Error('Restart managed ComfyUI to index downloaded weights.');
     await runtime.stop();await runtime.start();
     const deadline=Date.now()+120000;
     while(!await comfy.available()){
      if(Date.now()>deadline||runtime.status().error)throw Error(runtime.status().error||'Timed out restarting ComfyUI after model download.');
      await new Promise(resolve=>setTimeout(resolve,1500));
     }
    }
    if(typeof comfy.diagnosePack==='function'&&await comfy.available()){
     const report=await comfy.diagnosePack(id);
     if(!report.ok)throw Error('Downloaded weights not ready: '+[...(report.missingFiles||[]),...(report.missingNodes||[])].join(', ')+'. '+(report.advice||''));
    }
     if(id==='sdxl'&&!studio.snapshot().settings.comfyCheckpoint)
      await studio.action('/studio/configure',{comfyCheckpoint:'sd_xl_base_1.0.safetensors'});
     lastDownload={ok:true,packId:id,finishedAt:new Date().toISOString(),message:'Verified model files at '+x.modelRoot+'. Reloaded managed ComfyUI when running.'};
    })
   .catch(e=>{lastDownload={ok:false,packId:id,finishedAt:new Date().toISOString(),message:e.message}})
   .finally(()=>{operation=null});
  return {started:true,packId:id,directory:folder};
 }
 async function installQwenGGUFNode(job){
  if(!job.id.startsWith('qwen21-'))return;
  // Reuse an externally managed engine that already exposes the GGUF loader.
  if(await comfy.available()){
   const report=await comfy.diagnosePack(job.id);
   if(!report.missingNodes?.includes('UnetLoaderGGUF'))return;
   if(!runtime.installed())throw Error('External ComfyUI is missing ComfyUI-GGUF (UnetLoaderGGUF). Install the node in that ComfyUI instance and restart it, or choose managed Portable.');
  }
  const installed=runtime.installed();
  if(!installed?.base||!installed?.python)throw Error('Qwen GGUF requires a managed ComfyUI Portable runtime. Install or configure managed Portable before installing the custom node.');
  const dir=path.join(installed.base,'ComfyUI','custom_nodes','ComfyUI-GGUF');
  if(fs.existsSync(path.join(dir,'nodes.py')))return;
  if(fs.existsSync(dir))throw Error('Incomplete ComfyUI-GGUF folder detected at '+dir+'. Repair it manually; no existing files were removed.');
  fs.mkdirSync(path.dirname(dir),{recursive:true});
  const log=path.join(root,'Logs','qwen-gguf-install.log');
  async function run(cmd,args,cwd){
   const fd=fs.openSync(log,'a');
   try{
    const child=spawn(cmd,args,{cwd,windowsHide:true,stdio:['ignore',fd,fd]});
    const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve)});
    if(code!==0)throw Error('Dependency installer exited with '+code+'. Inspect '+log);
   }finally{fs.closeSync(fd)}
  }
  // Windows Portable does not install Git. Download the fixed upstream ZIP with
  // the OS-provided curl.exe and extract using built-in PowerShell instead.
  const staging=path.join(root,'Downloads','comfy-gguf-'+require('node:crypto').randomUUID());
  const archive=path.join(staging,'ComfyUI-GGUF.zip');
  fs.mkdirSync(staging,{recursive:true});
  try{
   job.phase='downloading ComfyUI-GGUF loader (Git not required)';
   const curl=path.join(process.env.SystemRoot||'C:\\Windows','System32','curl.exe');
   await run(curl,['--proto','=https','--proto-redir','=https','--location','--fail','--retry','3','--connect-timeout','30','--output',archive,'https://codeload.github.com/city96/ComfyUI-GGUF/zip/refs/heads/main'],staging);
   job.phase='extracting ComfyUI-GGUF loader';
   const quote=value=>"'"+value.replace(/'/g,"''")+"'";
   await run('powershell.exe',['-NoProfile','-NonInteractive','-Command','Expand-Archive -LiteralPath '+quote(archive)+' -DestinationPath '+quote(staging)+' -Force'],staging);
   const unpacked=path.join(staging,'ComfyUI-GGUF-main');
   if(!fs.existsSync(path.join(unpacked,'nodes.py')))throw Error('Official GGUF ZIP has no nodes.py; inspect '+log);
   const requirements=path.join(unpacked,'requirements.txt');
   if(fs.existsSync(requirements)){job.phase='installing GGUF Python requirements';await run(installed.python,['-s','-m','pip','install','-r',requirements],unpacked);}
   if(fs.existsSync(dir))throw Error('Custom node directory appeared during installation. No existing files were overwritten.');
   fs.renameSync(unpacked,dir);
  }finally{fs.rmSync(staging,{recursive:true,force:true});}
 }
 function setup({id,confirm=false}={}){
  if(confirm!==true)throw Error('Click Install engine + model to download the selected model and runtime.');
  if(!['flux-klein','z-turbo','sdxl',...QWEN_IDS].includes(id))throw Error('Choose a downloadable image model.');
  if(setupJob||operation||comfy.models.snapshot().download)throw Error('Image model setup is already running.');
  const job={id,phase:'checking engine',startedAt:Date.now(),cancelled:false};setupJob=job;lastSetup=null;
  const check=()=>{if(job.cancelled)throw Error('Setup cancelled. Downloaded files are preserved.');};
  Promise.resolve().then(async()=>{
   check();if(!runtime.installed()&&!await comfy.available()){job.phase='installing ComfyUI engine';await runtime.installPortable({confirm:true});}
   check();job.phase='detecting model folder';configureRoot({preferManaged:runtime.status().mode==='managed'});await installQwenGGUFNode(job);
   job.phase='downloading model and dependencies';await comfy.models.downloadPack({id,confirm:true});
   check();if(id==='sdxl'&&!studio.snapshot().settings.comfyCheckpoint)await studio.action('/studio/configure',{comfyCheckpoint:'sd_xl_base_1.0.safetensors'});
   if(runtime.installed()){
    job.phase='refreshing engine models';if(runtime.status().running)await runtime.stop();check();await runtime.start();
    job.phase='waiting for engine';const deadline=Date.now()+120000;
    while(!await comfy.available()){check();if(Date.now()>deadline||runtime.status().error)throw Error(runtime.status().error||'Engine startup timed out. Check Logs/comfy-engine.log.');await new Promise(r=>setTimeout(r,1500));}
   }
   check();job.phase='checking model readiness';const report=await comfy.diagnosePack(id);if(!report.ok)throw Error('Model not ready: '+[...(report.missingFiles||[]),...(report.missingNodes||[])].join(', ')+'. '+(report.advice||''));
   await select({id,scope:'global'});lastSetup={ok:true,packId:id,message:'Engine and '+id+' are ready for Image Studio, Tavern and Adventure.'};
  }).catch(e=>{lastSetup={ok:false,packId:id,message:e.message}}).finally(()=>{setupJob=null});
  return {started:true,packId:id};
 }
 function cancelDownload(){if(setupJob)setupJob.cancelled=true;runtime.cancelInstall?.();return comfy.models.cancel()}

 return {status,select,choice,forGeneration,startDownload,cancelDownload,configureRoot,setup,diagnose};
}
module.exports={createImageModelCenter,IDS,SCOPES};
