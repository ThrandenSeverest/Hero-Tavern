const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {runWorkflowTest,agencyFindings,passageChecks,createModelTests}=require('../manager/ModelTests.cjs');
const {createPipeline}=require('../manager/ReplyPipeline.cjs');
const longReply=(turn=1)=>Array.from({length:3},(_,i)=>'Mira checks the Silver Heron, the ember glass cargo, and the bell tower route. '+Array.from({length:70},(_,j)=>'observation'+turn+'x'+i+'x'+j).join(' ')+'.').join('\n\n');
function factory({short=false,leak=false,invalid=false,tokenScale=4}={}){
 const requests=[],roots=[];let trackerCalls=0;
 return {requests,roots,makePipeline:(root,setDiagnostics,getStoryContext)=>{roots.push(root);return createPipeline({root,backendURL:'http://fixture',getStoryContext,getContextSize:()=>16384,getModelProfile:()=>({Template:'mistral-v3',Family:'Mistral NeMo'}),setDiagnostics,fetchBackend:async(url,{body})=>{
  const q=JSON.parse(body);if(url.includes('tokencount'))return Response.json({value:Math.ceil(q.prompt.length/tokenScale)});requests.push(q);
  let text=short?'Hello.':leak?'Rowan says, "I accept." Rowan takes the letter.':longReply(requests.length);
  if(q.prompt.includes('What are Mira’s confirmed')){assert.match(q.prompt,/Oak Inn/);text='Mira is at Oak Inn with 9 coins; the clock reads 09:30.';}
  if(q.json_schema){trackerCalls++;text=invalid?'{}':JSON.stringify({field_0:trackerCalls===1?'Stonebridge':'Oak Inn',field_1:trackerCalls===1?12:9,field_2:trackerCalls===1?'09:15':'09:30'});}
  return Response.json({choices:[{text,finish_reason:'stop'}]});
 }});}};
}
test('Tracker diagnostic executes real schema pipeline, saves updates and verifies next-reply context without retaining fixture stories',async()=>{
 const f=factory(),r=await runWorkflowTest({kind:'tracker',makePipeline:f.makePipeline,contextSize:16384});
 assert.equal(r.status,'passed',JSON.stringify(r));assert.equal(r.stages.length,3);assert.ok(r.stages.slice(0,2).every(s=>s.checks.every(c=>c.passed)));assert.equal(r.stages[2].checks.passed,true);
 assert.equal(r.stages[1].actual.coins,9);assert.equal(f.requests.length,3);assert.ok(f.requests.slice(0,2).every(q=>q.json_schema));assert.ok(f.roots.every(root=>!fs.existsSync(root)));
 const bad=factory({invalid:true}),failed=await runWorkflowTest({kind:'tracker',makePipeline:bad.makePipeline});assert.equal(failed.status,'failed');assert.ok(failed.stages.some(s=>s.analysis?.partial));
});
test('Character diagnostic makes three sequential long-context requests, feeding actual earlier replies forward',async()=>{
 const f=factory(),r=await runWorkflowTest({kind:'character-long',makePipeline:f.makePipeline,contextSize:16384});
 assert.equal(r.status,'passed',JSON.stringify(r));assert.equal(r.stages.length,3);assert.ok(r.stages.every(s=>s.checks.words>=180&&s.checks.paragraphs>=3&&s.longContextVerified));
 assert.equal(f.requests.length,3);assert.ok(f.requests.every(q=>q.max_tokens===1024));assert.ok(f.requests[1].prompt.includes(longReply()));
 const short=factory({short:true}),failed=await runWorkflowTest({kind:'character-long',makePipeline:short.makePipeline,contextSize:16384});assert.equal(failed.status,'failed');assert.ok(failed.stages.every(s=>!s.checks.passed));
});
test('Writer diagnostic checks three real manuscript continuations and flags invented player speech and actions',async()=>{
 const f=factory({leak:true}),r=await runWorkflowTest({kind:'writer-agency',makePipeline:f.makePipeline,contextSize:16384});
 assert.equal(r.status,'failed');assert.equal(r.stages.length,3);assert.ok(r.stages.every(s=>s.findings.some(f=>f.rule==='player speech')&&s.findings.some(f=>f.rule==='player action or thought')));
 assert.ok(f.requests[0].prompt.includes('The author supplies Rowan’s dialogue'));assert.ok(f.requests[0].prompt.endsWith('Rowan says, "What happened to the bridge?"\n\n'));
 const clean=factory(),passed=await runWorkflowTest({kind:'writer-agency',makePipeline:clean.makePipeline,contextSize:16384});assert.equal(passed.status,'passed',JSON.stringify(passed));
 assert.deepEqual(agencyFindings('Mira looks toward Rowan. "The choice is yours," Mira says.'),[]);
 assert.equal(passageChecks('Hello.').passed,false);
});
test('Workflow cancellation is recorded as failure without dispatching requests, and full evidence survives history reload',async()=>{
 const f=factory(),control=new AbortController();control.abort();const r=await runWorkflowTest({kind:'character-long',makePipeline:f.makePipeline,signal:control.signal});
 assert.equal(r.status,'failed');assert.equal(f.requests.length,0);assert.match(r.error,/cancelled/);
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-report-'));try{
  const saved=createModelTests(root).record({kind:'character-long',model:'fixture',status:r.status,workflow:r});
  assert.deepEqual(createModelTests(root).history()[0].workflow,saved.workflow);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});

test('A model with correct long replies cannot pass long-context coverage without measured prompt tokens',async()=>{
 const f=factory({tokenScale:100}),r=await runWorkflowTest({kind:'character-long',makePipeline:f.makePipeline,contextSize:16384});
 assert.equal(r.status,'warning');assert.ok(r.stages.every(s=>s.checks.passed&&!s.longContextVerified));
});

test('NPC questions do not invent player thoughts, but preceding player assertions remain detectable',()=>{
 for(const text of ['Mira asks, "What do you think - speed and risk, or caution and time?"', '"A better plan, don’t you think?" Mira says.', '"Where will you take the cargo?"'])assert.deepEqual(agencyFindings(text),[],text);
 for(const text of ['You take the letter. "What do you think?" Mira asks.', 'Rowan thinks the inn is safe.', 'You think the inn is safe.', 'Rowan says, "Yes?"'])assert.ok(agencyFindings(text).length,text);
});
