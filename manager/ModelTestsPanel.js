(()=>{'use strict';
 const $=id=>document.getElementById(id);let presets=null,history=[],active=false,sourceImage='',currentController=null,currentKind='',cancelReason='',cancelling=false,stopRequested=false;
 const notify=(s)=>{$('model-test-status').textContent=s};
 async function api(route,data,{signal,timeoutMs=20000}={}){
  const controller=signal?null:new AbortController(),timer=controller?setTimeout(()=>controller.abort(),timeoutMs):null;
  try{
   const response=await fetch(route,{method:data===undefined?'GET':'POST',headers:{'X-Hero-Token':'__TOKEN__','Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data),signal:signal||controller.signal});
   const result=await response.json();if(!response.ok)throw Error(result.error||'Model test failed');return result;
  }finally{if(timer)clearTimeout(timer)}
 }
 async function terminateModelTest(){
  if(cancelling)return;cancelling=true;
  try{
   // Request engine cancellation independently; aborting fetch alone will not interrupt ComfyUI.
   const route=['text2image','image2image'].includes(currentKind)?'/images/cancel':currentKind==='image2text'?'/vision/stop':currentKind==='tts'?'/tts/stop':'/generation/abort';
   await api(route,{}, {timeoutMs:16000}).catch(e=>notify('Stop was requested but engine did not acknowledge: '+e.message));
  }finally{cancelling=false}
 }
 async function callTest(route,data,kind,timeoutMs){
  const controller=new AbortController();currentController=controller;currentKind=kind;cancelReason='';
  let timeout=false;
  const timer=setTimeout(()=>{timeout=true;cancelReason='Timed out after '+Math.round(timeoutMs/1000)+' seconds; cancelled the engine. This is a failure, not a pass.';controller.abort()},timeoutMs);
  try{return await api(route,data,{signal:controller.signal})}
  catch(e){
   if(controller.signal.aborted){await terminateModelTest();throw Error(cancelReason||'Test cancelled by user; engine stop requested.')}
   throw e;
  }finally{clearTimeout(timer);if(currentController===controller){currentController=null;currentKind='';}}
 }
 $('model-test-stop').onclick=()=>{
  if(!active)return;
  stopRequested=true;cancelReason='Cancelled by user. Stop requested for the active engine.';
  notify(currentController?'Stopping '+(kindNames[currentKind]||currentKind)+'…':'Stopping after the current preflight operation…');
  if(currentController)currentController.abort();
 };
 const kindNames={text2text:'Text → Text',text2image:'Text → Image',image2image:'Image → Image',image2text:'Image → Text',tts:'Text → Speech',tracker:'Tracker workflow','writer-agency':'Writer · player agency','character-long':'Character · 3 long-context replies'};
 const base=(chosenModel)=>{
  const model=chosenModel||$('model-test-model').value;
  const opts=model==='sdxl'?{steps:28,cfg_scale:6,sampler_name:'DPM++ 2M Karras',scheduler:'karras'}:model==='flux-klein'?{steps:4,cfg_scale:1,sampler_name:'Euler',scheduler:'simple'}:model==='z-turbo'?{steps:9,cfg_scale:1,sampler_name:'Euler',scheduler:'simple'}:{steps:25,cfg_scale:1,sampler_name:'Euler',scheduler:'simple'};
  return {modelTest:true,testTimeoutMs:205000,prompt:'',modelPack:model,negative_prompt:'',operation:'txt2img',width:768,height:768,seed:-1,preset:'raw',refine:false,releaseGPU:true,batch_size:1,lora:[],sourceName:'',referenceName:'',maskData:'',comfyCheckpoint:$('hero-comfy-checkpoint')?.value||'',...opts};
 };
 const getFilename=url=>{const name=String(url||'').split('/').pop();if(!/^\d{12,17}-[a-f0-9]{8,24}\.png$/.test(name))throw Error('Select a genuine Hero Tavern gallery PNG before editing or analyzing.');return name};
 async function gallery(){
  const x=await api('/gallery/list');const names=(x.items||[]).map(i=>i.name).filter(n=>/^\d{12,17}-[a-f0-9]{8,24}\.png$/.test(n));const sel=$('model-test-source'),prior=sel.value;sel.replaceChildren(new Option('Select an existing gallery image',''),...names.slice(0,200).map(n=>new Option(n,n)));if(names.includes(prior))sel.value=prior;else if(sourceImage&&names.includes(sourceImage))sel.value=sourceImage;
 }
 async function refresh(){
  if(!presets)presets=await api('/model-tests/presets');
  history=await api('/model-tests/history');await gallery();
  const status=await api('/status');$('model-test-text-model').textContent=status.runningModel||'Not loaded';
  $('model-test-vision-model').textContent=status.vision?.settings?.name||'Not installed';
  const packs=(await api('/comfy/status')).packs||[];const selector=$('model-test-model'),prior=selector.value||$('image-create-model')?.value||'flux-klein';
  selector.replaceChildren(...packs.map(p=>new Option(p.name+(p.installed?' · installed':' · missing'),p.id)));if([...selector.options].some(o=>o.value===prior))selector.value=prior;else if(packs.some(p=>p.id==='flux-klein'))selector.value='flux-klein';
  showHistory();
 }
 function showHistory(){
  const box=$('model-test-history');box.replaceChildren();
  for(const entry of [...history].reverse().slice(0,24)){
   const wrap=document.createElement('article');wrap.className='card';wrap.style.cssText='margin:9px 0;padding:12px';
   const title=document.createElement('strong');title.textContent=(kindNames[entry.kind]||entry.kind)+' · '+entry.model+' · '+entry.status.toUpperCase();
   const info=document.createElement('p');info.className='small';info.textContent=new Date(entry.at).toLocaleString()+' · '+(entry.elapsedMs===null?'—':(entry.elapsedMs/1000).toFixed(1)+' sec')+' · '+entry.notes.join('; ')+(entry.error?' · '+entry.error:'');
   const prompt=document.createElement('p');prompt.className='small';prompt.textContent='Prompt: '+entry.prompt.slice(0,300);
   wrap.append(title,info,prompt);
   if(entry.imageName){const img=document.createElement('img');img.src='/images/output/'+entry.imageName;img.loading='lazy';img.alt='Actual model test output';img.style.cssText='max-width:280px;width:100%;max-height:340px;object-fit:contain;display:block;border-radius:8px';wrap.append(img);}
   if(entry.text){const block=document.createElement('pre');block.textContent=entry.text.slice(0,2000);wrap.append(block);}
   if(entry.workflow){const detail=document.createElement('details'),summary=document.createElement('summary'),output=document.createElement('pre');summary.textContent='Full workflow evidence · '+entry.workflow.stages.length+' stages';output.textContent=JSON.stringify(entry.workflow,null,2);detail.append(summary,output);wrap.append(detail);}
   if(entry.comparison){const comp=document.createElement('p');comp.className='small';comp.textContent='Compared with previous: byte-identical '+entry.comparison.identicalBytes+' · mean color difference '+(entry.comparison.meanColorDifference??'unavailable');wrap.append(comp);}
   box.append(wrap);
  }
 }
 async function record(report){
  const result=await api('/model-tests/record',report);history.push(result);showHistory();return result;
 }
 async function run(kind,override){
  if(active&&override?.direct)throw Error('Another model test is in progress.');
  const started=Date.now(),model=override?.model||$('model-test-model').value,progress=label=>notify(label+' · '+model+' · bounded test (Stop available). Image tests unload text automatically; it reloads at the next chat request.');
  let report={kind,model,status:'passed',prompt:'',settings:{},elapsedMs:0,suiteId:override?.suiteId||null};
  try{
   if(['tracker','writer-agency','character-long'].includes(kind)){
    progress('Running '+kindNames[kind]);
    const result=await callTest('/model-tests/workflow',{kind},kind,900000);history.push(result);showHistory();notify(kindNames[kind]+' · '+result.status.toUpperCase());return result;
   }else if(kind==='text2text'){
    progress('Running local text-instruction test');
    const prompt=presets.text2text.prompt;
    const r=await callTest('/model-tests/text',{},'text2text',35000);
    report={...report,model:r.model||$('model-test-text-model').textContent,prompt,text:r.text||'',status:r.ok?'passed':'failed',error:r.error,settings:{template:r.template}};
   }else if(kind==='text2image'){
    progress('Generating image '+(override?.second?'B':'A')+' with repeatable prompt');
    const prompt=override?.second?presets.text2image.secondPrompt:presets.text2image.prompt;
    const input={...base(model),prompt,operation:'txt2img'};
    const r=await callTest('/studio/generate',input,kind,210000);
    sourceImage=getFilename(r.url);$('model-test-source').value=sourceImage;
    report={...report,prompt,settings:{...input,seed:r.seed,modelPack:model,mode:'txt2img'},imageName:sourceImage,model:r.modelPack||model};
   }else if(kind==='image2image'){
    if(model==='z-turbo')return record({...report,kind,model,status:'skipped',prompt:presets.image2image.prompt,notes:['Z-Image Turbo preset is text-to-image only.']});
    if(model.startsWith('qwen21-')&&!override?.confirmed){if(!confirm('Qwen-Image 2.1 image editing may exceed 12 GB VRAM. This manual diagnostic has a 210-second hard timeout and an engine Stop button. Proceed?'))return record({...report,kind,model,status:'skipped',prompt:presets.image2image.prompt,notes:['User chose not to run heavy Qwen image editing.']});}
    const source=$('model-test-source').value||sourceImage;
    if(!source)throw Error('Select a gallery PNG, or run Text → Image first.');
    progress('Editing explicit reference image');
    const prompt=presets.image2image.prompt;
    const input={...base(model),prompt,operation:'img2img',sourceName:source,denoise:0.7,batch_size:1};
    const r=await callTest('/studio/generate',input,kind,210000);
    const imageName=getFilename(r.url);report={...report,prompt,settings:{...input,seed:r.seed},imageName,model:r.modelPack||model};
   }else if(kind==='image2text'){
    let source=$('model-test-source').value||sourceImage;
    if(!source)throw Error('Choose a gallery image or run Text → Image first.');
    progress('Analyzing image using local vision model');
    const original=new Image();original.src='/images/output/'+getFilename(source);await original.decode();
    const canvas=document.createElement('canvas'),ratio=Math.min(1,768/Math.max(original.naturalWidth,original.naturalHeight));canvas.width=Math.max(1,Math.round(original.naturalWidth*ratio));canvas.height=Math.max(1,Math.round(original.naturalHeight*ratio));
    canvas.getContext('2d',{willReadFrequently:false}).drawImage(original,0,0,canvas.width,canvas.height);
    const imageData=canvas.toDataURL('image/jpeg',0.72);
    const question=presets.image2text.question;const r=await callTest('/vision/analyze',{imageData,question},kind,120000);
    report={...report,model:r.model||$('model-test-vision-model').textContent,prompt:question,text:r.caption||'',settings:{sourceImage:getFilename(source),width:canvas.width,height:canvas.height}};
   }else throw Error('Unknown test type');
  }catch(e){report.status='failed';report.error=e.message;report.notes=[e.message];}finally{report.elapsedMs=Date.now()-started}
  try{const result=await record(report);notify((result.status==='passed'?'PASS':'CHECK')+' · '+kindNames[kind]+' · '+(result.elapsedMs/1000).toFixed(1)+' sec'+(result.error?' · '+result.error:''));return result;}
  catch(e){notify('Could not save test report: '+e.message);return {...report,error:report.error||e.message};}
 }
 const busyToggle=v=>{active=v;$('model-test-stop').disabled=!v;for(const x of ['model-test-run-diagnostic-flow','model-test-run-all','model-test-compare-installed','model-test-run-text2text','model-test-run-tracker','model-test-run-writer-agency','model-test-run-character-long','model-test-run-text2image','model-test-run-image2image','model-test-run-image2text'])$(x).disabled=v;};
 async function guarded(fn){if(active)return;stopRequested=false;busyToggle(true);try{await fn();await gallery()}catch(e){notify(e.message)}finally{busyToggle(false)}}

 // Full diagnosis is deliberately separate from individual history cards and from
 // the hardware-only sequential benchmark. Each stage has a durable result.
 const FLOW_STAGES=[
  ['preflight','Engine connections and hardware'],
  ['text','Text → Text · isolated exact-instruction test'],
  ['tracker','Tracker · extract, update, save and inject state'],
  ['writer-agency','Writer · do not speak or act for the player'],
  ['character-long','Character · three longer replies with long history'],
  ['imageA','Text → Image · red teapot'],
  ['imageB','Text → Image · green frog'],
  ['edit','Image → Image · edit reference'],
  ['vision','Image → Text · visual description'],
  ['tts','Text → Speech · synthesize WAV']
 ];
 let flowReport=null;
 const flowState={};
 function drawFlow(){
  const box=$('model-test-flow-stages');box.replaceChildren();
  for(const [id,label] of FLOW_STAGES){
   const item=flowState[id]||{status:'pending'},li=document.createElement('li');
   const name=document.createElement('strong');name.textContent=label+' · ';
   const detail=document.createElement('span');detail.textContent=item.status.toUpperCase()+(item.note?' — '+item.note:'');
   detail.style.color=item.status==='passed'?'#93dfb3':item.status==='failed'?'#ffa4a4':item.status==='warning'?'#f1d58f':'#b3c2d7';
   li.append(name,detail);box.append(li);
  }
 }
 const flowSet=(id,status,note='',extra={})=>{
  flowState[id]={status,note,...extra};drawFlow();
  $('model-test-flow-summary').textContent=(status==='running'?'Running: ':'Finished: ')+FLOW_STAGES.find(x=>x[0]===id)[1]+' · '+note;
 };
 const clip=e=>String(e?.message||e||'Unknown failure').slice(0,300);
 async function flowSample(stage){
  try{
   const data=await api('/diagnostics/sample',{}, {timeoutMs:12000});
   flowReport.samples.push({stage,at:new Date().toISOString(),...data});
   if(flowReport.samples.length>80)flowReport.samples.shift();
  }catch(error){flowReport.errors.push('Hardware telemetry ('+stage+'): '+clip(error));}
 }
 async function flowStage(id,fn){
  if(stopRequested){flowSet(id,'skipped','Stopped');return null;}
  flowSet(id,'running','Testing…');
  const started=Date.now();
  await flowSample(id+':before');
  try{
   const result=await fn();
   if(result?.skipped)flowSet(id,'skipped',result.note||'Model unavailable');
   else if(result?.status)flowSet(id,result.status,result.error||result.notes?.join('; ')||'Completed');
   else flowSet(id,'passed','Completed');
   flowReport.stages[id]={...flowState[id],elapsedMs:Date.now()-started,result:result||null};
   return result;
  }catch(error){
   const message=clip(error);
   flowSet(id,'failed',message);
   flowReport.stages[id]={...flowState[id],elapsedMs:Date.now()-started};
   flowReport.errors.push(id+': '+message);return null;
  }finally{await flowSample(id+':after')}
 }
 function skipFlow(id,note){
  flowSet(id,'skipped',note);
  flowReport.stages[id]={...flowState[id]};
 }
 const reportSummary=()=>{
  const counts={passed:0,warning:0,failed:0,skipped:0};
  for(const [id] of FLOW_STAGES){const s=flowState[id]?.status||'skipped';if(counts[s]!==undefined)counts[s]++;}
  return counts;
 };
 $('model-test-flow-export').onclick=()=>{
  if(!flowReport)return;
  const blob=new Blob([JSON.stringify(flowReport,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),anchor=document.createElement('a');
  anchor.href=url;anchor.download='hero-full-diagnostics-'+flowReport.id+'.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
 };
 $('model-test-flow-hardware').onclick=()=>{document.querySelector('[data-tab="diagnostics"]')?.click();};
 const flowRun=()=>guarded(async()=>{
  const suiteId='compare-'+Date.now();
  flowReport={id:suiteId,startedAt:new Date().toISOString(),completedAt:null,mode:'full-diagnostic-flow',modelSelection:$('model-test-model').value,stages:{},samples:[],errors:[],testRecordIds:[],connections:null,hardware:null};
  $('model-test-flow-export').disabled=true;
  for(const [id] of FLOW_STAGES)flowState[id]={status:'pending'};
  drawFlow();
  let comfy=null,vision=null,voice=null,engine=null;
  await flowStage('preflight',async()=>{
   const checks=await Promise.allSettled([
    api('/diagnostics/check',{}, {timeoutMs:20000}),
    api('/status',undefined,{timeoutMs:15000}),
    api('/comfy/status',undefined,{timeoutMs:15000}),
    api('/vision/status',undefined,{timeoutMs:15000}),
    api('/tts/status',undefined,{timeoutMs:15000})
   ]);
   const get=i=>checks[i].status==='fulfilled'?checks[i].value:null;
   flowReport.connections=get(0);engine=get(1);comfy=get(2);vision=get(3);voice=get(4);
   flowReport.hardware=flowReport.connections?.environment||null;
   const unavailable=['Connections','Text service','ComfyUI','Vision','TTS'].filter((_,i)=>!get(i));
   if(unavailable.length)return {status:'warning',notes:['Some services unavailable: '+unavailable.join(', ')]};
   return {status:'passed',notes:['Services responded; readiness is checked independently in each stage']};
  });
  const add=async (id,kind,override={})=>{
   const result=await flowStage(id,()=>run(kind,{...override,suiteId}));
   if(result?.id)flowReport.testRecordIds.push(result.id);
   return result;
  };
  if(!engine?.selected&&!engine?.runningModel)skipFlow('text','No text model selected');
  else await add('text','text2text');
  for(const kind of ['tracker','writer-agency','character-long']){if(!engine?.selected&&!engine?.runningModel)skipFlow(kind,'No text model selected');else await add(kind,kind);}
  const selected=$('model-test-model').value,pack=(comfy?.packs||[]).find(x=>x.id===selected);
  const imageReady=!!pack?.installed;
  if(!imageReady){
   for(const id of ['imageA','imageB','edit'])skipFlow(id,'Selected image pack not installed: '+(selected||'none'));
  }else{
   const first=await add('imageA','text2image',{model:selected});
   if(stopRequested)skipFlow('imageB','Stopped');
   else await add('imageB','text2image',{model:selected,second:true});
   if(!sourceImage)skipFlow('edit','No generated reference image');
   else if(selected==='z-turbo')skipFlow('edit','Selected pack supports text-to-image only');
   else if(selected.startsWith('qwen21-')&&!$('model-test-include-heavy').checked)
    skipFlow('edit','Heavy Qwen editing omitted for 12 GB VRAM safety; opt in to run');
   else await add('edit','image2image',{model:selected,confirmed:true});
  }
  if(stopRequested)skipFlow('vision','Stopped');
  else if(!vision?.settings?.name||!vision?.settings?.mmproj)skipFlow('vision','Vision model or matching projector missing');
  else if(!sourceImage)skipFlow('vision','No gallery image generated or selected');
  else if(vision.settings.mode!=='cpu'&&!$('model-test-include-heavy').checked)
   skipFlow('vision','GPU vision test omitted in safe mode; enable heavy tests or select CPU mode');
  else await add('vision','image2text');
  if(stopRequested)skipFlow('tts','Stopped');
  else if(!voice?.ready||!voice?.weightsReady)skipFlow('tts','TTS dependencies or voice weights missing; install from All AI models');
  else await flowStage('tts',async()=>{
   const started=Date.now();
   const result=await callTest('/tts/speak',{text:'This is a Hero Tavern speech diagnostics test.'},'tts',150000);
   if(!/^\/tts\/audio\/[a-z0-9_-]+\.wav$/i.test(result.url||''))throw Error('TTS response did not contain a valid WAV path');
   return {status:'passed',notes:['WAV synthesis succeeded'],url:result.url,elapsedMs:Date.now()-started,engine:voice.settings?.engine,variant:voice.settings?.variant};
  });
  flowReport.completedAt=new Date().toISOString();flowReport.summary=reportSummary();
  flowReport.cancelled=stopRequested;
  const resultText=JSON.stringify(flowReport.summary);
  $('model-test-flow-summary').textContent=(stopRequested?'Flow stopped. ':'Full diagnostic flow finished. ')+resultText+' · Each image and text result remains in the test history.';
  $('model-test-flow-telemetry').textContent='Hardware samples: '+flowReport.samples.length+' · '+(flowReport.errors.length?'Warnings: '+flowReport.errors.join(' | '):'No telemetry exceptions')+
    '\nExport the full report for connections, raw telemetry, test records and audio result.';
  $('model-test-flow-export').disabled=false;
 });
 $('model-test-run-diagnostic-flow').onclick=flowRun;
 window.heroRunModelDiagnosticFlow=flowRun;
 drawFlow();

 $('model-test-run-all').onclick=()=>guarded(async()=>{
  const suite=[];
  const add=async (kind,config)=>{if(stopRequested)return null;const result=await run(kind,config);suite.push(result);if(result?.status==='failed'&&/cancelled|timed out/i.test(result.error||''))stopRequested=true;return result;};
  await add('text2text');
  for(const kind of ['tracker','writer-agency','character-long'])await add(kind);
  await add('text2image');
  await add('text2image',{second:true});
  if(!stopRequested){
   if($('model-test-include-heavy').checked||!$('model-test-model').value.startsWith('qwen21-'))await add('image2image',{confirmed:$('model-test-include-heavy').checked});
   else suite.push(await record({kind:'image2image',model:$('model-test-model').value,status:'skipped',prompt:presets.image2image.prompt,notes:['Qwen image editing skipped for 12 GB GPU safety. Click Image → Image to run this test individually.']}));
  }
  if(!stopRequested){
   const vision=await api('/vision/status').catch(()=>({settings:{}}));
   if(!vision.settings?.name||!vision.settings?.mmproj)suite.push(await record({kind:'image2text',model:'unconfigured vision model',status:'skipped',prompt:presets.image2text.question,notes:['Install a vision model and matching projector before testing image-to-text.']}));
   else if(vision.settings.mode!=='cpu'&&!$('model-test-include-heavy').checked)suite.push(await record({kind:'image2text',model:vision.settings.name,status:'skipped',prompt:presets.image2text.question,notes:['CUDA vision test skipped in safe mode to protect GPU after diffusion tests. Select CPU mode or opt into heavy tests.']}));
   else await add('image2text');
  }
  const counts={passed:0,failed:0,warning:0,skipped:0};for(const s of suite)counts[s.status]=(counts[s.status]||0)+1;
  notify((stopRequested?'Suite stopped safely. ':'Safe model test suite finished: ')+JSON.stringify(counts)+'. View individual results and timings below.');
 });
 // Run the same two fixed prompts consecutively for every available installed pack.
 // No automatic model downloads and no simultaneous inference jobs.
 $('model-test-compare-installed').onclick=()=>guarded(async()=>{
  const status=await api('/comfy/status');
  const installed=(status.packs||[]).filter(p=>p.installed&&p.id&&p.id!=='koboldcpp');
  if(!installed.length)throw Error('No installed ComfyUI image models. Install one in All AI models first.');
  const runId='compare-'+Date.now(),results=[];
  for(let i=0;i<installed.length;i++){
   if(stopRequested)break;
   const pack=installed[i];
   notify('Comparing model '+(i+1)+'/'+installed.length+': '+pack.name);
   for(const second of [false,true]){
    if(stopRequested)break;
    const item=await run('text2image',{model:pack.id,second,suiteId:runId});
    results.push(item);
    if(item?.status==='failed'&&/cancelled|timed out/i.test(item.error||'')){stopRequested=true;break;}
   }
  }
  const summary=results.reduce((groups,item)=>{const m=groups[item.model]??={passed:0,warning:0,failed:0,skipped:0,seconds:0};m[item.status]=(m[item.status]||0)+1;m.seconds+=Math.round((item.elapsedMs||0)/1000);return groups},{});
  notify((stopRequested?'Comparison stopped. ':'Sequential comparison complete. ')+JSON.stringify(summary)+' · per-model images and timings below.');
 });
 for(const kind of ['text2text','tracker','writer-agency','character-long','text2image','image2image','image2text'])$('model-test-run-'+kind).onclick=()=>guarded(()=>run(kind));
 $('model-test-refresh').onclick=()=>guarded(refresh);
 $('model-test-export').onclick=()=>{
  const anchor=document.createElement('a'),blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),presets,history},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob);
  anchor.href=url;anchor.download='hero-model-tests.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
 };
 window.heroModelTestsRefresh=()=>guarded(refresh);
})();