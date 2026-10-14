'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createWriterStore}=require('../manager/WriterStore.cjs');
const {createWriterAPI}=require('../manager/WriterAPI.cjs');
const {buildWriterContext}=require('../manager/WriterContext.cjs');
const {writerRepetitionIssue}=require('../manager/WriterFlow.cjs');
const {createPipeline}=require('../manager/ReplyPipeline.cjs');
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'writer-flow-'));
const count=async s=>Math.ceil(s.length/4);

test('Editor scene beats and pace survive autosave, revision, restoration and fork without modifying manuscript',()=>{
 const root=temp();
 try{
  const store=createWriterStore(root),s=store.create({text:'Mira opened the letter.',prompt:'A dangerous letter begins a journey.',beats:['The courier demands a response.','A guard interrupts the bargain.'],beatIndex:0});
  assert.equal(s.settings.scenePace,'steady');
  const updated=store.save(s.id,{beatIndex:1,settings:{...s.settings,scenePace:'fast'}},s.version);
  assert.equal(updated.beats.length,2);assert.equal(updated.beatIndex,1);assert.equal(updated.text,s.text);
  const fork=store.fork(s.id);assert.equal(fork.beatIndex,1);assert.equal(fork.settings.scenePace,'fast');
  const restored=store.restore(s.id,updated.history.at(-1).id,updated.version);
  assert.equal(restored.beatIndex,0);assert.equal(restored.settings.scenePace,'steady');
  assert.throws(()=>store.save(restored.id,{beatIndex:99},restored.version),/beat index/);
  assert.throws(()=>store.save(restored.id,{beats:['']},restored.version),/scene beats/);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});

test('Continuing an in-progress novel prioritizes current manuscript over origin prompt and next beat is deferred',async()=>{
 const r=await buildWriterContext({
  prompt:'In the opening scene Mira first meets the courier and receives a sealed letter.',
  text:'They met at the crossroads. The courier handed Mira the letter. She broke the wax seal and discovered a map. At dusk she followed its markings to the locked gate.',
  memory:'Mira is left-handed.',recap:'The courier departed after handing over the map.',
  beats:['Meet the courier.','At the gate, a watchman demands proof of identity.','Beyond the gate, the road divides into two paths.'],
  beatIndex:1,note:'Use past tense.',operation:'continue',settings:{scenePace:'steady'},lore:[]
 },2500,count);
 assert.match(r.prompt,/long-term background and trajectory/);
 assert.match(r.prompt,/Active beat 2 of 3: At the gate/);
 assert.match(r.prompt,/Later beat \(not yet happening\): Beyond the gate/);
 assert.match(r.prompt,/story has ALREADY BEGUN/);
 assert.match(r.prompt,/current manuscript endpoint/i);
 assert.ok(r.prompt.endsWith('locked gate.'));
 assert.equal(r.diagnostics.beatIndex,1);
 assert.equal(r.diagnostics.scenePace,'steady');
 assert.equal(r.diagnostics.manuscriptStarted,true);
});

test('Next Scene operation advances chronology instead of replacing or restarting existing paragraphs',async()=>{
 const r=await buildWriterContext({text:'The courier had left. Mira reached the inn, where she found the guard waiting.',prompt:'A courier arrives.',beats:['The guard demands an explanation.'],beatIndex:0,operation:'advance',lore:[]},2400,count);
 assert.match(r.prompt,/Advance into a genuinely subsequent scene/);
 assert.match(r.prompt,/Do NOT restart or retell/);
 const root=temp();
 try{
  const calls=[],api=createWriterAPI(root,{generate:async data=>{calls.push(data.hero_writer);return {choices:[{text:'The guard blocked the stairs and held out his hand.'}]}}});
  const s=await api.action('/writer/api/create',{story:{prompt:'A courier arrives.',text:'Mira reached the inn.'}});
  const result=await api.action('/writer/api/generate-apply',{id:s.id,expectedVersion:s.version,operation:'advance'});
  assert.equal(calls[0].operation,'advance');
  assert.match(result.story.text,/Mira reached the inn\. The guard blocked/);
  assert.equal(result.story.generations[0].operation,'advance');
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});

test('AI planner generates reviewable future beats from manuscript endpoint and never mutates the story',async()=>{
 const root=temp();let req;
 try{
  const api=createWriterAPI(root,{generate:async(body,signal,info)=>{req={body,info};return {choices:[{text:JSON.stringify({beats:[
   'Mira confronts the guard, but he refuses entry until she produces the royal seal.',
   'She discovers the seal was stolen, forcing her to ask the suspicious innkeeper for help.',
   'The innkeeper offers shelter for a price, and Mira must trade her last safe route.',
   'An arriving messenger reveals the map is a decoy, changing their immediate destination.'
  ]})}]}}});
  const s=await api.action('/writer/api/create',{story:{prompt:'A journey begins with a courier.',text:'The courier is gone. Mira stands before the locked gate.',beats:['Find the gate.'],beatIndex:1}});
  const result=await api.action('/writer/api/plan-beats',{id:s.id,expectedVersion:s.version});
  assert.equal(result.beats.length,4);
  assert.match(req.body.prompt,/locked gate/);
  assert.match(req.body.prompt,/NOT the scene to restart/);
  assert.equal(req.info.mode,'utility');
  assert.equal(api.store.read(s.id).text,s.text);
  assert.deepEqual(api.store.read(s.id).beats,['Find the gate.']);
  assert.equal(api.store.read(s.id).version,s.version);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});

test('Repetition detector catches long exact loops while allowing short dialogue echoes',()=>{
 const old='She crossed the bridge slowly, counting each loose board beneath her boots. The river battered the stone supports, and Mira was certain the ropes would break. She escaped and reached the watchtower just before the rain.';
 assert.match(writerRepetitionIssue('She crossed the bridge slowly, counting each loose board beneath her boots. The river battered the stone supports, and Mira was certain the ropes would break. Then she stopped.',old),/copies|replays|repeats/);
 assert.equal(writerRepetitionIssue('"We have to leave," she said. The messenger blocked the entrance and offered her a bargain.',old),'');
});

test('Writer retries a repeated passage with scene-progression repair but keeps the manuscript unchanged until commit',async()=>{
 const root=temp(),requests=[];
 try{
  const old='She crossed the bridge slowly, counting each loose board beneath her boots. The river battered the stone supports, and Mira was certain the ropes would break. She escaped and reached the watchtower just before the rain.';
  const pipeline=createPipeline({root,backendURL:'http://unused',getContextSize:()=>8192,getModelProfile:()=>({Template:'chatml',Family:'Qwen / compatible'}),fetchBackend:async(url,opts)=>{
   if(url.includes('tokencount'))return Response.json({value:Math.ceil(JSON.parse(opts.body).prompt.length/4)});
   const body=JSON.parse(opts.body);requests.push(body);
   return Response.json({choices:[{text:requests.length===1?'She crossed the bridge slowly, counting each loose board beneath her boots. The river battered the stone supports, and Mira was certain the ropes would break. Then she stopped.':'At the watchtower, a sentinel slammed the barred gate and demanded she surrender the map. Mira refused, forcing him to sound the alarm.'}]});
  }});
  const result=await pipeline.generate({prompt:'',writerSettings:{writerTwoPass:false,maxReplyTokens:256},hero_writer:{prompt:'Mira meets a courier.',text:old,memory:'',note:'',beats:['The guard demands proof.'],beatIndex:0,operation:'continue',lore:[]}},null,{mode:'writer'});
  assert.equal(requests.length,2);assert.match(requests[1].prompt,/Scene progression repair/);
  assert.match(result.choices[0].text,/sentinel slammed/);
  assert.equal(pipeline.runSnapshot().writerProgressRepair.success,true);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});

test('Writer interface contains planning/beat controls and can advance scenes without toggling into chat mode',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../manager/Writer.html'),'utf8');
 for(const id of ['id="beats-editor"','id="beat-next"','id="beat-prev"','id="plan-beats"','id="advance"',"select.id='writer-scene-pace'"])assert.ok(html.includes(id),id);
 assert.match(html,/api\('plan-beats'/);
 assert.match(html,/beatIndex:Math\.min/);
 assert.match(html,/generate\('advance'\)|'continue','advance','insert'/);
});
