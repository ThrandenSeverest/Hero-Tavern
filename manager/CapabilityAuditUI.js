// All-mode readiness dashboard. Never install hidden gigabytes without a user click.
(()=>{
 'use strict';
 const host=document.getElementById('model-center');if(!host)return;
 const panel=document.createElement('section');panel.className='card';panel.id='hero-capability-audit';
 const heading=document.createElement('h3');heading.textContent='Whole-app capability & dependency check';
 const help=document.createElement('p');help.textContent='Checks existing models and backend availability across Character Chat, Adventure, Writer and Image Studio. No downloads run during a check. A model is not called verified until a real test has passed.';
 const refresh=document.createElement('button');refresh.className='primary';refresh.id='hero-capability-check';refresh.textContent='Check every feature and installed model';
 const download=document.createElement('button');download.id='hero-capability-missing';download.textContent='Find & download missing models';
 const state=document.createElement('p');state.id='hero-capability-state';state.setAttribute('role','status');
 const output=document.createElement('div');output.id='hero-capability-results';
 const actions=document.createElement('div');actions.className='actions';actions.append(refresh,download);
 panel.append(heading,help,actions,state,output);host.insertBefore(panel,host.children[1]||null);
 let last=null,busy=false;
 const req=async(url,data)=>{
  let res;try{res=await fetch(url,{method:data===undefined?'GET':'POST',headers:{'X-Hero-Token':'__TOKEN__','Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)})}
  catch(error){throw Error('Local ModelBridge is unreachable. Restart Hero Tavern and check Diagnostics → startup logs. '+error.message)}
  let json;try{json=await res.json()}catch{throw Error('ModelBridge returned an invalid response (HTTP '+res.status+'). Check Diagnostics → startup logs.')}
  if(!res.ok)throw Error(json.error||'HTTP '+res.status+' on '+url);return json;
 };
 const tag=(name,text)=>{const x=document.createElement(name);x.textContent=text;return x;};
 const stateText={missing:'Missing dependencies',installed:'Installed, not tested',online:'Backend online, not end-to-end verified',verified:'Test passed',warning:'Needs repair',unverified:'Requires an actual workflow test'};
 const makeButton=(label,fn)=>{
  const b=document.createElement('button');b.textContent=label;
  b.onclick=async()=>{
   if(busy)return;busy=true;b.disabled=true;
   try{await fn();state.textContent='Operation accepted. Downloads can take time; check the linked installation screen for progress and errors.';await update(false);}
   catch(error){state.textContent='Setup failed: '+error.message;}
   finally{busy=false;b.disabled=false;}
  };
  return b;
 };
 async function launch(feature){
  const action=feature.action||{};
  if(action.kind==='text'){
   if(!confirm('Download the selected recommended GGUF text model? This may use several GB of disk space.'))return;
   await req('/download',{index:action.index});tab('models');return;
  }
  if(action.kind==='selectText'){
   await req('/select',{name:action.name});await req('/start',{});tab('models');return;
  }
  if(action.kind==='loadText'){await req('/start',{});tab('models');return;}
  if(action.kind==='image'){
   if(!confirm('Install or repair the '+action.id+' image pack, managed ComfyUI and required dependencies? Existing weights will be reused. This can require substantial disk space.'))return;
   await req('/image/model-center/setup',{id:action.id,confirm:true});tab('image-setup');return;
  }
  if(action.kind==='vision'){
   if(!confirm('Install or verify the Qwen vision model and matching multimodal projector? Existing files will be reused.'))return;
   await req('/vision/setup',{confirm:true});tab('vision');return;
  }
  if(action.kind==='tts'){
   const current=await req('/tts/status');
   if(!current.ready||!current.weightsReady){
    if(!confirm('Install Qwen CustomVoice 0.6B, its isolated speech dependencies and weights? It uses built-in voices without any WAV. Existing voices and models are preserved.'))return;
    await req('/tts/configure',{engine:'qwen',variant:'custom-0.6',device:current.settings.device});
    await req('/tts/setup',{});
   }
   tab('voices');return;
  }
  tab(action.tab||'diagnostics');
 }
 function render(report){
  output.replaceChildren();
  const total=report.summary||{};
  const tally=tag('p','Checked: '+(total.verified||0)+' verified · '+(total.online||0)+' backend online · '+(total.installed||0)+' installed/unverified · '+(total.missing||0)+' missing · '+(total.warning||0)+' warning · '+(total.unverified||0)+' needs live test.');
  output.append(tally);
  for(const mode of Object.values(report.modes||{})){
   const group=document.createElement('details');group.open=true;
   group.style.cssText='border-top:1px solid #53627b;padding:10px 0';
   const name=tag('summary',mode.label);name.style.fontWeight='bold';group.append(name);
   for(const feature of mode.features||[]){
    const box=document.createElement('div');box.style.cssText='padding:8px 10px;margin:7px 0;border:1px solid #42546c;border-radius:9px';
    const top=tag('strong',feature.label+' · '+(stateText[feature.state]||feature.state));
    const detail=tag('p',feature.description+(feature.model?' Model: '+feature.model+'.':''));
    detail.className='small';
    box.append(top,detail);
    if(feature.missing?.length){const note=tag('p','Check: '+feature.missing.join('; '));note.className='small';box.append(note);}
    if(feature.warning){const note=tag('p',feature.warning);note.className='small';box.append(note);}
    const verb=feature.action?.kind==='text'?'Download model':feature.action?.kind==='selectText'?'Select installed model':feature.action?.kind==='loadText'?'Start installed model':feature.action?.kind==='image'?'Install/repair complete image pack':feature.action?.kind==='vision'?'Install vision + projector':feature.action?.kind==='tts'?'Install no-WAV voice':'Run diagnostics';
    const button=makeButton(feature.state==='verified'?'Open diagnostics':verb,()=>launch(feature));
    box.append(button);group.append(box);
   }
   output.append(group);
  }
  output.append(tag('p',report.notice||'Downloaded is not synonymous with verified.'));
 }
 async function update(open=true){
  state.textContent='Scanning installed models, engines, shared dependencies and previous diagnostic results…';
  if(open)host.hidden=false;
  try{last=await req('/capabilities/report');render(last);state.textContent='Scan complete · '+new Date(last.at).toLocaleString()+'. To confirm a feature is truly working, run the matching real model test in Diagnostics.';}
  catch(error){state.textContent='Capability check failed: '+error.message;}
 }
 refresh.onclick=()=>update(true);
 download.onclick=async()=>{await update(true);output.scrollIntoView({block:'start',behavior:'smooth'});state.textContent+=' Choose an install/repair action beside each missing feature. No file is downloaded without confirmation.';};
 window.heroCapabilityCheck=update;
})();
