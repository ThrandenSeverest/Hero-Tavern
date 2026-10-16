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
function guidance(w,repair){
 const mode=w.operation||'continue',name=s(w.persona?.name).trim()||'the author-controlled character';
 return ['You are a professional novelist continuing an existing manuscript, not an assistant chatting with the author.',
 'Output ONLY the next literal prose, matching the manuscript language, point of view, tense and established style.',
 'The entire manuscript already happened. Never restart from the premise, re-introduce known characters or repeat an earlier scene.',
 mode==='rewrite'?'Rewrite the selected excerpt to fit exactly between surrounding passages. '+s(w.instruction).slice(0,1200):mode==='insert'?'Insert new prose at this cursor and connect to the following passage.':mode==='say'||mode==='do'?'The author already wrote their own words or action into the manuscript. Continue with other characters and the world reacting, without retelling their action.':'Continue from the present manuscript endpoint. When a scene naturally resolves, progress to the next causal scene yourself; no separate Next Scene button.',
 w.settings?.scenePace==='slow'?'Keep a deliberate pace, with at least one tangible development.':w.settings?.scenePace==='fast'?'Move promptly to the next consequence, obstacle or decision.':'Progress through concrete actions, reactions and consequences.',
 'Preserve characterization, continuity and other characters agency.',
 ...(w.settings?.protectPlayerSpeech!==false?['NEVER invent, complete, quote or paraphrase words spoken by '+name+'. Only reproduce dialogue already literally written by the author. Let NPCs answer, not speak for the player.']:[]),
 ...(w.settings?.protectPlayerActions!==false?['NEVER invent decisions, voluntary movements, thoughts, feelings, reactions or actions for '+name+'. Write the setting, consequences and other people instead, leaving agency to the author.']:[]),
 ...(w.settings?.finishSentences!==false?['Finish prose at a natural sentence or paragraph boundary. Do not end midsentence.']:[]),
 'No bullet points, summaries, headings, dialogue-role labels, outlines, instructions, assistant acknowledgments or private thinking.',
 'Premise, lore and future beats are reference information, not a command to replay those events.',
 repair?'Last attempt gave no usable prose; begin with new in-scene language immediately.':''].filter(Boolean).join('\n');
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
 const before=edit?manuscript.slice(0,start):manuscript,after=edit?manuscript.slice(end):'';
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
 const format=['mistral-v3','mistral-v7'].includes(model?.Template)?model.Template:'chatml',control=guidance(w,repair)+(sections.length?'\n\n'+sections.join('\n\n'):'');
 const render=tail=>serialize(format,control,tail,model);
 if(await countTokens(render(''))>maxInputTokens)throw Error('Writer instructions exceed the loaded context. Shorten notes or increase context. Manuscript is safe.');
 const counted=new Map(),measure=async n=>{if(!counted.has(n))counted.set(n,await countTokens(render(before.slice(-n))));return counted.get(n)};
 let low=0,high=before.length;
 while(low<high){const middle=Math.ceil((low+high)/2);if(await measure(middle)<=maxInputTokens)low=middle;else high=middle-1}
 let tail=before.slice(-low);
 if(low<before.length&&tail.length>1400){const cut=tail.indexOf('\n\n');if(cut>=0&&cut<Math.min(500,tail.length/4))tail=tail.slice(cut+2)}
 const prompt=render(tail);
 return {prompt,tail,diagnostics:{engine:'novel-completion-v2',format,promptTokens:await countTokens(prompt),tokenBudget:maxInputTokens,automaticSceneProgression:true,usesManuscriptPrefill:true,retainedCharacters:tail.length,omittedCharacters:before.length-tail.length,activeLore:lore.map(e=>e.title).filter(n=>!omitted.includes('Lore: '+n)),omittedSections:omitted,scenePace:w.settings?.scenePace||'steady',manuscriptStarted:!!manuscript.trim()}};
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
    report.stage=attempt?'retrying-prose':'writing';onStage(report.stage);
    const built=attempt?await buildNovelPrompt(w,{model,maxInputTokens:inputBudget,countTokens:tokenCount,repair:true}):baseline;
    const stop=attempt?[]:['<|im_end|>','<|endoftext|>','<|eot_id|>'];
    if(!attempt&&built.diagnostics.format!=='chatml')stop.push('</s>','[INST]');
    const response=await fetchBackend(backendURL+'/v1/completions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:built.prompt,...sampling,stop}),signal:ctl.signal,timeoutMs:600000});
    if(!response.ok)throw Error('Writer model returned HTTP '+response.status+'. Your manuscript was preserved.');
    const j=await response.json();if(j.error)throw Error(s(j.error.message||j.error));
    const raw=j.choices?.[0]?.text??j.choices?.[0]?.message?.content??'';
    prose=visibleProse(raw,built.tail);finishReason=j.choices?.[0]?.finish_reason||'';problem=proseIssue(prose,w.text);
    report.attempts.push({number:attempt+1,rawCharacters:s(raw).length,visibleCharacters:prose.length,issue:problem});
    if(!problem)break;
   }
   if(!problem&&settings.finishSentences!==false&&/\p{L}$/u.test(prose.trim())){
    // Avoid fabricating an ending with string heuristics: request only the few
    // words needed to finish the incomplete sentence, never a new scene.
    report.stage='finishing-sentence';onStage(report.stage);
    const remainder=await buildNovelPrompt({...w,text:s(w.text)+prose,note:s(w.note)+'\nFinish ONLY the current incomplete sentence, without speaking or acting for the author-controlled player.'},{model,maxInputTokens:inputBudget,countTokens:tokenCount});
    const response=await fetchBackend(backendURL+'/v1/completions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:remainder.prompt,...sampling,max_tokens:Math.min(160,max_tokens),stop:[]}),signal:ctl.signal,timeoutMs:600000});
    if(response.ok){const j=await response.json(),addition=visibleProse(j.choices?.[0]?.text||'',remainder.tail);if(addition.trim()&&!proseIssue(addition,''))prose+=addition;}
   }
   if(problem)throw Error('Writer could not produce new prose ('+problem+'). The original text was preserved. Check model template, context, and Diagnostics.');
   report.stage='complete';
   return {id:'hero-novel-'+Date.now(),object:'text_completion',model:body.model||'local-fiction',choices:[{index:0,text:prose,finish_reason:'stop'}],usage:{prompt_tokens:baseline.diagnostics.promptTokens,completion_tokens:await tokenCount(prose),context_size:context},writerContext:baseline.diagnostics};
  }catch(e){report.stage='failed';report.error=e.message;throw e}
  finally{report.elapsedMs=Date.now()-report.started;signal?.removeEventListener('abort',abort);active=null;onStage('idle')}
 }
 return {generate,abort:()=>active?.abort(),runSnapshot:()=>lastRun};
}
module.exports={createNovelWriter,buildNovelPrompt,visibleProse,proseIssue,loreFor};
