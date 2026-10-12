// Perchance compatibility bridge. Same loopback host, token and origin as the model panel.
const HERO_TOKEN='__TOKEN__';
async function heroRequest(route,data){const r=await fetch(route,{method:data===undefined?'GET':'POST',headers:{'X-Hero-Token':HERO_TOKEN,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});const j=await r.json();if(!r.ok)throw Error(j.error||'Local service failed');return j}
window.kv={gameState:{get:async key=>(await heroRequest('/adventure/storage/get',{key})).value,set:async(key,value)=>heroRequest('/adventure/storage/set',{key,value})}};
window.generateText=async prompt=>{
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
 return (await heroRequest('/task',{prompt:String(prompt)+(notes?'\nESTABLISHED EARLIER EVENTS (continuity, current game mechanics override outdated numbers):\n'+notes:''),mode:'adventure'})).text;
};
window.generateImage=async(prompt,options={})=>(await heroRequest('/images/generate',{prompt:String(prompt),...options})).url;
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
