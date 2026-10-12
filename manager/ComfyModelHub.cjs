'use strict';
// Curated local image-model packs; all downloads are user initiated and use official HTTPS files.
// A pack is a complete recipe, not a single checkpoint. No hidden background installs.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const PACKS=[
 {id:'sdxl',name:'SDXL · art & LoRA',family:'sdxl',downloadGiB:null,license:'Depends on checkpoint',description:'Painted and photographic artwork; compatible checkpoint & LoRA selection.',recommended:'Illustration and classic Stable Diffusion workflows',vram:'8–12 GB',files:[],docs:'https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0',steps:28,cfg:6,width:1024,height:1024},
 {id:'flux-klein',name:'FLUX.2 Klein 4B · character edits',family:'flux2',downloadGiB:16.3,license:'Apache-2.0 (verify each upstream file)',description:'Fast multi-component image engine for reference editing and coherent scenes.',recommended:'Character fidelity and references',vram:'~9 GB+ (varies by workflow)',docs:'https://docs.comfy.org/tutorials/flux/flux-2-klein',steps:4,cfg:1,width:1024,height:1024,
  files:[
   {group:'diffusion_models',name:'flux-2-klein-4b.safetensors',repo:'Comfy-Org/vae-text-encorder-for-flux-klein-4b',source:'split_files/diffusion_models/flux-2-klein-4b.safetensors'},
   {group:'text_encoders',name:'qwen_3_4b.safetensors',repo:'Comfy-Org/vae-text-encorder-for-flux-klein-4b',source:'split_files/text_encoders/qwen_3_4b.safetensors'},
   {group:'vae',name:'flux2-vae.safetensors',repo:'Comfy-Org/vae-text-encorder-for-flux-klein-4b',source:'split_files/vae/flux2-vae.safetensors'}
  ]},
 {id:'z-turbo',name:'Z-Image Turbo · fast scenes',family:'zimage',downloadGiB:10.6,license:'Apache-2.0',description:'Turbo diffusion with compressed weights and matching Qwen encoder.',recommended:'Fast group scenes, portraits and visual ideas',vram:'12 GB with offload (model dependent)',docs:'https://huggingface.co/Comfy-Org/z_image_turbo',steps:9,cfg:1,width:1024,height:1024,
  files:[
   {group:'diffusion_models',name:'z_image_turbo_nvfp4.safetensors',repo:'Comfy-Org/z_image_turbo',source:'split_files/diffusion_models/z_image_turbo_nvfp4.safetensors'},
   {group:'text_encoders',name:'qwen_3_4b_fp8_mixed.safetensors',repo:'Comfy-Org/z_image_turbo',source:'split_files/text_encoders/qwen_3_4b_fp8_mixed.safetensors'},
   {group:'vae',name:'ae.safetensors',repo:'Comfy-Org/z_image_turbo',source:'split_files/vae/ae.safetensors'}
  ]}
];
const GROUPS=['checkpoints','diffusion_models','text_encoders','vae','loras','upscale_models'];
const safe=(p,label)=>{if(typeof p!=='string'||!p||p.length>255||/[/\\\x00-\x1f]/.test(p)||p==='.'||p==='..')throw Error('Invalid '+label);return p};
// Existing installations may use the upstream FP8 filename or nested ComfyUI folders.
// Pass the actual visible name to UNETLoader; do not rename/download valid weights again.
const ALIASES={'flux-2-klein-4b.safetensors':['flux-2-klein-4b-fp8.safetensors']};
function findInstalledName(file,lists){
 const choices=[file.name,...(ALIASES[file.name]||[])];
 return (lists[file.group]||[]).find(name=>typeof name==='string'&&
  choices.some(wanted=>name===wanted||name.endsWith('/'+wanted)||name.endsWith('\\'+wanted)))||null;
}
function resolvePackFiles(pack,lists){
 return Object.fromEntries((pack.files||[]).map(file=>[file.group,findInstalledName(file,lists)]));
}
function installed(pack,lists){
 if(pack.id==='sdxl')return (lists.checkpoints||[]).some(x=>/\.safetensors$/i.test(x));
 return pack.files.every(file=>!!findInstalledName(file,lists));
}
function composeStatus(lists){
 return PACKS.map(pack=>({...pack,installed:installed(pack,lists),missing:pack.id==='sdxl'
   ? ((lists.checkpoints||[]).length?[]:['A compatible SDXL checkpoint in checkpoints'])
   :pack.files.filter(file=>!findInstalledName(file,lists)).map(file=>file.group+'/'+file.name)}));
}
function createModelHub(root,{fetchFn=globalThis.fetch,spawnFn=spawn}={}){
 const configPath=path.join(root,'comfy-model-hub.json'),logDir=path.join(root,'Logs');
 fs.mkdirSync(logDir,{recursive:true});
 let settings={modelRoot:'',selected:'sdxl'},download=null,lastError='';
 try{settings={...settings,...JSON.parse(fs.readFileSync(configPath,'utf8'))}}catch{}
 function save(){fs.writeFileSync(configPath,JSON.stringify(settings,null,2))}
 function pack(id){const found=PACKS.find(x=>x.id===id);if(!found)throw Error('Unknown managed image model');return found}
 function configure({modelRoot}={}){
  if(download)throw Error('Finish or cancel the model download first.');
  if(typeof modelRoot!=='string'||!path.isAbsolute(modelRoot))throw Error('Choose the full ComfyUI models directory.');
  const folder=path.resolve(modelRoot);
  if(!fs.existsSync(folder)||!fs.statSync(folder).isDirectory())throw Error('ComfyUI models directory does not exist.');
  if(fs.realpathSync(folder)!==folder)throw Error('Do not use a redirected model directory.');
  settings.modelRoot=folder;save();return snapshot();
 }
 function target(file){
  if(!settings.modelRoot)throw Error('Configure a ComfyUI models directory in Setup first.');
  const dir=path.join(settings.modelRoot,safe(file.group,'model group'));
  if(!GROUPS.includes(file.group))throw Error('Unsupported ComfyUI model group.');
  fs.mkdirSync(dir,{recursive:true});
  if(fs.lstatSync(dir).isSymbolicLink()||path.dirname(fs.realpathSync(dir))!==fs.realpathSync(settings.modelRoot))throw Error('Model directory redirected.');
  const output=path.join(dir,safe(file.name,'model name'));
  if(fs.existsSync(output)&&fs.lstatSync(output).isSymbolicLink())throw Error('Model file symlink refused.');
  return output;
 }
 function localStatus(){
  const lists={};for(const group of GROUPS){
   let names=[];const folder=settings.modelRoot?path.join(settings.modelRoot,group):'';
   try{
    if(folder&&fs.existsSync(folder)&&!fs.lstatSync(folder).isSymbolicLink())
     names=fs.readdirSync(folder,{withFileTypes:true}).filter(x=>x.isFile()&&!x.isSymbolicLink()).map(x=>x.name);
   }catch{}
   lists[group]=names;
  }
  return composeStatus(lists);
 }
 function snapshot(){
  return {settings:{...settings},catalog:PACKS.map(x=>({...x})),download:download&&{packId:download.packId,file:download.file,bytes:download.bytes+(download.part&&fs.existsSync(download.part)?fs.statSync(download.part).size:0),total:download.total,phase:download.phase,part:download.part},lastError};
 }
 async function sha256(file,signal){
  const hash=crypto.createHash('sha256');for await(const bytes of fs.createReadStream(file)){if(signal?.aborted)throw Error('Download cancelled.');hash.update(bytes);}
  return hash.digest('hex');
 }
 async function metadata(file){
  const url='https://huggingface.co/api/models/'+file.repo+'/tree/main/'+file.source.slice(0,file.source.lastIndexOf('/'))+'?recursive=false';
  const res=await fetchFn(url,{signal:AbortSignal.timeout(20000)});
  if(!res.ok)throw Error('Hugging Face model manifest HTTP '+res.status);
  const result=await res.json(),item=Array.isArray(result)?result.find(n=>n.path===file.source):null;
  if(!item||!Number.isFinite(item.size)||item.size<1048576)throw Error('Model file missing from official repository: '+file.source);
  const hash=item.lfs?.oid||'';
  if(hash&&!/^[0-9a-f]{64}$/.test(hash))throw Error('Unexpected model checksum.');
  return {size:item.size,hash};
 }
 async function downloadPack({id,confirm=false}={}){
  const p=pack(id);
  if(confirm!==true)throw Error('Confirm the model pack download first. Files can take many GB.');
  if(p.id==='sdxl')throw Error('Select an existing SDXL checkpoint from Image Studio. There is no pinned SDXL pack here.');
  if(download)throw Error('Another model download is running.');
  if(!settings.modelRoot)throw Error('Configure the ComfyUI models directory before downloading.');
  const job={packId:id,file:'',bytes:0,total:0,phase:'preflight',process:null,abort:false,part:''};download=job;
  try{
   const entries=[];
   for(const f of p.files){
    const location=target(f),meta=await metadata(f);
    const stat=fs.existsSync(location)?fs.statSync(location):null;
    const partial=location+'.part',start=fs.existsSync(partial)?fs.statSync(partial).size:0;
    if(start>meta.size)throw Error('Partial download is larger than the expected model: '+f.name+'. Inspect the .part file.');
    entries.push({f,location,meta,stat,start});
   }
   const need=entries.reduce((sum,x)=>sum+(x.stat&&x.stat.size===x.meta.size?0:Math.max(0,x.meta.size-x.start)),0);
   const disk=fs.statfsSync(settings.modelRoot);
   if(disk.bavail*disk.bsize<need+2*1024**3)throw Error('Not enough disk space; keep at least 2 GiB free after installing the models.');
   job.total=need;
   for(const e of entries){
    if(job.abort)throw Error('Download cancelled.');
    job.file=e.f.name;job.part=e.location+'.part';job.phase='downloading';
    if(e.stat&&e.stat.size===e.meta.size){
     if(e.meta.hash){job.phase='verifying';if(await sha256(e.location)!==e.meta.hash)throw Error('Existing model checksum mismatch: '+e.f.name);}
     continue;
    }
    const uri='https://huggingface.co/'+e.f.repo+'/resolve/main/'+e.f.source;
    const curl=process.platform==='win32'?path.join(process.env.SystemRoot||'C:\\Windows','System32','curl.exe'):'curl';
    if(!fs.existsSync(curl)&&process.platform==='win32')throw Error('Windows curl.exe is missing.');
    const stdio=fs.openSync(path.join(logDir,'comfy-download.log'),'a');
    try{
     const pchild=spawnFn(curl,['--proto','=https','--proto-redir','=https','--location','--fail','--retry','3','--retry-delay','2','--connect-timeout','30','--continue-at','-','--output',job.part,uri],{windowsHide:true,stdio:['ignore',stdio,stdio]});
     job.process=pchild;const exit=await new Promise((resolve,reject)=>{pchild.once('error',reject);pchild.once('exit',resolve);});job.process=null;
     if(job.abort)throw Error('Download cancelled.');
     if(exit!==0)throw Error('Model download failed: '+e.f.name+' (see Logs/comfy-download.log). Resume from Image Studio.');
    }finally{fs.closeSync(stdio)}
    if(fs.statSync(job.part).size!==e.meta.size)throw Error('Incomplete model download: '+e.f.name);
    job.phase='verifying';
    if(e.meta.hash&&await sha256(job.part)!==e.meta.hash)throw Error('Checksum mismatch: '+e.f.name+'. Partial file retained for inspection.');
    fs.renameSync(job.part,e.location);
    job.bytes+=e.meta.size;
   }
   settings.selected=id;save();job.phase='complete';lastError='';return {installed:true,packId:id,modelRoot:settings.modelRoot};
  }catch(e){lastError=e.message;throw e}finally{download=null}
 }
 function cancel(){if(download){download.abort=true;download.process?.kill();return {cancelled:true}}return {cancelled:false}}
 function select({id}={}){pack(id);settings.selected=id;save();return snapshot()}
 function knownFiles(id){return pack(id).files.map(x=>({group:x.group,name:x.name}))}
 return {PACKS,pack,snapshot,configure,downloadPack,cancel,select,knownFiles,composeStatus,localStatus,resolvePackFiles};
}
module.exports={PACKS,createModelHub,installed,composeStatus,resolvePackFiles};
