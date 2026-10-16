const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createMemory}=require('../manager/ContextMemory.cjs');
const {createPipeline,saveSettings}=require('../manager/ReplyPipeline.cjs');
const {modelRequest}=require('../manager/ModelProfiles.cjs');
const source='<|im_start|>assistant\nWelcome, traveller.<|im_end|>\n<|im_start|>user\nHello.<|im_end|>\n<|im_start|>assistant\n';
async function fixture(run){const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-prompts-'));try{await run(root)}finally{fs.rmSync(root,{recursive:true,force:true})}}
const messages=[{role:'assistant',text:'Welcome, traveller.'},{role:'user',text:'Hello.'},{role:'assistant',text:'The door opens and '}];
test('Memory rebuild includes greeting once, removes swipe draft and preserves continuation prefill',()=>fixture(async root=>{
 const memory=createMemory({root,countTokens:async()=>100,complete:async()=>''});
 for(const generationType of ['normal','swipe','continue']){
  const input={prompt:source,hero_context:{id:generationType,messages,generationType}};
  const result=await memory.prepare(input,4000,{memoryEnabled:false});
  assert.equal(result.split('Welcome, traveller.').length-1,1);
  assert.equal(result.includes('The door opens'),generationType!=='swipe');
  for(const Template of ['chatml','mistral-v3','mistral-v7']){
   const q=modelRequest({prompt:result,assistantContinuation:generationType==='continue'},{Template});
   if(generationType==='continue'){assert.ok(q.prompt.endsWith('The door opens and'));assert.ok(!q.prompt.endsWith('</s>'));}
  }
 }
 assert.equal(messages.length,3);
}));
test('Backend boundary uses one token limit and one stop list, and recovery clears both stop aliases',()=>{
 for(const Template of ['chatml','mistral-v3'])for(const noStopSequences of [false,true]){
  const q=modelRequest({prompt:source,max_tokens:768,max_new_tokens:2048,n_predict:2048,num_predict:2048,include_reasoning:true,stop:'END',stopping_strings:['OTHER'],noStopSequences},{Template});
  assert.equal(q.max_tokens,768);
  for(const key of ['max_new_tokens','n_predict','num_predict','include_reasoning','stopping_strings'])assert.equal(key in q,false,key);
  if(noStopSequences)assert.deepEqual(q.stop,[]);else{assert.ok(q.stop.includes('END'));assert.ok(q.stop.includes('OTHER'));}
 }
});
test('Empty Rocinante output retries once on the same template and reports failure without v7 fallback',()=>fixture(async root=>{
 const requests=[];const pipeline=createPipeline({root,backendURL:'http://fixture',getContextSize:()=>8192,getModelProfile:()=>({Template:'mistral-v3',Family:'Mistral NeMo'}),fetchBackend:async(url,{body})=>{if(url.includes('tokencount'))return Response.json({value:100});requests.push(JSON.parse(body));return Response.json({choices:[{text:''}]});}});
 await assert.rejects(pipeline.generate({prompt:source,stopping_strings:['OTHER']}),/EMPTY_OUTPUT/);
 assert.equal(requests.length,2);assert.deepEqual(requests[1].stop,[]);
 for(const q of requests)assert.ok(!q.prompt.includes('[SYSTEM_PROMPT]'));
}));
test('Continuation with private planning keeps the final prose endpoint open and rejects planner commentary',()=>fixture(async root=>{
 saveSettings(root,{thinkingMode:'separate'});const requests=[];
 const pipeline=createPipeline({root,backendURL:'http://fixture',getContextSize:()=>8192,getModelProfile:()=>({Template:'mistral-v3',Family:'Mistral NeMo'}),fetchBackend:async(url,{body})=>{if(url.includes('tokencount'))return Response.json({value:100});requests.push(JSON.parse(body));return Response.json({choices:[{text:requests.length===1?'I will now write the requested scene.':'a traveller enters.'}]});}});
 const result=await pipeline.generate({prompt:source,hero_context:{id:'continued',messages,generationType:'continue'}});
 assert.equal(requests.length,2);assert.ok(requests[1].prompt.endsWith('The door opens and'));
 assert.ok(!requests[1].prompt.includes('I will now write'));
 assert.ok(requests[1].prompt.includes('Continue the last assistant reply'));
 assert.equal(result.choices[0].text,'a traveller enters.');
}));
test('Planner receives authoritative state and latest task; invented facts never become reply instructions',()=>fixture(async root=>{
 saveSettings(root,{thinkingMode:'separate'});const requests=[];
 const state='Confirmed location: Oak Inn. Coins: 9. Clock: 09:30.';
 const pipeline=createPipeline({root,backendURL:'http://fixture',getContextSize:()=>8192,getModelProfile:()=>({Template:'mistral-v3',Family:'Mistral NeMo'}),getStoryContext:()=>({text:state,trackers:[],lore:[]}),fetchBackend:async(url,{body})=>{if(url.includes('tokencount'))return Response.json({value:100});const q=JSON.parse(body);requests.push(q);return Response.json({choices:[{text:requests.length%2===1?JSON.stringify({facts:['Mira is in the Forest of Whispers.']}):'Oak Inn, 9 coins, 09:30.'}]});}});
 await pipeline.generate({prompt:'<|im_start|>assistant\n',hero_context:{id:'verify',sessionId:'verify',messages:[{role:'user',text:'Read the current saved location and time. Do not advance the scene.'}],oneReply:'Verify the saved values exactly.'}});
 assert.equal(requests.length,2);assert.match(requests[0].prompt,/Oak Inn/);assert.match(requests[0].prompt,/Verify the saved values exactly/);assert.ok(requests[0].json_schema.properties.facts);
 assert.doesNotMatch(requests[1].prompt,/Forest of Whispers/);assert.match(requests[1].prompt,/09:30/);assert.match(pipeline.runSnapshot().planningRejected,/absent/);
}));
test('Continuity selection accepts only bounded exact source excerpts',()=>{
 const {groundedContinuityPlan}=require('../manager/ReplyPipeline.cjs');
 const source='The location is Oak Inn. The clock reads 09:30.';
 assert.equal(groundedContinuityPlan('{"facts":["Oak Inn","09:30"]}',source),'{"facts":["Oak Inn","09:30"]}');
 assert.equal(groundedContinuityPlan('{"facts":[]}',source),'');
 for(const raw of ['Mira enters the forest.','{"facts":["forest"]}','{"facts":["Oak Inn"],"goal":"move to forest"}','{"facts":[4]}'])assert.equal(groundedContinuityPlan(raw,source),null);
});
