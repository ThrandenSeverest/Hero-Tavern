'use strict';
// Image Studio LoRA library. Only safetensors, no pickle code execution.
// Manual uploads are chunked so large LoRAs do not enter JSON memory at once.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const MAX=2*1024**3,CHUNK=2*1024**2,ROOTS=['sdxl','sd15','flux2-klein','flux1','qwen-image21','qwen-image','zimage'];
function identifyBase(value=''){
 const s=String(value||'').toLowerCase().replace(/[_-]/g,' ');
 if(/flux\s*2.*klein|klein.*flux\s*2/.test(s))return 'flux2-klein';
 if(/flux\s*1|flux\.1|flux dev|flux schnell/.test(s))return 'flux1';
 if(/qwen.*image.*2[.\s]*1/.test(s))return 'qwen-image21';
 if(/qwen.*image/.test(s))return 'qwen-image';
 if(/z[\s-]*image|zimage/.test(s))return 'zimage';
 if(/stable diffusion\s*1[.\s]*5|\bsd\s*1[.\s]*5\b|\bsd15\b/.test(s))return 'sd15';
 if(/sdxl|stable diffusion xl|illustrious|pony diffusion|noobai/.test(s))return 'sdxl';
 return null;
}
function familyForPack(pack,checkpoint=''){
 if(/^qwen21-/.test(pack))return 'qwen-image21';
 if(pack==='flux-klein')return 'flux2-klein';
 if(pack==='z-turbo')return 'zimage';
 if(pack==='sdxl')return identifyBase(checkpoint)||'sdxl';
 return null;
}
function compatible(family,pack,checkpoint=''){
 const dest=familyForPack(pack,checkpoint);
 // Qwen Image (unversioned) cannot safely be treated as Qwen Image 2.1.
 return !!dest&&!!family&&family===dest;
}
function safeName(n){
 if(typeof n!=='string'||n.length>170||!/^[a-zA-Z0-9][a-zA-Z0-9._() +-]*\.safetensors$/i.test(n)||n.includes('..'))throw Error('Use a .safetensors file with a simple filename.');
 return n;
}
function inspectSafetensors(filename){
 const stat=fs.statSync(filename);
 if(!stat.isFile()||stat.size<32||stat.size>MAX)throw Error('Invalid safetensors file size.');
 const fd=fs.openSync(filename,'r');
 try{
  const len=Buffer.alloc(8);fs.readSync(fd,len,0,8,0);
  const headerSize=Number(len.readBigUInt64LE(0));
  if(headerSize<10||headerSize>16*1024**2||headerSize+8>=stat.size)throw Error('Invalid safetensors header length.');
  const b=Buffer.alloc(headerSize);fs.readSync(fd,b,0,headerSize,8);
  const header=JSON.parse(b.toString('utf8'));
  if(!header||typeof header!=='object'||!Object.keys(header).some(k=>k!=='__metadata__'))throw Error('No safetensors tensors found.');
  const meta=header.__metadata__||{};
  const details=[meta['modelspec.architecture'],meta.ss_base_model_version,meta.ss_sd_model_name,meta.base_model,meta.base_model_name,meta.model_family,meta.training_base_model,meta['modelspec.title']].filter(x=>typeof x==='string').join(' ');
  // Avoid huge tensor scans; validate metadata and several entries.
  for(const item of Object.entries(header).filter(([k])=>k!=='__metadata__').slice(0,20)){
   if(!Array.isArray(item[1]?.data_offsets)||item[1].data_offsets.length!==2)throw Error('Invalid safetensors offsets.');
  }
  return {family:identifyBase(details)||identifyBase(path.basename(filename)),metadata:Object.fromEntries(Object.entries(meta).filter(([k,v])=>typeof v==='string'&&v.length<500).slice(0,35)),size:stat.size};
 }finally{fs.closeSync(fd)}
}
const short=s=>String(s||'').slice(0,240);
function createLoRAManager(root,{modelRoot=()=>'',fetchFn=globalThis.fetch}={}){
 const manifest=path.join(root,'lora-library.json'),temp=path.join(root,'Downloads','LoRA');
 fs.mkdirSync(temp,{recursive:true});
 let records={};try{records=JSON.parse(fs.readFileSync(manifest,'utf8'))||{}}catch{}
 let upload=null,download=null,last=null;
 const save=()=>{const name=manifest+'.tmp';fs.writeFileSync(name,JSON.stringify(records,null,2));fs.renameSync(name,manifest)};
 function directory(){
  const base=modelRoot();if(!base||!path.isAbsolute(base)||!fs.existsSync(base))throw Error('Configure the active ComfyUI models folder first.');
  const folder=path.join(base,'loras');fs.mkdirSync(folder,{recursive:true});
  if(fs.lstatSync(folder).isSymbolicLink())throw Error('LoRA folder must not be a symlink.');
  return folder;
 }
 const key=(s)=>path.basename(s);
 function list({pack='',checkpoint=''}={}){
  let files=[];const dir=directory();
  const walk=(d,prefix='',depth=0)=>{
   if(depth>1)return;
   for(const entry of fs.readdirSync(d,{withFileTypes:true}).slice(0,1200)){
    if(entry.isDirectory()&&!entry.isSymbolicLink())walk(path.join(d,entry.name),prefix+entry.name+'/',depth+1);
    else if(entry.isFile()&&!entry.isSymbolicLink()&&/\.safetensors$/i.test(entry.name))files.push(prefix+entry.name);
   }
  };walk(dir);
  const items=files.map(name=>{
   const file=path.join(dir,name),r=records[name]||{};
   let inspected=null;try{inspected=inspectSafetensors(file)}catch(e){return {name,error:e.message,compatible:false};}
   const family=r.family||inspected.family||null;
   return {name,family,detected:inspected.family||null,manual:!!r.manual,compatible:compatible(family,pack,checkpoint),size:inspected.size,source:r.source||'local',versionId:r.versionId||null,triggerWords:r.triggerWords||[],notes:r.notes||'',unknown:!family};
  });
  return {items,pack,upload:upload&&{name:upload.name,bytes:upload.bytes,total:upload.total},download:download&&{name:download.name,bytes:download.bytes,total:download.total,phase:download.phase},last};
 }
 function assign({name,family,manual=true}={}){
  if(typeof name!=='string'||!list().items.some(x=>x.name===name))throw Error('Select an installed LoRA.');
  if(!ROOTS.includes(family))throw Error('Choose a supported base-model family.');
  const original=records[name]||{};records[name]={...original,family,manual:!!manual};save();return {name,family};
 }
 function begin({name,size}={}){
  if(upload||download)throw Error('Finish the existing LoRA installation first.');
  safeName(name);
  if(!Number.isSafeInteger(size)||size<32||size>MAX)throw Error('LoRA must be a safetensors file below 2 GiB.');
  const dir=directory();if(fs.existsSync(path.join(dir,name)))throw Error('This filename already exists. Rename the file before importing.');
  const stat=fs.statfsSync(dir);if(stat.bavail*stat.bsize<size+500*1024**2)throw Error('Not enough available disk space.');
  const file=path.join(temp,crypto.randomUUID()+'.part');
  fs.writeFileSync(file,Buffer.alloc(0),{flag:'wx'});
  upload={id:crypto.randomUUID(),name,total:size,bytes:0,file};return {id:upload.id,maxChunk:CHUNK};
 }
 function chunk({id,part}={}){
  if(!upload||upload.id!==id)throw Error('Upload session expired.');
  if(typeof part!=='string'||part.length>CHUNK*1.4)throw Error('Invalid LoRA upload chunk.');
  const data=Buffer.from(part,'base64');
  if(!data.length||data.length>CHUNK||upload.bytes+data.length>upload.total)throw Error('LoRA chunk is out of range.');
  fs.appendFileSync(upload.file,data);upload.bytes+=data.length;
  return {bytes:upload.bytes,total:upload.total};
 }
 function finish({id,family}={}){
  if(!upload||upload.id!==id)throw Error('Upload session expired.');
  const job=upload;upload=null;
  try{
   if(job.bytes!==job.total)throw Error('Upload is incomplete.');
   const inspect=inspectSafetensors(job.file);
   if(family&& !ROOTS.includes(family))throw Error('Unknown selected LoRA family.');
   const chosen=family||inspect.family||null;
   const output=path.join(directory(),job.name);
   if(fs.existsSync(output))throw Error('LoRA file already exists.');
   fs.renameSync(job.file,output);
   records[job.name]={family:chosen,manual:!!family,source:'local',installedAt:new Date().toISOString()};save();
   return {name:job.name,family:chosen,detected:inspect.family,warning:!chosen?'Unknown base model. Assign a family before use.':null};
  }finally{if(fs.existsSync(job.file))fs.unlinkSync(job.file)}
 }
 function cancel(){if(upload){const job=upload;upload=null;try{fs.unlinkSync(job.file)}catch{}}if(download)download.controller.abort();return {cancelled:true}}
 async function jsonFetch(url,token){
  const headers={Accept:'application/json'};if(token)headers.Authorization='Bearer '+token;
  const r=await fetchFn(url,{headers,signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error('Civitai API returned HTTP '+r.status+(r.status===401||r.status===403?' — API key or permission required.':''));
  return r.json();
 }
 async function browse({query='',family='',sort='Most Downloaded',token=''}={}){
  if(query.length>100||token.length>500||!['Most Downloaded','Highest Rated','Newest'].includes(sort))throw Error('Invalid browse options.');
  if(family&&!ROOTS.includes(family))throw Error('Unsupported base model filter.');
  const params=new URLSearchParams({types:'LORA',limit:'20',nsfw:'false',sort,primaryFileOnly:'true'});
  if(query.trim())params.set('query',query.trim());
  const base={'sdxl':'SDXL 1.0','flux1':'Flux.1 D','flux2-klein':'Flux.2 Klein 4B','qwen-image21':'Qwen-Image 2.1','qwen-image':'Qwen-Image','zimage':'Z-Image Turbo','sd15':'SD 1.5'}[family];
  if(base)params.set('baseModels',base);
  const data=await jsonFetch('https://civitai.com/api/v1/models?'+params,token);
  return {items:(data.items||[]).filter(m=>m.type==='LORA').flatMap(m=>(m.modelVersions||[]).slice(0,2).map(v=>({
    id:m.id,versionId:v.id,title:short(m.name),version:short(v.name),family:identifyBase(v.baseModel),baseModel:short(v.baseModel),description:short(m.description?.replace(/<[^>]*>/g,' ')||''),sizeKB:v.files?.find(f=>f.primary)?.sizeKB||v.files?.[0]?.sizeKB||0,triggerWords:(v.trainedWords||[]).slice(0,12),url:'https://civitai.com/models/'+m.id+'?modelVersionId='+v.id,nsfw:!!m.nsfw
  }))).filter(x=>!family||x.family===family),nextCursor:data.metadata?.nextCursor||null};
 }
 async function getVersion(versionId,token=''){
  if(!Number.isInteger(versionId)||versionId<1)throw Error('Invalid Civitai version ID.');
  const v=await jsonFetch('https://civitai.com/api/v1/model-versions/'+versionId,token);
  if(v.model?.type&&v.model.type!=='LORA')throw Error('This Civitai resource is not a LoRA. Workflow ZIPs are managed separately.');
  if(!v.model?.type&&v.modelId){const model=await jsonFetch('https://civitai.com/api/v1/models/'+v.modelId,token);if(model.type!=='LORA')throw Error('This Civitai resource is not a LoRA. Workflow ZIPs are managed separately.');}
  const f=v.files?.find(f=>f.primary&&/\.safetensors$/i.test(f.name))||v.files?.find(f=>/\.safetensors$/i.test(f.name));
  if(!f)throw Error('No public safetensors file available for this version.');
  if(['Danger','Error'].includes(f.virusScanResult)||['Danger','Error'].includes(f.pickleScanResult))throw Error('Civitai flagged this file as unsafe.');
  const family=identifyBase(v.baseModel);
  return {file:f,name:safeName(path.basename(f.name)),family,size:Math.round(Number(f.sizeKB)*1024),sha256:f.hashes?.SHA256||'',versionId,modelId:v.modelId,triggerWords:v.trainedWords||[],baseModel:v.baseModel||'',url:'https://civitai.com/api/download/models/'+versionId};
 }
 function startDownload({versionId,token='',family='',confirm=false}={}){
  if(confirm!==true)throw Error('Confirm this LoRA download.');
  if(download||upload)throw Error('Another LoRA transfer is running.');
  if(token.length>500||family&& !ROOTS.includes(family))throw Error('Invalid LoRA download options.');
  const controller=new AbortController();download={name:'Fetching Civitai metadata',bytes:0,total:0,phase:'checking',controller};last=null;
  const run=async()=>{
   const meta=await getVersion(versionId,token);
   if(family&&meta.family&&meta.family!==family)throw Error('Selected model family conflicts with the Civitai base model.');
   if(!meta.family&&!family)throw Error('Civitai did not declare a compatible family. Select one manually before installing.');
   if(!Number.isSafeInteger(meta.size)||meta.size<32||meta.size>MAX)throw Error('Civitai reported an invalid LoRA size.');
   const dir=directory(),output=path.join(dir,meta.name);
   if(fs.existsSync(output))throw Error('LoRA already installed: '+meta.name);
   download.name=meta.name;download.total=meta.size;download.phase='downloading';
   const stat=fs.statfsSync(dir);if(stat.bavail*stat.bsize<meta.size+500*1024**2)throw Error('Insufficient storage space for LoRA.');
   const partial=path.join(temp,crypto.randomUUID()+'.part');
   try{
    const h={};if(token)h.Authorization='Bearer '+token;
    const response=await fetchFn(meta.url,{headers:h,signal:controller.signal});
    if(!response.ok||!response.body)throw Error('Civitai download HTTP '+response.status+'. Authentication may be required.');
    const fd=fs.openSync(partial,'wx');
    try{for await(const buf of response.body){if(controller.signal.aborted)throw Error('LoRA download cancelled.');const b=Buffer.from(buf);download.bytes+=b.length;if(download.bytes>meta.size||download.bytes>MAX)throw Error('Civitai download exceeded declared file size.');fs.writeSync(fd,b);}}finally{fs.closeSync(fd)}
    if(download.bytes!==meta.size)throw Error('Incomplete Civitai download.');
    download.phase='verifying';
    inspectSafetensors(partial);
    if(/^[a-f0-9]{64}$/i.test(meta.sha256)){
     const hash=crypto.createHash('sha256');
     for await(const buf of fs.createReadStream(partial))hash.update(buf);
     if(hash.digest('hex').toLowerCase()!==meta.sha256.toLowerCase())throw Error('Downloaded LoRA SHA256 checksum mismatch.');
    }
    fs.renameSync(partial,output);
    records[meta.name]={family:family||meta.family,manual:!!family,source:'civitai',versionId,modelId:meta.modelId,triggerWords:meta.triggerWords.slice(0,15),installedAt:new Date().toISOString()};
    save();last={ok:true,name:meta.name,family:family||meta.family,versionId};
   }finally{if(fs.existsSync(partial))fs.unlinkSync(partial)}
  };
  Promise.resolve().then(run).catch(e=>last={ok:false,error:e.message,versionId}).finally(()=>download=null);
  return {started:true,versionId};
 }
 function validateSelection(entries,pack,checkpoint=''){
  if(!Array.isArray(entries)||entries.length>3)throw Error('Select up to three LoRAs.');
  const index=new Map(list({pack,checkpoint}).items.map(item=>[item.name,item]));
  return entries.map(entry=>{
   const item=index.get(entry.name);
   if(!item)throw Error('LoRA not installed: '+String(entry.name));
   if(!item.compatible)throw Error('LoRA "'+item.name+'" belongs to '+(item.family||'unknown')+', not '+(familyForPack(pack,checkpoint)||pack)+'. Assign a compatible family in LoRA Library.');
   const weight=Number(entry.strength??0.8);
   if(!Number.isFinite(weight)||weight< -2||weight>2)throw Error('LoRA weight must be between -2 and 2.');
   return {name:item.name,strength:weight};
  });
 }
 return {list,assign,begin,chunk,finish,cancel,browse,getVersion,startDownload,validateSelection};
}
module.exports={createLoRAManager,identifyBase,familyForPack,compatible,inspectSafetensors};
