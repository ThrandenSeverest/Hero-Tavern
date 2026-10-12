// Buffered inference proxy: hidden planning is ephemeral, never returned to chat.
const fs = require('node:fs'), path = require('node:path');
const { filterReply, isMetaReply } = require('./ReplyFilters.cjs');
const DEFAULTS = Object.freeze({thinkingMode:'off',temperature:0.8,top_p:0.9,min_p:0.05,repetition_penalty:1.08,maxReplyTokens:512,planningTokens:192,replyStyle:'mixed',instructions:'',removeModelTokens:true,stopAtSpeaker:true,dedupeParagraphs:false,repairMetaReplies:true,stopMarkers:[]});
function validateSettings(input = {}) {
    const value = {};
    for (const key of Object.keys(DEFAULTS)) value[key] = input[key] === undefined ? DEFAULTS[key] : input[key];
    if (!['off','separate'].includes(value.thinkingMode)) throw new Error('Choose disabled thinking or separate planning.');
    if (!['mixed','dialogue'].includes(value.replyStyle)) throw new Error('Choose dialogue with narration or dialogue only.');
    for (const [key,min,max] of [['temperature',0,2],['top_p',0.01,1],['min_p',0,1],['repetition_penalty',1,2],['maxReplyTokens',32,2048],['planningTokens',32,1024]]) {
        if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < min || value[key] > max || (key.endsWith('Tokens') && !Number.isInteger(value[key]))) throw new Error('Invalid '+key+' value.');
    }
    for (const key of ['removeModelTokens','stopAtSpeaker','dedupeParagraphs','repairMetaReplies']) if (typeof value[key] !== 'boolean') throw new Error('Invalid filter setting.');
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
        settings.instructions, '/no_think', '[/Hero Tavern reply instructions]'].filter(Boolean).join('\n');
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
function createPipeline({root,backendURL,setState=()=>{},fetchBackend=fetch}) {
    let active = null;
    async function generate(body, signal) {
        if(active)throw new Error('A reply is already being generated. Stop it before starting another.');
        if(typeof body.prompt!=='string')throw new Error('The local reply pipeline requires a text prompt.');
        const settings=readSettings(root), controller=new AbortController();active=controller;
        const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
        if(signal?.aborted)controller.abort();
        try {
            let plan='';
            const send=async request=>completionText(await fetchBackend(backendURL+'/v1/completions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),signal:controller.signal}));
            if(settings.thinkingMode==='separate'){
                setState('planning');
                const prompt=replyPrompt(body.prompt,'[Private continuity outline]\nBriefly list the scene facts, character intent and next-reply goal. Do not write dialogue or a final answer. This outline is not shown to the user. /no_think\n[/Private continuity outline]');
                plan=filterReply(await send({...body,prompt,stream:false,max_tokens:settings.planningTokens,temperature:0.4}),settings).slice(0,6000);
            }
            setState('responding');
            const extra=instructions(settings)+(plan?'\n[Private continuity notes — do not quote or reproduce]\n'+plan+'\n[/Private continuity notes]':'');
            let prompt=replyPrompt(body.prompt,extra);
            // Close an inherited reasoning prefill even in existing SillyTavern profiles.
            if(/<think>\s*$/i.test(prompt))prompt+='\n</think>\n';
            const raw=await send({...body,prompt,stream:!!body.stream,max_tokens:settings.maxReplyTokens,temperature:settings.temperature,top_p:settings.top_p,min_p:settings.min_p,rep_pen:settings.repetition_penalty,repetition_penalty:settings.repetition_penalty});
            let text=filterReply(raw,settings);
            if(settings.repairMetaReplies && isMetaReply(text)) {
                const repairedPrompt=replyPrompt(body.prompt,extra+'\nThe previous draft was a writer announcement instead of a character reply. Return the actual next scene reply now. Do not announce narrator roles or explain how you will answer.');
                text=filterReply(await send({...body,prompt:repairedPrompt,stream:false,max_tokens:settings.maxReplyTokens,temperature:Math.min(settings.temperature,0.7)}),settings);
                if(isMetaReply(text))throw new Error('The model is still returning writer commentary. Review the character card and Generation writing instructions, then retry.');
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
