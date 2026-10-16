'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createWriterStore}=require('../manager/WriterStore.cjs');
const {createWriterAPI}=require('../manager/WriterAPI.cjs');
const {buildNovelPrompt}=require('../manager/NovelWriter.cjs');
test('Named save points keep separate manuscripts and restore the original text and inline provenance',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-writer-checkpoints-'));
 try{
  const store=createWriterStore(root),a=store.create({title:'First tale',text:'A beginning.'}),b=store.create({title:'Different tale',text:'Another beginning.'});
  const point=store.checkpoint(a.id,'Before the ambush',a.version);
  const changed=store.save(a.id,{text:'A beginning. The ambush.'},point.version);
  const restored=store.restoreCheckpoint(a.id,point.checkpoints[0].id,changed.version);
  assert.equal(restored.text,'A beginning.');assert.equal(store.read(b.id).text,'Another beginning.');
  assert.equal(restored.checkpoints[0].label,'Before the ambush');
  const second=store.checkpoint(a.id,'After restoring',restored.version);
  assert.equal(second.checkpoints.length,2);
  assert.equal(second.checkpoints[1].story.checkpoints,undefined,'Save points must not recursively contain prior save points');
  assert.equal(second.checkpoints[1].story.history,undefined,'Do not recursively embed revision history');
  assert.ok(restored.history.some(h=>h.text==='A beginning. The ambush.'));
  assert.equal(store.list().length,2);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('Manual Say/Do span is stored independently from AI text and survives reopening',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-writer-manual-'));
 try{
  const api=createWriterAPI(root,{generate:async()=>({choices:[{text:'The guard lowered his blade and waited.'}]})});
  const draft=await api.action('/writer/api/create',{story:{prompt:'Fantasy guard encounter',text:'The guards stood by the gate.',persona:{name:'Ari',description:''}}});
  const result=await api.action('/writer/api/generate-apply',{id:draft.id,expectedVersion:draft.version,operation:'say',instruction:'Let me pass.'});
  const {text,generations}=api.store.read(draft.id);
  const manual=generations.find(x=>x.kind==='manual'),ai=generations.find(x=>x.kind==='generated');
  assert.ok(manual&&ai,JSON.stringify(generations));
  assert.match(text.slice(manual.start,manual.end),/Ari says, “Let me pass.”/);
  assert.match(text.slice(ai.start,ai.end),/guard lowered/);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('Player control toggles change the model prompt and avoid auto-continuing the player',async()=>{
 const w={prompt:'A party is traveling.',text:'The old guard steps aside.',persona:{name:'Ari',description:''},settings:{protectPlayerSpeech:true,protectPlayerActions:true,finishSentences:true}};
 const build=async x=>buildNovelPrompt(x,{maxInputTokens:4096,countTokens:async t=>Math.ceil(t.length/4)});
 const on=await build(w),off=await build({...w,settings:{protectPlayerSpeech:false,protectPlayerActions:false,finishSentences:false}});
 assert.match(on.prompt,/The author supplies Ari’s dialogue/);
 assert.match(on.prompt,/voluntary actions, decisions and inner life/);
 assert.match(on.prompt,/Finish prose at a natural sentence/);
 assert.doesNotMatch(off.prompt,/The author supplies Ari’s dialogue/);
 assert.doesNotMatch(off.prompt,/Finish prose at a natural sentence/);
});
test('Writer UI has persistent highlights and independent story management buttons',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../manager/Writer.html'),'utf8');
 for(const str of ['id="manuscript-ink"','user-say','user-do','ai-prose','new-checkpoint','checkpoint-restore','rename-story','Never write my dialogue','Never write my actions'])assert.ok(html.includes(str),str);
});

test('Regenerate last preserves Say/Do text and highlights across repeated retries, reopening and save points',async()=>{
 for(const operation of ['say','do']){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-writer-regen-highlight-'));
  try{
   let calls=0;const inputs=[];
   const api=createWriterAPI(root,{generate:async body=>{inputs.push(body.hero_writer.text);return {choices:[{text:'Mira response '+(++calls)+'.'}]}}});
   const draft=await api.action('/writer/api/create',{story:{text:'Mira waits at the gate.',persona:{name:'Ari',description:''}}});
   let result=await api.action('/writer/api/generate-apply',{id:draft.id,expectedVersion:draft.version,operation,instruction:operation==='say'?'Let me pass.':'places a map on the desk.'});
   const manual=result.story.generations.find(g=>g.kind==='manual'),firstAI=result.generation;
   assert.equal(result.replacement.start,firstAI.start);assert.equal(result.replacement.text,firstAI.text);
   for(let retry=0;retry<3;retry++){
    result=await api.action('/writer/api/regenerate',{id:draft.id,expectedVersion:result.story.version,operation,generationId:result.generation.id,replacement:result.replacement});
    const kept=result.story.generations.find(g=>g.id===manual.id);
    assert.deepEqual(kept,manual);assert.equal(result.story.text.slice(kept.start,kept.end),manual.text);
    assert.equal(result.story.text.split(manual.text).length-1,1);assert.ok(inputs.at(-1).includes(manual.text));
    assert.equal(result.story.generations.filter(g=>g.kind==='generated').length,1);
   }
   const reopened=createWriterStore(root).read(draft.id);assert.deepEqual(reopened.generations.find(g=>g.kind==='manual'),manual);
   const point=api.store.checkpoint(draft.id,'Highlighted input',reopened.version);assert.deepEqual(point.checkpoints[0].story.generations.find(g=>g.kind==='manual'),manual);
  }finally{fs.rmSync(root,{recursive:true,force:true})}
 }
});

test('Legacy whole-insertion regenerate anchors resolve to AI prose without deleting highlighted author text',async()=>{
 for(const operation of ['say','do']){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-writer-legacy-anchor-'));
  try{
   let count=0;const api=createWriterAPI(root,{generate:async()=>({choices:[{text:++count===1?'The guard waits.':'The guard steps aside.'}]})});
   const draft=await api.action('/writer/api/create',{story:{text:'At the gate.',persona:{name:'Ari',description:''}}});
   const first=await api.action('/writer/api/generate-apply',{id:draft.id,expectedVersion:draft.version,operation,instruction:operation==='say'?'Hello.':'shows the map.'});
   const manual=first.story.generations.find(g=>g.kind==='manual');
   const legacy={start:draft.text.length,text:first.story.text.slice(draft.text.length)};
   const result=await api.action('/writer/api/regenerate',{id:draft.id,expectedVersion:first.story.version,operation,replacement:legacy});
   assert.deepEqual(result.story.generations.find(g=>g.id===manual.id),manual);assert.match(result.story.text,/guard steps aside/);assert.doesNotMatch(result.story.text,/guard waits/);
   await assert.rejects(api.action('/writer/api/regenerate',{id:draft.id,expectedVersion:result.story.version,operation,generationId:manual.id}),/boundary changed/);
  }finally{fs.rmSync(root,{recursive:true,force:true})}
 }
});
