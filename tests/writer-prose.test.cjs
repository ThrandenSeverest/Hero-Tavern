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
test('writer rejects two consecutive explanatory drafts instead of offering them for Accept',async()=>{
 const root=tmp();let n=0;
 try{const pipeline=createPipeline({root,backendURL:'mock',getContextSize:()=>8192,fetchBackend:async(url,o)=>{
  const payload=JSON.parse(o.body);
  if(url.endsWith('/tokencount'))return Response.json({value:Math.ceil(payload.prompt.length/4)});
  n++;return Response.json({choices:[{text:'I understand I need to continue this scenario based on the instructions. Let me start by describing Lesya’s appearance:'}]});
 }});
 await assert.rejects(pipeline.generate({prompt:'',writerSettings:{maxReplyTokens:256},hero_writer:{text:'',prompt:'Lesya arrives at an inn.',memory:'',note:'',lore:[],operation:'continue'}},undefined,{mode:'writer'}),/could not produce a prose continuation/);
 assert.equal(n,2);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('writer preserves a valid narrative candidate without a repair pass',async()=>{
 const root=tmp();let n=0;
 try{const pipeline=createPipeline({root,backendURL:'mock',getContextSize:()=>8192,fetchBackend:async(url,o)=>{
  const payload=JSON.parse(o.body);
  if(url.endsWith('/tokencount'))return Response.json({value:Math.ceil(payload.prompt.length/4)});
  n++;return Response.json({choices:[{text:'The tavern door creaked open. Lesya looked up from the hearth.'}]});
 }});
 const r=await pipeline.generate({prompt:'',hero_writer:{text:'',prompt:'Lesya arrives at an inn.',memory:'',note:'',lore:[],operation:'continue'}},undefined,{mode:'writer'});
 assert.match(r.choices[0].text,/tavern door creaked/);assert.equal(n,1);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
