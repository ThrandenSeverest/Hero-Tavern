const S=require('./StoryState.cjs');
function createStoryAPI(store,pipeline,{ready=()=>true,contextSize=()=>8192}={}){
 async function generateJSON(prompt,signal,mode,key){
  let error;
  for(let attempt=0;attempt<2;attempt++){
   const task=prompt+(attempt?'\nThe previous response was malformed. Return exactly ONE complete JSON object, no explanation or Markdown. Keep entries concise enough to close every array and object.':'');
   const result=await pipeline.generate({prompt:'<|im_start|>user\n'+task+'<|im_end|>\n<|im_start|>assistant\n',stream:false,stop:['<|im_end|>']},signal,{mode});
   try{const parsed=S.parseModelJSON(result.choices[0].text);if(key&&!Array.isArray(parsed[key]))throw Error('Expected a JSON array named '+key);return parsed;}catch(e){error=e;}
  }
  throw error;
 }
 async function action(route,data,signal){
  const op=route.replace('/story/','');
  if(op==='templates')return S.TEMPLATE_DATA;
  if(op==='sync')return store.sync(data.location,data);
  if(op==='list')return store.list(data);
  if(op==='get')return store.view(data.id,data.query||'');
  if(op==='template'){
   const template=S.TEMPLATE_DATA.find(t=>t[0]===data.name);if(!template)throw Error('Unknown tracker template.');const s=store.get(data.id),owner=data.owner||'character:'+s.characterId,existing=s.definitions.filter(d=>d.template===data.name&&d.owner===owner);
   if(!existing.length&&data.enabled)return store.definitions(data.id,template[1].map(d=>({...d,owner,template:data.name,enabled:true})));
   for(const d of existing)d.enabled=!!data.enabled;store.saveSession(s);return store.view(data.id);
  }
  if(op==='definition-edit')return store.definitionEdit(data.id,data.key,data.updates);
  if(op==='definition-delete')return store.definitionDelete(data.id,data.key);
  if(op==='definitions')return store.definitions(data.id,data.definitions);
  if(op==='patch')return store.eventPatch(data.id,data.patch,{manual:true,expectedHead:data.expectedHead});
  if(op==='state-at'){const v=store.view(data.id);return {state:S.stateAt(v.session,v.messages,data.index),definitions:v.session.definitions};}
  if(op==='test-character'){if(!data.card||typeof data.card.description!=='string')throw Error('Enter a character draft first.');const prompt='Reply as this character in the test scene. Return only its natural dialogue/narration, without reasoning or JSON. Card: '+JSON.stringify(data.card)+'\nPlayer: '+String(data.message||'Hello.').slice(0,2000);const result=await pipeline.generate({prompt:'<|im_start|>user\n'+prompt+'<|im_end|>\n<|im_start|>assistant\n',stop:['<|im_end|>']},signal,{mode:'preview'});return {text:result.choices[0].text};}
  if(op==='preview')return store.preview(data.id,data.index);
  if(op==='fork')return store.fork(data.id,data);
  if(op==='restore')return store.restore(data.id,data);
  if(op==='bookmark')return store.bookmark(data.id,data);
  if(op==='metadata')return store.metadata(data.id,data);

  if(op==='profile')return store.profile(data.characterId,data.profile);
  if(op==='inspector')return store.inspector(data.id);
  if(op==='export')return store.exportArchive(data.id,data);
  if(op==='import')return store.importArchive(data.packet);
  if(op==='analyze'){
   const W=require('./WTracker.cjs');let view=store.view(data.id),session=view.session;
   const definitions=session.definitions.filter(d=>d.enabled!==false&&d.updateMode!=='manual');
   const completed=view.messages.map((m,index)=>({m,index})).filter(({m})=>!m.is_user&&!m.is_system&&String(m.mes||'').trim());
   if(!definitions.length||!completed.length)return view;
   const schemaHead=S.hash(definitions),head=S.hash(view.messages.map(S.signature));
   const last=session.lastAnalysis;
   if(!data.recheck&&last?.head===head&&last?.schemaHead===schemaHead&&last.partial&&Date.now()<(last.retryAt||0))return view;
   const stamp=index=>S.hash({schemaHead,prefix:view.messages.slice(0,index+1).map(S.signature)});
   const pending=completed.filter(({index})=>!session.analyzedSources.includes(stamp(index)));
   // First run bootstraps the current scene; subsequent runs advance in message order.
   const target=data.recheck||!session.analyzedSources.length?completed.at(-1):pending[0];
   if(!target)return view;
   const diagnostics={engine:'WTracker',at:Date.now(),head,schemaHead,processed:1,changes:0,partial:false,errors:[],modelUsed:false,backlog:0};
   try{
    if(!ready())throw Error('Load a text model in Models to update WTracker.');
    const source=target.m.extra.heroMessageId,previous=S.stateAt(session,view.messages,target.index-1),patch=[];
    const currentCard={name:session.profile?.name||view.header?.character_name||'',description:session.profile?.description||'',personality:session.profile?.personality||'',scenario:session.profile?.scenario||''};
    const context=view.messages.slice(Math.max(0,target.index-15),target.index+1);
    // Complete schemas in small batches let a 12B local model close every object.
    for(let start=0;start<definitions.length;start+=4){
     const fields=definitions.slice(start,start+4),request=W.buildRequest(fields,previous,context,currentCard);
     diagnostics.modelUsed=true;
     const response=await pipeline.generate(request,signal,{mode:'utility'});
     patch.push(...W.readSnapshot(response.choices?.[0]?.text||'',fields).map(item=>({...item,sourceMessageId:source})));
    }
    // No partial snapshot is committed. Check chat and schema after inference.
    const fresh=store.view(data.id);
    if(S.hash(fresh.messages.map(S.signature))!==head||S.hash(fresh.session.definitions.filter(d=>d.enabled!==false&&d.updateMode!=='manual'))!==schemaHead)throw Error('Chat or tracker schema changed during generation; retry on the current scene.');
    const before=fresh.session.events.length;
    view=store.eventPatch(data.id,patch,{expectedHead:head});diagnostics.changes=view.session.events.length-before;
    const persisted=store.get(data.id);
    const consumed=!session.analyzedSources.length?completed.filter(t=>t.index<=target.index):[target];
    persisted.analyzedSources=[...new Set([...persisted.analyzedSources,...consumed.map(t=>stamp(t.index))])].slice(-1500);
    diagnostics.backlog=completed.filter(t=>!persisted.analyzedSources.includes(stamp(t.index))).length;
    persisted.lastAnalysis=diagnostics;store.saveSession(persisted);return store.view(data.id);
   }catch(error){
    const persisted=store.get(data.id);diagnostics.partial=true;diagnostics.failed=true;diagnostics.error=error.message;diagnostics.errors=[error.message];diagnostics.retryAt=Date.now()+15000;
    persisted.lastAnalysis=diagnostics;persisted.failures=[...(persisted.failures||[]),{at:Date.now(),message:error.message,head}].slice(-30);store.saveSession(persisted);return store.view(data.id);
   }
  }
  if(op==='helper'){
   if(!['trackers','lore','episodes','character'].includes(data.kind)||typeof data.brief!=='string'||data.brief.length>200000)throw Error('Enter a description or source text (1–200000 characters), and choose Trackers, Lore or Episodes.');
   if(!data.brief.trim())throw Error('Enter the source text or describe what to draft in the helper box.');
   let brief=data.brief;
   if(brief.length>6000){const {reduceLongContext}=require('./WriterContext.cjs');const reduced=await reduceLongContext(brief,{count:async text=>Buffer.byteLength(text,'utf8'),budget:Math.max(1500,Math.min(24000,contextSize()-1800)),complete:async(prompt,maxReplyTokens)=>{const r=await pipeline.generate({prompt:'<|im_start|>user\n'+prompt+'<|im_end|>\n<|im_start|>assistant\n',writerSettings:{maxReplyTokens},stream:false},signal,{mode:'summary'});return r.choices[0].text;}});brief=reduced.text;}
   const schema=data.kind==='trackers'?JSON.stringify({trackers:[{id:'example_measurement',label:'Example measurement',category:'Custom',icon:'📏',description:'Exactly what is measured, including meaning of low and high values',type:'number',initialValue:0,min:0,max:100,unit:'%',updateMode:'automatic',instructions:'How present value affects decisions, speech and physical limits',changeRules:'Which explicit narrative events raise/lower the value; how quickly; what does NOT change it',alwaysInject:true,relevantKeywords:['metric','change']}]})
    :data.kind==='lore'?'{"lore":[{"id":"id","label":"title","text":"compact lore","keywords":["trigger"],"condition":null,"visibility":"player"}]}'
     :data.kind==='character'?'{"character":{"name":"Name","description":"Specific appearance, history and traits","personality":"Temperament, speech and reactions","scenario":"Setting and starting situation","first_mes":"An immersive opening scene in character","mes_example":"Example in-character dialogue","tags":["fantasy"]}}'
    :'{"episodes":[{"id":"id","title":"title","greeting":"opening dialogue","situation":"scene","initialState":{}}]}';
   const guidance=data.kind==='trackers'?
    'Design 1–24 independent WTracker fields for the supplied character and request. Choose text for descriptive state, number with min/max and unit for measurable quantities, boolean for flags, list for string entries, clock for fictional HH:mm (initialValue "--:--" when unknown), enum with allowedValues for a fixed choice, record for an object with named fields. initialValue must match its type. Every record field is retained in every complete snapshot; arrays initially [] contain strings unless an explicit schema is supplied. Nested object arrays need a schema with type, properties, required and items. injuries is an array of objects with location, condition, treatment and history strings. Preserve wound and scar history. Use text for physical condition unless the user requests a numeric measure. Use automatic for scene state and manual for user-controlled fields. Explain what updates the field in description/changeRules and how it affects the story in instructions. IDs use lowercase letters and underscores. Unknown facts stay unknown. Do not invent injuries, meal times, relationships or clock time. Never create evidence/source IDs, operation verbs, approval queues, maxDelta or transition maps. Return the fields array only inside the requested JSON object. These are drafts; the user adds them explicitly.'
    :data.kind==='character'?'Create exactly one complete SillyTavern V2-compatible character data object, not a template or a list. All six named text fields must be nonempty strings; tags is an array of strings. Description should include consistent appearance, motivations, skills and background; personality defines distinctive voice; scenario establishes relationships and location; first_mes begins an actual scene, not an explanation; mes_example contains examples of character dialogue. Do not insert placeholder values or metadata outside the JSON.'
     :'Keep each item grounded in the supplied character and story. Draft only useful independent items. Nothing is saved without approval.';
   const prompt='You are Hero Tavern’s state-design assistant. Return ONLY a JSON object conforming to this example shape: '+schema+'. '+guidance+'\nExisting context and character: '+String(data.context||'').slice(0,5000)+'\nUser request: '+brief;
   let parsed;try{parsed=await generateJSON(prompt,signal,'character',data.kind==='character'?null:data.kind)}catch{throw Error('AI helper returned malformed JSON twice. Try a more specific request; nothing was saved.');}
   if(data.kind==='character'){
     const card=parsed?.character;if(!card||typeof card!=='object'||Array.isArray(card))throw Error('AI helper did not return a valid character card.');
     for(const field of ['name','description','personality','scenario','first_mes','mes_example'])if(typeof card[field]!=='string'||!card[field].trim()||card[field].length>16000)throw Error('AI character needs a nonempty text field: '+field);
     return {character:{name:card.name,description:card.description,personality:card.personality,scenario:card.scenario,first_mes:card.first_mes,mes_example:card.mes_example,tags:Array.isArray(card.tags)?card.tags.filter(x=>typeof x==='string').slice(0,20):[],extensions:{}}};
    }
    if(!Array.isArray(parsed?.[data.kind]))throw Error('Helper returned an invalid draft; nothing was saved.');
   if(data.kind==='trackers'){
    if(parsed.trackers.length>24)throw Error('AI suggested too many trackers (maximum 24). Narrow the request and try again.');
    parsed.trackers=parsed.trackers.map((candidate,index)=>{
     const item={...candidate,owner:'character:draft'};
     if(!item.id&&item.label)item.id=String(item.label).toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,60)||'tracker_'+index;
     if(!item.updateMode)item.updateMode='automatic';
     if(item.type==='number'&&typeof item.initialValue==='string'&&item.initialValue.trim()!==''&&Number.isFinite(Number(item.initialValue)))item.initialValue=Number(item.initialValue);
     if(item.type==='boolean'&&typeof item.initialValue==='string'&&['true','false'].includes(item.initialValue.toLowerCase()))item.initialValue=item.initialValue.toLowerCase()==='true';
     try{const checked=S.validateDefinition(item);delete checked.owner;return checked;}catch(e){throw Error('AI tracker '+(index+1)+' ('+(item.label||item.id||'unnamed')+') needs revision: '+e.message+'. Nothing was saved.');}
    });
    if(new Set(parsed.trackers.map(d=>d.id)).size!==parsed.trackers.length)throw Error('AI produced duplicate tracker IDs. Nothing was saved.');
   }
   return parsed;
  }
  throw Error('Unknown story action.');
 }
 return {action};
}
module.exports={createStoryAPI};
