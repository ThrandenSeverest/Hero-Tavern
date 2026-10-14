'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createWriterStore}=require('../manager/WriterStore.cjs');
const {buildWriterContext}=require('../manager/WriterContext.cjs');
const read=p=>fs.readFileSync(path.join(__dirname,'../manager',p),'utf8');

test('continuity recap survives save, revision, restore, fork and is independent of permanent canon',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'writer-recap-'));
 try{
  const store=createWriterStore(root),s=store.create({memory:'Character is left-handed.',recap:'Chapter 1: lost a map.',note:'Tense dialogue.'});
  const next=store.save(s.id,{recap:'Chapter 1: recovered the map.',memory:'Character is left-handed.'},s.version);
  assert.equal(next.recap,'Chapter 1: recovered the map.');
  assert.equal(next.memory,'Character is left-handed.');
  assert.equal(next.history.at(-1).recap,'Chapter 1: lost a map.');
  const fork=store.fork(next.id);assert.equal(fork.recap,next.recap);
  const restored=store.restore(next.id,next.history.at(-1).id,next.version);
  assert.equal(restored.recap,'Chapter 1: lost a map.');
  assert.throws(()=>store.save(restored.id,{recap:'x'.repeat(50001)},restored.version),/at most/);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('writer context separates permanent canon, previous chapters, next-scene direction and recent prose',async()=>{
 const w={text:'The gate creaked open. Mira stepped inside.',prompt:'A fantasy village.',memory:'Mira cannot swim.',recap:'Earlier: the bridge collapsed, and she escaped.',note:'Third person past tense; focus on the arriving rider.',operation:'continue',lore:[]};
 const r=await buildWriterContext(w,4000,async s=>Math.ceil(s.length/4));
 for(const phrase of ['Mira cannot swim','the bridge collapsed','the arriving rider','Mira stepped inside'])assert.ok(r.prompt.includes(phrase),phrase);
 assert.equal(r.diagnostics.recapCharacters,w.recap.length);
 assert.ok(r.diagnostics.promptTokens<=r.diagnostics.budget);
 const positions=['[Established story facts','[Continuity recap','[Author direction'].map(x=>r.prompt.indexOf(x));
 assert.ok(positions[0]<positions[1]&&positions[1]<positions[2]);
});
test('lore matching uses recent context, whole-word keys and a bounded token budget',async()=>{
 const huge='A '.repeat(3000);
 const base={prompt:'',text:'The annual festival begins as Mira enters.',memory:'',recap:'',note:'',operation:'continue',lore:[
  {title:'Ann',keys:['Ann'],text:'should not activate accidentally'},
  {title:'Mira',keys:['Mira'],text:'Mira always wears a scarlet cloak.'},
  {title:'Huge',keys:['Mira'],text:huge}
 ]};
 const r=await buildWriterContext(base,1100,async s=>Math.ceil(s.length/4));
 assert.match(r.prompt,/scarlet cloak/);
 assert.doesNotMatch(r.prompt,/should not activate accidentally/);
 assert.doesNotMatch(r.prompt,/A A A A A A/);
 assert.ok(r.diagnostics.loreTokens<=r.diagnostics.loreBudget);
 assert.ok(r.diagnostics.budgetSkippedLore.includes('Huge'));
 assert.ok(r.diagnostics.omittedLore.includes('Ann'));
 assert.ok(r.diagnostics.retainedCharacters>0);
});
test('Writer UI retains scroll anchor after rerender and does not focus hidden manuscript',()=>{
 const html=read('Writer.html');
 assert.match(html,/function capturePassageViewport/);
 assert.match(html,/function restorePassageViewport/);
 assert.match(html,/saved\?\.bottom/);
 assert.match(html,/dataset\.passageKey/);
 assert.match(html,/requestAnimationFrame\(\(\)=>requestAnimationFrame/);
 assert.match(html,/if\(!segmentedMode\)\{editor\.focus\(\{preventScroll:true\}\)/);
 assert.match(html,/renderPassages\(options\)/);
 assert.match(html,/id="recap"/);
 assert.match(html,/recap:\$\('recap'\)\.value/);
 const pipeline=read('ReplyPipeline.cjs');
 assert.match(pipeline,/\[Previous chapters — continuity\]/);
 assert.match(pipeline,/\[Permanent canon\]/);
});
