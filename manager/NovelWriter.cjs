'use strict';
// NovelAI-inspired manuscript continuation, not chat-style story instruction.
const s=x=>String(x??''),clamp=(v,min,max,fallback)=>Number.isFinite(v)?Math.max(min,Math.min(max,v)):fallback;
function loreFor(w,tail){
 const haystack=(tail+'\n'+(!s(w.text).trim()?s(w.prompt):'')+'\n'+s(w.note)).toLowerCase();
 return (Array.isArray(w.lore)?w.lore:[]).filter(e=>e&&e.enabled!==false&&(e.always||(e.keys||[]).some(k=>{
  const word=s(k).trim().toLowerCase();if(!word)return false;
  if(!/^[\p{L}\p{N}_]+$/u.test(word))return haystack.includes(word);
  return haystack.split(/[^\p{L}\p{N}_]+/u).includes(word);
 })));
}
function writingTask(w){
 const operation=w.operation||'continue';
 const goals={
  continue:'Continue directly from the manuscript endpoint. Advance the next causal event through other characters and the setting. Carry natural scene transitions in the prose.',
  advance:'Continue directly from the manuscript endpoint. Carry the next causal event and any natural scene transition in the prose.',
  say:'The final author-written dialogue is already part of the manuscript. Continue with the addressed character’s answer, observable reaction, or the immediate external consequence.',
  do:'The final author-written action is already part of the manuscript. Continue with its external consequences and other characters’ reactions.',
  insert:'Write the missing prose at the cursor so it connects the preceding passage to the supplied following passage.',
  rewrite:'Write a replacement for the selected excerpt that fits its surrounding prose. '+s(w.instruction).slice(0,1200)
 };
 return {operation,goal:goals[operation]||goals.continue,character:s(w.persona?.name).trim()||'the author-controlled character'};
}
function guidance(w){
 const task=writingTask(w),name=task.character;
 return ['You are a professional novelist continuing an existing manuscript.',
 'Return the next literal manuscript prose in the established language, viewpoint, tense and voice. The response is part of the novel itself, written for its reader.',
 'Treat the manuscript as events already written. Build on the exact endpoint and preserve established continuity and characterization.',
 w.settings?.scenePace==='slow'?'Use a deliberate pace with a tangible development.':w.settings?.scenePace==='fast'?'Move promptly through the next consequence, obstacle or decision.':'Progress through concrete actions, reactions and consequences.',
 ...(w.settings?.protectPlayerSpeech!==false?['The author supplies '+name+'’s dialogue. Write the speech of other characters and their responses to the dialogue already present.']:[]),
 ...(w.settings?.protectPlayerActions!==false?['The author supplies '+name+'’s voluntary actions, decisions and inner life. Narrate external events, the environment and other characters while leaving that agency with the author.']:[]),
 ...(w.settings?.finishSentences!==false?['Finish prose at a natural sentence or paragraph boundary.']:[]),
 'Keep narration inside the scene. End on an in-world detail, another character’s line, or an external development. Leave unresolved choices implicit in the fiction.',
 'Use premise and future developments as background; the manuscript endpoint determines what happens next.'].join('\n');
}
function currentDirection(w){
 return '[Current writing task]\n'+writingTask(w).goal+'\n'+
 'Continue in finished novel prose, with dialogue and narration belonging to the scene. The next words follow the existing manuscript directly.';
}
// Correct an unwanted style example only in verified AI-written context. The
// saved manuscript and author-written contributions remain byte-for-byte intact.
const TURN_CUE=/^(?:what (?:do|will|would) you do(?: next)?|how (?:do|will|would) you (?:respond|react|proceed)|what(?:['’]s| is) your (?:next move|response)|(?:your|the player['’]s) (?:turn|move)|что (?:ты|вы) (?:делаешь|делаете|будешь делать|будете делать|сделаешь|сделаете)|как (?:ты|вы) (?:ответишь|ответите|отреагируешь|отреагируете)|твой ход|ваш ход)[?？.!:…]*$/iu;
function contextManuscript(w,before){
 let removed=0,text=before;
 const regions=(Array.isArray(w.generations)?w.generations:[]).filter(g=>g.kind==='generated'&&Number.isInteger(g.start)&&Number.isInteger(g.end)&&g.start>=0&&g.end<=before.length&&before.slice(g.start,g.end)===g.text).sort((a,b)=>b.start-a.start);
 for(const g of regions){const cleaned=g.text.split(/(\r?\n)/).map(line=>{if(TURN_CUE.test(line.trim().replace(/^[*_#\s]+|[*_\s]+$/g,''))){removed++;return ''}return line}).join('');text=text.slice(0,g.start)+cleaned+text.slice(g.end);}
 return {text,removed};
}
function serialize(format,control,tail,profile){
 if(format==='mistral-v3')return '<s>[INST]'+control+'[/INST]'+tail;
 if(format==='mistral-v7')return '<s>[SYSTEM_PROMPT]Fiction manuscript continuation[/SYSTEM_PROMPT][INST]'+control+'[/INST]'+tail;
 const nonThinking=/Qwen3/i.test(s(profile?.Family))?'<think>\n\n</think>\n\n':'';
 return '<|im_start|>system\n'+control+'<|im_end|>\n<|im_start|>assistant\n'+nonThinking+tail;
}
async function buildNovelPrompt(w,{model={},maxInputTokens=4096,countTokens=async x=>Math.ceil(x.length/3),repair=false}={}){
 const manuscript=s(w.text),premise=s(w.prompt);
 if(!manuscript.trim()&&!premise.trim())throw Error('Add a story premise or manuscript text before generating.');
 const operation=w.operation||'continue',edit=['rewrite','insert'].includes(operation),start=clamp(w.start,0,manuscript.length,manuscript.length),end=clamp(w.end,start,manuscript.length,start);
 const originalBefore=edit?manuscript.slice(0,start):manuscript,after=edit?manuscript.slice(end):'',cleaned=contextManuscript(w,originalBefore),before=cleaned.text;
 const beats=Array.isArray(w.beats)?w.beats:[],index=clamp(w.beatIndex,0,beats.length,0);
 const lore=loreFor(w,before.slice(-5000)),sections=[],omitted=[];let used=0;
 const candidates=[
  ['Novel premise — background, NOT the current scene',premise,2800],
  ['Permanent canon / memory',w.memory,4000],
  ['Previous chapter recap',w.recap,3000],
  ['Author-controlled persona',s(w.persona?.name)+'\n'+s(w.persona?.description),1400],
  ['Optional future developments, not mandatory beats',beats.slice(index,index+3).join('\n'),1100],
  ...lore.map(e=>['Lore: '+s(e.title),e.text,e.always?1400:950]),
  ['Author note — immediate direction and style',w.note,1300],
  ...(operation==='rewrite'?[['Selected prose to rewrite',manuscript.slice(start,end),2400]]:[]),
  ...(after?[['Following manuscript — preserve it exactly',after.slice(0,2600),2600]]:[])
 ];
 const supportBudget=Math.max(120,Math.floor(maxInputTokens*.4));
 for(const [label,source,maxChars] of candidates){
  const entry=s(source).trim().slice(-maxChars);if(!entry)continue;
  const part='['+label+']\n'+entry,tokens=await countTokens(part);
  if(tokens>Math.max(160,Math.floor(maxInputTokens*.24))||used+tokens>supportBudget){omitted.push(label);continue}
  sections.push(part);used+=tokens;
 }
 const format=['mistral-v3','mistral-v7'].includes(model?.Template)?model.Template:'chatml',control=guidance(w)+(sections.length?'\n\n'+sections.join('\n\n'):'')+'\n\n'+currentDirection(w);
 const render=tail=>serialize(format,control,tail,model);
 if(await countTokens(render(''))>maxInputTokens)throw Error('Writer instructions exceed the loaded context. Shorten notes or increase context. Manuscript is safe.');
 const counted=new Map(),measure=async n=>{if(!counted.has(n))counted.set(n,await countTokens(render(before.slice(-n))));return counted.get(n)};
 let low=0,high=before.length;
 while(low<high){const middle=Math.ceil((low+high)/2);if(await measure(middle)<=maxInputTokens)low=middle;else high=middle-1}
 let tail=before.slice(-low);
 if(low<before.length&&tail.length>1400){const cut=tail.indexOf('\n\n');if(cut>=0&&cut<Math.min(500,tail.length/4))tail=tail.slice(cut+2)}
 const prompt=render(tail);
 return {prompt,tail,diagnostics:{engine:'novel-completion-v2',promptStrategy:'prose-first-v3',task:writingTask(w).operation,contextOnlyTurnCuesRemoved:cleaned.removed,format,promptTokens:await countTokens(prompt),tokenBudget:maxInputTokens,automaticSceneProgression:true,usesManuscriptPrefill:true,retainedCharacters:tail.length,omittedCharacters:before.length-tail.length,activeLore:lore.map(e=>e.title).filter(n=>!omitted.includes('Lore: '+n)),omittedSections:omitted,scenePace:w.settings?.scenePace||'steady',manuscriptStarted:!!manuscript.trim()}};
}
function visibleProse(raw,prefix){
 let result=s(raw).replace(/<think>[\s\S]*?<\/think>/gi,'');
 if(result.includes('<think>'))result=result.slice(0,result.indexOf('<think>'));
 result=result.replace(/^(?:<\|im_end\|>|<\|im_start\|>assistant|<\|endoftext\|>|<\|eot_id\|>|<\/s>|\[\/INST\])+\s*/g,'');
 result=result.replace(/(?:<\|im_end\|>|<\|im_start\|>|<\|endoftext\|>|<\|eot_id\|>|<\/s>|\[INST\])[\s\S]*$/g,'');
 const echo=s(prefix).slice(-1024);if(echo.length>48&&result.startsWith(echo))result=result.slice(echo.length);
 return result;
}
function proseIssue(out,already){
 const t=s(out).trim();if(!t)return 'empty/hidden output';
 if(/^(?:okay|sure|certainly|here is|i will|i need to|i understand|as requested)\b/i.test(t))return 'assistant commentary';
 if(/^(?:#{1,4}\s*|\*\*)?(?:chapter summary|character profile|scene breakdown|story plan|review)\s*[:\n]/i.test(t))return 'outline instead of fiction';
 const first=t.toLowerCase().replace(/\s+/g,' ').slice(0,96),old=s(already).toLowerCase().replace(/\s+/g,' ');
 if(first.length>=75&&old.includes(first))return 'repeated existing scene';
 return '';
}
function writerStyleWarnings(text,already){
 const warnings=[],issue=proseIssue(text,already);
 if(issue&&issue!=='empty/hidden output')warnings.push(issue);
 const lastLine=s(text).trim().split(/\r?\n/).at(-1).trim().replace(/^[*_#\s]+|[*_\s]+$/g,'');
 if(TURN_CUE.test(lastLine))warnings.push('out-of-scene player prompt');
 return warnings;
}
function createNovelWriter({backendURL,fetchBackend,getModelProfile=()=>({Template:'chatml'}),getContextSize=()=>8192,recordInspector=()=>{},onStage=()=>{}}){
 let active=null,lastRun=null;
 async function generate(body,signal){
  if(active)throw Error('Writer is already generating.');
  const ctl=new AbortController();active=ctl;
  const abort=()=>ctl.abort();if(signal?.aborted)ctl.abort();signal?.addEventListener('abort',abort,{once:true});
  const report={stage:'preparing',started:Date.now(),attempts:[],engine:'novel-completion-v2'};lastRun=report;
  try{
   const w=body.hero_writer;if(!w||typeof w!=='object')throw Error('Missing Writer manuscript.');
   const settings={...w.settings,...body.writerSettings},model=getModelProfile(),context=clamp(getContextSize(),1024,524288,8192);
   const max_tokens=Math.min(clamp(settings.maxReplyTokens,64,2048,768),Math.max(128,Math.floor(context*.30)));
   const inputBudget=context-max_tokens-96;if(inputBudget<512)throw Error('Not enough loaded context for Writer.');
   const tokenCache=new Map();
   async function tokenCount(prompt){
    if(tokenCache.has(prompt))return tokenCache.get(prompt);let count;
    try{const response=await fetchBackend(backendURL+'/api/extra/tokencount',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt}),signal:ctl.signal,timeoutMs:10000});
     if(response.ok){const j=await response.json();count=Number.isFinite(j.value)?j.value:Array.isArray(j.ids)?j.ids.length:undefined}
    }catch(e){if(ctl.signal.aborted)throw e}
    if(!Number.isFinite(count))count=Buffer.byteLength(prompt,'utf8');tokenCache.set(prompt,count);return count;
   }
   const baseline=await buildNovelPrompt(w,{model,maxInputTokens:inputBudget,countTokens:tokenCount});
   report.writerContext=baseline.diagnostics;
   // A manuscript ID is not an Adventure/Chat session ID. Keep Writer diagnostics
   // in lastRun instead of sending its UUID to the chat session inspector.
   report.promptPreview=baseline.prompt.slice(-6000);
   const sampling={max_tokens,stream:false,temperature:clamp(settings.temperature,0.01,1.5,.85),top_p:clamp(settings.top_p,.1,1,.95),top_k:clamp(settings.top_k,0,200,40),min_p:clamp(settings.min_p,0,.5,.05),rep_pen:clamp(settings.repetition_penalty,1,1.3,1.08),rep_pen_range:2048};
   let prose='',problem='',finishReason='';
   for(let attempt=0;attempt<2;attempt++){
    if(ctl.signal.aborted)throw Error('Writer stopped.');
    report.stage=attempt?'recovering-empty-output':'writing';onStage(report.stage);
    const built=attempt?await buildNovelPrompt(w,{model,maxInputTokens:inputBudget,countTokens:tokenCount,repair:true}):baseline;
    const stop=attempt?[]:['<|im_end|>','<|endoftext|>','<|eot_id|>'];
    if(!attempt&&built.diagnostics.format!=='chatml')stop.push('</s>','[INST]');
    const response=await fetchBackend(backendURL+'/v1/completions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:built.prompt,...sampling,stop}),signal:ctl.signal,timeoutMs:600000});
    if(!response.ok)throw Error('Writer model returned HTTP '+response.status+'. Your manuscript was preserved.');
    const j=await response.json();if(j.error)throw Error(s(j.error.message||j.error));
    const raw=j.choices?.[0]?.text??j.choices?.[0]?.message?.content??'';
    prose=visibleProse(raw,built.tail);finishReason=j.choices?.[0]?.finish_reason||'';problem=prose.trim()?'':'empty/hidden output';
    report.styleWarnings=writerStyleWarnings(prose,w.text);
    report.attempts.push({number:attempt+1,rawCharacters:s(raw).length,visibleCharacters:prose.length,issue:problem});
    if(!problem)break;
   }
   if(!problem&&!report.styleWarnings?.length&&settings.finishSentences!==false&&!/[.!?…][”»"')\]]*$/u.test(prose.trim())){
    // Avoid fabricating an ending with string heuristics: request only the few
    // words needed to finish the incomplete sentence, never a new scene.
    report.stage='finishing-sentence';onStage(report.stage);
    const remainder=await buildNovelPrompt({...w,text:s(w.text)+prose,note:s(w.note)+'\nFinish ONLY the current incomplete sentence, without speaking or acting for the author-controlled player.'},{model,maxInputTokens:inputBudget,countTokens:tokenCount});
    const response=await fetchBackend(backendURL+'/v1/completions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:remainder.prompt,...sampling,max_tokens:Math.min(160,max_tokens),stop:[]}),signal:ctl.signal,timeoutMs:600000});
    if(response.ok){const j=await response.json(),addition=visibleProse(j.choices?.[0]?.text||'',remainder.tail);if(addition.trim())prose+=addition;}
   }
   if(problem)throw Error('Writer could not produce new prose ('+problem+'). The original text was preserved. Check model template, context, and Diagnostics.');
   report.styleWarnings=writerStyleWarnings(prose,w.text);
   report.stage='complete';
   return {id:'hero-novel-'+Date.now(),object:'text_completion',model:body.model||'local-fiction',choices:[{index:0,text:prose,finish_reason:'stop'}],usage:{prompt_tokens:baseline.diagnostics.promptTokens,completion_tokens:await tokenCount(prose),context_size:context},writerContext:{...baseline.diagnostics,styleWarnings:report.styleWarnings||[],generationPasses:report.attempts.length}};
  }catch(e){report.stage='failed';report.error=e.message;throw e}
  finally{report.elapsedMs=Date.now()-report.started;signal?.removeEventListener('abort',abort);active=null;onStage('idle')}
 }
 return {generate,abort:()=>active?.abort(),runSnapshot:()=>lastRun};
}
module.exports={writingTask,contextManuscript,writerStyleWarnings,createNovelWriter,buildNovelPrompt,visibleProse,proseIssue,loreFor};
