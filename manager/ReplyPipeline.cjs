// Buffered inference proxy: hidden planning is ephemeral, never returned to chat.
const fs = require('node:fs'), path = require('node:path');
const { filterReply, isMetaReply, repetitionIssue } = require('./ReplyFilters.cjs');
const {profileFor,renderPrompt,modelRequest}=require('./ModelProfiles.cjs');
const {buildWriterContext,reduceLongContext}=require('./WriterContext.cjs');
const {writerRepetitionIssue}=require('./WriterFlow.cjs');
const {engineFetch,errorDetails}=require('./EngineHTTP.cjs');
const {createMemory}=require('./ContextMemory.cjs');
const DEFAULTS = Object.freeze({thinkingMode:'off',planningSource:'same',top_k:20,temperature:0.8,top_p:0.9,min_p:0.05,repetition_penalty:1.08,memoryEnabled:true,memoryTokens:512,recentMessages:12,maxReplyTokens:512,planningTokens:192,replyStyle:'mixed',instructions:'',removeModelTokens:true,stopAtSpeaker:true,dedupeParagraphs:false,repairMetaReplies:true,avoidRepetition:true,repetitionSensitivity:0.83,stopMarkers:[]});
function validateSettings(input = {}) {
    const value = {};
    for (const key of Object.keys(DEFAULTS)) value[key] = input[key] === undefined ? DEFAULTS[key] : input[key];
    if(!['same','different'].includes(value.planningSource))throw Error('Choose the reply model or a separate planning model.');
    if (!['off','separate'].includes(value.thinkingMode)) throw new Error('Choose disabled thinking or separate planning.');
    if (!['mixed','dialogue'].includes(value.replyStyle)) throw new Error('Choose dialogue with narration or dialogue only.');
    for (const [key,min,max] of [['top_k',0,200],['repetitionSensitivity',0.7,0.98],['temperature',0,2],['top_p',0.01,1],['min_p',0,1],['repetition_penalty',1,2],['maxReplyTokens',32,4096],['memoryTokens',128,1024],['recentMessages',2,100],['planningTokens',32,1024]]) {
        if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < min || value[key] > max || ((key.endsWith('Tokens')||key==='recentMessages') && !Number.isInteger(value[key]))) throw new Error('Invalid '+key+' value.');
    }
    for (const key of ['removeModelTokens','stopAtSpeaker','dedupeParagraphs','repairMetaReplies','memoryEnabled','avoidRepetition']) if (typeof value[key] !== 'boolean') throw new Error('Invalid filter setting.');
    if (typeof value.instructions !== 'string' || value.instructions.length > 4000) throw new Error('Writing instructions must be at most 4000 characters.');
    if (!Array.isArray(value.stopMarkers) || value.stopMarkers.length > 20 || value.stopMarkers.some(x=>typeof x!=='string'||x.length>160)) throw new Error('Use at most 20 short stop markers.');
    return value;
}
function readSettings(root) {
    const file = path.join(root,'generation.json');
    return validateSettings(fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')) : {});
}
function saveSettings(root, input) {
    const value = validateSettings(input), file = path.join(root,'generation.json');
    fs.writeFileSync(file+'.tmp',JSON.stringify(value,null,2)+'\n');fs.renameSync(file+'.tmp',file);return value;
}
function instructions(settings) {
    return ['[Hero Tavern reply instructions]', 'Write only the next character reply. Stay in the scene and in character. Never describe how you will write, mention narrator roles, or give writer/assistant commentary. Never include private analysis, planning, reasoning headings, or think tags.',
        settings.replyStyle==='dialogue'?'Write spoken dialogue only. Do not narrate actions or internal thoughts.':'Dialogue and scene narration are allowed; model reasoning is not part of the story.',
        settings.avoidRepetition?'Answer the latest user message using the established conversation. Earlier assistant messages are history, not drafts to repeat. Advance the scene with a fresh response; do not simply echo the user or restate your last reply.':'', settings.instructions, '/no_think', '[/Hero Tavern reply instructions]'].filter(Boolean).join('\n');
}
function replyPrompt(prompt, extra) {
    if(/<think>\s*$/i.test(prompt))prompt+='\n</think>\n';
    // Put controls before the final assistant prefill, not after it as assistant content.
    const pattern = /(<\|im_start\|>assistant\s*(?:<think>\s*<\/think>\s*)?)$/i;
    if (pattern.test(prompt)) return prompt.replace(pattern, (_match,tail) => '<|im_start|>system\n'+extra+'<|im_end|>\n'+tail);
    return extra+'\n\n'+prompt;
}
async function completionText(response) {
    if (!response.ok) throw new Error('Local engine returned HTTP '+response.status+'. Check Diagnostics.');
    if ((response.headers.get('content-type')||'').includes('text/event-stream')) {
        let buffer='', text='', decoder=new TextDecoder();
        const consume = line => {
            if (!line.startsWith('data:')) return;
            const data=line.slice(5).trim();if(!data||data==='[DONE]')return;
            const item=JSON.parse(data);if(item.error)throw new Error(item.error.message||'Generation failed.');
            const choice=item.choices?.[0];text+=choice?.text??choice?.delta?.content??'';
            // reasoning_content and reasoning deltas are deliberately never copied.
        };
        for await (const bytes of response.body) {
            buffer+=decoder.decode(bytes,{stream:true});
            let index;while((index=buffer.indexOf('\n'))>=0){consume(buffer.slice(0,index).replace(/\r$/,''));buffer=buffer.slice(index+1);}
            if(text.length>200000)throw new Error('Reply is unexpectedly large.');
        }
        buffer+=decoder.decode();if(buffer)consume(buffer);return text;
    }
    const item=await response.json();if(item.error)throw new Error(item.error.message||'Generation failed.');
    return item.choices?.[0]?.text??item.choices?.[0]?.message?.content??item.results?.[0]?.text??'';
}
function isWriterNonProse(input){
 const text=String(input||'').trim();if(!text)return 'empty output';
 // A character's quoted dialogue may legitimately contain "I understand".
 const head=text.replace(/^(?:[\s#*_-]|\*\*)+/, '').slice(0,700).trim();
 if(isMetaReply(text))return 'assistant commentary';
 if(/^(?:okay|ok|alright|all right|right|sure|yes|certainly|absolutely|of course|got it|understood|roger|понял|хорошо|итак|да,?\s*понял)[\s,!.:-]*(?:now|so|then|i |i['’]ve |let|here|understand|got|буду|теперь|я |сейчас|давайте|начну|вот|что |как |мне )/i.test(head))return 'assistant acknowledgment';
 if(/^(?:I (?:now )?(?:understand|realize|get|see|know)|I['’]ve (?:got|understood|figured)|Now I (?:understand|see|know)|Let me|I (?:will|can|should|need to|am going to)|Here(?:['’]s| is| are)|To (?:continue|write|start|create|do)|You (?:want|asked|mean)|The (?:task|request|instructions|story) (?:is|are)|As (?:requested|you asked)|Based on (?:your|the)|My (?:approach|plan)|I (?:must|should) (?:write|continue))/i.test(head))return 'assistant preface';
 if(/^(?:\*\*|#{1,4}\s*)?(?:character (?:profile|description|sheet)|physical appearance|appearance|personality|background|overview|summary|scenario|outline|review|analysis|notes|instruction|plan)\s*[:\n]/i.test(head))return 'non-fiction outline';
 if(/^(?:[A-Z][a-z]+(?: [A-Z][a-z]+)?):\s*(?:Tall|Short|A |An |She |He |They )/i.test(head)&&/\n(?:Physical Appearance|Personality|Background|Age|Height):/i.test(text))return 'profile fields';
 if(/(?:here(?:['’]s| is) (?:the|a|my) (?:revised|requested|next)|I'll (?:write|continue|provide)|I now understand what|now I understand what|what (?:am I|I'm) supposed to do)/i.test(head.slice(0,180))&&!/^[“"«]/.test(text))return 'assistant talking about task';
 return '';
}
function createPipeline({root,backendURL,setState=()=>{},fetchBackend=engineFetch,enforceContext=false,setDiagnostics=()=>{},getModelProfile=()=>({Template:'chatml'}),getContextSize=null,getPlanningBackend=()=>null,getStoryContext=()=>null,recordInspector=()=>{}}) {
    let active = null,lastRun=null;const runSnapshot=()=>lastRun;const stage=value=>{if(lastRun){lastRun.stage=value;lastRun.timeline.push({stage:value,at:Date.now()-lastRun.started});}setState(value);};
    async function generate(body, signal, {mode='chat'}={}) {
        if(active)throw new Error('A reply is already being generated. Stop it before starting another.');
        if(typeof body.prompt!=='string')throw new Error('The local reply pipeline requires a text prompt.');
        lastRun={id:'run-'+Date.now(),started:Date.now(),stage:'preflight',timeline:[],requests:[],mode};
        const settings=mode==='writer'?validateSettings({...readSettings(root),...body.writerSettings,thinkingMode:'off'}):readSettings(root), controller=new AbortController();active=controller;
        const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
        if(signal?.aborted)controller.abort();
        try {
            let plan='',storyContext=null;
            if(body.hero_context?.sessionId){storyContext=getStoryContext(body.hero_context.sessionId,body.hero_context.messages.slice(-6).map(m=>m.text).join('\n'));}
            const profile=getModelProfile();lastRun.profile=profile.Template;const timeoutSeconds=fs.existsSync(path.join(root,'backend.json'))?JSON.parse(fs.readFileSync(path.join(root,'backend.json'),'utf8')).requestTimeoutSeconds||1200:1200;const trace=e=>{lastRun.requests.push(e);lastRun.requests=lastRun.requests.slice(-100);};stage('tokenizing');const send=async request=>completionText(await fetchBackend(backendURL+'/v1/completions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(modelRequest((({hero_context,hero_mode,hero_writer,hero_image_context,writerSettings,...value})=>value)(request),profile)),signal:controller.signal,timeoutMs:timeoutSeconds*1000,onEvent:trace}));
            const contextSize=getContextSize?getContextSize():fs.existsSync(path.join(root,'backend.json'))?JSON.parse(fs.readFileSync(path.join(root,'backend.json'),'utf8').replace(/^\uFEFF/, '')).contextSize||4096:4096;
            const tokenCache=new Map();const countTokens=async (prompt,format=true)=>{const key=(format?'formatted:':'raw:')+prompt;if(tokenCache.has(key))return tokenCache.get(key);
                const response=await fetchBackend(backendURL+'/api/extra/tokencount',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:format?renderPrompt(prompt,profile):prompt}),signal:controller.signal,timeoutMs:10000,onEvent:trace});
                if(response.ok){const value=await response.json();if(Number.isFinite(value.value)&&value.value>=0){tokenCache.set(key,value.value);return value.value;}if(Array.isArray(value.ids)){tokenCache.set(key,value.ids.length);return value.ids.length;}}
                // UTF-8 byte count is a conservative fallback, never a guessed 4-chars-per-token limit.
                return Buffer.byteLength(prompt,'utf8');
            };
            const taskInstruction=mode==='writer'?'You are a fiction continuation engine. Write only manuscript prose, preserving language, tense, viewpoint, voice and established facts. No character-reply framing, explanations, headings or analysis. /no_think':['image-prompt','utility'].includes(mode)?'Follow the requested task precisely. Return only its requested output, without model reasoning or roleplay commentary. /no_think':['adventure','adventure-json','adventure-dm','adventure-narrator'].includes(mode)?'Follow the requested Ilreon schema and rules exactly. Return valid JSON when requested, otherwise the requested narration or compact notes. Preserve authoritative game state; never output reasoning. /no_think':mode==='character'?'Create the requested character card as valid JSON. Return only the requested object without reasoning. /no_think':mode==='preview'?'Write the requested natural in-character test reply, without reasoning or JSON. /no_think':mode==='state'?'Return only the requested state-analysis JSON. Evidence must be exact, established and associated with the declared message and character. Do not invent state or include reasoning. /no_think':mode==='summary'?'Summarize the supplied established facts, without inventing details. Return factual notes only, no reasoning. /no_think':instructions(settings);
            const directionInstruction=(body.hero_context?.character?'\n[Character consistency] Respect the selected character card: canonical appearance, personality, speech habits, abilities, values and motives. Show reactions through dialogue and action rather than a character profile. Do not write dialogue, thoughts or decisions for the user. Avoid generic agreement and repetition.':'')+(body.hero_context?.oneReply?'\n[One reply only] '+String(body.hero_context.oneReply).slice(0,3000):'')+(body.hero_context?.generationType==='continue'?'\nContinue the last assistant reply without repeating its existing text.':'');
            const stateInstruction=storyContext?'\n'+storyContext.text:'';
            const budgeted=enforceContext||!!body.hero_context||mode!=='chat';
            let replyTokens=['adventure-json','adventure-dm'].includes(mode)?Math.max(4096,settings.maxReplyTokens):mode==='adventure-narrator'?Math.max(3072,settings.maxReplyTokens):mode==='adventure'||mode==='character'||mode==='state'?Math.max(1024,settings.maxReplyTokens):settings.maxReplyTokens;
            if(mode==='utility'&&Number.isFinite(body.max_tokens))replyTokens=Math.max(128,Math.min(4096,body.max_tokens));
            const overhead=budgeted?await countTokens(taskInstruction+stateInstruction+directionInstruction+'\n<|im_start|>system\n<|im_end|>\n')+96:0;
            if(mode.startsWith('adventure')){const available=contextSize-overhead-await countTokens(body.prompt)-96;if(available<1024)throw Error('Adventure: контекст не оставляет 1024 токена для завершённого ответа. Увеличьте контекст модели.');replyTokens=Math.min(replyTokens,available);}
            if(['state','character'].includes(mode)){const available=contextSize-overhead-await countTokens(body.prompt)-96;if(available<256)throw Error('Not enough loaded context for a complete JSON result. Shorten the source or increase model context.');replyTokens=Math.min(available,Math.max(mode==='character'?4096:2048,replyTokens));}
            const budget=contextSize-replyTokens-overhead-(mode==='chat'&&settings.thinkingMode==='separate'?settings.planningTokens+96:0);
            if(budget<128)throw Error('Reply and planning budgets leave no room for history. Lower Generation reply length or increase Hardware context.');
            const sendChecked=async request=>{if(budgeted&&await countTokens(modelRequest(request,profile).prompt,false)+request.max_tokens>contextSize)throw Error('Prompt exceeds the loaded context. Increase Hardware context or shorten the character card/instructions. Chat history was not silently discarded.');return send(request)};
            if(mode==='writer'){
                let built,writer=body.hero_writer;try{built=await buildWriterContext(writer,budget,countTokens)}catch(e){
                    if(!/exceeds the available context/.test(e.message))throw e;
                    stage('summarizing');const w=body.hero_writer;
                    const activation=(String(w.text||'').slice(-12000)+'\n'+String(w.prompt||'')+'\n'+String(w.instruction||'')).toLowerCase(),activeLore=(w.lore||[]).filter(e=>e.enabled!==false&&(e.always||(e.keys||[]).some(k=>activation.includes(k.toLowerCase()))));const source=JSON.stringify({prompt:w.prompt,memory:w.memory,note:w.note,persona:w.persona,lore:activeLore});
                    const reduced=await reduceLongContext(source,{count:countTokens,budget:Math.max(512,budget-600),complete:async(text,max_tokens)=>filterReply(await sendChecked({prompt:replyPrompt('<|im_start|>user\n'+text+'<|im_end|>\n<|im_start|>assistant\n','Extract faithful continuity facts only. /no_think'),max_tokens,temperature:.2,stream:false}),{stopAtSpeaker:false,removeModelTokens:true})});
                    writer={...w,persona:{name:w.persona?.name||'',description:''},prompt:'',memory:reduced.text,note:'Audit the combined continuity notes for consistency. Preserve the current scene and user intent; write only new prose.',lore:[]};built=await buildWriterContext(writer,budget,countTokens);
                    built.diagnostics.longContext={parts:reduced.parts,originalCharacters:source.length,summaryCharacters:reduced.text.length,originalPreserved:true};
                }
                body={...body,hero_writer:writer,prompt:built.prompt};lastRun.writerContext=built.diagnostics;
            }
            if(body.hero_context){
                const memory=createMemory({root,countTokens,setDiagnostics,complete:async(prompt,max_tokens)=>{stage('summarizing');return filterReply(await sendChecked({prompt:replyPrompt('<|im_start|>user\n'+prompt+'<|im_end|>\n<|im_start|>assistant\n', 'Return compact continuity facts only. /no_think'),max_tokens,temperature:0.2,stream:false}),{stopAtSpeaker:false,removeModelTokens:true})}});
                stage('remembering');body={...body,prompt:await memory.prepare(body,budget,{...settings,summaryInputBudget:contextSize-settings.memoryTokens-256})};
            }
            if(mode==='chat'&&settings.thinkingMode==='separate'){
                stage('planning');
                const prompt=replyPrompt(body.prompt,'[Private continuity outline]\nBriefly list the scene facts, character intent and next-reply goal. Do not write dialogue or a final answer. This outline is not shown to the user. /no_think\n[/Private continuity outline]');
                if(settings.planningSource==='different'){
                    const worker=getPlanningBackend();const planningProfile=worker?.settings?.name?profileFor(root,worker.settings.name):{Template:'chatml'};if(!worker?.ready)throw Error('Load a separate planning model in Generation, or choose Use reply model.');
                    let planningPrompt=prompt;const budget=worker.settings.contextSize-settings.planningTokens-64;
                    const count=async text=>{const r=await fetchBackend(worker.url+'/api/extra/tokencount',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:renderPrompt(text,planningProfile)}),signal:controller.signal});const j=await r.json();return Number.isFinite(j.value)?j.value:Buffer.byteLength(text,'utf8')};
                    while(await count(planningPrompt)>budget){const match=/<\|im_start\|>(?:user|assistant)\n[\s\S]*?<\|im_end\|>\n?/.exec(planningPrompt);if(!match||planningPrompt.slice(match.index+match[0].length).indexOf('<|im_start|>user')<0)throw Error('Planning context is too small for the character and latest turn. Increase planning context or use the reply model.');planningPrompt=planningPrompt.slice(0,match.index)+planningPrompt.slice(match.index+match[0].length);}
                    plan=filterReply(await completionText(await fetchBackend(worker.url+'/v1/completions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(modelRequest({prompt:planningPrompt,stream:false,max_tokens:settings.planningTokens,temperature:0.4,stop:['<|im_end|>']},planningProfile)),signal:controller.signal})),settings).slice(0,6000);
                }else plan=filterReply(await sendChecked({...body,prompt,stream:false,max_tokens:settings.planningTokens,temperature:0.4}),settings).slice(0,6000);
            }
            if(mode==='writer'&&body.writerSettings?.writerTwoPass===true){
                stage('writer-planning');
                const w=body.hero_writer||{},draft=String(w.text||''),hasDraft=!!draft.trim();
                const beats=Array.isArray(w.beats)?w.beats:[],index=Number.isInteger(w.beatIndex)?w.beatIndex:0;
                const activeBeat=String(beats[index]||''),upcomingBeat=String(beats[index+1]||'');
                const planningContext='<|im_start|>user\n[Story premise (background, not a starting instruction)]\n'+String(w.prompt||'').slice(0,900)+
                  '\n[Permanent canon]\n'+String(w.memory||'').slice(0,900)+
                  '\n[Previous chapters — continuity]\n'+String(w.recap||'').slice(-1000)+
                  '\n[CURRENT active beat]\n'+activeBeat.slice(0,600)+
                  '\n[Later beat — not now]\n'+upcomingBeat.slice(0,250)+
                  '\n[Author direction]\n'+String(w.note||'').slice(0,550)+
                  '\n[MANUSCRIPT ENDPOINT — authoritative scene and chronology]\n'+draft.slice(-3500)+
                  '\n[Writer operation]\n'+String(w.operation||'continue')+
                  '\nDraft one immediate NEW action or exchange and 1–3 causal consequences. Treat everything before the manuscript endpoint as past history. '+(hasDraft?'Do not describe the opening or repeat meetings/descriptions already written.':'Begin the opening in medias res.')+
                  ' No exposition dump or plot synopsis.<|im_end|>\n<|im_start|>assistant\n';
                const planningPrompt=replyPrompt(planningContext,'Private local scene director: decide what happens NEXT at the exact manuscript endpoint. Respect the active beat and current character goals. Output 2–4 concise causal steps, not prose, not a retelling, and never reset the chronology. /no_think');
                const planned=filterReply(await sendChecked({prompt:planningPrompt,max_tokens:Math.min(240,Math.max(96,Math.floor(settings.maxReplyTokens/3))),temperature:0.4,stream:false}),{removeModelTokens:true,stopAtSpeaker:false});
                if(planned)plan=planned.slice(0,1600);
            }
            stage(mode==='state'?'analyzing':'responding');
            const extra=taskInstruction+stateInstruction+directionInstruction+(plan?'\n[Private continuity notes — do not quote or reproduce]\n'+plan+'\n[/Private continuity notes]':'');
            let prompt;
            if(mode==='writer'){
                // Actual continuation of the manuscript: append controls as a system
                // message BEFORE the prose and never append another instruction AFTER it.
                const marker='<|im_start|>assistant\n',idx=body.prompt.lastIndexOf(marker);
                if(idx<0)throw Error('Writer prompt has no manuscript continuation boundary.');
                prompt=body.prompt.slice(0,idx)+'<|im_start|>system\n'+extra+'<|im_end|>\n'+body.prompt.slice(idx);
            }else prompt=replyPrompt(body.prompt,extra);
            // Close an inherited reasoning prefill even in existing SillyTavern profiles.
            if(/<think>\s*$/i.test(prompt))prompt+='\n</think>\n';
            if(body.hero_context?.sessionId){let inspected=prompt.replace(/\[Private continuity notes[^\]]*\][\s\S]*?\[\/Private continuity notes\]/g,'[Private planning omitted]');for(const entry of storyContext?.lore||[])if(entry.visibility==='hidden'&&entry.text)inspected=inspected.split(entry.text).join('[Hidden lore omitted]');for(const entry of storyContext?.trackers||[])if(entry.hidden)inspected=inspected.split(JSON.stringify(entry.value)).join('[Hidden state omitted]');recordInspector(body.hero_context.sessionId,{at:Date.now(),prompt:renderPrompt(inspected,profile),template:profile.Template,promptTokens:await countTokens(prompt),replyTokens,contextSize,trackerKeys:storyContext?.trackers.map(x=>x.key)||[],omittedTrackers:storyContext?.omitted||[],lore:(storyContext?.lore||[]).map(e=>({id:e.id,label:e.visibility==='hidden'?'Hidden entry':e.label,active:e.active,reason:e.reason})),history:body.hero_context.messages.length,planningSource:settings.thinkingMode==='separate'?settings.planningSource:'off'});}
            const request={...body,prompt,disableNativeThinking:true,writerContinuation:mode==='writer',stream:!!body.stream,max_tokens:replyTokens,temperature:mode==='utility'&&Number.isFinite(body.temperature)?body.temperature:['adventure-json','adventure-dm'].includes(mode)?0.35:settings.temperature,top_p:['adventure-json','adventure-dm'].includes(mode)?0.9:settings.top_p,top_k:['adventure-json','adventure-dm'].includes(mode)?20:settings.top_k,min_p:['adventure-json','adventure-dm'].includes(mode)?0:settings.min_p,rep_pen_range:1024,rep_pen:settings.repetition_penalty,repetition_penalty:settings.repetition_penalty};
            const raw=await sendChecked(request);
            const filters=mode==='chat'?settings:{removeModelTokens:true,stopAtSpeaker:false};
            let text=filterReply(raw,filters);
            if(!text){
                // Thinking-only generations exhaust the answer budget on some Qwen/RP checkpoints.
                // Re-prompt once, with no hidden reasoning and a larger bounded reply budget.
                // The original empty/hidden reasoning is never displayed or saved as dialogue.
                stage('recovering-empty-reply');
                lastRun.emptyReplyRecovery={originalLength:raw.length,reason:raw.trim()?'Only hidden reasoning/tokens were produced.':'Local engine returned empty text.'};
                let recoveryBodyPrompt=body.prompt;
                if(/Qwen3/i.test(profile.Family||'')){
                    recoveryBodyPrompt=recoveryBodyPrompt.replace(/(<\|im_end\|>\s*<\|im_start\|>assistant\s*)$/i,'\n/no_think\n$1');
                }
                const retryPrompt=mode==='writer'?prompt:replyPrompt(recoveryBodyPrompt,extra+'\n[Output recovery: The previous attempt produced no visible answer. Disable thinking. Answer the latest task DIRECTLY. Never emit <think> tags, scratchpad, or analysis. For image-prompt tasks return only the visual prompt; for JSON tasks return only one complete JSON object. /no_think]');
                const capacity=Math.max(128,contextSize-await countTokens(retryPrompt)-64);
                const retryTokens=Math.min(capacity,Math.max(replyTokens,['adventure-json','adventure-dm'].includes(mode)?2048:1024));
                const retryRaw=await sendChecked({...request,prompt:retryPrompt,stop:[],noStopSequences:true,stream:false,max_tokens:retryTokens,temperature:0.65,top_p:0.94,min_p:0,top_k:20});
                text=filterReply(retryRaw,{...filters,stopAtSpeaker:false,stopMarkers:[]});
                lastRun.emptyReplyRecovery={...lastRun.emptyReplyRecovery,retryTokens,success:!!text,stopReset:true,noStopSequences:true,rawCharacters:retryRaw.length,visibleCharacters:text.length,template:profile.Template,thinkingControl:profile.Family==='Qwen3'?'qwen3-template-empty-thinking':'instruction'};
                if(!text&&mode==='image-prompt'&&body.hero_image_context){text='Illustrate this visible scene with coherent composition, keeping the described people distinct. '+String(body.hero_image_context).replace(/<[^>]+>/g,'').slice(0,5000);lastRun.imagePromptFallback=true;}
                if(!text)throw Error((/<think>|<\|channel\|>analysis/i.test(retryRaw)?'THINKING_ONLY':'EMPTY_OUTPUT')+': No visible reply after recovery. Model template: '+profile.Template+'; output budget: '+retryTokens+'. Open Diagnostics for request metadata. Your chat and trackers were preserved.');
            }
            const history=body.hero_context?.messages||[...body.prompt.matchAll(/<\|im_start\|>(user|assistant)\n([\s\S]*?)<\|im_end\|>/g)].map(x=>({role:x[1],text:x[2]}));
            const repetitive=mode==='chat'&&settings.avoidRepetition?repetitionIssue(text,history,settings.repetitionSensitivity):'';
            const writerMeta=mode==='writer'&&isWriterNonProse(text);
            const meta=mode==='chat'&&settings.repairMetaReplies&&isMetaReply(text);
            if(writerMeta){
                stage('repairing-writer-prose');
                const rebuilt=await buildWriterContext({...body.hero_writer,repair:true},budget,countTokens);
                const boundary='<|im_start|>assistant\n',place=rebuilt.prompt.lastIndexOf(boundary);
                if(place<0)throw Error('Writer correction lost its manuscript continuation.');
                const corrected=rebuilt.prompt.slice(0,place)+'<|im_start|>system\n'+extra+'\nOnly continue the unfinished novel passage from the existing prose, never discuss the task.<|im_end|>\n'+rebuilt.prompt.slice(place);
                text=filterReply(await sendChecked({...request,prompt:corrected,stream:false,temperature:Math.min(settings.temperature,0.75)}),filters);
                lastRun.writerRepair={trigger:writerMeta,success:!!text&&!isWriterNonProse(text)};
                if(!text||isWriterNonProse(text))throw Error('The selected text model could not produce a prose continuation. The original manuscript remains saved. Open Model Testing → Text → Text to diagnose the model and check its prompt template.');
            }
            if(meta||repetitive) {
                const repairedPrompt=replyPrompt(body.prompt,extra+'\nCORRECT THE DRAFT: '+(repetitive||'The draft was writer commentary.')+' Write a fresh reply that answers the most recent user message and moves the scene forward. Do not reuse previous reply sentences, echo the user, announce narrator roles or explain how you will answer.');
                text=filterReply(await sendChecked({...body,prompt:repairedPrompt,stream:false,max_tokens:replyTokens,temperature:repetitive?Math.max(0.75,Math.min(settings.temperature,1)):Math.min(settings.temperature,0.7),rep_pen:Math.max(settings.repetition_penalty,1.15),repetition_penalty:Math.max(settings.repetition_penalty,1.15),rep_pen_range:1024}),settings);
                if(settings.avoidRepetition&&repetitionIssue(text,history,settings.repetitionSensitivity))throw Error('The model repeated the conversation again. Try regenerate or adjust repetition sensitivity / sampling in Generation. The repeated draft was hidden.');
                if(settings.repairMetaReplies&&isMetaReply(text))throw new Error('The model is still returning writer commentary. Review the character card and Generation writing instructions, then retry.');
            }
            if(mode==='writer'&&text&&!isWriterNonProse(text)){
                const issue=writerRepetitionIssue(text,body.hero_writer?.text);
                if(issue){
                    stage('repairing-writer-progression');
                    const rebuilt=await buildWriterContext({...body.hero_writer,flowRepair:true},budget,countTokens);
                    const boundary='<|im_start|>assistant\n',place=rebuilt.prompt.lastIndexOf(boundary);
                    if(place<0)throw Error('Writer progression repair lost the manuscript prefill.');
                    const corrected=rebuilt.prompt.slice(0,place)+'<|im_start|>system\n'+extra+'\nContinue with a NEW causal scene event; do not replay established material.<|im_end|>\n'+rebuilt.prompt.slice(place);
                    const revised=filterReply(await sendChecked({...request,prompt:corrected,stream:false,temperature:Math.max(0.65,Math.min(1,settings.temperature)),rep_pen:Math.max(1.13,settings.repetition_penalty)}),filters);
                    const still=writerRepetitionIssue(revised,body.hero_writer?.text);
                    lastRun.writerProgressRepair={reason:issue,success:!!revised&&!still&&!isWriterNonProse(revised)};
                    if(!revised||still||isWriterNonProse(revised))throw Error('Writer continued repeating established manuscript events. The draft was preserved; choose Next Scene, edit the active beat, or try another prose model.');
                    text=revised;
                }
            }
            if(!text)throw new Error('The model returned only hidden reasoning or an empty reply. Try again or adjust Generation settings.');
            let usage;if(budgeted){try{usage={prompt_tokens:await countTokens(prompt),completion_tokens:await countTokens(text,false),context_size:contextSize};}catch(error){lastRun.metricsWarning=errorDetails(error);}}
            return {id:'hero-'+Date.now(),object:'text_completion',model:body.model||'local-model',usage,...(mode==='writer'?{writerContext:lastRun.writerContext}:{}),choices:[{index:0,text,finish_reason:'stop'}]};
        } catch(error){lastRun.error=errorDetails(error);lastRun.failedStage=lastRun.stage;throw error;} finally {lastRun.elapsedMs=Date.now()-lastRun.started;lastRun.finished=Date.now();signal?.removeEventListener('abort',abort);active=null;stage('idle');}
    }
    function abort(){active?.abort();if(fetchBackend===engineFetch){engineFetch(backendURL+'/api/extra/abort',{method:'POST',timeoutMs:3000}).catch(()=>{});const worker=getPlanningBackend();if(worker?.ready)engineFetch(worker.url+'/api/extra/abort',{method:'POST',timeoutMs:3000}).catch(()=>{});}}
    async function handle(req,res){
        if(!req.url.startsWith('/inference/'))return false;
        if(req.headers.origin){res.writeHead(403);res.end('Browser inference requests are not allowed.');return true;}
        const endpoint=req.url.slice('/inference'.length);
        const allowed = /^\/(?:v1\/(?:models|completions)|props|api\/(?:v1\/(?:model|config\/max_context_length)|extra\/(?:abort|tokenize|tokencount|version|true_max_context_length|generate\/stream|preloadstory)))\/?$/;
        if(!allowed.test(endpoint)){res.writeHead(404);res.end();return true;}
        const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort()});
        try{
            let payload='';for await(const chunk of req){payload+=chunk;if(payload.length>2000000)throw new Error('Prompt is too large.')}
            if(endpoint==='/api/extra/abort')abort();
            if(req.method==='POST'&&endpoint==='/v1/completions'){
                const body=JSON.parse(payload||'{}'),result=await generate(body,controller.signal,{mode:body.hero_mode==='image-prompt'?'image-prompt':body.hero_mode==='utility'?'utility':'chat'});
                if(body.stream){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store'});res.end('data: '+JSON.stringify(result)+'\n\ndata: [DONE]\n\n');}
                else{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));}
            }else{
                const reply=await fetchBackend(backendURL+endpoint,{method:req.method,headers:{'Content-Type':'application/json'},body:!['GET','HEAD'].includes(req.method)?payload:undefined,signal:controller.signal});
                res.writeHead(reply.status,{'Content-Type':reply.headers.get('content-type')||'application/json'});res.end(Buffer.from(await reply.arrayBuffer()));
            }
        }catch(e){if(!res.destroyed){res.writeHead(502,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:e.name==='AbortError'?'Reply generation stopped.':e.message}}));}}
        return true;
    }
    return {generate,handle,abort,runSnapshot};
}
module.exports={DEFAULTS,validateSettings,readSettings,saveSettings,replyPrompt,completionText,isWriterNonProse,createPipeline};
