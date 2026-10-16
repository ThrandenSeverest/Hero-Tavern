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
 assert.match(on.prompt,/NEVER invent, complete, quote or paraphrase words spoken by Ari/);
 assert.match(on.prompt,/NEVER invent decisions, voluntary movements/);
 assert.match(on.prompt,/Finish prose at a natural sentence/);
 assert.doesNotMatch(off.prompt,/NEVER invent, complete, quote or paraphrase/);
 assert.doesNotMatch(off.prompt,/Finish prose at a natural sentence/);
});
test('Writer UI has persistent highlights and independent story management buttons',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../manager/Writer.html'),'utf8');
 for(const str of ['id="manuscript-ink"','user-say','user-do','ai-prose','new-checkpoint','checkpoint-restore','rename-story','Never write my dialogue','Never write my actions'])assert.ok(html.includes(str),str);
});
