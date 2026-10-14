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
   const route=['text2image','image2image'].includes(currentKind)?'/images/cancel':currentKind==='image2text'?'/vision/stop':'/generation/abort';
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
  if(!active||!currentController)return;
  stopRequested=true;cancelReason='Cancelled by user. Stop requested for the active engine.';
  notify('Stopping '+(kindNames[currentKind]||currentKind)+'…');
  currentController.abort();
 };
 const kindNames={text2text:'Text → Text',text2image:'Text → Image',image2image:'Image → Image',image2text:'Image → Text'};
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
   if(kind==='text2text'){
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
    const r=await api('/studio/generate',input);
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
 const busyToggle=v=>{active=v;$('model-test-stop').disabled=!v;for(const x of ['model-test-run-all','model-test-compare-installed','model-test-run-text2text','model-test-run-text2image','model-test-run-image2image','model-test-run-image2text'])$(x).disabled=v;};
 async function guarded(fn){if(active)return;stopRequested=false;busyToggle(true);try{await fn();await gallery()}catch(e){notify(e.message)}finally{busyToggle(false)}}
 $('model-test-run-all').onclick=()=>guarded(async()=>{
  const suite=[];
  const add=async (kind,config)=>{if(stopRequested)return null;const result=await run(kind,config);suite.push(result);if(result?.status==='failed'&&/cancelled|timed out/i.test(result.error||''))stopRequested=true;return result;};
  await add('text2text');
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
 for(const kind of ['text2text','text2image','image2image','image2text'])$('model-test-run-'+kind).onclick=()=>guarded(()=>run(kind));
 $('model-test-refresh').onclick=()=>guarded(refresh);
 $('model-test-export').onclick=()=>{
  const anchor=document.createElement('a'),blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),presets,history},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob);
  anchor.href=url;anchor.download='hero-model-tests.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
 };
 window.heroModelTestsRefresh=()=>guarded(refresh);
})();