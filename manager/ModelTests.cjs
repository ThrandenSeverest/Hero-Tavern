'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {imagePromptHash}=require('./ImageRequest.cjs');
const PRESETS=Object.freeze({
 text2text:{label:'Text → Text',model:'loaded KoboldCpp text model',prompt:'Output exactly the following text, with no introduction or extra characters: BLUE LANTERN',expected:'BLUE LANTERN'},
 text2image:{label:'Text → Image',model:'selected image model',prompt:'A single RED ceramic teapot standing on a WHITE marble table. Bright daylight, simple clean composition, no humans, no lettering. The teapot is the only subject.',secondPrompt:'A single GREEN frog sitting in a TRANSPARENT glass bowl against a BLUE backdrop. No people, no teapot, no lettering.',width:768,height:768,steps:24,seed:-1,refine:false,preset:'raw'},
 image2image:{label:'Image → Image',model:'selected edit-capable image model',prompt:'Edit the supplied image: change the main object to vivid BLUE. Preserve the original composition, viewpoint and background; change its color clearly.',width:768,height:768,steps:24,seed:-1,denoise:0.7,refine:false,preset:'raw'},
 image2text:{label:'Image → Text',model:'loaded local vision model + projector',question:'Describe the visible main subject and its color, composition, and surroundings in two factual sentences. Do not explain your task.'}
});
const kinds=[...Object.keys(PRESETS),'tracker','writer-agency','character-long'];
const GALLERY=/^\d{12,17}-[a-f0-9]{8,24}\.png$/;
function imageStats(bytes){
 if(bytes.length<50||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('Output is not a valid PNG.');
 let i=8,width=0,height=0,bits=0,type=0,parts=[],palette=null;
 while(i+12<=bytes.length){
  const len=bytes.readUInt32BE(i),name=bytes.toString('ascii',i+4,i+8),end=i+12+len;
  if(end>bytes.length||len>75000000)throw Error('Malformed PNG chunk.');
  if(name==='IHDR'){width=bytes.readUInt32BE(i+8);height=bytes.readUInt32BE(i+12);bits=bytes[i+16];type=bytes[i+17];}
  if(name==='IDAT')parts.push(bytes.subarray(i+8,i+8+len));
  if(name==='PLTE')palette=bytes.subarray(i+8,i+8+len);
  i=end;if(name==='IEND')break;
 }
 if(!width||!height||width>4096||height>4096||!parts.length)throw Error('PNG has invalid dimensions or no image data.');
 const channels={0:1,2:3,3:1,4:2,6:4}[type],fingerprint=[];
 if(bits===8&&channels&&width*height*channels<77000000){
  try{
   const row=width*channels,raw=zlib.inflateSync(Buffer.concat(parts),{maxOutputLength:(row+1)*height+1024});
   if(raw.length<(row+1)*height)throw Error('PNG data incomplete.');
   const columns=8,rows=8,bins=Array.from({length:columns*rows},()=>[0,0,0,0]),prior=Buffer.alloc(row);
   let o=0;
   for(let y=0;y<height;y++){
    const filter=raw[o++],decoded=Buffer.allocUnsafe(row);
    for(let x=0;x<row;x++){
     const up=prior[x],left=x>=channels?decoded[x-channels]:0,upperLeft=x>=channels?prior[x-channels]:0;
     let predictor=0;
     if(filter===1)predictor=left;else if(filter===2)predictor=up;
     else if(filter===3)predictor=Math.floor((left+up)/2);
     else if(filter===4){const p=left+up-upperLeft,a=Math.abs(p-left),b=Math.abs(p-up),c=Math.abs(p-upperLeft);predictor=a<=b&&a<=c?left:b<=c?up:upperLeft;}
     else if(filter!==0)throw Error('Unsupported PNG filter.');
     decoded[x]=(raw[o++]+predictor)&255;
    }
    // Compute coarse spatial color fingerprint. This catches nearly identical
    // pictures despite metadata, different compression or renamed output files.
    for(let x=0;x<width;x+=Math.max(1,Math.floor(width/120))){
     let rgb;
     const k=x*channels;
     if(type===2||type===6)rgb=[decoded[k],decoded[k+1],decoded[k+2]];
     else if(type===3&&palette)rgb=[palette[decoded[k]*3]||0,palette[decoded[k]*3+1]||0,palette[decoded[k]*3+2]||0];
     else rgb=[decoded[k],decoded[k],decoded[k]];
     const box=Math.min(7,Math.floor(y*8/height))*8+Math.min(7,Math.floor(x*8/width));
     const bin=bins[box];for(let c=0;c<3;c++)bin[c]+=rgb[c];bin[3]++;
    }
    decoded.copy(prior);
   }
   for(const bin of bins)for(let k=0;k<3;k++)fingerprint.push(bin[3]?Math.round(bin[k]/bin[3]):0);
  }catch(e){return {width,height,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),decodeWarning:e.message};}
 }
 return {width,height,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),colorFingerprint:fingerprint};
}
function distance(a,b){
 if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length||!a.length)return null;
 return Math.round(a.reduce((sum,x,i)=>sum+Math.abs(x-b[i]),0)/a.length*100)/100;
}
function createModelTests(root){
 const folder=path.join(root,'Diagnostics'),journal=path.join(folder,'model-tests.json');
 fs.mkdirSync(folder,{recursive:true});
 function history(){try{const value=JSON.parse(fs.readFileSync(journal,'utf8'));return Array.isArray(value)?value.slice(-120):[]}catch{return []}}
 function record(input){
  if(!input||!kinds.includes(input.kind))throw Error('Unknown model test.');
  if(!['passed','warning','failed','skipped'].includes(input.status))throw Error('Invalid test status.');
  if(typeof input.model!=='string'||input.model.length>200)throw Error('Invalid tested model.');
  const previous=history(),entry={id:crypto.randomUUID(),at:new Date().toISOString(),kind:input.kind,model:input.model,suiteId:typeof input.suiteId==='string'&&/^compare-[0-9]{10,16}$/.test(input.suiteId)?input.suiteId:null,status:input.status,elapsedMs:Number.isFinite(Number(input.elapsedMs))?Math.max(0,Math.round(Number(input.elapsedMs))):null,prompt:String(input.prompt||'').slice(0,5000),settings:input.settings&&typeof input.settings==='object'?input.settings:{},notes:Array.isArray(input.notes)?input.notes.slice(0,8).map(n=>String(n).slice(0,400)):[],text:String(input.text||'').slice(0,12000)};
  if(input.error){entry.error=String(input.error).slice(0,1500);entry.status='failed';}
  if(input.workflow&&['tracker','writer-agency','character-long'].includes(input.kind)){const serialized=JSON.stringify(input.workflow);if(serialized.length>250000)throw Error('Workflow report too large.');entry.workflow=JSON.parse(serialized);}
  if(input.kind==='text2text'){
   if(!entry.error){
    const raw=entry.text.trim();
    if(raw!==PRESETS.text2text.expected){entry.status='warning';entry.notes.push('Expected exact text "'+PRESETS.text2text.expected+'"; received '+JSON.stringify(raw.slice(0,180))+'.');}
    else entry.notes.push('Exact instruction-following text matched.');
   }
  }
  if(input.kind==='image2text'&&!entry.text.trim()&&!entry.error){entry.status='failed';entry.notes.push('Vision model returned an empty description.');}
  if(['text2image','image2image'].includes(input.kind)&&entry.status!=='skipped'&&!entry.error){
   const name=String(input.imageName||'');
   if(!GALLERY.test(name))throw Error('Model test image must be a saved Hero Tavern gallery PNG.');
   const filename=path.join(root,'Images',name),raw=fs.readFileSync(filename);
   const stats=imageStats(raw);entry.imageName=name;entry.image=stats;
   entry.promptHash=imagePromptHash(entry.prompt);
   const older=[...previous].reverse().find(x=>x.kind===input.kind&&x.model===entry.model&&x.image);
   if(older){
    const differ=older.promptHash!==entry.promptHash||older.settings?.seed!==entry.settings.seed;
    const identical=older.image.sha256===stats.sha256;
    const delta=distance(older.image.colorFingerprint,stats.colorFingerprint);
    entry.comparison={previousId:older.id,identicalBytes:identical,meanColorDifference:delta};
    if(differ&&identical){entry.status='failed';entry.notes.push('Byte-identical PNG despite a changed prompt or seed: possible stale output/cache or disconnected conditioning.');}
    else if(differ&&delta!==null&&delta<5){entry.status=entry.status==='failed'?'failed':'warning';entry.notes.push('Very similar spatial color fingerprint despite changed prompt/seed. Inspect images side-by-side for stuck conditioning.');}
   }
   if(stats.decodeWarning)entry.notes.push('PNG decode could not be fully analyzed: '+stats.decodeWarning);
   else if(stats.colorFingerprint&&new Set(stats.colorFingerprint).size<7){entry.status=entry.status==='failed'?'failed':'warning';entry.notes.push('Unusually flat/low-detail color distribution; inspect for blank output.');}
  }
  previous.push(entry);
  fs.writeFileSync(journal,JSON.stringify(previous.slice(-120),null,2));
  return entry;
 }
 return {presets:()=>PRESETS,history,record};
}
module.exports={PRESETS,imageStats,distance,createModelTests};
// Exercise production pipelines on disposable stories, never a user's saves.
const WORKFLOW_KINDS=['tracker','writer-agency','character-long'];
function agencyFindings(text,name='Rowan'){
 const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const subject='(?:'+escaped+'|you|\\{\\{user\\}\\})';
 const patterns=[
  ['player speech',new RegExp('\\b'+subject+'\\s+(?:(?:quietly|softly|then)\\s+)?(?:say|says|said|ask|asks|asked|reply|replies|replied|whisper|whispers|whispered|shout|shouts|shouted)\\b','gi')],
  ['player action or thought',new RegExp('\\b'+subject+'\\s+(?:(?:quietly|slowly|then)\\s+)?(?:decide[sd]?|think[s]?|thought|feel[s]?|felt|nod[s]?|nodded|smile[sd]?|walk[s]?|walked|step[s]?|stepped|reach(?:es|ed)?|agree[sd]?|accept[sd]?|take[s]?|took|open[s]?|opened|turn[s]?|turned)\\b','gi')],
  ['unresolved player placeholder',/\{\{user\}\}/gi]
 ];
 const findings=[];for(const [rule,re] of patterns)for(const match of text.matchAll(re)){
  // Questions addressed to the player do not assert the player's thoughts or
  // actions. Limit this exemption to the matched clause, so a later question
  // cannot hide an earlier invented action.
  if(/^you\b/i.test(match[0])){
   const end=text.slice(match.index).search(/[.!?\n]/);
   const before=text.slice(Math.max(0,match.index-25),match.index);
   if(end>=0&&text[match.index+end]==='?'||/\b(?:do|don't|did|didn't|would|could|can|will|should)\s+$/i.test(before))continue;
  }
  findings.push({rule,evidence:text.slice(Math.max(0,match.index-45),match.index+match[0].length+100)});
 }
 return findings.slice(0,30);
}
function passageChecks(text,{expected=[],minWords=180,minParagraphs=3}={}){
 const words=(text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)||[]).length;
 const paragraphs=text.trim()?text.trim().split(/\n\s*\n/).filter(Boolean).length:0;
 const missing=expected.filter(x=>!text.toLowerCase().includes(x.toLowerCase()));
 return {words,paragraphs,minWords,minParagraphs,missing,passed:!!text.trim()&&words>=minWords&&paragraphs>=minParagraphs&&!missing.length};
}
async function runWorkflowTest({kind,makePipeline,settings={},contextSize=8192,signal}){
 if(!WORKFLOW_KINDS.includes(kind))throw Error('Unknown workflow diagnostic.');
 const os=require('node:os'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'hero-workflow-'));
 const report={kind,status:'passed',startedAt:new Date().toISOString(),stages:[],notes:[],contextSize,automaticOnly:true};
 let context=null;const started=Date.now();
 const ensureActive=()=>{if(signal?.aborted)throw Error('Workflow diagnostic cancelled.');};
 try{
  const {saveSettings}=require('./ReplyPipeline.cjs');
  // Local diagnostic overrides are written only to the disposable root.
  report.settings=saveSettings(temp,{...settings,maxReplyTokens:1024,replyStyle:'mixed',memoryEnabled:true,recentMessages:100,instructions:kind==='tracker'?'Answer the latest state verification question directly from confirmed values. Do not invent a new scene.':'Write at least three substantial paragraphs, about 220–350 words. Preserve established scene facts. Do not speak or act for the player.'});
  let storyContext=()=>null;
  const pipeline=makePipeline(temp,value=>{context=value},(id,query)=>storyContext(id,query));
  const complete=async(body,mode='chat')=>{ensureActive();const at=Date.now();const result=await pipeline.generate(body,signal,{mode});return {text:String(result.choices?.[0]?.text||''),usage:result.usage,context:context?{...context}:null,planningRejected:pipeline.runSnapshot()?.planningRejected||null,writerContext:result.writerContext||null,elapsedMs:Date.now()-at};};
  if(kind==='tracker'){
   const {createStoryStore}=require('./StoryStore.cjs'),{createStoryAPI}=require('./StoryAPI.cjs'),W=require('./WTracker.cjs');
   const folder=path.join(temp,'SillyTavern/data/default-user/chats/Mira');fs.mkdirSync(folder,{recursive:true});
   const file=path.join(folder,'Diagnostic.jsonl'),loc={avatar:'Mira.png',filename:'Diagnostic'};
   fs.writeFileSync(file,[{character_name:'Mira',chat_metadata:{}},{name:'Mira',mes:'Mira arrives at Stonebridge with exactly 12 coins. The town clock reads 09:15.',is_user:false,extra:{}}].map(JSON.stringify).join('\n')+'\n');
   const store=createStoryStore(temp),view=store.sync(loc),id=view.session.id,session=store.get(id);
   storyContext=(sessionId,query)=>store.view(sessionId,query).context;
   const owner='character:'+session.characterId;
   session.definitions=[['location','text','Unknown'],['coins','number',0],['clock','clock','--:--']].map(([id,type,initialValue])=>W.validateDefinition({id,type,initialValue,owner,label:id,updateMode:'automatic',alwaysInject:true}));
   session.events=[];store.saveSession(session);
   const snapshots=[];const api=createStoryAPI(store,{generate:async(...args)=>{const result=await pipeline.generate(...args);snapshots.push(String(result.choices?.[0]?.text||''));return result;}},{contextSize:()=>contextSize});
   for(const [label,narration,expected] of [
    ['Initial extraction',null,{location:'Stonebridge',coins:12,clock:'09:15'}],
    ['Update after a new passage','Mira leaves Stonebridge and enters Oak Inn. After paying 3 coins, she has exactly 9 coins left. The inn clock reads 09:30.',{location:'Oak Inn',coins:9,clock:'09:30'}]
   ]){
    ensureActive();
    if(narration){const old=store.view(id);fs.writeFileSync(file,[old.header,...old.messages,{name:'Mira',mes:narration,is_user:false,extra:{}}].map(JSON.stringify).join('\n')+'\n');store.sync(loc);}
    const before=fs.readFileSync(file,'utf8'),at=Date.now();let updated=await api.action('/story/analyze',{id},signal);
    const actual=Object.fromEntries(Object.keys(expected).map(key=>[key,updated.context.state[owner+':'+key]]));
    const checks=Object.entries(expected).map(([key,value])=>({check:key,expected:value,actual:actual[key],passed:key==='location'?String(actual[key]).toLowerCase().includes(value.toLowerCase()):actual[key]===value}));
    const reopened=createStoryStore(temp).view(id);
    checks.push({check:'Saved state survives reopening',passed:JSON.stringify(updated.context.state)===JSON.stringify(reopened.context.state)});
    checks.push({check:'Confirmed state appears in next reply context',passed:reopened.context.text.includes(String(expected.location))&&reopened.context.text.includes(String(expected.coins))});
    checks.push({check:'Chat text preserved',passed:before===fs.readFileSync(file,'utf8')});
    checks.push({check:'Extraction completed with real model request',passed:updated.session.lastAnalysis?.modelUsed===true&&!updated.session.lastAnalysis?.partial});
    report.stages.push({label,status:checks.every(c=>c.passed)?'passed':'failed',checks,actual,modelOutput:snapshots.at(-1)||'',analysis:updated.session.lastAnalysis,elapsedMs:Date.now()-at});
   }
   const question='What are Mira’s confirmed location, remaining coins and clock time? Copy the exact saved location and HH:mm time, and write the coin count as a digit. Do not change the scene.';
   const result=await complete({prompt:'<|im_start|>system\nRead confirmed state for this isolated diagnostic.<|im_end|>\n<|im_start|>assistant\n',hero_context:{id,sessionId:id,messages:[{role:'user',text:question}],oneReply:'Verify the saved tracker values exactly, without inventing new events.'},stream:false});
   const checks=passageChecks(result.text,{expected:['Oak Inn','9','09:30'],minWords:1,minParagraphs:1});
   report.stages.push({label:'Next reply uses saved tracker state',status:checks.passed?'passed':'failed',...result,checks});
   if(!checks.passed)report.notes.push('Extraction and persistence are checked separately above. Reply grounding failed: missing '+checks.missing.join(', ')+'.');
  }else if(kind==='writer-agency'){
   report.notes.push('Agency detection is an English heuristic. Review the saved outputs; a clean scan does not prove that every player action was avoided.');
   const cases=[
    ['Player speech','say','Rowan says, "What happened to the bridge?"\n\n', 'Mira answers Rowan’s question; leave Rowan’s next words and choices unwritten.'],
    ['Player action','do','Rowan places a sealed map on the desk.\n\n', 'Mira examines the map and reacts; leave Rowan’s next actions and thoughts unwritten.'],
    ['Open decision','continue','Mira holds out two sealed letters, awaiting Rowan’s choice.\n\n', 'Describe Mira and the surroundings while the choice remains with Rowan.']
   ];
   for(const [label,operation,text,note] of cases){
    const body={prompt:'',hero_writer:{text,prompt:'A quiet mystery in a riverside inn. Mira is the innkeeper. Rowan is the player, controlled only by the author.',persona:{name:'Rowan',description:'The player-controlled traveller; {{user}} refers to Rowan.'},operation,note,settings:{protectPlayerSpeech:true,protectPlayerActions:true,finishSentences:true}},writerSettings:{maxReplyTokens:1024,protectPlayerSpeech:true,protectPlayerActions:true}};
    const result=await complete(body,'writer'),findings=agencyFindings(result.text),checks=passageChecks(result.text,{minWords:80,minParagraphs:1}),styleWarnings=result.writerContext?.styleWarnings||[];
    report.stages.push({label,status:!result.text.trim()||findings.length?'failed':checks.passed&&!styleWarnings.length?'passed':'warning',styleWarnings,agencyStatus:findings.length?'failed':'passed',lengthStatus:checks.passed?'passed':'warning',...result,findings,checks,input:body.hero_writer});
    if(styleWarnings.length)report.notes.push(label+': '+styleWarnings.join('; ')+'. Output retained without automatic regeneration.');
    if(!checks.passed)report.notes.push(label+': reply length '+checks.words+' words; threshold '+checks.minWords+'. Player-agency findings: '+findings.length+'.');
   }
  }else{
   report.notes.push('Three sequential character replies use actual prior generated replies. Longer responses require at least 180 words and three paragraphs each.');
   const messages=[{role:'user',text:'Our boat is named Silver Heron. The package contains ember glass. We must deliver it to the bell tower before dusk.'},{role:'assistant',name:'Mira',text:'I have recorded the boat, cargo and destination in my journal.'}];
   const entries=Array.from({length:48},(_,i)=>({role:i%2?'assistant':'user',text:`Travel journal entry ${i+1}: We pass landmark ${i+1}, inspect the quay, discuss the weather, and compare the route with the harbour map. The ferryman checks his ropes and the market stalls close in turn. No one changes our boat, cargo, or destination.`}));
   messages.push(...entries);
   const prompts=[['Boat','Mira, explain your plan for preparing our boat for departure. Include its established name.',['Silver Heron']],['Cargo','Mira, describe how you will keep our established cargo safe during the crossing. Name it.',['ember glass']],['Destination','Mira, plan the final delivery. Name our original destination and explain the next obstacle.',['bell tower']]];
   for(const [label,question,expected] of prompts){
    messages.push({role:'user',text:question+' Respond in at least three substantial paragraphs, 220–350 words, without deciding or speaking for Rowan.'});
    const body={prompt:'<|im_start|>system\nIsolated character diagnostic: Mira is a practical river guide. Rowan is the player.<|im_end|>\n<|im_start|>assistant\n',hero_context:{id:'diagnostic-character',messages:messages.map(x=>({...x})),character:{name:'Mira',description:'An experienced river guide, calm and observant.'},generationType:'normal'},stream:false};
    const result=await complete(body),checks=passageChecks(result.text,{expected}),findings=agencyFindings(result.text);
    const longContext=(result.usage?.prompt_tokens||0)>=3000;
    report.stages.push({label,status:!checks.passed||findings.length?'failed':longContext?'passed':'warning',...result,checks,findings,longContextVerified:longContext,minimumPromptTokens:3000,requestedReplyTokens:1024,inputMessages:messages.length,question});
    messages.push({role:'assistant',name:'Mira',text:result.text});
   }
   if(report.stages.some(s=>!s.longContextVerified))report.notes.push('Long context was not verified at 3000 prompt tokens on every turn. Increase the loaded context (8192 or more recommended) and rerun.');
  }
 }catch(error){report.error=error.message;report.status='failed';}
 finally{report.elapsedMs=Date.now()-started;fs.rmSync(temp,{recursive:true,force:true});}
 const failedStages=report.stages.filter(s=>s.status==='failed').map(s=>s.label);if(failedStages.length)report.notes.push('Failed stages: '+failedStages.join('; ')+'.');
 if(report.stages.some(s=>s.status==='failed'))report.status='failed';else if(report.status!=='failed'&&report.stages.some(s=>s.status==='warning'))report.status='warning';
 return report;
}
Object.assign(module.exports,{WORKFLOW_KINDS,agencyFindings,passageChecks,runWorkflowTest});
