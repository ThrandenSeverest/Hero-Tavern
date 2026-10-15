'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {createWriterAPI}=require('../manager/WriterAPI.cjs');
const source=fs.readFileSync(path.join(__dirname,'../extension/story.js'),'utf8');
test('Character Voice stays renderable when TTS status is slow',()=>{
 assert.match(source,/Promise\.race\(\[/);
 assert.match(source,/Voice service is slow or offline/);
 assert.ok(source.indexOf("dialog('Voice · '")<source.indexOf("rpc('/tts/status')"));
});
test('Writer next-scene advances one beat ONLY after successful save',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-scene-next-'));
 try{
  const seen=[];const pipeline={generate:async(body)=>{seen.push(body.hero_writer.beatIndex);return {choices:[{text:' The captain enters the courtyard and changes the plan.'}]}}};
  const api=createWriterAPI(root,pipeline,{ensureText:async()=>{}});
  const story=api.store.create({title:'Scene',prompt:'There is a castle.',text:'The guard waits.',beats:['First arrival.','The captain interrupts.','A new decision.'],beatIndex:0});
  const first=await api.action('/writer/api/generate',{id:story.id,expectedVersion:story.version,operation:'advance'});
  assert.equal(first.nextBeatIndex,1);assert.equal(seen.at(-1),1);
  assert.equal(api.store.read(story.id).beatIndex,0,'preview cannot consume a beat');
  const accepted=await api.action('/writer/api/accept',{id:story.id,candidateId:first.id});
  assert.equal(accepted.beatIndex,1);
  const continued=await api.action('/writer/api/generate-apply',{id:story.id,expectedVersion:accepted.version,operation:'continue'});
  assert.equal(continued.story.beatIndex,1,'Continue preserves the current beat');
  const advanced=await api.action('/writer/api/generate-apply',{id:story.id,expectedVersion:continued.story.version,operation:'advance'});
  assert.equal(advanced.story.beatIndex,2);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
