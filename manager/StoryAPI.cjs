const S=require('./StoryState.cjs');
function createStoryAPI(store,pipeline,{ready=()=>true}={}){
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
   const view=store.view(data.id),s=view.session,head=S.hash(view.messages.map(S.signature)),pending=view.messages.filter(m=>!s.analyzedSources.includes(S.signature(m))).slice(-2);
   const eligible=s.definitions.filter(d=>d.enabled!==false&&d.updateMode!=='manual'&&view.context.trackers.some(t=>t.key===S.keyOf(d)));
   if(!eligible.length||!pending.length)return view;
   if(!ready())throw Error('Load the reply model before analyzing tracker changes.');
   const prompt='Return JSON only: {"changes":[{"key":"exact tracker key","value":"typed value","sourceMessageId":"id","evidence":"exact quote from that message","reason":"short causal reason","ambiguous":false}]}. Propose only established changes, not hypotheticals or poetic description. Do not invent injuries, healing, elapsed time, possessions or knowledge. Bandaging is not healing. Use declared owners; never conflate characters. Return changes:[] if there is no reliable evidence.\nDefinitions: '+JSON.stringify(eligible)+'\nCurrent confirmed state: '+JSON.stringify(Object.fromEntries(eligible.map(d=>[S.keyOf(d),view.context.state[S.keyOf(d)]])))+'\nNew finalized messages: '+JSON.stringify(pending.map(m=>({id:m.extra.heroMessageId,name:m.name,avatar:m.original_avatar,text:m.mes})));
   try{const result=await pipeline.generate({prompt:'<|im_start|>user\n'+prompt+'<|im_end|>\n<|im_start|>assistant\n',stream:false,stop:['<|im_end|>']},signal,{mode:'state'}),raw=result.choices[0].text.replace(/^```(?:json)?\s*|```$/g,'').trim(),patch=JSON.parse(raw);
    const current=store.view(data.id);if(S.hash(current.messages.map(S.signature))!==head)throw Error('Chat changed; stale state analysis discarded.');
    const resultView=store.eventPatch(data.id,patch.changes,{expectedHead:head});resultView.session.analyzedSources=[...new Set([...resultView.session.analyzedSources,...pending.map(S.signature)])];store.saveSession(resultView.session);return store.view(data.id);
   }catch(e){const current=store.get(data.id);current.failures.push({at:Date.now(),message:e.message,head});current.failures=current.failures.slice(-30);store.saveSession(current);throw e;}
  }
  if(op==='helper'){
   if(!['trackers','lore','episodes'].includes(data.kind)||typeof data.brief!=='string'||data.brief.length>6000)throw Error('Choose a helper and a short description.');
   const schema=data.kind==='trackers'?'{"trackers":[{"id":"short_id","label":"label","type":"number|boolean|enum|text|list|relationship|timer|quest","initialValue":"correctly typed","updateMode":"approval","min":0,"max":100,"allowedValues":["status"],"instructions":"natural effect on story"}]}':data.kind==='lore'?'{"lore":[{"id":"id","label":"title","text":"compact lore","keywords":["trigger"],"condition":null,"visibility":"player"}]}':'{"episodes":[{"id":"id","title":"title","greeting":"opening dialogue","situation":"scene","initialState":{}}]}';
   const prompt='Draft '+data.kind+' for a character/story. Return valid JSON exactly matching this schema: '+schema+'. Keep it compact and practical; do not create unnecessary trackers. Every draft will be reviewed by the user. Context: '+String(data.context||'').slice(0,5000)+'\nRequest: '+data.brief;
   const result=await pipeline.generate({prompt:'<|im_start|>user\n'+prompt+'<|im_end|>\n<|im_start|>assistant\n',stream:false,stop:['<|im_end|>']},signal,{mode:'character'});const parsed=JSON.parse(result.choices[0].text.replace(/^```(?:json)?\s*|```$/g,'').trim());if(!Array.isArray(parsed[data.kind]))throw Error('Helper returned an invalid draft; nothing was saved.');return parsed;
  }
  throw Error('Unknown story action.');
 }
 return {action};
}
module.exports={createStoryAPI};
