'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const W=require('../manager/WTracker.cjs'),S=require('../manager/StoryState.cjs'),{createStoryStore}=require('../manager/StoryStore.cjs'),{createStoryAPI}=require('../manager/StoryAPI.cjs'),{createPipeline}=require('../manager/ReplyPipeline.cjs');
const def=(id,type,value,extra={})=>W.validateDefinition({id,type,initialValue:value,owner:'character:lyra',...extra});
function fixture(fields=[def('location','text','Unknown')]){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'wtracker-')),folder=path.join(root,'SillyTavern/data/default-user/chats/Lyra');fs.mkdirSync(folder,{recursive:true});
 const file=path.join(folder,'Story.jsonl'),loc={avatar:'Lyra.png',filename:'Story'},store=createStoryStore(root);
 fs.writeFileSync(file,[{character_name:'Lyra',chat_metadata:{}},{name:'Lyra',mes:'We are in the tavern.',is_user:false,extra:{}}].map(JSON.stringify).join('\n')+'\n');
 let view=store.sync(loc),session=store.get(view.session.id);session.definitions=fields;session.events=[];store.saveSession(session);
 return {root,file,store,id:session.id,view:()=>store.view(session.id),save(messages){const v=this.view();fs.writeFileSync(file,[v.header,...messages].map(JSON.stringify).join('\n')+'\n');return store.sync(loc)},close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('Pinned upstream parser and example generator execute; old command formats are not accepted',()=>{
 const U=require('../manager/WTrackerUpstream.cjs');assert.deepEqual(U.parseResponse('```json\n{"a":1}\n```'),{a:1});assert.deepEqual(JSON.parse(U.schemaToExample({type:'object',properties:{location:{type:'string',example:'Tavern'}}},'json')),{location:'Tavern'});
 for(const raw of ['UPDATE :: location :: SET :: Inn','{"changes":[]}','{"operations":[]}','{"field_0":'])assert.throws(()=>W.readSnapshot(raw,[def('location','text','Unknown')]));
});
test('WTracker builds complete schema-constrained requests for KoboldCpp with short aliases',()=>{
 const fields=[def('clock','clock','--:--'),def('mass','number',61.5,{unit:'kg',min:0,max:300}),def('inventory','list',[])];
 const req=W.buildRequest(fields,W.initialState(fields),[{name:'Lyra',mes:'She takes a rope.'}]);
 assert.deepEqual(req.json_schema.required,['field_0','field_1','field_2']);assert.deepEqual(JSON.parse(req.grammar),req.json_schema);assert.equal(req.json_schema.properties.field_0.example,'--:--');assert.equal(req.json_schema.properties.field_1.example,61.5);assert.match(req.prompt,/PREVIOUS TRACKER/);assert.match(req.prompt,/She takes a rope/);
 assert.deepEqual(W.readSnapshot('{"field_0":"--:--","field_1":61.5,"field_2":["rope"]}',fields).map(v=>v.value),['--:--',61.5,['rope']]);
});
test('Every requested field must exist and match its schema; unknown clock remains valid',()=>{
 const fields=[def('clock','clock','--:--'),def('open','boolean',false),def('count','number',0,{min:0,max:10})];
 for(const raw of [{field_0:'--:--',field_1:false},{field_0:'25:00',field_1:false,field_2:0},{field_0:'--:--',field_1:'false',field_2:0},{field_0:'--:--',field_1:false,field_2:11},{field_0:'--:--',field_1:false,field_2:0,extra:1}])assert.throws(()=>W.readSnapshot(JSON.stringify(raw),fields));
 assert.equal(W.readSnapshot('{"field_0":"--:--","field_1":false,"field_2":0}',fields).length,3);
});
test('Structured records and lists use complete snapshots without per-field command/evidence matching',()=>{
 const fields=[def('meals','record',{summary:'Unknown',recentMeals:[],fullness:null})];
 const values=W.readSnapshot('{"field_0":{"summary":"Ate soup","recentMeals":["Soup in the tavern"],"fullness":70}}',fields);assert.equal(values[0].value.fullness,70);assert.deepEqual(values[0].value.recentMeals,['Soup in the tavern']);
 assert.throws(()=>W.readSnapshot('{"field_0":{"summary":"Ate soup"}}',fields),/missing/);
});
test('Legacy state is reset once; it cannot be replayed or passed through the old engine',()=>{
 const s={characterId:'lyra',definitions:[def('bad','text','bad')],events:[{op:'set',value:12}],snapshots:[{}],analyzedSources:['old'],failures:[{}]};assert.equal(W.initialize(s),true);assert.equal(s.trackerEngine,'wtracker-1');assert.equal(s.events.length,0);assert.equal(s.definitions.some(d=>d.id==='bad'),false);assert.equal(W.initialize(s),false);assert.equal(fs.existsSync(path.join(__dirname,'../manager/TrackerDelta.cjs')),false);
});
test('Successful snapshot updates live state, survives restart and injects the next prompt; no-op is success',async()=>{
 const f=fixture();try{let calls=0;const api=createStoryAPI(f.store,{generate:async req=>{calls++;assert.ok(req.json_schema);return {choices:[{text:'{"field_0":"Tavern"}'}]}}});
 const before=fs.readFileSync(f.file,'utf8');let v=await api.action('/story/analyze',{id:f.id});assert.equal(v.context.state['character:lyra:location'],'Tavern');assert.equal(v.session.lastAnalysis.partial,false);assert.equal(v.session.events[0].engine,'wtracker');assert.equal(fs.readFileSync(f.file,'utf8'),before);
 assert.match(createStoryStore(f.root).view(f.id).context.text,/Tavern/);await api.action('/story/analyze',{id:f.id});assert.equal(calls,1);
 v=await api.action('/story/analyze',{id:f.id,recheck:true});assert.equal(v.session.events.length,1);assert.equal(v.session.lastAnalysis.partial,false);
 }finally{f.close()}
});
test('Malformed/truncated result records the error and a manual retry recovers without consuming the turn',async()=>{
 const f=fixture();try{let bad=true;const api=createStoryAPI(f.store,{generate:async()=>({choices:[{text:bad?'wrong':'{"field_0":"Tavern"}'}]})});let v=await api.action('/story/analyze',{id:f.id});assert.equal(v.context.state['character:lyra:location'],'Unknown');assert.equal(v.session.events.length,0);assert.equal(v.session.analyzedSources.length,0);assert.ok(v.session.lastAnalysis.retryAt>Date.now());bad=false;v=await api.action('/story/analyze',{id:f.id,recheck:true});assert.equal(v.context.state['character:lyra:location'],'Tavern');assert.equal(v.session.lastAnalysis.partial,false);
 }finally{f.close()}
});
test('Multi-batch snapshot is atomic: a later batch failure cannot save the first batch',async()=>{
 const f=fixture(Array.from({length:5},(_,i)=>def('state_'+i,'text','Unknown')));try{let calls=0;const api=createStoryAPI(f.store,{generate:async()=>({choices:[{text:++calls===1?'{"field_0":"a","field_1":"b","field_2":"c","field_3":"d"}':'incomplete'}]})});const v=await api.action('/story/analyze',{id:f.id});assert.equal(calls,2);assert.equal(v.session.events.length,0);assert.ok(v.session.lastAnalysis.partial);assert.deepEqual(Object.values(v.context.state),Array(5).fill('Unknown'));
 }finally{f.close()}
});
test('Chat edits while inference runs discard the stale snapshot',async()=>{
 const f=fixture();try{const api=createStoryAPI(f.store,{generate:async()=>{const messages=f.view().messages;messages[0].mes='We are in the forest.';f.save(messages);return {choices:[{text:'{"field_0":"Tavern"}'}]}}});const v=await api.action('/story/analyze',{id:f.id});assert.equal(v.session.events.length,0);assert.match(v.session.lastAnalysis.error,/changed during generation/);assert.equal(v.messages[0].mes,'We are in the forest.');
 }finally{f.close()}
});
test('Schema edits during inference discard the stale snapshot',async()=>{
 const f=fixture();try{const api=createStoryAPI(f.store,{generate:async()=>{f.store.definitionEdit(f.id,'character:lyra:location',{description:'New rules'});return {choices:[{text:'{"field_0":"Tavern"}'}]}}});const v=await api.action('/story/analyze',{id:f.id});assert.equal(v.session.events.length,0);assert.match(v.session.lastAnalysis.error,/changed during generation/);
 }finally{f.close()}
});
test('Manual correction made during generation is preserved',async()=>{
 const f=fixture();try{const api=createStoryAPI(f.store,{generate:async()=>{f.store.eventPatch(f.id,[{key:'character:lyra:location',value:'Kitchen',sourceMessageId:f.view().messages.at(-1).extra.heroMessageId}],{manual:true});return {choices:[{text:'{"field_0":"Tavern"}'}]}}});const v=await api.action('/story/analyze',{id:f.id});assert.equal(v.context.state['character:lyra:location'],'Kitchen');
 }finally{f.close()}
});
test('Unanswered user actions and empty assistant messages are excluded from the current snapshot',async()=>{
 const f=fixture();try{const seen=[];const api=createStoryAPI(f.store,{generate:async req=>{seen.push(req.prompt);return {choices:[{text:'{"field_0":"Tavern"}'}]}}});await api.action('/story/analyze',{id:f.id});f.save([...f.view().messages,{name:'Player',mes:'GO_TO_FOREST_PENDING',is_user:true,extra:{}},{name:'Lyra',mes:'',is_user:false,extra:{}}]);await api.action('/story/analyze',{id:f.id});assert.equal(seen.length,1);await api.action('/story/analyze',{id:f.id,recheck:true});assert.doesNotMatch(seen.at(-1),/GO_TO_FOREST_PENDING/);
 }finally{f.close()}
});
test('Newest completed scene is initialized once, then newly completed turns process in order',async()=>{
 const f=fixture();try{let v=f.view();f.save([...v.messages,{name:'Player',mes:'Walk outside',is_user:true,extra:{}},{name:'Lyra',mes:'Forest_A',is_user:false,extra:{}}]);let calls=0;const api=createStoryAPI(f.store,{generate:async req=>{calls++;return {choices:[{text:JSON.stringify({field_0:req.prompt.includes('Forest_B')?'Forest_B':'Forest_A'})}]}}});v=await api.action('/story/analyze',{id:f.id});assert.equal(calls,1);assert.equal(v.context.state['character:lyra:location'],'Forest_A');f.save([...v.messages,{name:'Lyra',mes:'Forest_B',is_user:false,extra:{}}]);v=await api.action('/story/analyze',{id:f.id});assert.equal(calls,2);assert.equal(v.context.state['character:lyra:location'],'Forest_B');
 }finally{f.close()}
});
test('No model yields a concrete retryable error; manual-only fields do not trigger inference',async()=>{
 const f=fixture();try{let calls=0;const api=createStoryAPI(f.store,{generate:async()=>{calls++}},{ready:()=>false});const v=await api.action('/story/analyze',{id:f.id});assert.match(v.session.lastAnalysis.error,/Load a text model/);assert.equal(calls,0);f.store.definitionEdit(f.id,'character:lyra:location',{updateMode:'manual'});await api.action('/story/analyze',{id:f.id,recheck:true});assert.equal(calls,0);
 }finally{f.close()}
});
test('Actual ReplyPipeline forwards grammar + JSON schema and max_tokens to Mistral Kobold request',async()=>{
 const f=fixture();try{let received;const pipeline=createPipeline({root:f.root,backendURL:'http://fixture',getContextSize:()=>32768,getModelProfile:()=>({Template:'mistral-v3',Family:'Mistral NeMo'}),fetchBackend:async(url,options)=>{if(url.endsWith('tokencount'))return Response.json({value:300});received=JSON.parse(options.body);return Response.json({choices:[{text:'{"field_0":"Tavern"}'}]});}});
 const api=createStoryAPI(f.store,pipeline),v=await api.action('/story/analyze',{id:f.id});assert.equal(v.session.lastAnalysis.partial,false);assert.equal(v.context.state['character:lyra:location'],'Tavern');assert.ok(received.prompt.startsWith('<s>[INST]'));assert.deepEqual(JSON.parse(received.grammar),received.json_schema);assert.equal(received.max_tokens,1024);
 }finally{f.close()}
});
test('Packaging removes the retired module and ships new runtime, UI and MIT notice',()=>{
 const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');for(const name of ['installer/Install.ps1','launcher/Bootstrap.cs','.github/workflows/build-windows.yml'])for(const asset of ['WTracker.cjs','WTrackerUpstream.cjs','WTrackerPanel.js','WTracker-LICENSE.txt'])assert.ok(read(name).includes(asset),name+' missing '+asset);
 assert.doesNotMatch(read('manager/StoryAPI.cjs'),/TrackerDelta|parseCommands|explicitStateChanges/);assert.doesNotMatch(read('manager/StoryState.cjs'),/evidence|validateInjuryChange|maxDelta/);assert.ok(read('manager/ModelPanel.html').includes('/wtracker-panel.js'));
});
