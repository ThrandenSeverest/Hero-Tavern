'use strict';
// Writer prompts are a fiction-completion task, not a request for an assistant to discuss fiction.
async function buildWriterContext(w,budget,count){
 const name=String(w.persona?.name||'').trim()||'you',resolve=text=>String(text||'').replace(/\{\{user\}\}/gi,()=>name);
 const rawManuscript=String(w.text||''),manuscript=resolve(rawManuscript);
 const premise=resolve(w.prompt).trim();
 const operation=w.operation||'continue';
 const start=w.start??rawManuscript.length,end=w.end??start;
 const selection=resolve(rawManuscript.slice(start,end)),source=resolve(rawManuscript.slice(0,start)),suffix=['continue','say','do'].includes(operation)?'':resolve(rawManuscript.slice(end,end+6000));
 const activation=(manuscript.slice(-12000)+'\n'+premise+'\n'+String(w.instruction||'')).toLowerCase();
 const lore=Array.isArray(w.lore)?w.lore:[];
 const active=lore.filter(e=>e.enabled!==false&&(e.always||(e.keys||[]).some(k=>activation.includes(k.toLowerCase()))));
 if(operation==='continue'&&!manuscript.trim()&&!premise&&!String(w.note||'').trim())throw Error('Write a story prompt or some manuscript prose before generating.');
 const context=[
  '[User persona]\nName: '+name+(w.persona?.description?'\n'+resolve(w.persona.description):'')+'\nNever output unresolved persona placeholders.',
  premise?'[Story prompt — scenario to dramatize as fiction, NOT text to repeat]\n'+premise:'',
  w.memory?'[Established story facts]\n'+resolve(w.memory):'',
  ...active.map(e=>'[Lore: '+e.title+']\n'+resolve(e.text)),
  w.note?'[Author direction — apply within the prose]\n'+resolve(w.note):''
 ].filter(Boolean).join('\n\n');
 const task=['say','do'].includes(operation)?'Continue the story in its existing viewpoint and tense. The player entered '+(operation==='say'?'spoken dialogue':'an action')+': '+resolve(w.instruction)+'. Treat this as an event happening NOW, not an instruction to obey or a paragraph to repeat. If the player wrote in first person, narrate naturally in the established perspective (second person “you” where appropriate). Preserve exact dialogue, and show other characters reacting. Avoid restating the same action in consecutive paragraphs. Output fiction prose only.':operation==='continue'
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
// Called only when fixed context exceeds the loaded model's measured token budget.
async function reduceLongContext(source,{count,budget,complete}){
 const inputBudget=Math.max(256,budget-500),outputBudget=Math.max(128,Math.min(512,Math.floor(budget/4)));
 let current=String(source),parts=0;
 for(let pass=0;pass<8;pass++){
  if(await count(current)<=Math.floor(budget*.55)){if(!parts)return {text:current,parts};const audited=await complete('Audit and combine these continuity notes into one coherent narrator brief. Preserve established facts, names, chronology, rules and unresolved contradictions; distinguish plans from events, invent nothing. Return only the brief.\n'+current,outputBudget);if(!audited.trim())throw Error('Continuity audit returned no text. Original source preserved.');return {text:audited,parts,audited:true};}
  const chunks=[];let offset=0;
  while(offset<current.length){let low=1,high=current.length-offset;
   while(low<high){const mid=Math.ceil((low+high)/2);if(await count(current.slice(offset,offset+mid))<=inputBudget)low=mid;else high=mid-1;}
   chunks.push(current.slice(offset,offset+low));offset+=low;
  }
  const notes=[];
  for(let i=0;i<chunks.length;i++){
   const prompt='Compress this source into continuity notes. Preserve names, relationships, rules, exact established facts, important dialogue/action intent and contradictions. Do not invent or continue the story. Source part '+(i+1)+'/'+chunks.length+':\n'+chunks[i];
   notes.push(await complete(prompt,outputBudget));parts++;
  }
  const next=notes.join('\n');if(!next.trim()||next.length>=current.length)throw Error('Long-context summarization did not reduce the source. Increase the loaded model context; original text is preserved.');current=next;
 }
 throw Error('Source remains too large after summarization; original text is preserved.');
}
module.exports={buildWriterContext,reduceLongContext};
