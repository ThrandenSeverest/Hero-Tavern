/* Unified Image Studio controller: one model registry and progress across Create, Tavern and Adventure. */
(()=>{
'use strict';
const $=id=>document.getElementById(id),token='__TOKEN__';
async function req(route,data){
 const r=await fetch(route,{method:data===undefined?'GET':'POST',headers:{'X-Hero-Token':token,...(data===undefined?{}:{'Content-Type':'application/json'})},body:data===undefined?undefined:JSON.stringify(data)});
 const raw=await r.text();let json;try{json=JSON.parse(raw)}catch{throw Error(route+' returned invalid response: '+raw.slice(0,180))}
 if(!r.ok)throw Error(json.error||'Local service error '+r.status);
 return json;
}
const element=(tag,txt,cls)=>{const e=document.createElement(tag);if(txt!=null)e.textContent=txt;if(cls)e.className=cls;return e};
function action(label,click){const b=element('button',label);b.type='button';b.onclick=async()=>{b.disabled=true;try{await click()}catch(e){alertError(e)}finally{b.disabled=false}};return b}
let last=null,polling=false,pollTimer=null,visible=false,loading=false;
const errorEl=()=> $('image-model-center-error');
const alertError=e=>{const out=errorEl();if(out)out.textContent=e.message||String(e);const quick=$('image-create-feedback');if(quick)quick.textContent=e.message||String(e)};
const choiceLabel=id=>({'flux-klein':'FLUX.2 Klein 4B','z-turbo':'Z-Image Turbo',sdxl:'SDXL',koboldcpp:'KoboldCpp classic',custom:'Custom ComfyUI workflow'}[id]||id);
function applyVisualSelection(id){
 if(!$('image-create-model'))return;
 $('image-create-model').value=id;
 if(typeof selectStudioModel==='function')selectStudioModel(id,{save:false}).catch(alertError);
}
function fileStatus(model,file){
 const missing=(model.missing||[]).includes(file.group+'/'+file.name);
 const row=element('div','','hero-model-file-row');
 row.append(element('span',missing?'○':'✓','hero-file-icon'),element('span',file.group+' / '+file.name));
 const status=element('small',missing?'Required':'Detected');
 row.append(status);return row;
}
function modelCard(model){
 const card=element('article',null,'card hero-unified-card');
 if(model.id===last?.choices.global)card.classList.add('hero-unified-selected');
 const head=element('div',null,'hero-unified-head'),details=element('div');
 details.append(element('strong',model.label||choiceLabel(model.id)),element('p',model.description||'', 'small'));
 const state=element('p',model.ready?'Ready to generate':model.canStart&&model.downloaded?'Downloaded · loads automatically when needed':model.downloaded?'Downloaded · ready to check':'Not downloaded','hero-unified-state');
 if(!model.ready)state.classList.add('hero-unified-warning');
 details.append(state);head.append(details);
 const choose=action(model.id===last.choices.global?'Selected as default':'Use for images',async()=>{
  await req('/image/model-center/select',{scope:'global',id:model.id});applyVisualSelection(model.id);await refresh(true);
 });
 if(model.id===last.choices.global)choose.disabled=true;
 head.append(choose);card.append(head);
 if(model.files?.length){
  const box=element('div',null,'hero-unified-files');for(const f of model.files)box.append(fileStatus(model,f));
  card.append(box);
 }
 const operations=element('div',null,'actions');
 if(['flux-klein','z-turbo','sdxl'].includes(model.id)){
  operations.append(action('Check workflow / dependencies',async()=>{
   const report=await req('/image/model-center/diagnose',{id:model.id});
   const message=report.ok?'✓ '+report.advice:
      '⚠ '+report.advice+(report.missingNodes?.length?'\nMissing nodes: '+report.missingNodes.join(', '):'')+
      (report.missingFiles?.length?'\nMissing models: '+report.missingFiles.join(', '):'');
   alertError(Error(message));
  }));
 }
 if(['sdxl','flux-klein','z-turbo'].includes(model.id)&&!model.installed&&!model.downloaded){
  operations.append(action('Download '+choiceLabel(model.id)+(model.downloadGiB?' (~'+model.downloadGiB+' GB models)':''),async()=>{
   await req('/image/model-center/setup',{id:model.id,confirm:true});await refresh(true);
  }));
 }
 if(model.downloaded&&!model.ready)operations.append(action('Prepare '+choiceLabel(model.id),async()=>{await req('/image/model-center/setup',{id:model.id,confirm:true});await refresh(true)}));
 if(model.issue)card.append(element('p',!model.downloaded?'Download this model to prepare its engine and all required components automatically.':!last.comfy.connected&&last.comfy.detected?'The engine starts automatically when you generate an image.':model.issue,'small'));
 if(operations.children.length)card.append(operations);
 return card;
}
function renderDownload(state){
 const region=$('image-center-download');region.replaceChildren();
 const dl=state.download,done=state.lastDownload;
 if(state.install){region.append(element('strong','Installing managed image engine · '+state.install.phase));const p=element('progress');p.max=state.install.expected||1;if(state.install.expected>0&&state.install.phase==='downloading')p.value=state.install.bytes;else p.removeAttribute('value');region.append(p,element('small',(state.install.bytes/1024**3).toFixed(2)+' GB downloaded'+(state.install.expected?' / '+(state.install.expected/1024**3).toFixed(2)+' GB':'')));}
 if(state.setup){region.append(element('strong','Setting up '+choiceLabel(state.setup.packId)),element('p',state.setup.phase));const progress=element('progress');progress.removeAttribute('value');region.append(progress,action('Cancel setup',async()=>{await req('/image/model-center/cancel',{});await refresh(true)}));}
 else if(state.lastSetup)region.append(element('p',(state.lastSetup.ok?'✓ ':'⚠ ')+state.lastSetup.message));
 if(dl){
  region.append(element('strong','Installing '+choiceLabel(dl.packId)),element('p',(dl.file||'Checking files and disk space')+' · '+dl.phase));
  const p=element('progress');p.max=100;if(dl.total>0)p.value=Math.min(100,Math.round(100*dl.bytes/dl.total));else p.removeAttribute('value');
  region.append(p,element('small',(dl.bytes/(1024**3)).toFixed(2)+' / '+(dl.total>0?(dl.total/(1024**3)).toFixed(2)+' GB':'calculating size…')));
  region.append(action('Cancel / keep resumable files',async()=>{await req('/image/model-center/cancel',{});await refresh(true)}));
 }else if(done){
  const msg=element('p',(done.ok?'✓ ':'⚠ ')+done.message);region.append(msg);
 }
}
function render(state){
 last=state;
 const display=$('image-center-connection');display.replaceChildren();
 const connect=state.comfy.connected;
 display.append(element('strong',connect?'● Image engine ready':state.comfy.detected?'○ Image engine idle · starts automatically':'○ Download a model to prepare image generation'),element('p',state.comfy.modelsDirectory?'Model folder: '+state.comfy.modelsDirectory:'Choose Download on a model card. Hero Tavern prepares the required engine and model components automatically.','small'));
 if(state.comfy.error&&(state.comfy.running||state.comfy.mode==='external'||!/fetch failed|ECONNREFUSED|not connected/i.test(state.comfy.error)))display.append(element('p',state.comfy.error,'small'));
 const jobs=$('image-center-generation');jobs.replaceChildren();
 const run=state.activeGeneration;
 if(run){
  jobs.append(element('strong','Image generation · '+run.phase));
  const b=element('progress');b.max=100;if(run.progress!=null)b.value=Math.max(0,Math.min(100,run.progress*100));else b.removeAttribute('value');
  jobs.append(b,element('p',(run.step!=null?run.step+'/'+run.totalSteps+' steps · ':'')+Math.floor((run.elapsedMs||0)/1000)+'s elapsed','small'));
 }else jobs.append(element('small','No image generation currently running.'));
 const gpu=state.comfy.devices?.[0];
 if(gpu?.vramTotal||gpu?.vram_total){const total=gpu.vramTotal||gpu.vram_total,free=gpu.vramFree||gpu.vram_free;
  jobs.append(element('p',(gpu.name||'GPU')+' · '+(Number(free)/(1024**3)).toFixed(1)+' GB free of '+(Number(total)/(1024**3)).toFixed(1)+' GB VRAM (reported by ComfyUI)','small'));
 }
 const quick=$('image-create-model-status'),current=state.models.find(m=>m.id===state.choices.global);
 if(quick&&current){
  quick.textContent=current.ready?'✓ '+current.label+' ready':current.downloaded?(connect?'Downloaded; not visible in running ComfyUI. Open Models & Setup.':'Model downloaded. Its engine starts automatically when needed.'):'Download this model in Models. Hero Tavern prepares its engine and dependencies automatically.';
  quick.classList.toggle('error',!current.ready);
 }
 $('image-center-cards').replaceChildren(...state.models.filter(m=>m.id!=='custom'&&m.id!=='koboldcpp').map(modelCard));
 renderDownload(state);
 for(const scope of ['global','chat','adventure']){
  const selector=$('image-center-'+scope);if(!selector||document.activeElement===selector)continue;
  const value=scope==='global'?state.choices.global:(state.choices.overrides[scope]||'inherit');selector.value=value;
 }
 const help=$('image-center-restart-note');
 help.textContent=connect?'ComfyUI is online. Newly downloaded model files may require restarting the engine.':state.comfy.detected?'Managed Portable detected; click Start ComfyUI below.':'Use Install ComfyUI below or connect your existing installation.';
 $('image-center-start').disabled=connect||!state.comfy.detected;
 $('image-center-install').disabled=!!state.comfy.detected||!!state.install;
 $('image-center-restart').disabled=!state.comfy.detected||state.comfy.mode!=='managed'||!connect;
 $('image-center-model-path').placeholder=state.comfy.modelsDirectory||'C:\\AI\\ComfyUI\\models';
}
async function refresh(force=false){
 if(polling)return;
 if(!force&&!visible)return;
 polling=true;
 try{const data=await req('/image/model-center');render(data);errorEl().textContent='';}
 catch(e){alertError(e)}
 finally{polling=false}
}
function makeUI(){
 const setup=$('image-setup-content'),create=$('images');if(!setup||!create)return;
 const original=$('hero-comfy-hub');if(!original)return;
 original.hidden=true;
 const main=element('div',null,'card hero-unified-root');
 main.id='image-model-center';
 main.append(element('h2','Image models · managed engines'),element('p','One model system for Create, Tavern and Adventure. Download, track dependencies, and select a model here. Downloading a model automatically installs its required engine and dependencies. No separate engine installation or manual launch is needed.','small'));
 const status=element('div',null,'hero-unified-connection');status.id='image-center-connection';main.append(status);
 const choices=element('div',null,'controls');
 for(const [id,label] of [['global','Default model (Image Studio / native image API)'],['chat','Tavern chat image model'],['adventure','Adventure image model']]){
  const field=element('label',label),select=element('select');select.id='image-center-'+id;
  if(id!=='global')select.append(new Option('Use default model','inherit'));
  for(const key of ['flux-klein','z-turbo','sdxl','koboldcpp','custom'])select.append(new Option(choiceLabel(key),key));
  select.onchange=async()=>{
   const value=select.value;
   try{await req('/image/model-center/select',id!=='global'&&value==='inherit'?{scope:id,inherit:true}:{scope:id,id:value});
     if(id==='global')applyVisualSelection(value);await refresh(true);}
   catch(e){alertError(e)}
  };
  field.append(select);choices.append(field);
 }
 main.append(choices);
 const actions=element('div',null,'actions');
 const start=action('Start ComfyUI',async()=>{await req('/comfy/runtime/start',{});await refresh(true)});start.id='image-center-start';
 const install=action('Install ComfyUI Portable',async()=>{
  const oldInstall=$('hero-runtime-install');
  if(!oldInstall)throw Error('ComfyUI installation control is missing.');
  oldInstall.click();
  await refresh(true);
 });install.id='image-center-install';
 const restart=action('Restart managed ComfyUI (detect new models)',async()=>{
  if(!confirm('Restart the managed ComfyUI engine? Only the Hero Tavern-owned process will be restarted; existing images/models stay untouched.'))return;
  const current=await req('/studio/get');if(current.busy)throw Error('Finish generating before restarting.');
  await req('/comfy/runtime/stop',{});await req('/comfy/runtime/start',{});await refresh(true);
 });restart.id='image-center-restart';
 actions.append(action('Refresh model status',()=>refresh(true)));
 const engineActions=element('div',null,'actions');engineActions.append(install,start,restart);
 const note=element('p','', 'small');note.id='image-center-restart-note';
 main.append(actions);
 const generation=element('div',null,'hero-unified-progress');generation.id='image-center-generation';main.append(generation);
 const models=element('div',null,'hero-unified-models');models.id='image-center-cards';
 main.append(models);
 const download=element('div',null,'hero-unified-progress');download.id='image-center-download';main.append(download);
 const advanced=element('details');const summary=element('summary','Advanced · external engines and troubleshooting');advanced.append(summary,engineActions,note);
 const location=element('div',null,'controls'),label=element('label','Model folder (only for an external ComfyUI installation)'),
 input=element('input');input.id='image-center-model-path';input.placeholder='C:\\AI\\ComfyUI\\models';
 label.append(input);location.append(label);
 const locationActions=element('div',null,'actions');
 locationActions.append(action('Use this folder',async()=>{
  if(!input.value.trim())throw Error('Enter the existing ComfyUI models directory.');
  await req('/comfy/models/configure',{modelRoot:input.value.trim()});await refresh(true);
 }));
 locationActions.append(action('Detect managed folder',async()=>{await req('/image/model-center/folder',{});await refresh(true)}));
 advanced.append(location,locationActions);
 const runtimeDetails=original.querySelector('details');
 if(runtimeDetails)advanced.append(runtimeDetails);
 const technical=$('hero-comfy-panel');
 if(technical){
  const tech=element('details'),h=element('summary','Advanced engine settings, checkpoints, masking tools');tech.append(h,technical);advanced.append(tech);
 }
 const workflows=$('hero-comfy-workflow-library');if(workflows)advanced.append(workflows);
 main.append(advanced);
 const error=element('p','', 'hero-unified-error');error.id='image-model-center-error';main.append(error);
 $('models').append(main);
 const mount=()=>{const target=$('image-setup').hidden?$('models'):setup;if(main.parentElement!==target)target.append(main)};new MutationObserver(mount).observe($('image-setup'),{attributes:true,attributeFilter:['hidden']});mount();
 const quick=element('div',null,'hero-unified-quick');
 quick.append(action('Install / fix selected image model',async()=>{
  const model=last?.models.find(m=>m.id===$('image-create-model').value);
  if(!model)throw Error('Choose an image model first.');
  if(['koboldcpp','custom'].includes(model.id)){document.querySelector('[data-tab="image-setup"]')?.click();return}
  if(model.ready){alertError(Error('Model is already ready to generate.'));return}
  await req('/image/model-center/setup',{id:model.id,confirm:true});await refresh(true);document.querySelector('[data-tab="models"]')?.click();return;
 }));
 $('image-create-model-status').after(quick);
 $('image-create-model').onchange=async()=>{
  try{const id=$('image-create-model').value;await req('/image/model-center/select',{scope:'global',id});
   applyVisualSelection(id);await refresh(true)}catch(e){alertError(e)}
 };
 window.heroRefreshImageCenter=()=>refresh(true);
 visible=true;refresh(true);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',makeUI,{once:true});else makeUI();
setInterval(()=>{visible=!!last?.download||!!last?.setup||!$('models')?.hidden||!$('image-setup')?.hidden||!$('images')?.hidden;refresh()},3000);
})();
