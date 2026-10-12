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
    const api = { filterReply, isMetaReply };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.HeroReplyFilters = api;
})(globalThis);
