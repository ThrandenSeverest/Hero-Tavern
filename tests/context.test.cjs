const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createMemory,readMemory,editMemory}=require('../manager/ContextMemory.cjs');
const {createPipeline,saveSettings}=require('../manager/ReplyPipeline.cjs');
test('Full chronological chat survives a truncated native prompt and memory is scoped to each chat',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-context-'));const requests=[];
 try{const pipeline=createPipeline({root,backendURL:'http://fixture',fetchBackend:async(url,{body})=>{const j=JSON.parse(body);if(url.endsWith('tokencount'))return Response.json({value:Math.ceil(j.prompt.length/4)});requests.push(j);return Response.json({choices:[{text:'We agreed on blue.'}]})}});
 const result=await pipeline.generate({prompt:'<|im_start|>system\nSara is a tailor.<|im_end|>\n<|im_start|>user\nWhat did we choose?<|im_end|>\n<|im_start|>assistant\n',hero_context:{id:'sara-chat-one',messages:[{role:'user',name:'Player',text:'The cloak should be blue.'},{role:'assistant',name:'Sara',text:'Agreed, a blue cloak.'},{role:'user',name:'Player',text:'What did we choose?'}]}});
 assert.match(requests.at(-1).prompt,/cloak should be blue[\s\S]*Agreed, a blue cloak[\s\S]*What did we choose/);assert.equal(result.choices[0].text,'We agreed on blue.');assert.equal(requests.at(-1).hero_context,undefined);assert.equal(readMemory(root,'different-chat').summary,'');
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('Oversized history summarizes old turns, preserves newest turns, rebuilds after edits and never mutates input',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-summary-'));const messages=Array.from({length:20},(_,i)=>({role:i%2?'assistant':'user',name:'Speaker',text:'Turn '+i+': '+('long event '.repeat(20))}));const original=JSON.stringify(messages);let calls=0,diagnostics;
 try{const memory=createMemory({root,countTokens:async s=>s.length,complete:async()=>{calls++;return 'Established: a blue cloak was promised.'},setDiagnostics:value=>diagnostics=value});
 const body={prompt:'<|im_start|>system\nCharacter and world facts.<|im_end|>\n<|im_start|>user\ntruncated<|im_end|>\n<|im_start|>assistant\n',hero_context:{id:'one',messages}},settings={memoryEnabled:true,memoryTokens:128,recentMessages:4};
 const result=await memory.prepare(body,1800,settings);assert.match(result,/blue cloak/);assert.match(result,/Turn 19/);assert.ok(diagnostics.promptTokens<=1800);assert.ok(diagnostics.summarizedMessages>0);assert.equal(JSON.stringify(messages),original);
 const count=calls;await memory.prepare(body,1800,settings);assert.equal(calls,count);messages[0].text='EDITED: cloak is green.';await memory.prepare(body,1800,settings);assert.ok(calls>count);
 editMemory(root,'one',{notes:'The cloak must be green.',reset:true});assert.equal(readMemory(root,'one').summary,'');assert.equal(readMemory(root,'one').notes,'The cloak must be green.');
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('Context guard stops overflowing cards instead of sending a silently truncated request',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-overflow-'));let sent=0;
 try{saveSettings(root,{});const pipeline=createPipeline({root,backendURL:'http://fixture',enforceContext:true,fetchBackend:async(url,{body})=>{if(url.endsWith('tokencount'))return Response.json({value:JSON.parse(body).prompt.length});sent++;return Response.json({choices:[{text:'wrong'}]})}});await assert.rejects(pipeline.generate({prompt:'x'.repeat(5000)}),/exceeds the loaded context/);assert.equal(sent,0)}finally{fs.rmSync(root,{recursive:true,force:true})}
});
