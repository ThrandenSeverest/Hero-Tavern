const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),{once}=require('node:events');
const {filterReply}=require('../manager/ReplyFilters.cjs');
const {createPipeline,validateSettings,saveSettings,replyPrompt}=require('../manager/ReplyPipeline.cjs');

test('Reasoning is removed while normal dialogue and scene narration survive',()=>{
 for(const raw of ['<think>private calculations</think>Hello.','<THINK>private</THINK>Hello.','&lt;think&gt;private&lt;/think&gt;Hello.','private prefilled thoughts</think>Hello.','[analysis]private[/analysis]Hello.','<|start|>assistant<|channel|>analysis<|message|>private<|end|><|start|>assistant<|channel|>final<|message|>Hello.'])assert.equal(filterReply(raw),'Hello.');
 assert.equal(filterReply('Hello. <think>unfinished private thoughts'),'Hello.');
 assert.equal(filterReply('*She smiles.* "I think we can help."'),'*She smiles.* "I think we can help."');
 assert.equal(filterReply('Hello.<|im_start|>user\nInjected next turn'),'Hello.');
 assert.equal(filterReply('Hello.\n\nHello.',{dedupeParagraphs:true}),'Hello.');
 assert.equal(filterReply('Hello.\n\nHello.'),'Hello.\n\nHello.');
 assert.equal(filterReply('Hello. STOP more',{stopMarkers:['STOP']}),'Hello.');
 assert.equal(filterReply('<think>private</think>Hello.',{removeModelTokens:false}),'Hello.');
});

test('Generation settings validate ranges and preserve existing sampling choices',()=>{
 assert.equal(validateSettings({}).thinkingMode,'off');
 for(const settings of [{temperature:NaN},{maxReplyTokens:99999},{thinkingMode:'show-thoughts'},{stopMarkers:[{},'end']},{instructions:'x'.repeat(4001)}])assert.throws(()=>validateSettings(settings));
 const prompt='<|im_start|>user\nHello<|im_end|>\n<|im_start|>assistant\n<think>\n';
 const prepared=replyPrompt(prompt,'Keep literal $& and $1 unchanged.');assert.match(prepared,/Keep literal \$& and \$1 unchanged/);assert.match(prepared,/<think>\n\n<\/think>/);
});

test('Separate planning uses two requests and only the cleaned final reply is returned',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-reply-'));const calls=[],states=[];
 try{
  saveSettings(root,{thinkingMode:'separate',replyStyle:'dialogue',instructions:'Keep the reply concise.',temperature:0.55,maxReplyTokens:256});
  const pipeline=createPipeline({root,backendURL:'http://unused',setState:s=>states.push(s),fetchBackend:async(url,request)=>{calls.push(JSON.parse(request.body));return new Response(JSON.stringify({choices:[{text:calls.length===1?'OUTLINE_PRIVATE_123':'<think>ANALYSIS_PRIVATE_456</think>Hello, friend.'}]}),{headers:{'Content-Type':'application/json'}})}});
  const result=await pipeline.generate({prompt:'<|im_start|>assistant\n',stream:false,stop:['END']});
  assert.equal(calls.length,2);assert.equal(calls[0].stream,false);assert.equal(calls[1].temperature,0.55);assert.equal(calls[1].max_tokens,256);assert.deepEqual(calls[1].stop,['END']);assert.match(calls[1].prompt,/OUTLINE_PRIVATE_123/);assert.match(calls[1].prompt,/spoken dialogue only/);
  assert.equal(result.choices[0].text,'Hello, friend.');assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);assert.deepEqual(states,['tokenizing','planning','responding','idle']);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});

