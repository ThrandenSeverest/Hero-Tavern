'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const S=require('../manager/StoryState.cjs');
const {modelRequest}=require('../manager/ModelProfiles.cjs');
const {createPipeline}=require('../manager/ReplyPipeline.cjs');
const clock=S.validateDefinition({owner:'character:seraphina',id:'current_time',label:'Current story time (24h)',type:'clock',initialValue:'--:--',updateMode:'automatic'});
const message=(text,id='t1')=>({name:'Seraphina',mes:text,extra:{heroMessageId:id},is_user:false});
test('Mistral-v3 places system guidance in first instruction and stop-free recovery is possible',()=>{
 const canonical='<|im_start|>system\nStay in character.<|im_end|>\n<|im_start|>user\nHello<|im_end|>\n<|im_start|>assistant\n';
 const profile={Template:'mistral-v3',Family:'Mistral'};
 const m=modelRequest({prompt:canonical,stop:['<|im_end|>'],noStopSequences:true},profile);
 assert.equal(m.stop.length,0);assert.match(m.prompt,/^<s>\[INST\]Stay in character\.\n\nHello\[\/INST\]$/);
});
test('Mistral multi-turn system rules remain next to the most recent user prompt, not buried in opening history',()=>{
 const canonical='<|im_start|>system\nStay in character. Answer directly.<|im_end|>\n<|im_start|>user\nHello<|im_end|>\n<|im_start|>assistant\nHello there!<|im_end|>\n<|im_start|>user\nContinue the scene<|im_end|>\n<|im_start|>assistant\n';
 const prompt=modelRequest({prompt:canonical,noStopSequences:true},{Template:'mistral-v3',Family:'Mistral NeMo'}).prompt;
 assert.match(prompt,/^<s>\[INST\]Hello\[\/INST\]Hello there!<\/s>\[INST\]Stay in character\. Answer directly\.\n\nContinue the scene\[\/INST\]$/);
 assert.equal((prompt.match(/Stay in character/g)||[]).length,1);
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
