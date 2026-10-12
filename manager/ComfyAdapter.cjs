// Optional, loopback-only ComfyUI worker. All local output stays in the Hero Tavern gallery.
// No background installer, unbounded retries or deletion of external ComfyUI data.
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {buildWorkflow,modelName}=require('./ComfyWorkflows.cjs');
const {createWorkflowLibrary}=require('./ComfyWorkflowLibrary.cjs');
const PNG=Buffer.from([137,80,78,71,13,10,26,10]);
const GALLERY_NAME=/^\d{12,17}-[a-f0-9]{8,24}\.png$/;
function checkPNG(data,max=75*1024*1024){
 if(!Buffer.isBuffer(data)||data.length<33||data.length>max||!data.subarray(0,8).equals(PNG)||data.toString('ascii',12,16)!=='IHDR')throw Error('A PNG image is required; supplied bytes exceeded the supported size or were invalid.');
 const width=data.readUInt32BE(16),height=data.readUInt32BE(20);
 if(width<256||height<256||width>4096||height>4096)throw Error('Image dimensions must be 256–4096.');
 return {width,height};
}
function makeGraph(input){return buildWorkflow(input)}
function createComfyAdapter(root,{port=8188,fetchFn=globalThis.fetch,WebSocketClass=globalThis.WebSocket}={}){
 if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid ComfyUI loopback port.');
 const base='http://127.0.0.1:'+port,dir=path.join(root,'Images'),logs=path.join(root,'Logs');
 fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(logs,{recursive:true});
 const workflows=createWorkflowLibrary(root);
 let active=null,lastError='',lastCheck=0,healthy=false,lastStats=null,completed=0;
 async function request(route,options={},timeout=4000){
  const signal=AbortSignal.any([options.signal||new AbortController().signal,AbortSignal.timeout(timeout)]);
  const r=await fetchFn(base+route,{...options,signal});
  if(!r.ok){let detail='';try{detail=(await r.text()).slice(0,750)}catch{}throw Error('ComfyUI '+route.split('?')[0]+' HTTP '+r.status+(detail?': '+detail:''));}
  return r;
 }
 async function available(){
  try{const r=await request('/system_stats',{},2200);lastStats=await r.json();healthy=true;lastError='';return true}
  catch(e){healthy=false;lastError=e.message;return false}finally{lastCheck=Date.now()}
 }
 async function modelList(group){
  if(!['checkpoints','loras','upscale_models'].includes(group))throw Error('Unknown ComfyUI model group.');
  const r=await request('/models/'+group,{},7000),names=await r.json();
  if(!Array.isArray(names))throw Error('ComfyUI returned an invalid model list for '+group+'.');
  return names.filter(name=>{try{modelName(name);return name.length<=260}catch{return false}});
 }
 const checkpoints=()=>modelList('checkpoints').then(names=>names.filter(n=>/\.safetensors$/i.test(n)));
 async function catalog(){
  if(!await available())return {available:false,error:lastError,checkpoints:[],loras:[],upscalers:[],devices:[]};
  const [ckpt,loras,upscalers]=await Promise.allSettled([checkpoints(),modelList('loras'),modelList('upscale_models')]);
  return {available:true,checkpoints:ckpt.status==='fulfilled'?ckpt.value:[],loras:loras.status==='fulfilled'?loras.value:[],upscalers:upscalers.status==='fulfilled'?upscalers.value:[],
    devices:(lastStats?.devices||[]).map(x=>({name:x.name,type:x.type,vramTotal:x.vram_total,vramFree:x.vram_free})),
    warnings:[ckpt,loras,upscalers].filter(x=>x.status==='rejected').map(x=>x.reason.message)};
 }
 function galleryFile(name){
  if(typeof name!=='string'||!GALLERY_NAME.test(name))throw Error('Select an image from Hero Tavern gallery.');
  const file=path.join(dir,name);
  if(!fs.existsSync(file)||fs.lstatSync(file).isSymbolicLink()||!fs.statSync(file).isFile())throw Error('Saved image is unavailable.');
  return file;
 }
 async function upload(bytes,prefix,signal){
  const name='hero-'+prefix+'-'+crypto.randomUUID()+'.png';
  const form=new FormData();form.append('image',new Blob([bytes],{type:'image/png'}),name);form.append('type','input');form.append('overwrite','false');
  const info=await (await request('/upload/image',{method:'POST',body:form,signal},45000)).json();
  if(info?.name!==name)throw Error('ComfyUI did not confirm the uploaded input image.');
  return name;
 }
 function logEvent(entry){
  const file=path.join(logs,'image-files.jsonl');
  try{
   if(fs.existsSync(file)&&fs.statSync(file).size>4*1024*1024){const old=file+'.previous';if(fs.existsSync(old))fs.unlinkSync(old);fs.renameSync(file,old);}
   fs.appendFileSync(file,JSON.stringify({at:new Date().toISOString(),...entry})+'\n');
  }catch{}
 }
 function listen(job){
  if(typeof WebSocketClass!=='function')return;
  try{
   const ws=new WebSocketClass('ws://127.0.0.1:'+port+'/ws?clientId='+encodeURIComponent(job.clientId));
   job.socket=ws;
   ws.addEventListener('message',event=>{
    if(typeof event.data!=='string'||event.data.length>65536)return;
    try{
     const packet=JSON.parse(event.data),eventId=packet.data?.prompt_id;
     if(eventId&&job.id&&eventId!==job.id)return;
     if(packet.type==='progress'&&job.id){
      const now=Date.now(),step=Number(packet.data.value),max=Number(packet.data.max);
      if(Number.isFinite(step)&&Number.isFinite(max)&&max>0&&step>=0&&step<=max){
       job.step=step;job.totalSteps=max;job.progress=step/max;job.phase='sampling';
       const elapsed=now-job.startedAt;job.etaMs=step>0?Math.max(0,Math.round(elapsed*(max-step)/step)):null;
      }
     }else if(packet.type==='executing'&&packet.data?.node===null&&job.id){job.phase='saving';job.progress=1;}
    }catch{}
   });
   ws.addEventListener('error',()=>{});
  }catch{}
 }
 async function cancel(){
  const job=active;
  if(!job)return {cancelled:false};
  job.controller.abort();
  if(!job.id)return {cancelled:true};
  try{
   const queue=await (await request('/queue',{},2500)).json();
   const running=queue.queue_running||[];
   const body=JSON.stringify({prompt_id:job.id});
   if(running.some(item=>Array.isArray(item)&&item[1]===job.id))
    await request('/interrupt',{method:'POST',headers:{'Content-Type':'application/json'},body},4000);
   else await request('/queue',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({delete:[job.id]})},4000);
  }catch(e){logEvent({action:'comfy-cancel-warning',error:e.message,promptId:job.id})}
  return {cancelled:true,promptId:job.id};
 }
 async function freeMemory({confirm=false}={}){
  if(confirm!==true)throw Error('Confirm ComfyUI GPU/RAM model unloading.');
  if(active)throw Error('Finish or cancel the active ComfyUI job first.');
  await request('/free',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"unload_models":true,"free_memory":true}'},6000);
  return {requested:true};
 }
 async function queueStatus(){
  try{
   const q=await (await request('/queue',{},2500)).json();
   const current=active?.id||null;
   return {running:(q.queue_running||[]).length,pending:(q.queue_pending||[]).length,ownQueued:!!current&&(q.queue_pending||[]).some(v=>v[1]===current)};
  }catch(e){return {error:e.message}}
 }
 async function generate(params,{checkpoint,sourceName,maskData,signal}={}){
  if(active)throw Error('A Hero Tavern ComfyUI image job is already running.');
  const job={id:null,clientId:'hero-tavern-'+crypto.randomUUID(),controller:new AbortController(),phase:'preflight',startedAt:Date.now(),progress:null,step:null,totalSteps:null,etaMs:null,socket:null};
  active=job;const onAbort=()=>cancel().catch(()=>{});
  signal?.addEventListener('abort',onAbort,{once:true});
  try{
   if(signal?.aborted)throw Error('Job cancelled.');
   const free=fs.statfsSync(dir),freeBytes=free.bavail*free.bsize;
   if(freeBytes<1024*1024*1024)throw Error('Less than 1 GiB free where Hero Tavern saves images. Free disk space before generating.');
   const custom=!!params.workflowId;
   const mode=custom?'custom':params.operation||((sourceName&&maskData)?'inpaint':sourceName?'img2img':'txt2img');
   if(!custom&&mode!=='upscale'){const availableCheckpoints=await checkpoints();if(!availableCheckpoints.includes(checkpoint))throw Error('Select an installed ComfyUI checkpoint in Image Studio.');}
   else if(custom&&params.lora?.length)throw Error('Custom workflows manage their own LoRAs. Remove separate LoRA selections.');
   if(mode==='upscale'&&!sourceName)throw Error('Choose a gallery image to upscale.');
   if(params.lora?.length){
    const installed=await modelList('loras');
    if(params.lora.some(item=>!installed.includes(item.name)))throw Error('Selected LoRA was not found in ComfyUI model library.');
   }
   if(mode==='upscale'&&params.upscaleModel){
    const installed=await modelList('upscale_models');
    if(!installed.includes(params.upscaleModel))throw Error('The selected AI upscaler is not installed in ComfyUI.');
   }
   let source,mask,sourceDimensions;
   if(sourceName){
    const sourceBytes=fs.readFileSync(galleryFile(sourceName));sourceDimensions=checkPNG(sourceBytes,28*1024*1024);
    if(sourceDimensions.width>2048||sourceDimensions.height>2048)throw Error('For 12 GB GPU safety, source images above 2048px need resizing first.');
    source=await upload(sourceBytes,'source',job.controller.signal);
    if(mode==='inpaint'||custom&&maskData){
     if(typeof maskData!=='string'||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(maskData)||maskData.length>38*1024*1024)throw Error('Paint a valid PNG mask to edit an area.');
     const maskBytes=Buffer.from(maskData.slice('data:image/png;base64,'.length),'base64'),size=checkPNG(maskBytes,28*1024*1024);
     if(size.width!==sourceDimensions.width||size.height!==sourceDimensions.height)throw Error('Source and painted mask dimensions differ.');
     mask=await upload(maskBytes,'mask',job.controller.signal);
    }
    logEvent({action:'comfy-upload',source:sourceName,remoteFiles:[source,mask].filter(Boolean),remoteFolder:'ComfyUI input (external; retained)'});
   }
   if(mode==='inpaint'&&!mask)throw Error('The inpaint brush selection cannot be empty.');
   if(mode==='upscale'&&sourceDimensions){if(params.upscaleModel&&Math.max(sourceDimensions.width,sourceDimensions.height)>1024)throw Error('For safe AI upscaling on 12 GB VRAM, select a source at most 1024 pixels per side.');if(!params.upscaleModel&&Math.max(sourceDimensions.width,sourceDimensions.height)*(params.upscaleFactor||2)>4096)throw Error('Upscale result would exceed 4096px.');}
   const settings={...params,width:sourceDimensions?.width||params.width,height:sourceDimensions?.height||params.height};
   const spec=custom?workflows.build(params.workflowId,{...settings,sourceImage:source||'',maskImage:mask||''}):buildWorkflow({checkpoint,params:settings,source,mask,mode,lora:params.lora||[],upscaleModel:params.upscaleModel||'',upscaleFactor:params.upscaleFactor||2});
   job.phase='queued';listen(job);
   const response=await (await request('/prompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:spec.graph,client_id:job.clientId}),signal:job.controller.signal},45000)).json();
   if(!response?.prompt_id)throw Error('ComfyUI rejected the workflow: '+JSON.stringify(response?.node_errors||response).slice(0,1500));
   job.id=response.prompt_id;
   const deadline=Date.now()+20*60*1000;let outputs=null,lastQueueCheck=0;
   while(Date.now()<deadline){
    if(job.controller.signal.aborted)throw Error('ComfyUI job cancelled.');
    const history=await (await request('/history/'+encodeURIComponent(job.id),{signal:job.controller.signal},12000)).json();
    const result=history[job.id];
    if(result){
     if(result.status?.status_str==='error'||result.status?.status_str==='failed')throw Error('ComfyUI workflow failed: '+JSON.stringify(result.status?.messages||[]).slice(0,1400));
     outputs=result.outputs?.[spec.saveId]?.images;
     if(Array.isArray(outputs)&&outputs.length)break;
     if(result.status?.completed)throw Error('ComfyUI completed without returning an image.');
    }
    if(Date.now()-lastQueueCheck>2500){
     lastQueueCheck=Date.now();
     try{const q=await queueStatus();if(q.ownQueued)job.phase='queued';else if(!Number.isFinite(job.progress))job.phase='generating';}catch{}
    }
    await new Promise((resolve,reject)=>{
     const t=setTimeout(resolve,700),aborted=()=>{clearTimeout(t);reject(Error('ComfyUI job cancelled.'))};
     job.controller.signal.addEventListener('abort',aborted,{once:true});
     t.unref?.();
    });
   }
   if(!Array.isArray(outputs)||!outputs.length)throw Error('ComfyUI job timed out.');
   job.phase='saving';job.progress=1;
   const images=[],max=Math.min(4,outputs.length);
   for(const remote of outputs.slice(0,max)){
    if(job.controller.signal.aborted)throw Error('ComfyUI job cancelled.');
    if(remote.type!=='output'||typeof remote.filename!=='string'||remote.filename.length>256)throw Error('Unexpected ComfyUI output reference.');
    const query=new URLSearchParams({filename:remote.filename,subfolder:remote.subfolder||'',type:'output'});
    const bytes=Buffer.from(await (await request('/view?'+query.toString(),{signal:job.controller.signal},60000)).arrayBuffer());
    const size=checkPNG(bytes);
    const name=Date.now()+'-'+crypto.randomBytes(6).toString('hex')+'.png';
    const dest=path.join(dir,name);
    fs.writeFileSync(dest,bytes,{flag:'wx'});
    const details={engine:'comfyui',mode:spec.mode,workflowId:spec.workflowId||null,workflowName:spec.workflowName||null,model:custom?(spec.workflowName||'Custom ComfyUI workflow'):checkpoint,sourceName:sourceName||null,prompt:params.prompt,negative_prompt:params.negative_prompt,
      width:size.width,height:size.height,steps:params.steps,seed:spec.seed,sampler_name:params.sampler_name,denoise:params.denoise,
      lora:params.lora||[],upscaleModel:params.upscaleModel||'',batch_size:spec.batch,promptId:job.id,remoteOutput:{filename:remote.filename,subfolder:remote.subfolder||'',type:'output'},
      createdAt:new Date().toISOString()};
    fs.writeFileSync(dest+'.json',JSON.stringify(details,null,2));
    logEvent({action:'comfy-image-saved',path:dest,bytes:bytes.length,promptId:job.id,remoteOutput:details.remoteOutput});
    images.push({url:'/images/output/'+name,width:size.width,height:size.height,seed:spec.seed});
   }
   completed++;lastError='';
   return {url:images[0].url,images,engine:'comfyui',model:custom?(spec.workflowName||'Custom ComfyUI'):checkpoint,seed:spec.seed,workflowId:spec.workflowId||null,info:JSON.stringify({count:images.length,mode:spec.mode,promptId:job.id})};
  }catch(e){lastError=e.message;logEvent({action:'comfy-job-error',error:e.message,promptId:job.id});throw e}
  finally{signal?.removeEventListener('abort',onAbort);try{job.socket?.close()}catch{};if(active===job)active=null}
 }
 return {available,catalog,checkpoints,modelList,generate,cancel,freeMemory,queueStatus,logEvent,workflows,
  snapshot:()=>({healthy,lastCheck,error:lastError,active:active&&{id:active.id,phase:active.phase,progress:active.progress,step:active.step,totalSteps:active.totalSteps,etaMs:active.etaMs,elapsedMs:Date.now()-active.startedAt},completed,url:base,
    devices:(lastStats?.devices||[]).map(x=>({name:x.name,type:x.type,vramFree:x.vram_free,vramTotal:x.vram_total}))})};
}
module.exports={createComfyAdapter,makeGraph,checkPNG};