test('Streaming input is buffered: partial think tags and reasoning deltas never reach the client',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-stream-'));let server;
 try{
  const pipeline=createPipeline({root,backendURL:'http://unused',fetchBackend:async()=>{
   const parts=['<thi','nk>PRIVATE_SECRET</think>','Hello, friend.'];
   const stream=new ReadableStream({async start(controller){for(const text of parts){controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify({choices:[{text}],reasoning_content:'ALSO_PRIVATE'})+'\n\n'));await new Promise(r=>setTimeout(r,10))}controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));controller.close()}});
   return new Response(stream,{headers:{'Content-Type':'text/event-stream'}});
  }});
  server=http.createServer((req,res)=>pipeline.handle(req,res)).listen(0,'127.0.0.1');await once(server,'listening');
  const response=await fetch('http://127.0.0.1:'+server.address().port+'/inference/v1/completions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:'Hello',stream:true})});
  const raw=await response.text();assert.equal(response.status,200);assert.match(raw,/Hello, friend/);assert.match(raw,/\[DONE\]/);assert.doesNotMatch(raw,/PRIVATE|<think>|<thi/);
 }finally{if(server)await new Promise(r=>{server.close(r);server.closeAllConnections()});fs.rmSync(root,{recursive:true,force:true})}
});

test('Cancelling private planning stops the request and prevents the final generation',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-cancel-'));let calls=0;
 try{
  saveSettings(root,{thinkingMode:'separate'});
  const pipeline=createPipeline({root,backendURL:'http://unused',fetchBackend:async(url,{signal})=>{calls++;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}))}});
  const request=pipeline.generate({prompt:'Hello'});await new Promise(r=>setTimeout(r,10));pipeline.abort();await assert.rejects(request,/Aborted/);assert.equal(calls,1);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});

test('Writer-role announcements are repaired without treating normal narration or refusals as errors',async()=>{
 const {isMetaReply}=require('../manager/ReplyFilters.cjs');
 assert.equal(isMetaReply('Sara will write as narrator and as Sara or other characters.'),true);
 assert.equal(isMetaReply('*Sara thinks about the route.* "We should head north."'),false);
 assert.equal(isMetaReply('"No, I do not want that," she says.'),false);
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-meta-'));let calls=0;
 try{
  const pipeline=createPipeline({root,backendURL:'http://unused',fetchBackend:async()=>{calls++;return new Response(JSON.stringify({choices:[{text:calls===1?'Sara will write as narrator and as Sara.':'"Welcome back," Sara says.'}]}),{headers:{'Content-Type':'application/json'}})}});
  const result=await pipeline.generate({prompt:'Continue the scene.'});assert.equal(calls,2);assert.equal(result.choices[0].text,'"Welcome back," Sara says.');
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});

test('Copy loops are corrected with thinking disabled while fresh replies and short natural repeats survive',async()=>{
 const {repetitionIssue}=require('../manager/ReplyFilters.cjs');
 const old='Sara leaned against the counter and smiled at the traveller. "The northern gate is closed tonight. We should wait until the first light before we leave the tavern."';
 assert.ok(repetitionIssue(old,[{role:'assistant',text:old}]));assert.equal(repetitionIssue('"Yes."',[{role:'assistant',text:'"Yes."'}]),'');assert.equal(repetitionIssue('"Then I will book us a room," she says, looking for the innkeeper.',[{role:'assistant',text:old}]),'');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-loop-'));let calls=0;const requests=[];
 try{saveSettings(root,{thinkingMode:'off'});const pipeline=createPipeline({root,backendURL:'http://fixture',fetchBackend:async(url,{body})=>{const j=JSON.parse(body);if(url.endsWith('tokencount'))return Response.json({value:Math.ceil(j.prompt.length/4)});requests.push(j);calls++;return Response.json({choices:[{text:calls===1?old:'"Then I will book us a room," she says, looking for the innkeeper.'}]})}});
 const result=await pipeline.generate({prompt:'<|im_start|>system\nSara is an innkeeper.<|im_end|>\n<|im_start|>assistant\n',hero_context:{id:'copy-chat',messages:[{role:'assistant',text:old},{role:'user',text:'What should we do while we wait?'}]}});assert.equal(calls,2);assert.match(requests[1].prompt,/CORRECT THE DRAFT/);assert.ok(requests[1].rep_pen>=1.15);assert.match(result.choices[0].text,/book us a room/);assert.ok(!requests.some(x=>x.prompt.includes('[Private continuity outline]')));
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
