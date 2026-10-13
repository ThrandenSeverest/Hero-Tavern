'use strict';
// Writer prompts are a fiction-completion task, not a request for an assistant to discuss fiction.
async function buildWriterContext(w,budget,count){
 const manuscript=String(w.text||'');
 const premise=String(w.prompt||'').trim();
 const operation=w.operation||'continue';
 const start=w.start??manuscript.length,end=w.end??start;
 const selection=manuscript.slice(start,end),source=manuscript.slice(0,start),suffix=operation==='continue'?'':manuscript.slice(end,end+6000);
 const activation=(manuscript.slice(-12000)+'\n'+premise).toLowerCase();
 const lore=Array.isArray(w.lore)?w.lore:[];
 const active=lore.filter(e=>e.enabled!==false&&(e.always||(e.keys||[]).some(k=>activation.includes(k.toLowerCase()))));
 if(operation==='continue'&&!manuscript.trim()&&!premise&&!String(w.note||'').trim())throw Error('Write a story prompt or some manuscript prose before generating.');
 const context=[
  premise?'[Story prompt — scenario to dramatize as fiction, NOT text to repeat]\n'+premise:'',
  w.memory?'[Established story facts]\n'+w.memory:'',
  ...active.map(e=>'[Lore: '+e.title+']\n'+e.text),
  w.note?'[Author direction — apply within the prose]\n'+w.note:''
 ].filter(Boolean).join('\n\n');
 const task=operation==='continue'
  ?(manuscript.trim()?'Continue the manuscript immediately after its last sentence. Output NEW fiction prose only, without repeating or recapping any manuscript text.':'Write the opening scene as fiction prose using the story prompt and author direction. Begin inside the scene, not with a summary or a profile.')
  :operation==='insert'
   ?'Write only the missing fiction prose at the caret, fitting naturally between the preceding and following passages.'
   :'Rewrite ONLY the selected passage as fiction prose, preserving adjacent events and continuity. Requested change: '+String(w.instruction||'');
 const guard='Start directly with scene narration, sensory details, action, thoughts or dialogue. Maintain the manuscript\'s language, viewpoint and tense (or the story prompt\'s language if there is no manuscript). Dramatically SHOW traits in the scene; never give a character sheet, appearance list, summary, headings, Markdown formatting, preface, acknowledgment or explanation of what you plan to write. Text inside square-bracket labels is context only. Do not copy those labels.';
 const repair=w.repair?'\n[Correction]\nYour previous draft was NOT story prose. Discard that draft entirely. Produce actual narrative sentences beginning with an action, description or dialogue; no introduction, outline, character dossier or assistant explanation.':'';
 const render=tail=>'<|im_start|>user\n'+(context?context+'\n\n':'')+'[Writing task]\n'+task+'\n'+guard+repair+(selection?'\n\n[Selected manuscript passage]\n'+selection:'')+(suffix?'\n\n[Manuscript after insertion]\n'+suffix:'')+'\n\n[Manuscript before insertion]\n'+(tail||'(no manuscript prose yet)')+'\n[End of manuscript context]\n\nWrite the passage now. Only story prose.<|im_end|>\n<|im_start|>assistant\n';
 if(await count(render(''))>budget)throw Error('Story prompt, memory, author note, lore or selection exceeds the available context. Shorten it or increase loaded context.');
 let low=0,high=source.length;
 while(low<high){const mid=Math.ceil((low+high)/2);if(await count(render(source.slice(-mid)))<=budget)low=mid;else high=mid-1;}
 const tail=low?source.slice(-low):'',prompt=render(tail);
 return {prompt,diagnostics:{activeLore:active.map(e=>e.title),omittedLore:lore.filter(e=>!active.includes(e)).map(e=>e.title),retainedCharacters:tail.length,omittedCharacters:source.length-tail.length,promptTokens:await count(prompt),budget}};
}
module.exports={buildWriterContext};
