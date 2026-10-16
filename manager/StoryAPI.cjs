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
  if(op==='decision')return store.decision(data.id,data.eventId,data.approve);
  if(op==='profile')return store.profile(data.characterId,data.profile);
  if(op==='inspector')return store.inspector(data.id);
  if(op==='export')return store.exportArchive(data.id,data);
  if(op==='import')return store.importArchive(data.packet);
  if(op==='analyze'){
   let v=store.view(data.id);
   for(const d of v.session.definitions.filter(d=>d.template==='Health & Injuries'&&d.enabled!==false))
    if(!v.session.definitions.some(x=>x.owner===d.owner&&x.type==='injuries'))
     v=store.definitions(data.id,[{...S.TEMPLATE_DATA[0][1].find(x=>x.type==='injuries'),owner:d.owner,template:'Health & Injuries',enabled:true}]);
   const session=v.session,head=S.hash(v.messages.map(S.signature));
   // One bounded automatic retry is allowed after a failure/partial extraction.
   // Unlike the old permanent same-head throttle, temporary empty outputs are recoverable.
   const last=session.lastAnalysis;
   // Never permanently lock a completed turn after a transient local model failure.
   if(data.recheck!==true&&last?.head===head&&(last.failed||last.partial)&&Date.now()<(last.retryAt||0))return v;
   const eligible=session.definitions.filter(d=>d.enabled!==false&&d.updateMode!=='manual');
   const lastFinal=v.messages.findLastIndex(m=>!m.is_system&&!m.is_user&&String(m.mes||'').trim());
   if(!eligible.length||lastFinal<0)return v;
   const indexById=new Map(v.messages.map((m,i)=>[m.extra?.heroMessageId,i]));
   const firstIndex=d=>d.introducedAt?indexById.get(d.introducedAt)??Infinity:0;
   const available=(m,index)=>!m.is_system&&String(m.mes||'').trim()&&m.extra?.heroMessageId&&eligible.some(d=>index>=firstIndex(d));
   const all=v.messages.slice(0,lastFinal+1).filter(available);
   const recheck=data.recheck===true;
   // Never silently replay an already processed turn. Explicit recheck is the recovery path,
   // including old versions which incorrectly saved an empty/failed extraction as complete.
   const selected=recheck?all.slice(-8):all.filter(m=>!session.analyzedSources.includes(S.signature(m))).slice(0,3);
   if(!selected.length)return v;
   const selectedIds=new Set(selected.map(m=>m.extra.heroMessageId));
   const priorEvents=new Set(session.events.filter(e=>e.op==='set'&&e.status!=='invalid'&&selectedIds.has(e.sourceMessageId)).map(e=>e.key+'|'+e.sourceMessageId));
   const {parseCommands,trackerInstructions,explicitStateChanges}=require('./TrackerDelta.cjs');
   const sourceIndex=m=>indexById.get(m.extra.heroMessageId);
   const eligibleFor=m=>eligible.filter(d=>sourceIndex(m)>=firstIndex(d));
   const direct=explicitStateChanges(eligible,selected,v.context.state);
   const contextBefore=v.messages.slice(Math.max(0,sourceIndex(selected[0])-5),sourceIndex(selected[0])).filter(m=>!m.is_system);
   const diagnostics={at:Date.now(),head,recheck,processed:selected.length,changes:0,partial:false,errors:[],changeTypes:{},modelUsed:false,directChanges:direct.length,autoRetries:recheck?0:(last?.head===head?(last.autoRetries||0)+1:0),sourceIds:selected.map(m=>m.extra.heroMessageId),backlog:all.filter(m=>!session.analyzedSources.includes(S.signature(m))).length};
   try{
    let parsed={changes:[],issues:[],recognized:0};
    if(ready()){
     diagnostics.modelUsed=true;
     const p=trackerInstructions(eligible,v.context.state,selected,contextBefore);
     const retries=2;
     for(let attempt=0;attempt<retries;attempt++){
      const repair=attempt?'\nThe previous response had validation errors: '+parsed.issues.join('; ').slice(0,1200)+'. Output valid operations JSON only. Do not invent changes.':'';
      try{
       const response=await pipeline.generate({
        prompt:'<|im_start|>system\nExtract factual state transitions from completed dialogue. Return operations JSON only, no roleplay or reasoning. /no_think<|im_end|>\n<|im_start|>user\n'+p+repair+'<|im_end|>\n<|im_start|>assistant\n',
        stream:false,max_tokens:Math.min(2200,Math.max(800,eligible.length*130)),temperature:0.1,stop:['<|im_end|>']
       },signal,{mode:'utility'});
       const raw=String(response.choices?.[0]?.text||'');
       parsed=parseCommands(raw,eligible,selected,v.context.state);
       if(!parsed.recognized&&!parsed.issues.length)parsed.issues.push('Model returned no changes JSON.');
       for(const change of parsed.changes){
        const d=eligible.find(d=>S.keyOf(d)===change.key),at=indexById.get(change.sourceMessageId);
        if(!d||at===undefined||at<firstIndex(d))parsed.issues.push('Tracker not active for source message: '+change.key);
       }
       if(!parsed.issues.length)break;
      }catch(error){
       parsed={changes:[],recognized:0,issues:['Model extractor failed: '+error.message]};
       if(attempt===retries-1)break;
      }
     }
    }else diagnostics.errors.push('Reply model is not loaded: explicit facts only; remaining tracker actions require AI analysis.');
    const updates=[],seen=new Set(priorEvents);
    // Explicit typed statements win over the model for the same tracker in the same message.
    const directKeys=new Set(direct.map(c=>c.key+'|'+c.sourceMessageId));
    const ordered=[...direct,...parsed.changes.filter(c=>!directKeys.has(c.key+'|'+c.sourceMessageId))].sort((a,b)=>(indexById.get(a.sourceMessageId)??Infinity)-(indexById.get(b.sourceMessageId)??Infinity));
    // Multiple FIELD/ADD operations in one message may affect the same record.
    // Keep the final validated state for that tracker/source, not the first partial one.
    const combined=new Map();for(const item of ordered)combined.set(item.key+'|'+item.sourceMessageId,item);
    for(const candidate of combined.values()){
     const identifier=candidate.key+'|'+candidate.sourceMessageId;
     if(seen.has(identifier))continue;
     const definition=eligible.find(d=>S.keyOf(d)===candidate.key);
     const at=indexById.get(candidate.sourceMessageId);
     if(!definition||at===undefined||at<firstIndex(definition)){diagnostics.errors.push('Skipped event for an inactive tracker: '+candidate.key);continue;}
     try{S.propose(session,v.messages,[candidate]);}catch(error){diagnostics.errors.push('Rejected '+candidate.key+' from '+candidate.sourceMessageId+': '+error.message);continue;}
     seen.add(identifier);updates.push(candidate);
    }
    if(parsed.issues.length)diagnostics.errors.push(...parsed.issues.slice(0,8));
    // A completely malformed output is an actual retryable failure, not a clean no-op.
    // Invalid model output is an unverified attempt, never an empty successful
    // extraction. Keep the source eligible for retry without failing the chat.
    if(diagnostics.errors.length&&!updates.length)diagnostics.errors.unshift('No tracker changes could be verified. Saved state is unchanged; automatic retry scheduled.');
    diagnostics.partial=diagnostics.errors.length>0;
    if(S.hash(store.view(data.id).messages.map(S.signature))!==head)throw Error('Chat changed; stale state analysis discarded.');
    if(updates.length){
     const before=session.events.length;
     v=store.eventPatch(data.id,updates,{expectedHead:head});
     const applied=v.session.events.slice(before);
     diagnostics.changes=applied.length;
     for(const change of applied){const type=eligible.find(d=>S.keyOf(d)===change.key)?.type||'unknown';diagnostics.changeTypes[type]=(diagnostics.changeTypes[type]||0)+1;}
    }
    const persisted=store.get(data.id);
    // A failed/partial extraction never consumes its source signatures.
    // It can retry on the next completed turn or by the explicit Re-analyze button.
    // Confirm explicitly extracted changes immediately even if the LLM is temporarily
    // unavailable; only consume sources as fully analyzed when the model succeeds.
    if(!diagnostics.partial&&diagnostics.modelUsed)persisted.analyzedSources=[...new Set([...persisted.analyzedSources,...selected.map(S.signature)])].slice(-1500);
    if(diagnostics.partial)diagnostics.retryAt=Date.now()+Math.min(60000,8000*Math.pow(2,Math.min(3,diagnostics.autoRetries)));
    diagnostics.backlog=all.filter(m=>!persisted.analyzedSources.includes(S.signature(m))).length;
    persisted.lastAnalysis=diagnostics;
    if(diagnostics.errors.length){persisted.failures.push({at:Date.now(),message:diagnostics.errors.join(' | ').slice(0,1500),head});persisted.failures=persisted.failures.slice(-30);}
    store.saveSession(persisted);return store.view(data.id);
   }catch(error){
    const current=store.get(data.id);
    current.failures.push({at:Date.now(),message:error.message,head});current.failures=current.failures.slice(-30);
    current.lastAnalysis={...diagnostics,failed:true,error:error.message,partial:true,retryAt:Date.now()+15000};
    store.saveSession(current);throw error;
   }
  }
  if(op==='helper'){
   if(!['trackers','lore','episodes','character'].includes(data.kind)||typeof data.brief!=='string'||data.brief.length>200000)throw Error('Enter a description or source text (1–200000 characters), and choose Trackers, Lore or Episodes.');
   if(!data.brief.trim())throw Error('Enter the source text or describe what to draft in the helper box.');
   let brief=data.brief;
   if(brief.length>6000){const {reduceLongContext}=require('./WriterContext.cjs');const reduced=await reduceLongContext(brief,{count:async text=>Buffer.byteLength(text,'utf8'),budget:Math.max(1500,Math.min(24000,contextSize()-1800)),complete:async(prompt,maxReplyTokens)=>{const r=await pipeline.generate({prompt:'<|im_start|>user\n'+prompt+'<|im_end|>\n<|im_start|>assistant\n',writerSettings:{maxReplyTokens},stream:false},signal,{mode:'summary'});return r.choices[0].text;}});brief=reduced.text;}
   const schema=data.kind==='trackers'?JSON.stringify({trackers:[{id:'example_measurement',label:'Example measurement',category:'Custom',icon:'📏',description:'Exactly what is measured, including meaning of low and high values',type:'number',initialValue:0,min:0,max:100,maxDelta:10,unit:'%',updateMode:'automatic',instructions:'How present value affects decisions, speech and physical limits',changeRules:'Which explicit narrative events raise/lower the value; how quickly; what does NOT change it',alwaysInject:true,relevantKeywords:['metric','change']}]})
    :data.kind==='lore'?'{"lore":[{"id":"id","label":"title","text":"compact lore","keywords":["trigger"],"condition":null,"visibility":"player"}]}'
     :data.kind==='character'?'{"character":{"name":"Name","description":"Specific appearance, history and traits","personality":"Temperament, speech and reactions","scenario":"Setting and starting situation","first_mes":"An immersive opening scene in character","mes_example":"Example in-character dialogue","tags":["fantasy"]}}'
    :'{"episodes":[{"id":"id","title":"title","greeting":"opening dialogue","situation":"scene","initialState":{}}]}';
   const guidance=data.kind==='trackers'?
    'Design 1–24 specific independent trackers; follow the requested count and scope, using only as many as needed, never redundant numbers and enums for the same fact. Fit the CHARACTER and user request, not generic RPG boilerplate. Use precise initialValue matching the type: number is a JSON number, boolean is true/false, enum is one of allowedValues, list is an array of strings, text is string, relationship is an object mapping names to numbers, timer is {remaining:number,clock:"story"}, quest is {stage:string,status:"inactive"|"active"|"complete"|"failed"}. Measurement type and units are independent: body weight/mass in kg, carried mass, grams, litres, centimeters, distance, money, temperature, damage, energy and similar quantities MUST be numeric type number with their exact unit (kg, g, °C, cm, etc.). Example {type:"number",initialValue:65,min:0,max:500,maxDelta:5,unit:"kg"}. NEVER assign days/hours/turns to kilograms. Timer means only countdown duration. Clock is a separate type with string initialValue "--:--" if unknown or 24h HH:mm for an established fictional time; unit HH:mm. Never invent story time. For a tracker needing narrative detail (hunger, meals, sleep, mood causes, training), prefer type record with initialValue an object of named fields: numbers or null for unknown levels, summary text, last event story time, and lists of recent established events. Hunger example: {fullness:null,summary:"Not established",lastMealAt:"Unknown",recentMeals:[]}. Track meals actually eaten with food, portion and time if known; preserve recent history and do not infer unmentioned meals. Record values must retain unchanged fields. Do not flatten detailed state into sliding meters. Use ids with lowercase letters/underscores; unique per tracker. Each description explains purpose and units; each instructions field states in-world behavioral consequences; each changeRules field explains evidence, progression, caps and prohibited guesses. For enum also provide allowedValues (at least 2), rules mapping statuses to effects and transitions mapping each status to permitted next statuses. Do not presume unmentioned injuries, affection, progress or locations. For health requests create an overall condition number AND one injuries-type ledger with initialValue:[] (or established injury records). Never hardcode a shoulder injury or flatten wounds into a single string. injuries is an array of records with stable id, location, cause, severity (minor/moderate/severe/critical), status (fresh/treated/healing/healed/scarred), pain (0–10), symptoms, limitations, treatment and scar strings. Use automatic by default for all trackers that should update from confirmed scene events, with conservative numeric steps and exact evidence. Use approval ONLY when the user explicitly asks to review changes or when a particular tracker must never update without approval. Use manual only for user-owned values. The chat tracker panel exposes an automatic/approval toggle for each tracker. Each confirmed reply should produce typed event changes when actual states, actions or conditions changed; do not invent changes from ordinary dialogue. Do not generate 0–100 percentage values without clear anchors for what low/middle/high mean. Return only fields relevant to each type. Nothing is saved until user reviews and accepts.'
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
     if(item.type==='record'&&item.dynamicFields===undefined)item.dynamicFields=true;
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
