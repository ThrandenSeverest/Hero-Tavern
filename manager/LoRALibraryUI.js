(()=>{
'use strict';
const $=id=>document.getElementById(id),token='__TOKEN__';
async function api(route,data){const response=await fetch(route,{method:data===undefined?'GET':'POST',headers:{'X-Hero-Token':token,...(data===undefined?{}:{'Content-Type':'application/json'})},body:data===undefined?undefined:JSON.stringify(data)});const body=await response.json();if(!response.ok)throw Error(body.error||'LoRA service HTTP '+response.status);return body;}
const familyNames={'sdxl':'SDXL / Pony / Illustrious','sd15':'Stable Diffusion 1.5','flux2-klein':'FLUX.2 Klein 4B','flux2-klein-9b':'FLUX.2 Klein 9B (requires different engine)','flux1':'FLUX.1','qwen-image21':'Qwen Image 2.1','qwen-image':'Qwen Image','zimage':'Z-Image Turbo'};
const families=['',...Object.keys(familyNames)];
function familyOf(id){if(id.startsWith('qwen21-'))return 'qwen-image21';return ({sdxl:'sdxl','flux-klein':'flux2-klein','z-turbo':'zimage'})[id]||'';}
const node=(tag,attrs={},text)=>{const el=document.createElement(tag);for(const [key,value]of Object.entries(attrs)){if(key==='class')el.className=value;else el.setAttribute(key,value);}if(text!==undefined)el.textContent=text;return el;};
let records=[],installed=[],poll=null;
const info=()=>$('hero-lora-status');
function message(s){info().textContent=s;}
function chosenModel(){return $('image-create-model')?.value||'sdxl';}
function addOptions(field,arr,placeholder){const value=field.value;field.replaceChildren(new Option(placeholder,''),...arr.map(x=>new Option(x[1],x[0])));if([...field.options].some(o=>o.value===value))field.value=value;}
async function refresh(){
 try{
  const family=familyOf(chosenModel()),state=await api('/lora/library?pack='+encodeURIComponent(chosenModel())+'&checkpoint='+encodeURIComponent($('hero-comfy-checkpoint')?.value||''));
  installed=state.items||[];
  const search=($('hero-lora-filter').value||'').toLowerCase();
  const showUnknown=$('hero-lora-unknown').checked;
  const matches=installed.filter(l=>((l.compatible)||(showUnknown&&l.unknown))&&l.name.toLowerCase().includes(search));
  const choices=matches.filter(x=>x.compatible).map(x=>[x.name,x.name+' ('+(familyNames[x.family]||x.family)+')']);
  for(const key of ['hero-comfy-lora-1','hero-comfy-lora-2','hero-comfy-lora-3'])addOptions($(key),choices,'None / incompatible hidden');
  const grid=$('hero-lora-installed');grid.replaceChildren();
  for(const lora of installed.filter(x=>x.name.toLowerCase().includes(search))){
   const card=node('div',{class:'card'}),heading=node('strong',{},lora.name),status=node('p',{class:'small'},lora.error||((lora.compatible?'✓ Compatible':'○ '+(lora.unknown?'Unknown base model':'Different base model'))+' · '+(familyNames[lora.family]||lora.family||'unknown')));
   const selector=node('select');
   selector.append(new Option('Unknown – do not use',''),...Object.entries(familyNames).map(([k,v])=>new Option(v,k)));
   selector.value=lora.family||'';
   const words=node('input',{placeholder:'Trigger words, separated by commas',maxlength:'1000'});words.value=(lora.triggerWords||[]).join(', ');
   const assign=node('button',{},'Save family and trigger words');assign.onclick=async()=>{try{if(!selector.value)throw Error('Choose a family first.');await api('/lora/assign',{name:lora.name,family:selector.value,triggerWords:words.value.split(',').map(x=>x.trim()).filter(Boolean)});message('Saved '+lora.name+'. Trigger words will be added during generation.');await refresh();await window.heroRefreshQuickLoras?.()}catch(e){message(e.message)}};
   card.append(heading,status,selector,words,assign);grid.append(card);
  }
  $('hero-lora-count').textContent=matches.length+' usable or unclassified LoRA(s) for '+(familyNames[family]||chosenModel())+'. Incompatible LoRAs cannot be selected.';
  const d=state.download;if(d){message('Downloading '+d.name+': '+(d.bytes/1048576).toFixed(1)+' / '+(d.total/1048576).toFixed(1)+' MiB · '+d.phase);}
  else if(state.last){message(state.last.ok?'Installed '+state.last.name:state.last.error);}
 }catch(e){message(e.message);}
}
async function installFile(){
 const file=$('hero-lora-file').files?.[0];if(!file)throw Error('Choose a .safetensors file.');
 if(!/\.safetensors$/i.test(file.name))throw Error('Only .safetensors LoRAs are supported.');
 const chosen=$('hero-lora-import-family').value||undefined;
 const job=await api('/lora/upload/start',{name:file.name,size:file.size});
 try{
  let sent=0;const max=Math.min(job.maxChunk,1024*1024);
  while(sent<file.size){const buf=await file.slice(sent,sent+max).arrayBuffer();const bytes=new Uint8Array(buf);let raw='';for(let i=0;i<bytes.length;i+=16384)raw+=String.fromCharCode(...bytes.subarray(i,i+16384));await api('/lora/upload/chunk',{id:job.id,part:btoa(raw)});sent+=bytes.byteLength;message('Importing '+file.name+' '+Math.round(sent/file.size*100)+'%');}
  const done=await api('/lora/upload/finish',{id:job.id,...(chosen?{family:chosen}:{})});message('Installed '+done.name+(done.warning?' · '+done.warning:''));await refresh();
 }catch(e){await api('/lora/cancel',{}).catch(()=>{});throw e;}
}
async function browse(){
 const wanted=$('hero-lora-civitai-family').value||familyOf(chosenModel());
 const data=await api('/lora/browse',{query:$('hero-lora-query').value,family:wanted,sort:$('hero-lora-sort').value,token:$('hero-lora-key').value});
 const grid=$('hero-lora-results');grid.replaceChildren();
 for(const item of data.items){
  const card=node('div',{class:'card'}),title=node('strong',{},item.title),description=node('p',{class:'small'},item.version+' · '+item.baseModel+' · '+Math.round(item.sizeKB/1024)+' MiB');
  const link=node('a',{href:item.url,target:'_blank',rel:'noopener noreferrer'},'View on Civitai');
  const install=node('button',{},'Install');install.onclick=async()=>{try{if(!confirm('Download '+item.title+' · '+item.baseModel+' from Civitai into ComfyUI LoRAs?'))return;await api('/lora/download',{versionId:item.versionId,family:item.family||wanted,token:$('hero-lora-key').value,confirm:true});message('Download started. Follow progress below.');await refresh();}catch(e){message(e.message)}};
  if(!item.family)install.disabled=!wanted;card.append(title,description,link,install);grid.append(card);
 }
 if(!data.items.length)message('No compatible Civitai LoRAs found. Try a wider search or a different base-model filter.');
}
function mount(){
 const advanced=$('hero-comfy-advanced'),host=$('image-model-center')||$('image-setup-content');if(!advanced||!host)return;
 const box=node('div',{class:'card',id:'hero-lora-library'}),h=node('h3',{},'LoRA Library · compatible models only');
 box.append(h,node('p',{class:'small'},'LoRAs are isolated by model family. Unknown or mismatched weights are excluded from generation until you assign a matching family.'));
 const filters=node('div',{class:'controls'}),search=node('input',{id:'hero-lora-filter',placeholder:'Search installed LoRAs'}),unknown=node('label',{},'Include unknown');unknown.append(node('input',{type:'checkbox',id:'hero-lora-unknown'}));filters.append(search,unknown);box.append(filters,node('p',{id:'hero-lora-count',class:'small'}));
 const installedList=node('div',{id:'hero-lora-installed',class:'grid'});box.append(installedList);
 const upload=node('div',{class:'card'});upload.append(node('h4',{},'Install LoRA from file'),node('input',{type:'file',id:'hero-lora-file',accept:'.safetensors'}));
 const choice=node('select',{id:'hero-lora-import-family'});choice.append(new Option('Auto-detect from metadata',''),...Object.entries(familyNames).map(([k,v])=>new Option(v,k)));upload.append(choice);
 const uploadButton=node('button',{id:'hero-lora-upload'},'Install selected file');uploadButton.onclick=async()=>{uploadButton.disabled=true;try{await installFile()}catch(e){message(e.message)}finally{uploadButton.disabled=false}};
 upload.append(uploadButton);box.append(upload);
 const cv=node('div',{class:'card'});cv.append(node('h4',{},'Browse Civitai LoRAs · SFW'));
 const q=node('input',{id:'hero-lora-query',placeholder:'Character, style, detail, etc.'}),fam=node('select',{id:'hero-lora-civitai-family'});
 fam.append(new Option('Current model family',''),...Object.entries(familyNames).map(([k,v])=>new Option(v,k)));
 const sort=node('select',{id:'hero-lora-sort'});for(const n of ['Most Downloaded','Highest Rated','Newest'])sort.append(new Option(n,n));
 const key=node('input',{id:'hero-lora-key',type:'password',placeholder:'Optional Civitai API key (not saved)'}),submit=node('button',{},'Search Civitai');
 submit.onclick=async()=>{submit.disabled=true;try{await browse()}catch(e){message(e.message)}finally{submit.disabled=false}};
 cv.append(q,fam,sort,key,submit,node('div',{id:'hero-lora-results',class:'grid'}));box.append(cv);
 const buttons=node('div',{class:'actions'}),refreshButton=node('button',{},'Refresh installed LoRAs'),cancel=node('button',{},'Cancel transfer');
 refreshButton.onclick=refresh;cancel.onclick=async()=>{await api('/lora/cancel',{});message('Transfer cancellation requested.');await refresh()};buttons.append(refreshButton,cancel);
 box.append(buttons,node('p',{id:'hero-lora-status',role:'status'}));
 host.append(box);
 const existing=advanced.querySelectorAll('label');for(const label of existing){if(/LoRA #/.test(label.textContent))label.style.display='none'}
 search.oninput=()=>refresh();unknown.onchange=()=>refresh();
 const observer=new MutationObserver(()=>refresh());observer.observe($('image-create-model'),{attributes:true,attributeFilter:['value']});
 $('image-create-model').addEventListener('change',()=>refresh());
 setInterval(()=>{if(!$('images').hidden||!$('image-setup').hidden)refresh()},12000);
 refresh();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();
