const S=require('./StoryState.cjs');
function createStoryAPI(store,pipeline,{ready=()=>true,contextSize=()=>8192}={}){
 async function generateJSON(prompt,signal,mode,key){
  let error;
  for(let attempt=0;attempt<2;attempt++){
   const task=prompt+(attempt?'\nThe previous response was malformed. Return exactly ONE complete JSON object, no explanation or Markdown. Keep entries concise enough to close every array and object.':'');
   const result=await pipeline.generate({prompt:'<|im_start|>user\n'+task+'<|im_end|>\n<|im_start|>assistant\n',stream:false,stop:['<|im_end|>']},signal,{mode});
   try{const parsed=S.parseModelJSON(result.choices[0].text);if(key&&!Array.isArray(parsed[key]))throw Error('Expected a JSON array named '+key);if(key==='changes'&&parsed.changes.length>100)throw Error('Return at most 100 evidence-backed changes.');return parsed;}catch(e){error=e;}
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
   if(data.enabled&&data.name==='Health & Injuries'&&!s.definitions.some(d=>d.owner===owner&&d.type==='injuries'))return store.definitions(data.id,[{...template[1].find(d=>d.type==='injuries'),owner,template:data.name,enabled:true}]);
   for(const d of existing)d.enabled=!!data.enabled;store.saveSession(s);return store.view(data.id);
  }
  if(op==='definition-edit')return store.definitionEdit(data.id,data.key,data.updates);
  if(op==='definitions')return store.definitions(data.id,data.definitions);
  if(op==='patch')return store.eventPatch(data.id,data.patch,{manual:true,expectedHead:data.expectedHead});
  if(op==='state-at'){const v=store.view(data.id);return {state:S.stateAt(v.session,v.messages,data.index),definitions:v.session.definitions};}
  if(op==='test-character'){if(!data.card||typeof data.card.description!=='string')throw Error('Enter a character draft first.');const prompt='Reply as this character in the test scene. Return only its natural dialogue/narration, without reasoning or JSON. Card: '+JSON.stringify(data.card)+'\nPlayer: '+String(data.message||'Hello.').slice(0,2000);const result=await pipeline.generate({prompt:'<|im_start|>user\n'+prompt+'<|im_end|>\n<|im_start|>assistant\n',stop:['<|im_end|>']},signal,{mode:'preview'});return {text:result.choices[0].text};}
  if(op==='preview')return store.preview(data.id,data.index);
  if(op==='fork')return store.fork(data.id,data);
  if(op==='restore')return store.restore(data.id,data);
  if(op==='bookmark')return store.bookmark(data.id,data);
  if(op==='metadata')return store.metadata(data.id,data);
  if(op==='decision')return store.decision(data.id,data.eventId,data.approve);
  if(op==='profile')return store.profile(data.characterId,data.profile);
  if(op==='inspector')return store.inspector(data.id);
  if(op==='export')return store.exportArchive(data.id,data);
  if(op==='import')return store.importArchive(data.packet);
  if(op==='analyze'){
   let view=store.view(data.id);for(const d of view.session.definitions.filter(d=>d.template==='Health & Injuries'&&d.enabled!==false))if(!view.session.definitions.some(x=>x.owner===d.owner&&x.type==='injuries'))view=store.definitions(data.id,[{...S.TEMPLATE_DATA[0][1].find(x=>x.type==='injuries'),owner:d.owner,template:'Health & Injuries',enabled:true}]);
   const s=view.session,head=S.hash(view.messages.map(S.signature)),pending=view.messages.filter(m=>!s.analyzedSources.includes(S.signature(m))).slice(-2);
   const eligible=s.definitions.filter(d=>d.enabled!==false&&d.updateMode!=='manual'&&view.context.trackers.some(t=>t.key===S.keyOf(d)));
   if(!eligible.length||!pending.length)return view;
   if(!ready())throw Error('Load the reply model before analyzing tracker changes.');
   const prompt='Return JSON only: {"changes":[{"key":"exact tracker key","value":"typed value","sourceMessageId":"id","evidence":"exact quote from that message","reason":"short causal reason","ambiguous":false}]}. Propose only established changes, not hypotheticals or poetic description. Do not invent injuries, healing, elapsed time, possessions or knowledge. For record values return the full structured object, preserving unchanged fields and recent event history. Update narrative detail even when the numeric level stays the same. Record only actual meals/actions, not plans; do not invent timestamps or portions. For injuries values return the full array, retaining every previous record and its stable id, location and cause. Each record has id, location, cause, severity (minor/moderate/severe/critical), status (fresh/treated/healing/healed/scarred), pain (0–10), symptoms, limitations, treatment, scar. Add injuries from explicit events; update care, symptoms and recovery separately; keep healed and scarred records. Bandaging is not healing. Use declared owners; never conflate characters. Return changes:[] if there is no reliable evidence.\nDefinitions: '+JSON.stringify(eligible)+'\nCurrent confirmed state: '+JSON.stringify(Object.fromEntries(eligible.map(d=>[S.keyOf(d),view.context.state[S.keyOf(d)]])))+'\nNew finalized messages: '+JSON.stringify(pending.map(m=>({id:m.extra.heroMessageId,name:m.name,avatar:m.original_avatar,text:m.mes})));
   try{const patch=await generateJSON(prompt,signal,'state','changes');
    const current=store.view(data.id);if(S.hash(current.messages.map(S.signature))!==head)throw Error('Chat changed; stale state analysis discarded.');
    const resultView=store.eventPatch(data.id,patch.changes,{expectedHead:head});resultView.session.analyzedSources=[...new Set([...resultView.session.analyzedSources,...pending.map(S.signature)])];store.saveSession(resultView.session);return store.view(data.id);
   }catch(e){const current=store.get(data.id);current.failures.push({at:Date.now(),message:e.message,head});current.failures=current.failures.slice(-30);store.saveSession(current);throw e;}
  }
  if(op==='helper'){
   if(!['trackers','lore','episodes'].includes(data.kind)||typeof data.brief!=='string'||data.brief.length>200000)throw Error('Enter a description or source text (1–200000 characters), and choose Trackers, Lore or Episodes.');
   if(!data.brief.trim())throw Error('Enter the source text or describe what to draft in the helper box.');
   let brief=data.brief;
   if(brief.length>6000){const {reduceLongContext}=require('./WriterContext.cjs');const reduced=await reduceLongContext(brief,{count:async text=>Buffer.byteLength(text,'utf8'),budget:Math.max(1500,Math.min(24000,contextSize()-1800)),complete:async(prompt,maxReplyTokens)=>{const r=await pipeline.generate({prompt:'<|im_start|>user\n'+prompt+'<|im_end|>\n<|im_start|>assistant\n',writerSettings:{maxReplyTokens},stream:false},signal,{mode:'summary'});return r.choices[0].text;}});brief=reduced.text;}
   const schema=data.kind==='trackers'?JSON.stringify({trackers:[{id:'shoulder_pain',label:'Left shoulder pain',category:'Injuries',icon:'🩹',description:'Exactly what is measured, including meaning of low and high values',type:'number',initialValue:0,min:0,max:100,maxDelta:10,unit:'%',updateMode:'approval',instructions:'How present value affects decisions, speech and physical limits',changeRules:'Which explicit narrative events raise/lower the value; how quickly; what does NOT change it',alwaysInject:true,relevantKeywords:['shoulder','injury']}]})
    :data.kind==='lore'?'{"lore":[{"id":"id","label":"title","text":"compact lore","keywords":["trigger"],"condition":null,"visibility":"player"}]}'
    :'{"episodes":[{"id":"id","title":"title","greeting":"opening dialogue","situation":"scene","initialState":{}}]}';
   const guidance=data.kind==='trackers'?
    'Design 1–24 specific independent trackers; follow the requested count and scope, using only as many as needed, never redundant numbers and enums for the same fact. Fit the CHARACTER and user request, not generic RPG boilerplate. Use precise initialValue matching the type: number is a JSON number, boolean is true/false, enum is one of allowedValues, list is an array of strings, text is string, relationship is an object mapping names to numbers, timer is {remaining:number,clock:"story"}, quest is {stage:string,status:"inactive"|"active"|"complete"|"failed"}. For a tracker needing narrative detail (hunger, meals, sleep, mood causes, training), prefer type record with initialValue an object of named fields: numbers or null for unknown levels, summary text, last event story time, and lists of recent established events. Hunger example: {fullness:null,summary:"Not established",lastMealAt:"Unknown",recentMeals:[]}. Track meals actually eaten with food, portion and time if known; preserve recent history and do not infer unmentioned meals. Record values must retain unchanged fields. Do not flatten detailed state into sliding meters. Use ids with lowercase letters/underscores; unique per tracker. Each description explains purpose and units; each instructions field states in-world behavioral consequences; each changeRules field explains evidence, progression, caps and prohibited guesses. For enum also provide allowedValues (at least 2), rules mapping statuses to effects and transitions mapping each status to permitted next statuses. Do not presume unmentioned injuries, affection, progress or locations. For health requests create an overall condition number AND one injuries-type ledger with initialValue:[] (or established injury records). Never hardcode a shoulder injury or flatten wounds into a single string. injuries is an array of records with stable id, location, cause, severity (minor/moderate/severe/critical), status (fresh/treated/healing/healed/scarred), pain (0–10), symptoms, limitations, treatment and scar strings. Use automatic for the ledger so explicit narrative changes appear live; preserve healed history and scars. Use approval for consequential changes, automatic only for clear facts, manual for user-only values. Do not generate 0–100 percentage values without clear anchors for what low/middle/high mean. Return only fields relevant to each type. Nothing is saved until user reviews and accepts.'
    :'Keep each item grounded in the supplied character and story. Draft only useful independent items. Nothing is saved without approval.';
   const prompt='You are Hero Tavern’s state-design assistant. Return ONLY a JSON object conforming to this example shape: '+schema+'. '+guidance+'\nExisting context and character: '+String(data.context||'').slice(0,5000)+'\nUser request: '+brief;
   let parsed;try{parsed=await generateJSON(prompt,signal,'character',data.kind)}catch{throw Error('AI helper returned malformed JSON twice. Try a more specific request; nothing was saved.');}
   if(!Array.isArray(parsed?.[data.kind]))throw Error('Helper returned an invalid draft; nothing was saved.');
   if(data.kind==='trackers'){
    if(parsed.trackers.length>24)throw Error('AI suggested too many trackers (maximum 24). Narrow the request and try again.');
    parsed.trackers=parsed.trackers.map((candidate,index)=>{
     const item={...candidate,owner:'character:draft'};
     if(!item.id&&item.label)item.id=String(item.label).toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,60);
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
