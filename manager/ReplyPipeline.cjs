// Buffered inference proxy: hidden planning is ephemeral, never returned to chat.
const fs = require('node:fs'), path = require('node:path');
const { filterReply, isMetaReply, repetitionIssue } = require('./ReplyFilters.cjs');
const {createMemory}=require('./ContextMemory.cjs');
const DEFAULTS = Object.freeze({thinkingMode:'off',temperature:0.8,top_p:0.9,min_p:0.05,repetition_penalty:1.08,memoryEnabled:true,memoryTokens:512,recentMessages:12,maxReplyTokens:512,planningTokens:192,replyStyle:'mixed',instructions:'',removeModelTokens:true,stopAtSpeaker:true,dedupeParagraphs:false,repairMetaReplies:true,avoidRepetition:true,repetitionSensitivity:0.83,stopMarkers:[]});
function validateSettings(input = {}) {
    const value = {};
    for (const key of Object.keys(DEFAULTS)) value[key] = input[key] === undefined ? DEFAULTS[key] : input[key];
    if (!['off','separate'].includes(value.thinkingMode)) throw new Error('Choose disabled thinking or separate planning.');
    if (!['mixed','dialogue'].includes(value.replyStyle)) throw new Error('Choose dialogue with narration or dialogue only.');
    for (const [key,min,max] of [['repetitionSensitivity',0.7,0.98],['temperature',0,2],['top_p',0.01,1],['min_p',0,1],['repetition_penalty',1,2],['maxReplyTokens',32,4096],['memoryTokens',128,1024],['recentMessages',2,100],['planningTokens',32,1024]]) {
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
function createPipeline({root,backendURL,setState=()=>{},fetchBackend=fetch,enforceContext=false,setDiagnostics=()=>{}}) {
    let active = null;
    async function generate(body, signal, {mode='chat'}={}) {
        if(active)throw new Error('A reply is already being generated. Stop it before starting another.');
        if(typeof body.prompt!=='string')throw new Error('The local reply pipeline requires a text prompt.');
        const settings=readSettings(root), controller=new AbortController();active=controller;
        const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
        if(signal?.aborted)controller.abort();
        try {
            let plan='';
            const send=async request=>completionText(await fetchBackend(backendURL+'/v1/completions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify((({hero_context,...value})=>value)(request)),signal:controller.signal}));
            const contextSize=fs.existsSync(path.join(root,'backend.json'))?JSON.parse(fs.readFileSync(path.join(root,'backend.json'),'utf8').replace(/^\uFEFF/, '')).contextSize:4096;
            const countTokens=async prompt=>{
                const response=await fetchBackend(backendURL+'/api/extra/tokencount',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt}),signal:controller.signal});
                if(response.ok){const value=await response.json();if(Number.isFinite(value.value)&&value.value>=0)return value.value;if(Array.isArray(value.ids))return value.ids.length;}
                // UTF-8 byte count is a conservative fallback, never a guessed 4-chars-per-token limit.
                return Buffer.byteLength(prompt,'utf8');
            };
            const taskInstruction=mode==='adventure'?'Follow the requested Ilreon schema and rules exactly. Return valid JSON when requested, otherwise the requested narration or compact notes. Preserve authoritative game state; never output reasoning. /no_think':mode==='character'?'Create the requested character card as valid JSON. Return only the requested object without reasoning. /no_think':mode==='summary'?'Summarize the supplied established facts, without inventing details. Return factual notes only, no reasoning. /no_think':instructions(settings);
            const budgeted=enforceContext||!!body.hero_context||mode!=='chat';
            const replyTokens=mode==='adventure'||mode==='character'?Math.max(1024,settings.maxReplyTokens):settings.maxReplyTokens;
            const overhead=budgeted?await countTokens(taskInstruction+'\n<|im_start|>system\n<|im_end|>\n')+96:0;
            const budget=contextSize-replyTokens-overhead-(mode==='chat'&&settings.thinkingMode==='separate'?settings.planningTokens+96:0);
            if(budget<128)throw Error('Reply and planning budgets leave no room for history. Lower Generation reply length or increase Hardware context.');
            if(body.hero_context){
                const memory=createMemory({root,countTokens,setDiagnostics,complete:async(prompt,max_tokens)=>filterReply(await send({prompt:replyPrompt('<|im_start|>user\n'+prompt+'<|im_end|>\n<|im_start|>assistant\n', 'Return compact continuity facts only. /no_think'),max_tokens,temperature:0.2,stream:false}),{stopAtSpeaker:false,removeModelTokens:true})});
                setState('remembering');body={...body,prompt:await memory.prepare(body,budget,settings)};
            }
            const sendChecked=async request=>{if(budgeted&&await countTokens(request.prompt)+request.max_tokens>contextSize)throw Error('Prompt exceeds the loaded context. Increase Hardware context or shorten the character card/instructions. Chat history was not silently discarded.');return send(request)};
            if(mode==='chat'&&settings.thinkingMode==='separate'){
                setState('planning');
                const prompt=replyPrompt(body.prompt,'[Private continuity outline]\nBriefly list the scene facts, character intent and next-reply goal. Do not write dialogue or a final answer. This outline is not shown to the user. /no_think\n[/Private continuity outline]');
                plan=filterReply(await sendChecked({...body,prompt,stream:false,max_tokens:settings.planningTokens,temperature:0.4}),settings).slice(0,6000);
            }
            setState('responding');
            const extra=taskInstruction+(body.hero_context?.generationType==='continue'?'\nContinue the last assistant reply without repeating its existing text.':'')+(plan?'\n[Private continuity notes — do not quote or reproduce]\n'+plan+'\n[/Private continuity notes]':'');
            let prompt=replyPrompt(body.prompt,extra);
            // Close an inherited reasoning prefill even in existing SillyTavern profiles.
            if(/<think>\s*$/i.test(prompt))prompt+='\n</think>\n';
            const raw=await sendChecked({...body,prompt,stream:!!body.stream,max_tokens:replyTokens,temperature:settings.temperature,top_p:settings.top_p,min_p:settings.min_p,rep_pen_range:1024,rep_pen:settings.repetition_penalty,repetition_penalty:settings.repetition_penalty});
            const filters=mode==='chat'?settings:{removeModelTokens:true,stopAtSpeaker:false};
            let text=filterReply(raw,filters);
            const history=body.hero_context?.messages||[...body.prompt.matchAll(/<\|im_start\|>(user|assistant)\n([\s\S]*?)<\|im_end\|>/g)].map(x=>({role:x[1],text:x[2]}));
            const repetitive=mode==='chat'&&settings.avoidRepetition?repetitionIssue(text,history,settings.repetitionSensitivity):'';
            const meta=mode==='chat'&&settings.repairMetaReplies&&isMetaReply(text);
            if(meta||repetitive) {
                const repairedPrompt=replyPrompt(body.prompt,extra+'\nCORRECT THE DRAFT: '+(repetitive||'The draft was writer commentary.')+' Write a fresh reply that answers the most recent user message and moves the scene forward. Do not reuse previous reply sentences, echo the user, announce narrator roles or explain how you will answer.');
                text=filterReply(await sendChecked({...body,prompt:repairedPrompt,stream:false,max_tokens:replyTokens,temperature:repetitive?Math.max(0.75,Math.min(settings.temperature,1)):Math.min(settings.temperature,0.7),rep_pen:Math.max(settings.repetition_penalty,1.15),repetition_penalty:Math.max(settings.repetition_penalty,1.15),rep_pen_range:1024}),settings);
                if(settings.avoidRepetition&&repetitionIssue(text,history,settings.repetitionSensitivity))throw Error('The model repeated the conversation again. Try regenerate or adjust repetition sensitivity / sampling in Generation. The repeated draft was hidden.');
                if(settings.repairMetaReplies&&isMetaReply(text))throw new Error('The model is still returning writer commentary. Review the character card and Generation writing instructions, then retry.');
            }
            if(!text)throw new Error('The model returned only hidden reasoning or an empty reply. Try again or adjust Generation settings.');
            return {id:'hero-'+Date.now(),object:'text_completion',model:body.model||'local-model',choices:[{index:0,text,finish_reason:'stop'}]};
        } finally {signal?.removeEventListener('abort',abort);active=null;setState('idle');}
    }
    function abort(){active?.abort()}
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
                const body=JSON.parse(payload||'{}'),result=await generate(body,controller.signal);
                if(body.stream){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store'});res.end('data: '+JSON.stringify(result)+'\n\ndata: [DONE]\n\n');}
                else{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));}
            }else{
                const reply=await fetchBackend(backendURL+endpoint,{method:req.method,headers:{'Content-Type':'application/json'},body:!['GET','HEAD'].includes(req.method)?payload:undefined,signal:controller.signal});
                res.writeHead(reply.status,{'Content-Type':reply.headers.get('content-type')||'application/json'});res.end(Buffer.from(await reply.arrayBuffer()));
            }
        }catch(e){if(!res.destroyed){res.writeHead(502,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:e.name==='AbortError'?'Reply generation stopped.':e.message}}));}}
        return true;
    }
    return {generate,handle,abort};
}
module.exports={DEFAULTS,validateSettings,readSettings,saveSettings,replyPrompt,completionText,createPipeline};
