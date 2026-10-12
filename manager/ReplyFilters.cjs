// Shared reply cleanup used by the local proxy and the SillyTavern extension.
(function(root) {
    function filterReply(input, options = {}) {
        let text = String(input || '').replace(/^\uFEFF/, '');
        // Only decode known reasoning tags; never turn arbitrary escaped HTML into markup.
        text = text.replace(/&lt;(\/?(?:think|analysis|reasoning))(?:\s[^&]*?)?&gt;/gi, '<$1>');
        text = text.replace(/<\s*(think|analysis|reasoning)\b[^>]*>[\s\S]*?(?:<\s*\/\s*\1\s*>|$)/gi, '');
        text = text.replace(/\[(think|analysis|reasoning)\][\s\S]*?(?:\[\/\1\]|$)/gi, '');
        // Some models inherit an opening think tag from the prompt, so only emit its closer.
        const closers = [...text.matchAll(/<\s*\/\s*(?:think|analysis|reasoning)\s*>/gi)];
        if (closers.length) { const last = closers[closers.length - 1]; text = text.slice(last.index + last[0].length); }
        text = text.replace(/<\|start\|>assistant<\|channel\|>analysis<\|message\|>[\s\S]*?(?=<\|start\|>assistant<\|channel\|>final<\|message\|>|$)/gi, '');
        text = text.replace(/^\s*(?:Analysis|Reasoning)\s*:\s*[\s\S]*?\n(?:Final(?: answer)?|Response)\s*:\s*/i, '');
        if (options.stopAtSpeaker !== false) {
            const nextRole = /<\|im_start\|>\s*(?:user|system)|<\|start_header_id\|>\s*(?:user|system)/i.exec(text);
            if (nextRole) text = text.slice(0, nextRole.index);
        }
        for (const marker of options.stopMarkers || []) {
            if (!marker) continue;
            const index = text.indexOf(marker); if (index >= 0) text = text.slice(0, index);
        }
        if (options.removeModelTokens !== false) {
            text = text.replace(/<\|im_start\|>\s*assistant\s*/gi, '').replace(/<\|start\|>assistant<\|channel\|>final<\|message\|>/gi, '');
            text = text.replace(/<\|(?:im_start|im_end|endoftext|eot_id|start_header_id|end_header_id|begin_of_text|end_of_text|start|end|message|channel|finetune_right_pad)\|>/gi, '');
        }
        if (options.dedupeParagraphs) {
            const seen = new Set();
            text = text.split(/\n\s*\n/).filter(paragraph => { const key = paragraph.trim(); if (!key) return false; if (seen.has(key)) return false; seen.add(key); return true; }).join('\n\n');
        }
        return text.trim();
    }
    function isMetaReply(text) {
        // Limit this to writer/assistant announcements, not character refusals or ordinary thoughts.
        const plain=String(text||'').replace(/<[^>]*>/g,'').trim();
        return /^(?:(?:[\p{L}\p{N}_-]+\s+){0,4})(?:will|should|need to|must)\s+(?:write|respond|answer|roleplay|act)\s+(?:as|in|with|to)\b/iu.test(plain)
            || /^(?:Okay[,!.]?\s*)?(?:let me (?:think|analy[sz]e)|I (?:need to|should|must) (?:respond|answer|write)|as an AI|the user (?:wants|asked))/i.test(plain);
    }
    function repetitionIssue(text, messages = [], threshold = 0.83) {
        const normalize=value=>String(value||'').normalize('NFKC').toLocaleLowerCase().replace(/<[^>]*>/g,' ').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
        const plain=normalize(text);if(plain.length<60)return '';
        const words=plain.split(/\s+/),grams=w=>new Set(w.slice(0,-2).map((_,i)=>w.slice(i,i+3).join(' ')));
        const current=grams(words);
        for(const message of messages.slice(-8)){
            if(message.role==='system')continue;const previous=normalize(message.text);
            if(plain===previous)return message.role==='user'?'The draft copies the user message.':'The draft repeats an earlier assistant reply.';
            if(words.length<18||previous.length<80||current.size<12)continue;
            const old=grams(previous.split(/\s+/));let common=0;for(const g of current)if(old.has(g))common++;
            if(common/current.size>=threshold&&common>=12)return message.role==='user'?'The draft mostly echoes the user message.':'The draft mostly reuses an earlier assistant reply.';
        }
        const parts=String(text).split(/\n\s*\n|(?<=[.!?。！？])\s+/),seen=new Set();let duplicate=0,total=0;
        for(const part of parts){const key=normalize(part);if(key.length<60)continue;total+=key.length;if(seen.has(key))duplicate+=key.length;seen.add(key);}
        return duplicate>120&&duplicate/Math.max(1,total)>0.25?'The draft repeats long sentences or paragraphs within itself.':'';
    }
    const api = { filterReply, isMetaReply, repetitionIssue };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.HeroReplyFilters = api;
})(globalThis);
