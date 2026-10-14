'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const S=require('../manager/StoryState.cjs');
const {explicitClockChanges}=require('../manager/TrackerDelta.cjs');
const {modelRequest}=require('../manager/ModelProfiles.cjs');
const {createPipeline}=require('../manager/ReplyPipeline.cjs');
const clock=S.validateDefinition({owner:'character:seraphina',id:'current_time',label:'Current story time (24h)',type:'clock',initialValue:'--:--',updateMode:'automatic'});
const message=(text,id='t1')=>({name:'Seraphina',mes:text,extra:{heroMessageId:id},is_user:false});
test('A confirmed in-story clock statement updates exactly the HH:mm time with source evidence',()=>{
 const result=explicitClockChanges([clock],[message('The time... fine. It\'s 23:47. Now please, tell me—why does it matter?')],{[S.keyOf(clock)]:'--:--'});
 assert.equal(result.length,1);assert.equal(result[0].value,'23:47');assert.equal(result[0].sourceMessageId,'t1');
 assert.match(result[0].evidence,/23:47/);assert.match(result[0].reason,/clock state/);
 assert.equal(explicitClockChanges([clock],[message('It is 23:47.')],{[S.keyOf(clock)]:'23:47'}).length,0);
});
test('Questions, bare timestamps and unestablished story time cannot become clock updates',()=>{
 for(const phrase of ['looks like midnight, is it midnight?','Seraphina - 2026-10-15 23:47','2 hours later','I do not know the time.']){
  assert.equal(explicitClockChanges([clock],[message(phrase)],{[S.keyOf(clock)]:'--:--'}).length,0,phrase);
 }
});
test('Mistral-v3 places system guidance in first instruction and stop-free recovery is possible',()=>{
 const canonical='<|im_start|>system\nStay in character.<|im_end|>\n<|im_start|>user\nHello<|im_end|>\n<|im_start|>assistant\n';
 const profile={Template:'mistral-v3',Family:'Mistral'};
 const m=modelRequest({prompt:canonical,stop:['<|im_end|>'],noStopSequences:true},profile);
 assert.equal(m.stop.length,0);assert.match(m.prompt,/^<s>\[INST\]Stay in character\.\n\nHello\[\/INST\]$/);
});
test('Mistral empty responses retry without stop sequences and return user-visible text',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-mistral-'));const requests=[];
 try{
  const pipeline=createPipeline({root,backendURL:'http://fixture',getContextSize:()=>8192,getModelProfile:()=>({Template:'mistral-v3',Family:'Mistral'}),fetchBackend:async(url,{body})=>{
   if(url.includes('/tokencount'))return Response.json({value:90});
   const q=JSON.parse(body);requests.push(q);
   return Response.json({choices:[{text:requests.length===1?'':'“It is 23:47,” Seraphina replies.'}]});
  }});
  const result=await pipeline.generate({prompt:'<|im_start|>user\nWhat time is it?<|im_end|>\n<|im_start|>assistant\n'},null,{mode:'chat'});
  assert.equal(requests.length,2);assert.deepEqual(requests[1].stop,[]);
  assert.match(result.choices[0].text,/23:47/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('Character voice assignment and standalone diagnostics are available from the visible interfaces',()=>{
 const story=fs.readFileSync(path.join(__dirname,'../extension/story.js'),'utf8');
 const ui=fs.readFileSync(path.join(__dirname,'../manager/ModelPanel.html'),'utf8');
 const tts=fs.readFileSync(path.join(__dirname,'../manager/TTSService.cjs'),'utf8');
 assert.match(story,/hero-character-voice-toolbar/);assert.match(story,/hero-character-voice-quick/);
 assert.match(story,/custom-0\.6/);assert.match(story,/openCharacterVoice\(\)/);
 for(const id of ['diagnostic-tts-refresh','diagnostic-tts-run','diagnostic-tts-log','diagnostic-tts-profile','model-diagnostic-flow'])assert.ok(ui.includes(id),id);
 assert.match(ui,/insertBefore\(el\('model-diagnostic-flow'\)/);
 assert.match(tts,/engine:'qwen',variant:'custom-0.6'/);
});

test('Universal direct tracker updates support numeric, enum, boolean, text, list, record and quest state',()=>{
 const {explicitStateChanges}=require('../manager/TrackerDelta.cjs');
 const base={owner:'character:seraphina',updateMode:'automatic'};
 const d=[
  S.validateDefinition({...base,id:'health',label:'Health',type:'number',min:0,max:100,initialValue:70}),
  S.validateDefinition({...base,id:'mood',label:'Mood',type:'enum',allowedValues:['calm','angry'],initialValue:'calm'}),
  S.validateDefinition({...base,id:'door_unlocked',label:'Door unlocked',type:'boolean',initialValue:false}),
  S.validateDefinition({...base,id:'location',label:'Current location',type:'text',initialValue:'Unknown'}),
  S.validateDefinition({...base,id:'inventory',label:'Inventory',type:'list',initialValue:[]}),
  S.validateDefinition({...base,id:'needs',label:'Needs',type:'record',initialValue:{fullness:null,summary:'Unknown'}}),
  S.validateDefinition({...base,id:'quest',label:'Quest',type:'quest',initialValue:{stage:'Waiting',status:'inactive'}})
 ];
 const messages=[
  message('Health: 75.5\nMood: angry\nDoor unlocked: true\nCurrent location: Old forest','m1'),
  message('Inventory: ["rope","torch"]\nNeeds: {"fullness":30,"summary":"Hungry"}\nQuest: {"stage":"Find the gate","status":"active"}','m2')
 ];
 const result=explicitStateChanges(d,messages,S.initialState(d)),state=Object.fromEntries(result.map(x=>[x.key,x.value]));
 assert.equal(result.length,7);
 assert.equal(state['character:seraphina:health'],75.5);
 assert.equal(state['character:seraphina:mood'],'angry');
 assert.equal(state['character:seraphina:door_unlocked'],true);
 assert.equal(state['character:seraphina:location'],'Old forest');
 assert.deepEqual(state['character:seraphina:inventory'],['rope','torch']);
 assert.deepEqual(state['character:seraphina:needs'],{fullness:30,summary:'Hungry'});
 assert.deepEqual(state['character:seraphina:quest'],{stage:'Find the gate',status:'active'});
 for(const change of result){
  const source=messages.find(m=>m.extra.heroMessageId===change.sourceMessageId);
  assert.ok(source.mes.includes(change.evidence),'Every change has its own verbatim source evidence');
 }
});
test('Universal AI reanalysis repairs missed state for earlier processed dialogue exactly once',async()=>{
 const {createStoryAPI}=require('../manager/StoryAPI.cjs');
 const base={owner:'character:seraphina',updateMode:'automatic'};
 const inventory=S.validateDefinition({...base,id:'inventory',label:'Inventory',type:'list',initialValue:[]});
 const m=message('I put the silver key in my bag.', 'old-assistant'),msgs=[m];
 const session={id:'test',characterId:'seraphina',definitions:[inventory],events:[],analyzedSources:[S.signature(m)],failures:[]};
 const state=()=>S.stateAt(session,msgs);
 const store={
  view:()=>({session,messages:msgs,context:{state:state()}}),
  get:()=>session,
  saveSession:()=>{},
  eventPatch(_id,changes){session.events.push(...S.propose(session,msgs,changes));return this.view();}
 };
 let calls=0;
 const pipeline={generate:async()=>{calls++;return {choices:[{text:JSON.stringify({operations:[{key:S.keyOf(inventory),verb:'ADD',value:'silver key',sourceMessageId:m.extra.heroMessageId,evidence:'I put the silver key in my bag.'}]})}]}}};
 const api=createStoryAPI(store,pipeline);
 assert.deepEqual((await api.action('/story/analyze',{id:'test'})).context.state[S.keyOf(inventory)],[]);
 const first=await api.action('/story/analyze',{id:'test',recheck:true});
 assert.deepEqual(first.context.state[S.keyOf(inventory)],['silver key']);
 assert.equal(first.session.lastAnalysis.changeTypes.list,1);
 await api.action('/story/analyze',{id:'test',recheck:true});
 assert.equal(session.events.length,1,'Reanalysis must not apply the same source/key twice');
 assert.equal(calls,2);
});
test('Extractor failure is retryable and does not mark source messages analyzed',async()=>{
 const {createStoryAPI}=require('../manager/StoryAPI.cjs');
 const d=S.validateDefinition({owner:'character:seraphina',id:'hunger',label:'Hunger',type:'number',min:0,max:100,initialValue:50,updateMode:'automatic'});
 const m=message('She skipped dinner and feels hungry.');
 const session={id:'test',characterId:'seraphina',definitions:[d],events:[],analyzedSources:[],failures:[]};
 const store={view:()=>({session,messages:[m],context:{state:S.initialState([d])}}),get:()=>session,saveSession:()=>{}};
 const api=createStoryAPI(store,{generate:async()=>({choices:[{text:''}]})});
 await assert.rejects(api.action('/story/analyze',{id:'test'}),/could not validate any changes/);
 assert.deepEqual(session.analyzedSources,[]);
 assert.equal(session.lastAnalysis.failed,true);
 assert.ok(session.failures.length);
});
