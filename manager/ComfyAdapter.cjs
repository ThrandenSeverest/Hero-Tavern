// Optional local ComfyUI engine. Never installs, kills or deletes files owned by ComfyUI.
// Uses core graph nodes only; keeps original pixels outside a painted inpaint mask.
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const PNG=Buffer.from([137,80,78,71,13,10,26,10]);
const SAMPLERS={'DPM++ 2M Karras':['dpmpp_2m','karras'],'DPM++ 2S ancestral Karras':['dpmpp_2s_ancestral','karras'],'Euler':['euler','normal'],'Euler a':['euler_ancestral','normal'],'LCM':['lcm','normal']};
function checkPNG(data,max=28*1024*1024){
 if(!Buffer.isBuffer(data)||data.length<33||data.length>max||!data.subarray(0,8).equals(PNG)||data.toString('ascii',12,16)!=='IHDR')throw Error('A valid PNG under 28 MiB is required.');
 const width=data.readUInt32BE(16),height=data.readUInt32BE(20);
 if(width<256||height<256||width>2048||height>2048)throw Error('Source and mask dimensions must be 256–2048.');
 return {width,height};
}
function makeGraph({checkpoint,params,source,mask}){
 if(typeof checkpoint!=='string'||!checkpoint.endsWith('.safetensors')||/[\/\\\x00-\x1f]/.test(checkpoint))throw Error('Select a checkpoint installed in ComfyUI.');
 const pair=SAMPLERS[params.sampler_name]||SAMPLERS['DPM++ 2M Karras'];
 let number=0;const graph={},node=(class_type,inputs)=>{const id=String(++number);graph[id]={class_type,inputs};return [id,0]};
 const ckpt=node('CheckpointLoaderSimple',{ckpt_name:checkpoint});
 const positive=node('CLIPTextEncode',{text:params.prompt,clip:[ckpt[0],1]});
 const negative=node('CLIPTextEncode',{text:params.negative_prompt||'',clip:[ckpt[0],1]});
 let latent,original,maskNode;
 if(source&&mask){
   original=node('LoadImage',{image:source});
   maskNode=node('LoadImageMask',{image:mask,channel:'red'});
   latent=node('VAEEncodeForInpaint',{pixels:original,vae:[ckpt[0],2],mask:maskNode,grow_mask_by:6});
 }else latent=node('EmptyLatentImage',{width:params.width,height:params.height,batch_size:1});
 const sampled=node('KSampler',{model:ckpt,positive,negative,latent_image:latent,seed:params.seed<0?crypto.randomInt(0,2147483647):params.seed,steps:params.steps,cfg:params.cfg_scale,sampler_name:pair[0],scheduler:pair[1],denoise:source?Math.max(0.05,Math.min(1,Number(params.denoise??0.75))):1});
 const decoded=node('VAEDecode',{samples:sampled,vae:[ckpt[0],2]});
 // Compositing restores exact source pixels outside the white mask.
 const output=source?node('ImageCompositeMasked',{destination:original,source:decoded,mask:maskNode,x:0,y:0,resize_source:false}):decoded;
 const saved=node('SaveImage',{images:output,filename_prefix:'HeroTavern'});
 return {graph,saveId:saved[0]};
}
function createComfyAdapter(root,{port=8188,fetchFn=globalThis.fetch}={}){
 if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid ComfyUI loopback port.');
 const base='http://127.0.0.1:'+port,dir=path.join(root,'Images'),logs=path.join(root,'Logs');
 fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(logs,{recursive:true});
 let active=null,lastError='',lastCheck=0,healthy=false;
 async function request(route,options={},timeout=4000){
  const signal=AbortSignal.any([options.signal||new AbortController().signal,AbortSignal.timeout(timeout)]);
  const r=await fetchFn(base+route,{...options,signal});
  if(!r.ok)throw Error('ComfyUI '+route+' returned HTTP '+r.status);
  return r;
 }
 async function available(){
  try{const r=await request('/system_stats',{},1800);await r.json();healthy=true;lastError='';return true}
  catch(e){healthy=false;lastError=e.message;return false}finally{lastCheck=Date.now()}
 }
 async function checkpoints(){
  const r=await request('/models/checkpoints',{},5000),names=await r.json();
  if(!Array.isArray(names))throw Error('ComfyUI did not return checkpoint filenames.');
  return names.filter(n=>typeof n==='string'&&n.endsWith('.safetensors')&&n.length<256);
 }
 function validateGalleryName(name){
  if(typeof name!=='string'||!/^\d{12,17}-[a-f0-9]{8,24}\.png$/.test(name))throw Error('Choose an image from the Hero Tavern gallery.');
  const f=path.join(dir,name);
  if(!fs.existsSync(f)||fs.lstatSync(f).isSymbolicLink()||!fs.statSync(f).isFile())throw Error('Gallery image not found.');
  return f;
 }
 async function upload(bytes,prefix,signal){
  const name='hero-'+prefix+'-'+crypto.randomUUID()+'.png';
  const form=new FormData();form.append('image',new Blob([bytes],{type:'image/png'}),name);form.append('type','input');form.append('overwrite','false');
  const info=await (await request('/upload/image',{method:'POST',body:form,signal},30000)).json();
  if(!info?.name||typeof info.name!=='string'||info.name!==name)throw Error('ComfyUI did not confirm upload.');
  return info.name;
 }
 function logEvent(entry){
  const log=path.join(logs,'image-files.jsonl');
  try{if(fs.existsSync(log)&&fs.statSync(log).size>4*1024*1024)fs.renameSync(log,log+'.previous');fs.appendFileSync(log,JSON.stringify({at:new Date().toISOString(),...entry})+'\n')}catch{}
 }
 async function cancel(){
  const job=active;if(!job)return {cancelled:false};
  job.controller.abort();
  if(!job.id)return {cancelled:true};
  try{
   const queue=await (await request('/queue',{},2000)).json();
   const running=queue.queue_running||[];
   if(running.some(item=>Array.isArray(item)&&item[1]===job.id))await request('/interrupt',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'},2500);
   else await request('/queue',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({delete:[job.id]})},2500);
  }catch{}
  return {cancelled:true};
 }
 async function freeMemory({confirm=false}={}){
  if(confirm!==true)throw Error('Confirm GPU/RAM model unloading.');
  if(active)throw Error('Finish or cancel the active ComfyUI job first.');
  // Does not stop ComfyUI or erase its model files. External workflows may be affected.
  await request('/free',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({unload_models:true,free_memory:true})},5000);
  return {requested:true};
 }
 async function generate(params,{checkpoint,sourceName,maskData,signal}={}){
  if(active)throw Error('ComfyUI is already processing a Hero Tavern job.');
  const job={id:null,controller:new AbortController(),phase:'preparing',startedAt:Date.now()};active=job;
  const onAbort=()=>{job.controller.abort();if(job.id)cancel().catch(()=>{});};signal?.addEventListener('abort',onAbort,{once:true});
  try{
   const names=await checkpoints();
   if(!names.includes(checkpoint))throw Error('Selected checkpoint is not installed in ComfyUI. Choose from the ComfyUI checkpoint list.');
   let source,mask,width=params.width,height=params.height;
   if(sourceName){
    const sourceBytes=fs.readFileSync(validateGalleryName(sourceName)),dimensions=checkPNG(sourceBytes);
    if(typeof maskData!=='string'||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(maskData)||maskData.length>38*1024*1024)throw Error('Paint a PNG mask before inpainting.');
    const maskBytes=Buffer.from(maskData.slice('data:image/png;base64,'.length),'base64'),size=checkPNG(maskBytes);
    if(size.width!==dimensions.width||size.height!==dimensions.height)throw Error('Mask and original image must have identical dimensions.');
    width=dimensions.width;height=dimensions.height;
    source=await upload(sourceBytes,'source',job.controller.signal);
    mask=await upload(maskBytes,'mask',job.controller.signal);
    logEvent({action:'comfy-input-upload',source:sourceName,remote:[source,mask],note:'ComfyUI keeps input files in its own input directory; Hero Tavern does not delete them.'});
   }
   const {graph,saveId}=makeGraph({checkpoint,params:{...params,width,height},source,mask});
   job.phase='queued';
   const response=await (await request('/prompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:graph,client_id:'hero-tavern'}) ,signal:job.controller.signal},30000)).json();
   if(!response?.prompt_id)throw Error('ComfyUI rejected the workflow: '+JSON.stringify(response?.node_errors||{}).slice(0,800));
   job.id=response.prompt_id;job.phase='generating';
   let image=null;
   const deadline=Date.now()+15*60*1000;
   while(Date.now()<deadline){
    if(job.controller.signal.aborted)throw Error('ComfyUI image job cancelled.');
    const item=await (await request('/history/'+encodeURIComponent(job.id),{signal:job.controller.signal},15000)).json();
    const result=item[job.id];
    if(result){
     if(result.status?.status_str==='error'||result.status?.status_str==='failed')throw Error('ComfyUI execution failed: '+JSON.stringify(result.status?.messages||[]).slice(0,1000));
     const outputs=result.outputs?.[saveId]?.images;
     if(Array.isArray(outputs)&&outputs.length){image=outputs[0];break}
     if(result.status?.completed)throw Error('ComfyUI finished without a PNG. Check the selected checkpoint and workflow nodes.');
    }
    await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,650);job.controller.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(Error('ComfyUI job cancelled.'))},{once:true});});
   }
   if(!image)throw Error('ComfyUI generation timed out after 15 minutes.');
   job.phase='saving';
   const query=new URLSearchParams({filename:image.filename,subfolder:image.subfolder||'',type:image.type||'output'});
   const bytes=Buffer.from(await (await request('/view?'+query.toString(),{signal:job.controller.signal},30000)).arrayBuffer());
   const size=checkPNG(bytes);
   const file=Date.now()+'-'+crypto.randomBytes(6).toString('hex')+'.png';
   fs.writeFileSync(path.join(dir,file),bytes,{flag:'wx'});
   const info={engine:'comfyui',model:checkpoint,prompt:params.prompt,negative_prompt:params.negative_prompt,width:size.width,height:size.height,steps:params.steps,seed:params.seed,sampler_name:params.sampler_name,sourceName:sourceName||null,inpaint:!!sourceName,remoteOutput:{filename:image.filename,subfolder:image.subfolder||'',type:image.type||'output'}};
   fs.writeFileSync(path.join(dir,file+'.json'),JSON.stringify(info,null,2));
   logEvent({action:'comfy-image-saved',path:path.join(dir,file),bytes:bytes.length,remote:info.remoteOutput});
   lastError='';return {url:'/images/output/'+file,model:checkpoint,engine:'comfyui',info:JSON.stringify(info)};
  }catch(e){lastError=e.message;throw e}
  finally{signal?.removeEventListener('abort',onAbort);if(active===job)active=null}
 }
 return {available,checkpoints,cancel,freeMemory,generate,logEvent,snapshot:()=>({healthy,lastCheck,error:lastError,active:active&&{id:active.id,phase:active.phase,elapsedMs:Date.now()-active.startedAt},url:base})};
}
module.exports={createComfyAdapter,makeGraph,checkPNG};