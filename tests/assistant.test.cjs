'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createAssistantWorkspace}=require('../manager/AssistantWorkspace.cjs');
const build=(root,{webFetch=async()=>{throw Error('Network unexpectedly accessed.')},replies=[]}={})=>{
 const requests=[];
 const agent=createAssistantWorkspace(root,{getModelProfile:()=>({Template:'chatml',Family:'Qwen3'}),modelName:()=> 'qwen3-8b-abliterated-Q4_K_M.gguf',contextSize:()=>32768,readGeneration:()=>({requestTimeoutSeconds:120}),
  ensureText:async()=>{},webFetch,fetchBackend:async(url,init)=>{requests.push(JSON.parse(init.body));return Response.json({choices:[{text:replies.shift()||'Test assistant answer.'}]})}});
 return {agent,requests};
};
test('Safe file import refuses paths and executable/binary files',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-assistant-files-'));try{
  const {agent}=build(root);
  assert.throws(()=>agent.importFile({name:'../../secret.txt',text:'Hi'}),/filename|directory/i);
  assert.throws(()=>agent.importFile({name:'bad.exe',text:'echo'}),/text formats/i);
  assert.throws(()=>agent.importFile({name:'readme.md',text:'a'.repeat(160000)}),/max/i);
  const saved=agent.importFile({name:'notes.md',text:'One paragraph.'});
  assert.equal(saved.file.revision,1);
  assert.ok(fs.existsSync(path.join(root,'AssistantWorkspace','Files',saved.file.id+'.json')));
  await assert.rejects(()=>agent.action('/assistant/file-edit',{fileId:saved.file.id,prompt:'Rewrite',mode:'fast'}),/complete delimited file/i);
  assert.equal(agent.getFile(saved.file.id).text,'One paragraph.');
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('Revisions require explicit confirmation; original external file is never overwritten',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-assistant-revision-'));try{
  const original=path.join(root,'outside.txt');fs.writeFileSync(original,'Original external disk data.');
  const {agent}=build(root,{replies:['<<<REVISED FILE>>>\n# Updated title\nRetained body.\n<<<END REVISED>>>']});
  const imported=agent.importFile({name:'notes.md',text:'# Old title\nRetained body.'});
  const proposal=await agent.action('/assistant/file-edit',{fileId:imported.file.id,prompt:'Change title only',mode:'fast'});
  assert.equal(proposal.changed,true);
  assert.equal(agent.getFile(imported.file.id).revision,1);
  assert.throws(()=>agent.apply({id:imported.file.id}),/Confirm/i);
  const result=agent.apply({id:imported.file.id,confirm:true});
  assert.equal(result.file.revision,2);
  assert.equal(fs.readFileSync(original,'utf8'),'Original external disk data.');
  const restored=await agent.action('/assistant/file-restore',{id:imported.file.id,revision:1,confirm:true});
  assert.equal(restored.file.text,'# Old title\nRetained body.');
  assert.equal(restored.file.revision,3);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('Deep Think is two inference passes, chat history persists between reloads',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-assistant-think-'));try{
  const {agent,requests}=build(root,{replies:['Checklist: define the problem, verify facts.','Final answer with checks.']});
  const reply=await agent.action('/assistant/message',{prompt:'How to optimize a Python script?',mode:'deep'});
  assert.equal(reply.planningPasses,2);assert.equal(requests.length,2);
  assert.equal(reply.answer,'Final answer with checks.');
  assert.equal(reply.chat.messages.length,2);
  assert.equal(createAssistantWorkspace(root).sessions().chat.messages.length,2);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('Selected text document is included only in local Qwen prompt, not outbound search query',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-assistant-document-'));
 let requestedURL='';
 try{
  const {agent,requests}=build(root,{replies:['The document mentions a blue banner.'],webFetch:async url=>{
   requestedURL=url;return Response.json({web:{results:[]}});
  }});
  const file=agent.importFile({name:'notes.md',text:'A blue banner flies above the gate.'}).file;
  const r=await agent.action('/assistant/message',{prompt:'What colour is the banner?',fileId:file.id,web:true,apiKey:'search-key-12345678'});
  assert.match(requests[0].prompt,/blue banner flies/);
  assert.equal(r.answer,'The document mentions a blue banner.');
  assert.ok(!requestedURL.includes('blue+banner'));
  assert.ok(!JSON.stringify(r.chat.messages).includes('flies above the gate'));
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('JSON edits are validated before a draft can be applied',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-assistant-json-'));
 try{
  const {agent}=build(root,{replies:['<<<REVISED FILE>>>\n{broken json}\n<<<END REVISED>>>']});
  const file=agent.importFile({name:'config.json',text:'{"enabled":true}'}).file;
  await assert.rejects(()=>agent.action('/assistant/file-edit',{fileId:file.id,prompt:'Fix naming',mode:'fast'}),/invalid syntax/i);
  assert.equal(agent.getFile(file.id).text,'{"enabled":true}');
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('Search requires explicit key and never sends workspace file content; sources link to HTTPS only',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-assistant-search-'));let seen;
 try{
  const {agent}=build(root,{webFetch:async(url,opts)=>{
   seen={url,headers:opts.headers};
   return Response.json({web:{results:[{title:'Official docs',url:'https://example.org/guide',description:'Documentation excerpt.'},{title:'Unsafe',url:'http://insecure.example',description:'excluded'}]}});
  },replies:['Answer backed by [1].']});
  await assert.rejects(()=>agent.action('/assistant/message',{prompt:'Research a topic',web:true}),/key/i);
  const answer=await agent.action('/assistant/message',{prompt:'Research a topic',web:true,apiKey:'brave-test-12345678'});
  assert.equal(answer.sources.length,1);assert.equal(answer.sources[0].url,'https://example.org/guide');
  assert.ok(seen.url.includes('q=Research+a+topic'));
  assert.equal(seen.headers['X-Subscription-Token'],'brave-test-12345678');
  assert.ok(!JSON.stringify(agent.snapshot()).includes('brave-test-12345678'));
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
