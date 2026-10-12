'use strict';
// Optional ComfyUI Portable manager. Detects installed/external runtimes, owns only
// processes it starts. Never deletes user ComfyUI installation, models or outputs.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const ARCHIVE_URL='https://github.com/Comfy-Org/ComfyUI/releases/latest/download/ComfyUI_windows_portable_nvidia.7z';
function resolveRuntime(folder){
 const base=path.resolve(folder);
 for(const candidate of [base,path.join(base,'ComfyUI_windows_portable')]){
  const app=path.join(candidate,'ComfyUI','main.py');
  const python=path.join(candidate,'python_embeded','python.exe');
  if(fs.existsSync(app)&&fs.existsSync(python)&&fs.statSync(python).isFile())return {base:candidate,app,python,models:path.join(candidate,'ComfyUI','models')};
 }
 return null;
}
function sevenZip(){
 if(process.platform!=='win32')return null;
 for(const bin of [path.join(process.env.ProgramFiles||'C:\\Program Files','7-Zip','7z.exe'),path.join(process.env['ProgramFiles(x86)']||'C:\\Program Files (x86)','7-Zip','7z.exe')]){
  if(fs.existsSync(bin))return bin;
 }
 return null;
}
function createComfyRuntime(root,{port=8188,spawnFn=spawn,fetchFn=globalThis.fetch}={}){
 const configFile=path.join(root,'comfy-runtime.json'),downloads=path.join(root,'Downloads'),logs=path.join(root,'Logs');
 fs.mkdirSync(downloads,{recursive:true});fs.mkdirSync(logs,{recursive:true});
 let config={mode:'external',folder:'',lowVram:true};
 try{config={...config,...JSON.parse(fs.readFileSync(configFile,'utf8'))}}catch{}
 let child=null,install=null,error='',started=0,ready=false;
 const installed=()=>resolveRuntime(config.folder||path.join(root,'ComfyUI-Portable'))||resolveRuntime(path.join(root,'ComfyUI-Portable'));
 const status=()=>({mode:config.mode,folder:config.folder,lowVram:config.lowVram,detected:installed(),running:!!child,pid:child?.pid||null,ready,error,install:install&&{phase:install.phase,bytes:install.bytes,expected:install.expected,archive:install.archive},officialArchive:ARCHIVE_URL,extractorInstalled:!!sevenZip()});
 const save=()=>fs.writeFileSync(configFile,JSON.stringify(config,null,2));
 function configure({mode,folder,lowVram}={}){
  if(child||install)throw Error('Stop ComfyUI and finish installation before changing runtime.');
  if(mode!==undefined){if(!['external','managed'].includes(mode))throw Error('Use managed or external ComfyUI mode.');config.mode=mode}
  if(folder!==undefined){if(typeof folder!=='string'||folder.length>700||!/^[A-Za-z]:[\\/]/.test(folder))throw Error('Enter the full Windows ComfyUI Portable folder path.');config.folder=path.resolve(folder)}
  if(lowVram!==undefined){if(typeof lowVram!=='boolean')throw Error('Invalid low-VRAM option.');config.lowVram=lowVram}
  save();return status();
 }
 async function isReachable(){
  try{const res=await fetchFn('http://127.0.0.1:'+port+'/system_stats',{signal:AbortSignal.timeout(1800)});return res.ok}catch{return false}
 }
 function shareHeroCheckpoints(runtime){
  // Write only to the Hero Tavern-owned Portable installation; never modify an external app.
  const managedRoot=path.resolve(root,'ComfyUI-Portable');
  const rel=path.relative(managedRoot,runtime.base);
  if(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))return {linked:false,reason:'External portable installation left unmodified.'};
  const file=path.join(runtime.base,'ComfyUI','extra_model_paths.yaml');
  if(fs.existsSync(file))return {linked:false,reason:'Existing extra_model_paths.yaml preserved. Configure Hero Tavern ImageModels manually.'};
  const clean=root.replace(/\\/g,'/').replace(/'/g,"''");
  fs.writeFileSync(file,"# Hero Tavern managed shared image checkpoint directory\nhero_tavern:\n  base_path: '"+clean+"'\n  checkpoints: ImageModels\n");
  return {linked:true,file};
 }

 async function start(){
  if(process.platform!=='win32')throw Error('Built-in portable ComfyUI launcher currently requires Windows.');
  if(child)return status();
  if(await isReachable())return {alreadyRunning:true,external:true,...status()};
  const runtime=installed();if(!runtime)throw Error('ComfyUI Portable not found. Use Install, or select your existing ComfyUI Portable directory.');
  config.mode='managed';config.folder=runtime.base;save();
  shareHeroCheckpoints(runtime);
  fs.mkdirSync(path.join(root,'Cache','ComfyUI'),{recursive:true});
  const fd=fs.openSync(path.join(logs,'comfy-engine.log'),'a');
  try{
   child=spawnFn(runtime.python,['-s',runtime.app,'--listen','127.0.0.1','--port',String(port),'--disable-auto-launch','--windows-standalone-build',...(config.lowVram?['--lowvram']:[])],
    {cwd:runtime.base,windowsHide:true,env:{...process.env,TEMP:path.join(root,'Cache','ComfyUI'),TMP:path.join(root,'Cache','ComfyUI')},stdio:['ignore',fd,fd]});
  }finally{fs.closeSync(fd)}
  const current=child;started=Date.now();ready=false;error='';
  current.on('error',e=>{error=e.message;if(child===current){child=null;ready=false}});
  current.on('exit',code=>{if(child===current){child=null;ready=false;if(code)error='ComfyUI exited with code '+code+'. Check Logs/comfy-engine.log'}});
  return status();
 }
 async function stop(){
  if(!child)return {stopped:false,reason:'ComfyUI is externally managed or already stopped.'};
  const current=child;try{current.kill('SIGTERM')}catch{}
  let exited=await Promise.race([new Promise(resolve=>current.once('exit',()=>resolve(true))),new Promise(resolve=>setTimeout(()=>resolve(false),12000))]);
  if(!exited&&child===current){try{current.kill('SIGKILL')}catch{}error='ComfyUI did not exit gracefully. Emergency stop was required.'}
  return {stopped:true,graceful:exited};
 }
 async function spawnWait(exe,args,logName,state,job){
  const fd=fs.openSync(path.join(logs,logName),'a');
  let proc;
  try{proc=spawnFn(exe,args,{cwd:root,windowsHide:true,stdio:['ignore',fd,fd]});job.process=proc;job.phase=state;
   const code=await new Promise((res,rej)=>{proc.once('error',rej);proc.once('exit',res)});
   if(job.cancel)throw Error('ComfyUI installation cancelled. Existing installations were not changed.');
   if(code!==0)throw Error(state+' failed (exit '+code+'). Inspect Logs/'+logName);
  }finally{fs.closeSync(fd);job.process=null}
 }
 async function installPortable({confirm=false}={}){
  if(confirm!==true)throw Error('Confirm ComfyUI Portable download: multiple gigabytes and external software.');
  if(process.platform!=='win32')throw Error('Automatic Portable installation is only supported on Windows.');
  if(install)throw Error('ComfyUI setup is already running.');
  if(installed())return {alreadyInstalled:true,...status()};
  const extractor=sevenZip();
  // Windows 11 builds with a recent libarchive tar can extract .7z without 7-Zip.
  // Validate the archive with that tool before attempting extraction.
  const systemTar=path.join(process.env.SystemRoot||'C:\\Windows','System32','tar.exe');
  if(!extractor&&!fs.existsSync(systemTar))throw Error('7-Zip (or Windows 11 archive-capable tar.exe) is required. Install 7-Zip from https://7-zip.org/ first.');
  const target=path.join(root,'ComfyUI-Portable'),staging=target+'.installing',archive=path.join(downloads,'ComfyUI_windows_portable_nvidia.7z'),partial=archive+'.part';
  if(fs.existsSync(target)||fs.existsSync(staging))throw Error('ComfyUI target or interrupted staging folder exists. Nothing was deleted; inspect it before retrying.');
  const job={phase:'preflight',bytes:0,expected:0,archive,process:null,cancel:false};install=job;
  try{
   const headers=await fetchFn(ARCHIVE_URL,{method:'HEAD',signal:AbortSignal.timeout(20000)});
   const expected=Number(headers.headers?.get('content-length')||0);
   if(expected>0)job.expected=expected;
   const disk=fs.statfsSync(root),need=Math.max(15*1024**3,expected*2.6);
   if(disk.bavail*disk.bsize<need)throw Error('Not enough free space for portable install/extraction. Keep at least '+Math.ceil(need/1024**3)+' GiB free.');
   const curl=path.join(process.env.SystemRoot||'C:\\Windows','System32','curl.exe');
   if(!fs.existsSync(curl))throw Error('Windows curl.exe unavailable.');
   await spawnWait(curl,['--proto','=https','--proto-redir','=https','--fail','--location','--retry','3','--continue-at','-','--output',partial,ARCHIVE_URL],'comfy-install.log','downloading',job);
   job.bytes=fs.statSync(partial).size;
   if(job.expected&&job.bytes!==job.expected)throw Error('Incomplete official ComfyUI archive.');
   const with7zip=!!extractor;
   try{await spawnWait(with7zip?extractor:systemTar,with7zip?['t',partial]:['-tf',partial],'comfy-install.log','validating',job);}
   catch(e){if(!with7zip)throw Error('Windows tar could not read this .7z archive. Install 7-Zip and click Install again; the downloaded archive is preserved.');throw e;}
   fs.mkdirSync(staging,{recursive:true});
   await spawnWait(with7zip?extractor:systemTar,with7zip?['x',partial,'-o'+staging,'-y']:['-xf',partial,'-C',staging],'comfy-install.log','extracting',job);
   const found=resolveRuntime(staging);if(!found)throw Error('ComfyUI Portable archive layout is unexpected; see staging folder.');
   fs.renameSync(staging,target);
   fs.renameSync(partial,archive);
   config.folder=resolveRuntime(target).base;config.mode='managed';save();
   return {installed:true,...status()};
  }catch(e){error=e.message;throw e}
  finally{install=null}
 }
 function cancelInstall(){if(!install)return {cancelled:false};install.cancel=true;install.process?.kill();return {cancelled:true}}
 return {status,installed,configure,isReachable,start,stop,installPortable,cancelInstall,archiveURL:ARCHIVE_URL};
}
module.exports={createComfyRuntime,resolveRuntime};
