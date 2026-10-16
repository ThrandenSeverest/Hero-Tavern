'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createWriterStore}=require('../manager/WriterStore.cjs');
const {buildWriterContext}=require('../manager/WriterContext.cjs');
const {createPipeline}=require('../manager/ReplyPipeline.cjs');
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'hero-writer-prose-'));
test('story prompt is a separate, persisted, revisioned field',()=>{
 const root=tmp();
 try{const st=createWriterStore(root),created=st.create({prompt:'An innkeeper hears footsteps.',text:''});
 assert.equal(created.prompt,'An innkeeper hears footsteps.');assert.equal(created.text,'');
 const edited=st.save(created.id,{prompt:'The innkeeper opens the door.'},created.version);
 assert.equal(edited.history.at(-1).prompt,'An innkeeper hears footsteps.');
 assert.equal(st.read(created.id).prompt,'The innkeeper opens the door.');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('empty manuscript with story prompt requests opening scene rather than a character dossier',async()=>{
 const c=await buildWriterContext({text:'',prompt:'Lesya meets a stranger in a tavern.',memory:'',note:'',lore:[],operation:'continue'},4000,async s=>s.length);
 assert.match(c.prompt,/Write the opening scene as fiction prose/);assert.match(c.prompt,/Lesya meets a stranger/);
 assert.match(c.prompt,/never give a character sheet/);
});
test('Writer returns a nonempty completion with diagnostic style information and no automatic regeneration',async()=>{
 const root=tmp();let n=0;
 try{const pipeline=createPipeline({root,backendURL:'mock',getContextSize:()=>8192,fetchBackend:async(url,o)=>{
  const payload=JSON.parse(o.body);
  if(url.endsWith('/tokencount'))return Response.json({value:Math.ceil(payload.prompt.length/4)});
  n++;return Response.json({choices:[{text:'I understand I need to continue this scenario based on the instructions. Let me start by describing Lesya’s appearance:'}]});
 }});
 const result=await pipeline.generate({prompt:'',writerSettings:{maxReplyTokens:256},hero_writer:{text:'',prompt:'Lesya arrives at an inn.',memory:'',note:'',lore:[],operation:'continue'}},undefined,{mode:'writer'});
 assert.equal(n,1);assert.ok(result.writerContext.styleWarnings.includes('assistant commentary'));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('writer preserves a valid narrative candidate without a repair pass',async()=>{
 const root=tmp();let n=0;
 try{const pipeline=createPipeline({root,backendURL:'mock',getContextSize:()=>8192,fetchBackend:async(url,o)=>{
  const payload=JSON.parse(o.body);
  if(url.endsWith('/tokencount'))return Response.json({value:Math.ceil(payload.prompt.length/4)});
  n++;return Response.json({choices:[{text:'The tavern door creaked open. Lesya looked up from the hearth. A traveler staggered across the threshold, clutching a letter against his coat. Before she could ask his name, he sank into the nearest chair and asked whether anyone had followed him. Outside, a horse whinnied and heavy footsteps approached the door. The innkeeper reached for the iron latch.'}]});
 }});
 const r=await pipeline.generate({prompt:'',hero_writer:{text:'',prompt:'Lesya arrives at an inn.',memory:'',note:'',lore:[],operation:'continue'}},undefined,{mode:'writer'});
 assert.match(r.choices[0].text,/tavern door creaked/);assert.equal(n,1);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('Writer diagnoses standalone player prompts without rejecting fictional dialogue',()=>{
 const {writerStyleWarnings}=require('../manager/NovelWriter.cjs');
 for(const ending of ['What do you do?','**What do you do next?**','How do you respond?','Your turn.','Что ты будешь делать?','Как вы ответите?'])assert.ok(writerStyleWarnings('Mira waits by the door.\n\n'+ending,'').includes('out-of-scene player prompt'));
 for(const prose of ['“What do you do?” Mira asks.','Mira asks, “How do you respond?”','The stranger waits for an answer.'])assert.deepEqual(writerStyleWarnings(prose,''),[]);
});
test('Writer uses prose-first task instructions and records a style issue without another model call',async()=>{
 const root=tmp();let n=0;try{
  const pipeline=createPipeline({root,backendURL:'mock',getContextSize:()=>8192,fetchBackend:async(url,o)=>{const q=JSON.parse(o.body);if(url.endsWith('tokencount'))return Response.json({value:100});n++;assert.match(q.prompt,/End on an in-world detail/);assert.doesNotMatch(q.prompt,/What do you do/);return Response.json({choices:[{text:n===1?'Mira waits by the door.\n\nWhat do you do?':'Mira rests a hand on the latch, listening to the footsteps outside.'}]});}});
  const result=await pipeline.generate({prompt:'',hero_writer:{prompt:'A traveller visits an inn.',text:'The room falls silent.',operation:'continue'}},null,{mode:'writer'});
  assert.equal(n,1);assert.match(result.choices[0].text,/What do you do/);assert.ok(result.writerContext.styleWarnings.includes('out-of-scene player prompt'));assert.equal(result.writerContext.generationPasses,1);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('Prose-first task analysis varies by operation, places current direction last and preserves Rocinante prefill',async()=>{
 const {buildNovelPrompt}=require('../manager/NovelWriter.cjs');
 for(const operation of ['continue','say','do','insert','rewrite']){
  const w={text:'Mira sets a sealed letter on the counter.\n\n',prompt:'A mystery at a riverside inn.',note:'Keep the reply quiet and observant.',persona:{name:'Rowan'},operation,instruction:'Retain the current scene.'};
  const r=await buildNovelPrompt(w,{model:{Template:'mistral-v3'},maxInputTokens:8192,countTokens:async t=>Math.ceil(t.length/4)});
  assert.ok(r.prompt.endsWith(w.text));assert.ok(r.prompt.indexOf('[Current writing task]')>r.prompt.indexOf('Keep the reply quiet'));
  assert.ok(!r.prompt.includes('[SYSTEM_PROMPT]'));assert.ok(!r.prompt.includes('<|im_start|>'));assert.ok(!r.prompt.includes('What do you do'));
  assert.equal(r.diagnostics.promptStrategy,'prose-first-v3');assert.equal(r.diagnostics.task,operation);
  if(operation==='say')assert.match(r.prompt,/addressed character’s answer/);
  if(operation==='do')assert.match(r.prompt,/external consequences/);
 }
});
test('Only verified generated player-turn cues are omitted from model context; stored text and authored passages stay intact',async()=>{
 const {buildNovelPrompt}=require('../manager/NovelWriter.cjs');
 const ai='Mira waits by the door.\n\nWhat do you do?\n\n',manual='What do you do?\n\n',text=ai+manual;
 const w={text,prompt:'A mystery at an inn.',generations:[{kind:'generated',start:0,end:ai.length,text:ai},{kind:'manual',operation:'say',start:ai.length,end:text.length,text:manual}]};
 const before=JSON.stringify(w),r=await buildNovelPrompt(w,{maxInputTokens:8192,countTokens:async t=>Math.ceil(t.length/4)});
 assert.equal(r.diagnostics.contextOnlyTurnCuesRemoved,1);assert.equal(r.tail.split('What do you do?').length-1,1);assert.equal(JSON.stringify(w),before);
 const edited=await buildNovelPrompt({...w,generations:[{...w.generations[0],text:'no longer matches'}]},{maxInputTokens:8192,countTokens:async t=>Math.ceil(t.length/4)});
 assert.equal(edited.diagnostics.contextOnlyTurnCuesRemoved,0);
});
