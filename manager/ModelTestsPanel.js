(()=>{'use strict';
 const $=id=>document.getElementById(id);let presets=null,history=[],active=false,sourceImage='';
 const notify=(s)=>{$('model-test-status').textContent=s};
 async function api(route,data){const response=await fetch(route,{method:data===undefined?'GET':'POST',headers:{'X-Hero-Token':'__TOKEN__','Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});const result=await response.json();if(!response.ok)throw Error(result.error||'Model test failed');return result;}
 const kindNames={text2text:'Text → Text',text2image:'Text → Image',image2image:'Image → Image',image2text:'Image → Text'};
 const base=()=>{
  const model=$('model-test-model').value;
  const opts=model==='sdxl'?{steps:28,cfg_scale:6,sampler_name:'DPM++ 2M Karras',scheduler:'karras'}:model==='flux-klein'?{steps:4,cfg_scale:1,sampler_name:'Euler',scheduler:'simple'}:model==='z-turbo'?{steps:9,cfg_scale:1,sampler_name:'Euler',scheduler:'simple'}:{steps:25,cfg_scale:1,sampler_name:'Euler',scheduler:'simple'};
  return {prompt:'',modelPack:model,negative_prompt:'',operation:'txt2img',width:768,height:768,seed:-1,preset:'raw',refine:false,releaseGPU:true,batch_size:1,lora:[],sourceName:'',referenceName:'',maskData:'',comfyCheckpoint:$('hero-comfy-checkpoint')?.value||'',...opts};
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
  const started=Date.now(),model=$('model-test-model').value,progress=label=>notify(label+' · '+model);
  let report={kind,model,status:'passed',prompt:'',settings:{},elapsedMs:0};
  try{
   if(kind==='text2text'){
    progress('Running local text-instruction test');
    const prompt=presets.text2text.prompt;
    const r=await api('/diagnostics/text',{prompt,historyTurns:0});
    report={...report,model:r.model||$('model-test-text-model').textContent,prompt,text:r.text||'',status:r.ok?'passed':'failed',error:r.error,settings:{template:r.template}};
   }else if(kind==='text2image'){
    progress('Generating image '+(override?.second?'B':'A')+' with repeatable prompt');
    const prompt=override?.second?presets.text2image.secondPrompt:presets.text2image.prompt;
    const input={...base(),prompt,operation:'txt2img'};
    const r=await api('/studio/generate',input);
    sourceImage=getFilename(r.url);$('model-test-source').value=sourceImage;
    report={...report,prompt,settings:{...input,seed:r.seed,modelPack:model,mode:'txt2img'},imageName:sourceImage,model:r.modelPack||model};
   }else if(kind==='image2image'){
    if(model==='z-turbo')return record({...report,kind,model,status:'skipped',prompt:presets.image2image.prompt,notes:['Z-Image Turbo preset is text-to-image only.']});
    const source=$('model-test-source').value||sourceImage;
    if(!source)throw Error('Select a gallery PNG, or run Text → Image first.');
    progress('Editing explicit reference image');
    const prompt=presets.image2image.prompt;
    const input={...base(),prompt,operation:'img2img',sourceName:source,denoise:0.7,batch_size:1};
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
    const question=presets.image2text.question;const r=await api('/vision/analyze',{imageData,question});
    report={...report,model:r.model||$('model-test-vision-model').textContent,prompt:question,text:r.caption||'',settings:{sourceImage:getFilename(source),width:canvas.width,height:canvas.height}};
   }else throw Error('Unknown test type');
  }catch(e){report.status='failed';report.error=e.message;report.notes=[e.message];}finally{report.elapsedMs=Date.now()-started}
  try{const result=await record(report);notify((result.status==='passed'?'PASS':'CHECK')+' · '+kindNames[kind]+' · '+(result.elapsedMs/1000).toFixed(1)+' sec'+(result.error?' · '+result.error:''));return result;}
  catch(e){notify('Could not save test report: '+e.message);return {...report,error:report.error||e.message};}
 }
 const busyToggle=v=>{active=v;for(const x of ['model-test-run-all','model-test-run-text2text','model-test-run-text2image','model-test-run-image2image','model-test-run-image2text'])$(x).disabled=v;};
 async function guarded(fn){if(active)return;busyToggle(true);try{await fn();await gallery()}catch(e){notify(e.message)}finally{busyToggle(false)}}
 $('model-test-run-all').onclick=()=>guarded(async()=>{
  const suite=[];suite.push(await run('text2text'));suite.push(await run('text2image'));suite.push(await run('text2image',{second:true}));suite.push(await run('image2image'));suite.push(await run('image2text'));
  const counts={passed:0,failed:0,warning:0,skipped:0};for(const s of suite)counts[s.status]=(counts[s.status]||0)+1;
  notify('Model test run complete: '+JSON.stringify(counts)+'. See each output below.');
 });
 for(const kind of ['text2text','text2image','image2image','image2text'])$('model-test-run-'+kind).onclick=()=>guarded(()=>run(kind));
 $('model-test-refresh').onclick=()=>guarded(refresh);
 $('model-test-export').onclick=()=>{
  const anchor=document.createElement('a'),blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),presets,history},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob);
  anchor.href=url;anchor.download='hero-model-tests.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
 };
 window.heroModelTestsRefresh=()=>guarded(refresh);
})();