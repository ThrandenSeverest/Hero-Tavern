// Perchance compatibility bridge. Same loopback host, token and origin as the model panel.
const HERO_TOKEN='__TOKEN__';
async function heroRequest(route,data){const r=await fetch(route,{method:data===undefined?'GET':'POST',headers:{'X-Hero-Token':HERO_TOKEN,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});const j=await r.json();if(!r.ok)throw Error(j.error||'Local service failed');return j}
window.kv={gameState:{get:async key=>(await heroRequest('/adventure/storage/get',{key})).value,set:async(key,value)=>heroRequest('/adventure/storage/set',{key,value})}};
window.generateText=async (prompt,options={})=>{
 let notes='';
 if(typeof G!=='undefined'&&G?.log){
  const entries=G.log.filter(x=>x.text).map(x=>({type:x.type,npcId:x.npcId,text:x.text})),cut=Math.max(0,entries.length-12);
  const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(x=>x.toString(16).padStart(2,'0')).join('');
  let memory=G.heroMemory||{covered:0,summary:'',hash:await hash([])};
  if(memory.covered>cut||memory.hash!==await hash(entries.slice(0,memory.covered)))memory={covered:0,summary:'',hash:await hash([])};
  if(entries.length>32||memory.covered){
   while(memory.covered<cut){const end=Math.min(cut,memory.covered+6),older=entries.slice(memory.covered,end);
    memory.summary=(await heroRequest('/task',{mode:'summary',prompt:'Summarize established Ilreon events for continuity. Preserve names, relationships, promises, quests and unresolved goals. No invention. Previous memory: '+memory.summary+'\nOlder events: '+JSON.stringify(older)})).text;
    memory.covered=end;memory.hash=await hash(entries.slice(0,end));G.heroMemory=memory;
   }
   notes=memory.summary;
  }
 }
 return (await heroRequest('/task',{prompt:String(prompt)+(notes?'\nESTABLISHED EARLIER EVENTS (continuity, current game mechanics override outdated numbers):\n'+notes:''),mode:options.stage==='dm'?'adventure-dm':options.stage==='narrator'?'adventure-narrator':'adventure'})).text;
};
window.generateImage=async(prompt,options={})=>new URL((await heroRequest('/images/generate',{prompt:String(prompt),...options,surface:'adventure'})).url,location.origin).href;
// Bundle the pinned 514-spell catalogue so offline boot does not depend on GitHub.
const nativeFetch=window.fetch.bind(window);
window.fetch=async(input,options)=>{
 const url=typeof input==='string'?input:input.url;
 if(url.includes('generatedSpellCatalog.ts')){
  const r=await nativeFetch('/spells.json');const list=await r.json();
  const source='export const documentSpells = '+JSON.stringify(list)+';';
  if(url.includes('api.github.com'))return new Response(JSON.stringify({content:btoa(unescape(encodeURIComponent(source)))}),{headers:{'Content-Type':'application/json'}});
  return new Response(source);
 }
 return nativeFetch(input,options);
};


// Dedicated Adventure image model switcher. Uses exactly the same model registry as Studio/Chat.
// Never loads a second ComfyUI process or downloads model files implicitly.
(function initAdventureImageChoice(){
 function mount(){
  if(document.getElementById('hero-adventure-image-choice'))return;
  const bar=document.createElement('div');bar.id='hero-adventure-image-choice';
  bar.style.cssText='position:fixed;right:14px;bottom:12px;z-index:20000;max-width:min(360px,calc(100vw - 28px));padding:11px 14px;background:#1d2635;border:1px solid #b39762;box-shadow:0 8px 25px #0008;border-radius:12px;color:#f3deb6;font:13px Segoe UI,Arial,sans-serif;';
  const head=document.createElement('button');head.type='button';head.textContent='🎨 Adventure images · loading…';
  head.style.cssText='color:#f3deb6;background:transparent;border:0;cursor:pointer;font:inherit;';
  const body=document.createElement('div');body.hidden=true;
  const options=document.createElement('select');options.style.cssText='width:100%;padding:8px;background:#293950;color:#f2e3c5;border-radius:7px;margin:8px 0;';
  const state=document.createElement('p');state.style.cssText='max-width:320px;font-size:12px;line-height:1.5;color:#b9c7dc;';
  const manage=document.createElement('button');manage.type='button';manage.textContent='Install / repair image models';
  manage.style.cssText='padding:8px 10px;background:#3a4860;color:#fff;border:1px solid #64748b;border-radius:7px;cursor:pointer;';
  manage.onclick=()=>window.parent.postMessage({type:'hero-open-panel',section:'image-setup'},'http://127.0.0.1:8000');
  head.onclick=()=>{body.hidden=!body.hidden;if(!body.hidden)refresh()};
  body.append(options,state,manage);bar.append(head,body);document.body.append(bar);
  async function refresh(){
   try{
    const d=await heroRequest('/image/model-center');
    const current=d.choices.adventure;
    options.replaceChildren(...d.models.filter(m=>m.id!=='custom').map(m=>new Option((m.ready?'✓ ':m.downloaded?'◷ ':'○ ')+(m.label||m.id),m.id)));
    options.value=current;const model=d.models.find(x=>x.id===current);
    head.textContent='🎨 Adventure images · '+(model?.label||current);
    state.textContent=model?.ready?'✓ Ready. All Adventure portraits and scene images use this model.':model?.issue||'Model is not ready; open setup to download or start ComfyUI.';
   }catch(e){state.textContent=e.message;head.textContent='🎨 Adventure image model · setup needed'}
  }
  options.onchange=async()=>{try{await heroRequest('/image/model-center/select',{scope:'adventure',id:options.value});await refresh()}catch(e){state.textContent=e.message}};
  refresh();setInterval(()=>{if(!body.hidden)refresh()},18000);
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();
