// Optional, loopback-only ComfyUI worker. All local output stays in the Hero Tavern gallery.
// No background installer, unbounded retries or deletion of external ComfyUI data.
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {buildWorkflow,modelName}=require('./ComfyWorkflows.cjs');
const {createWorkflowLibrary}=require('./ComfyWorkflowLibrary.cjs');
const {createModelHub,PACKS}=require('./ComfyModelHub.cjs');
const {recipeGraph}=require('./ComfyRecipes.cjs');
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
 const models=createModelHub(root,{fetchFn});
 let active=null,lastError='',lastCheck=0,healthy=false,lastStats=null,completed=0;
 let lastQwenImage=null;
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
  if(!['checkpoints','loras','upscale_models','diffusion_models','unet_gguf','text_encoders','vae'].includes(group))throw Error('Unknown ComfyUI model group.');
  const r=await request('/models/'+group,{},7000),names=await r.json();
  if(!Array.isArray(names))throw Error('ComfyUI returned an invalid model list for '+group+'.');
  return names.filter(name=>{try{modelName(name);return name.length<=260}catch{return false}});
 }
 async function ggufList(){
  try{return await modelList('unet_gguf')}catch{
   const info=await (await request('/object_info/UnetLoaderGGUF',{},7000)).json();
   const names=info.UnetLoaderGGUF?.input?.required?.unet_name?.[0];
   return Array.isArray(names)?names.filter(name=>{try{modelName(name);return /\.gguf$/i.test(name)}catch{return false}}):[];
  }
 }
 const checkpoints=()=>modelList('checkpoints').then(names=>names.filter(n=>/\.safetensors$/i.test(n)));
 async function nativeHistory(){
  const history=await (await request('/history?max_items=30',{},10000)).json();
  return Object.entries(history).filter(([,job])=>job.status?.completed).map(([id,job])=>({id,images:Object.values(job.outputs||{}).flatMap(o=>o.images||[]).filter(i=>i.type==='output')})).filter(j=>j.images.length).reverse();
 }
 async function importNative({id}={}){
  if(typeof id!=='string'||!/^[-\w]{1,128}$/.test(id))throw Error('Select a completed ComfyUI job.');
  const jobs=await (await request('/history/'+encodeURIComponent(id),{},10000)).json(),job=jobs[id];
  if(!job?.status?.completed)throw Error('The selected ComfyUI job has not completed.');
  const outputs=Object.values(job.outputs||{}).flatMap(o=>o.images||[]).filter(i=>i.type==='output').slice(0,20),images=[];
  for(const remote of outputs){
   if(typeof remote.filename!=='string'||remote.filename.length>256||remote.filename.includes('..')||/[\\/]/.test(remote.filename))throw Error('Invalid ComfyUI image filename.');
   const query=new URLSearchParams({filename:remote.filename,subfolder:remote.subfolder||'',type:'output'}),bytes=Buffer.from(await (await request('/view?'+query,{},60000)).arrayBuffer()),size=checkPNG(bytes);
   const name=Date.now()+'-'+crypto.randomBytes(6).toString('hex')+'.png',dest=path.join(dir,name);fs.writeFileSync(dest,bytes,{flag:'wx'});
   fs.writeFileSync(dest+'.json',JSON.stringify({engine:'comfyui',mode:'native-workflow',promptId:id,remoteOutput:remote,...size,createdAt:new Date().toISOString()}));images.push({url:'/images/output/'+name,...size});
  }
  return {images};
 }

 const NODE_REQUIREMENTS={
  ...Object.fromEntries(require('./ComfyModelHub.cjs').QWEN_PACKS.map(p=>[p.id,['UnetLoaderGGUF','CLIPLoader','VAELoader','TextEncodeQwenImage21','LatentUpscale','RepeatLatentBatch','KSampler','VAEDecode','SaveImage']])),
  'flux-klein':['LoraLoaderModelOnly','UNETLoader','CLIPLoader','VAELoader','CLIPTextEncode','ConditioningZeroOut','EmptyFlux2LatentImage','Flux2Scheduler','SamplerCustomAdvanced','RandomNoise','KSamplerSelect','CFGGuider','VAEDecode','SaveImage'],
  'z-turbo':['UNETLoader','CLIPLoader','VAELoader','CLIPTextEncode','ConditioningZeroOut','ModelSamplingAuraFlow','EmptyLatentImage','KSampler','VAEDecode','SaveImage'],
  'sdxl':['CheckpointLoaderSimple','CLIPTextEncode','EmptyLatentImage','KSampler','VAEDecode','SaveImage']
 };
 async function diagnosePack(id){
  const required=NODE_REQUIREMENTS[id];if(!required)throw Error('Select a supported ComfyUI model pack.');
  if(!await available())return {ok:false,connected:false,status:'offline',packId:id,missingNodes:[],missingFiles:[],requiredNodesNotChecked:required,missingFilesOnDisk:models.localStatus().find(p=>p.id===id)?.missing||[],error:lastError,advice:'ComfyUI is offline on 127.0.0.1:'+port+'. Node availability cannot be tested until the engine starts. Use Start & check or Install / repair selected model; already-downloaded weights are preserved.'};
  const status=await catalog(),pack=status.packs.find(p=>p.id===id);
  const info=await (await request('/object_info',{},18000)).json();
  const missingNodes=required.filter(node=>!Object.prototype.hasOwnProperty.call(info,node));
  const missingFiles=pack?.missing||[];
  return {ok:!missingNodes.length&&!missingFiles.length,connected:true,status:!missingNodes.length&&!missingFiles.length?'ready':'incomplete',missingNodes,missingFiles,packId:id,
    advice:missingNodes.length?'ComfyUI is missing required core nodes. Update ComfyUI Portable, then restart it.':
       missingFiles.length?'ComfyUI cannot find the model weights. Check the active models folder and restart managed ComfyUI.':
       'Required model components and workflow nodes are visible. Actual GPU inference must still be tested.'};
 }

 async function catalog(){
  if(!await available())return {available:false,error:lastError,checkpoints:[],loras:[],upscalers:[],devices:[],packs:models.localStatus().map(pack=>({...pack,downloaded:pack.installed})),modelHub:models.snapshot(),offlineInventory:true};
  const groups=['checkpoints','loras','upscale_models','diffusion_models','text_encoders','vae'];
  const entries=await Promise.allSettled([...groups.map(group=>modelList(group)),ggufList()]);
  const lists=Object.fromEntries(groups.map((name,i)=>[name,entries[i].status==='fulfilled'?entries[i].value:[]]));
  // ComfyUI-GGUF registers its own file category. The core diffusion_models
  // endpoint can omit .gguf even while UnetLoaderGGUF sees the weight.
  if(entries[groups.length].status==='fulfilled')lists.diffusion_models=[...new Set([...lists.diffusion_models,...entries[groups.length].value.filter(name=>/\.gguf$/i.test(name))])];
  let samplingOptions={};try{const info=await (await request('/object_info/KSampler',{},7000)).json(),required=info.KSampler?.input?.required;samplingOptions={samplers:required?.sampler_name?.[0]||[],schedulers:required?.scheduler?.[0]||[]};}catch{}
  return {...samplingOptions,available:true,checkpoints:lists.checkpoints,loras:lists.loras,upscalers:lists.upscale_models,
    packs:models.composeStatus(lists).map(pack=>{
      const disk=models.localStatus().find(item=>item.id===pack.id);
      return {...pack,downloaded:!!disk?.installed,installed:pack.installed,missing:pack.missing};
    }),modelHub:models.snapshot(),lists,
    devices:(lastStats?.devices||[]).map(x=>({name:x.name,type:x.type,vramTotal:x.vram_total,vramFree:x.vram_free})),
    warnings:entries.filter(x=>x.status==='rejected').map(x=>x.reason.message)};
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
   const chosenPack=custom?null:models.pack(params.modelPack||models.snapshot().settings.selected||'sdxl');
   const managed=!!chosenPack&&chosenPack.id!=='sdxl'&&params.operation!=='upscale';
   const mode=custom?'custom':params.operation||((sourceName&&maskData)?'inpaint':sourceName?'img2img':'txt2img');
   let resolvedFiles=null;
   if(managed){
    const groups=['diffusion_models','text_encoders','vae'];
    const actual=Object.fromEntries(await Promise.all(groups.map(async name=>[name,await modelList(name)])));
    if(chosenPack.family==='qwen21'){
     const gguf=await ggufList();
     actual.diffusion_models=[...new Set([...actual.diffusion_models,...gguf.filter(name=>/\.gguf$/i.test(name))])];
    }
    const missing=models.composeStatus(actual).find(x=>x.id===chosenPack.id)?.missing||[];
    resolvedFiles=models.resolvePackFiles(chosenPack,actual);
    if(missing.length)throw Error(chosenPack.name+' missing components: '+missing.join(', ')+'. Install its model pack in Image Studio.');
   }else if(!custom&&mode!=='upscale'){const availableCheckpoints=await checkpoints();if(!availableCheckpoints.includes(checkpoint))throw Error('Select an installed ComfyUI checkpoint in Image Studio.');}
   else if(custom&&params.lora?.length)throw Error('Custom workflows manage their own LoRAs. Remove separate LoRA selections.');
   if(mode==='upscale'&&!sourceName)throw Error('Choose a gallery image to upscale.');
   if(mode==='upscale'&&params.lora?.length)throw Error('LoRAs apply to diffusion generation, not standalone upscaling.');
   if(params.lora?.length){
    const installed=await modelList('loras');
    if(params.lora.some(item=>!installed.includes(item.name)))throw Error('Selected LoRA was not found in ComfyUI model library.');
   }
   if(mode==='upscale'&&params.upscaleModel){
    const installed=await modelList('upscale_models');
    if(!installed.includes(params.upscaleModel))throw Error('The selected AI upscaler is not installed in ComfyUI.');
   }
   let source,mask,reference,sourceDimensions;
   if(params.referenceName){const referenceBytes=fs.readFileSync(galleryFile(params.referenceName));checkPNG(referenceBytes,28*1024*1024);reference=await upload(referenceBytes,'reference',job.controller.signal);}
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
   const spec=custom?workflows.build(params.workflowId,{...settings,sourceImage:source||'',maskImage:mask||''}):managed?recipeGraph(chosenPack,settings,{source,mask,reference,resolvedFiles:resolvedFiles}):buildWorkflow({checkpoint,params:settings,source,mask,mode,lora:params.lora||[],upscaleModel:params.upscaleModel||'',upscaleFactor:params.upscaleFactor||2,upscaleMethod:params.upscaleMethod||'lanczos'});
   const qwenGraph=managed&&chosenPack.family==='qwen21';
   const qwenText=qwenGraph?Object.values(spec.graph).find(node=>node.class_type==='TextEncodeQwenImage21')?.inputs?.prompt:null;
   if(qwenGraph&&(typeof qwenText!=='string'||qwenText!==settings.prompt))throw Error('Qwen text encoding was not connected to the current image prompt. Generation stopped; no stale image was used.');
   const promptFingerprint=qwenGraph?crypto.createHash('sha256').update(qwenText).digest('hex').slice(0,16):null;
   if(qwenGraph)logEvent({action:'qwen-conditioning-check',promptHash:promptFingerprint,promptLength:qwenText.length,seed:spec.seed,model:chosenPack.id,sampler:'euler',scheduler:'simple',cfg:spec.graph[Object.keys(spec.graph).find(id=>spec.graph[id].class_type==='KSampler')]?.inputs.cfg});

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
     if(result.status?.status_str==='error'||result.status?.status_str==='failed'){const messages=result.status?.messages||[];const error=messages.find(x=>x[0]==='execution_error')?.[1]||{};if(error.node_type==='UnetLoaderGGUF'&&/unknown model architecture|model is not currently supported/i.test(error.exception_message||''))throw Error('The installed ComfyUI-GGUF loader cannot read this Qwen-Image 2.1 model architecture. Open Image models & setup → Repair Qwen 2.1 GGUF loader. Hero Tavern will install the compatible leejet version and preserve model weights. Details: '+String(error.exception_message||'').slice(0,350));throw Error('ComfyUI workflow failed at '+(error.node_type||'node')+(error.node_id?' #'+error.node_id:'')+': '+String(error.exception_message||JSON.stringify(messages)).slice(0,850));}
     outputs=result.outputs?.[spec.saveId]?.images;
     if(Array.isArray(outputs)&&outputs.length)break;
     if(result.status?.completed)throw Error('ComfyUI completed without returning an image.');
    }
    if(Date.now()-lastQueueCheck>2500){
     lastQueueCheck=Date.now();
     try{const q=await queueStatus();if(q.ownQueued)job.phase='queued';else if(!Number.isFinite(job.progress))job.phase='generating';}catch{}
    }
    await new Promise((resolve,reject)=>{
     let t;
     const aborted=()=>{clearTimeout(t);job.controller.signal.removeEventListener('abort',aborted);reject(Error('ComfyUI job cancelled.'))};
     t=setTimeout(()=>{job.controller.signal.removeEventListener('abort',aborted);resolve()},700);
     job.controller.signal.addEventListener('abort',aborted,{once:true});
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
    if(qwenGraph&&images.length===0){
      const imageHash=crypto.createHash('sha256').update(bytes).digest('hex');
      const previous=lastQwenImage;
      if(previous&&previous.imageHash===imageHash&&(previous.promptHash!==promptFingerprint||previous.seed!==spec.seed)){
        logEvent({action:'qwen-identical-image-error',promptHash:promptFingerprint,previousPromptHash:previous.promptHash,seed:spec.seed,previousSeed:previous.seed,outputHash:imageHash});
        throw Error('Qwen returned byte-identical image data even though the prompt or seed changed. The result was not saved as a new image. Check the Qwen text encoder, connected model weights and the managed ComfyUI loader; see Logs/image-files.jsonl.');
      }
      lastQwenImage={promptHash:promptFingerprint,seed:spec.seed,imageHash};
    }
    const name=Date.now()+'-'+crypto.randomBytes(6).toString('hex')+'.png';
    const dest=path.join(dir,name);
    fs.writeFileSync(dest,bytes,{flag:'wx'});
    const details={engine:'comfyui',modelPack:chosenPack?.id||null,referenceName:params.referenceName||null,mode:spec.mode,workflowId:spec.workflowId||null,workflowName:spec.workflowName||null,model:custom?(spec.workflowName||'Custom ComfyUI workflow'):managed?chosenPack.name:checkpoint,sourceName:sourceName||null,prompt:params.prompt,negative_prompt:params.negative_prompt,
      width:size.width,height:size.height,steps:params.steps,seed:spec.seed,sampler_name:params.sampler_name,denoise:params.denoise,
      lora:params.lora||[],upscaleModel:params.upscaleModel||'',batch_size:spec.batch,batchIndex:images.length,promptId:job.id,remoteOutput:{filename:remote.filename,subfolder:remote.subfolder||'',type:'output'},
      promptFingerprint,normalizedSettings:spec.normalizedSettings||null,createdAt:new Date().toISOString()};
    fs.writeFileSync(dest+'.json',JSON.stringify(details,null,2));
    logEvent({action:'comfy-image-saved',path:dest,bytes:bytes.length,promptId:job.id,remoteOutput:details.remoteOutput});
    images.push({url:'/images/output/'+name,width:size.width,height:size.height,seed:spec.seed});
   }
   completed++;lastError='';
   return {url:images[0].url,images,engine:'comfyui',model:custom?(spec.workflowName||'Custom ComfyUI'):managed?chosenPack.name:checkpoint,modelPack:chosenPack?.id||null,seed:spec.seed,workflowId:spec.workflowId||null,info:JSON.stringify({count:images.length,mode:spec.mode,promptId:job.id})};
  }catch(e){lastError=e.message;logEvent({action:'comfy-job-error',error:e.message,promptId:job.id});throw e}
  finally{signal?.removeEventListener('abort',onAbort);try{job.socket?.close()}catch{};if(active===job)active=null}
 }
 return {available,catalog,checkpoints,modelList,generate,cancel,freeMemory,queueStatus,logEvent,workflows,models,diagnosePack,nativeHistory,importNative,
  snapshot:()=>({healthy,lastCheck,error:lastError,active:active&&{id:active.id,phase:active.phase,progress:active.progress,step:active.step,totalSteps:active.totalSteps,etaMs:active.etaMs,elapsedMs:Date.now()-active.startedAt},completed,url:base,
    devices:(lastStats?.devices||[]).map(x=>({name:x.name,type:x.type,vramFree:x.vram_free,vramTotal:x.vram_total}))})};
}
module.exports={createComfyAdapter,makeGraph,checkPNG};
