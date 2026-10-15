'use strict';
// Writer prompts are a fiction-completion task, not a request for an assistant to discuss fiction.
async function buildWriterContext(w,budget,count){
 const name=String(w.persona?.name||'').trim()||'you',resolve=text=>String(text||'').replace(/\{\{user\}\}/gi,()=>name);
 const rawManuscript=String(w.text||''),manuscript=resolve(rawManuscript);
 const premise=resolve(w.prompt).trim();
 const operation=w.operation||'continue';
 const beats=Array.isArray(w.beats)?w.beats.filter(x=>typeof x==='string'&&x.trim()).slice(0,60):[];
 const beatIndex=Number.isInteger(w.beatIndex)?Math.max(0,Math.min(beats.length,w.beatIndex)):0;
 const activeBeat=resolve(beats[beatIndex]||''),futureBeat=resolve(beats[beatIndex+1]||'');
 const pace=['slow','steady','fast'].includes(w.settings?.scenePace)?w.settings.scenePace:'steady';
 const start=w.start??rawManuscript.length,end=w.end??start;
 const selection=resolve(rawManuscript.slice(start,end)),source=resolve(rawManuscript.slice(0,start)),suffix=['continue','say','do'].includes(operation)?'':resolve(rawManuscript.slice(end,end+6000));
 // A book-length premise must not activate lore for characters absent from the current scene.
 const activation=(manuscript.slice(-6500)+'\n'+(!manuscript.trim()?premise:'')+'\n'+activeBeat+'\n'+String(w.instruction||'')).toLowerCase();
 const lore=Array.isArray(w.lore)?w.lore:[];
 const isTriggered=entry=>entry.enabled!==false&&(entry.always||(entry.keys||[]).some(key=>{
  const term=String(key||'').trim().toLowerCase();
  // Require word boundaries for short names, so "Ann" does not fire on "annual".
  if(!term)return false;
  const looksWord=/^[\p{L}\p{N}_]+$/u.test(term);
  if(!looksWord)return activation.includes(term);
  return new RegExp('(^|[^\\p{L}\\p{N}_])'+term+'($|[^\\p{L}\\p{N}_])','iu').test(activation);
 }));
 const candidates=lore.filter(isTriggered).sort((a,b)=>Number(!!b.always)-Number(!!a.always));
 const loreBudget=Math.max(48,Math.min(1800,Math.floor(budget*0.19)));
 const chosen=[],skippedLore=[];let loreTokens=0;
 for(const e of candidates){
  const entry='[Lore: '+String(e.title||'')+']\n'+resolve(e.text||'');
  const tokens=await count(entry);
  if(!entry.trim()||loreTokens+tokens>loreBudget){skippedLore.push(e.title);continue;}
  chosen.push(entry);loreTokens+=tokens;
 }
 if(operation==='continue'&&!manuscript.trim()&&!premise&&!String(w.note||'').trim())throw Error('Write a story prompt or some manuscript prose before generating.');
 // Old chapters are not automatically rewritten or hallucinated into a recap.
 // Authors can curate this compact field independently of permanent canon.
 const recap=resolve(w.recap||'').trim();
 const context=[
  '[User persona]\nName: '+name+(w.persona?.description?'\n'+resolve(w.persona.description):'')+'\nNever output unresolved persona placeholders.',
  premise?'[Novel premise — long-term background and trajectory, not a command to restart the opening]\n'+premise:'',
  w.memory?'[Established story facts — permanent canon]\n'+resolve(w.memory):'',
  recap?'[Continuity recap — previous scenes; do not retell]\n'+recap:'',
  beats.length?'[Optional plot beats — advisory, never hold a resolved scene open]\nActive beat '+Math.min(beatIndex+1,beats.length)+' of '+beats.length+': '+(activeBeat||'All planned beats completed; continue from the latest manuscript.')+(futureBeat?'\nUpcoming possible development (use when current beat is resolved): '+futureBeat:''):'',
  ...chosen,
  w.note?'[Author direction — apply to the NEXT scene]\n'+resolve(w.note):''
 ].filter(Boolean).join('\n\n');
 const task=['say','do'].includes(operation)?'Continue the story in its existing viewpoint and tense. The player entered '+(operation==='say'?'spoken dialogue':'an action')+': '+resolve(w.instruction)+'. Treat this as an event happening NOW, not an instruction to obey or a paragraph to repeat. If the player wrote in first person, narrate naturally in the established perspective (second person “you” where appropriate). Preserve exact dialogue, and show other characters reacting. Avoid restating the same action in consecutive paragraphs. Output fiction prose only.':operation==='advance'
  ?(manuscript.trim()?'Advance into a genuinely subsequent scene or turning point from the manuscript endpoint. Carry forward the immediate consequences and unresolved goals; change the situation through a concrete action, decision, arrival, discovery or passage of time. Do NOT restart or retell the opening scene.':'Open the first scene in immediate action and dialogue.')
  :operation==='continue'
  ?(manuscript.trim()?'Continue from the CURRENT manuscript endpoint, not from the original premise. Develop cause and effect, and change the immediate situation through an action, exchange, discovery, resistance or decision. Never replay the first meeting, first description or an already completed beat.':'Write the opening scene as fiction prose using the story premise and active beat. Begin inside the scene, not with a summary or profile.')
  :operation==='insert'
   ?'Write only the missing fiction prose at the caret, fitting naturally between the preceding and following passages.'
   :'Rewrite ONLY the selected passage as fiction prose, preserving adjacent events and continuity. Requested change: '+String(w.instruction||'');
 const progression=manuscript.trim()?'\n[CURRENT PROGRESSION — more important than the broad premise]\nThis story has ALREADY BEGUN. The final manuscript lines are the current moment and are authoritative; events in the premise or previous manuscript have already happened if shown there. Write the NEXT event, not another variation of the setup. '+(activeBeat?'Use the current beat only if still unresolved; if it has already happened, move into the next consequence without revisiting it. ':'')+(pace==='fast'?'Move decisively to a new complication or a consequence within this passage.':pace==='slow'?'Allow measured emotional beats, but advance an observable interaction or decision.':'At least one meaningful action, reaction or decision should change the situation during this passage.'):'';
 const eventGuard=['say','do'].includes(operation)?' The player\'s '+(operation==='say'?'exact words':'action')+' are ALREADY written as the final manuscript beat. Do not repeat, rephrase or contradict that beat; immediately describe how the environment and other characters react. Make a meaningful consequence within the next two sentences. Never acknowledge this instruction.': '';
 const guard='Start directly with scene narration, sensory details, action, thoughts or dialogue. Maintain the manuscript\'s language, viewpoint and tense (or the story prompt\'s language if there is no manuscript). Dramatically SHOW traits in the scene; never give a character sheet, appearance list, summary, headings, Markdown formatting, preface, acknowledgment or explanation of what you plan to write. Text inside square-bracket labels is context only. Do not copy those labels.';
 const repair=w.repair?'\n[Correction]\nYour previous draft was NOT story prose. Discard that draft entirely. Produce actual narrative sentences beginning with an action, description or dialogue; no introduction, outline, character dossier or assistant explanation.':w.flowRepair?'\n[Scene progression repair]\nThe previous attempt repeated recent manuscript events or stalled in the setup. Start from the last established consequence and write a DIFFERENT NEXT action or change of circumstances. No paraphrases of prior dialogue or a second opening.':'';
 // Never put manuscript prose in a partially opened assistant turn.
 // Qwen3's non-thinking suffix and non-ChatML model serializers require an
 // EMPTY assistant boundary. The manuscript is authoritative user context.
 // This is a writing/completion task, not a roleplay chat message.
 const render=tail=>'<|im_start|>system\n'+
  'You are a novelist writing the NEXT portion of a manuscript. Respond with ONLY finished literary prose. Do not address the author or describe your writing process. Never output prompt labels, bracketed instructions, outlines or analysis. /no_think<|im_end|>\n'+
  '<|im_start|>user\n'+
  (context?context+'\n\n':'')+
  '[Writing objective]\n'+task+'\n'+guard+progression+eventGuard+repair+
  '\nNarrative autonomy: give supporting characters realistic actions, choices and reactions. Do NOT invent dialogue, decisions, movements or thoughts for the author-controlled persona '+name+'; only use those the author actually wrote. Respect existing narrative point of view. '+
  (operation==='rewrite'||operation==='insert'?'Return only prose that fits exactly at the selected location.':'Write several complete, connected paragraphs (typically 120–250 words, within the output token limit). Follow cause and effect; when a scene reaches a natural turning point or conclusion, transition organically to the next scene without asking the author to choose a mode.')+
  (selection?'\n\n[Selected passage]\n'+selection:'')+
  (suffix?'\n\n[Following passage to preserve]\n'+suffix:'')+
  '\n\n[Manuscript already written — all events here HAVE HAPPENED; do not repeat or summarize]\n'+(tail||'(Opening scene has not been written yet.)')+
  '\n[END OF EXISTING MANUSCRIPT]\nWrite ONLY the NEW prose that comes after this endpoint; do not include old text or these instructions.<|im_end|>\n<|im_start|>assistant\n';
 if(await count(render(''))>budget)throw Error('Story prompt, memory, author note, lore or selection exceeds the available context. Shorten it or increase loaded context.');
 let low=0,high=source.length;
 while(low<high){const mid=Math.ceil((low+high)/2);if(await count(render(source.slice(-mid)))<=budget)low=mid;else high=mid-1;}
 const tail=low?source.slice(-low):'',prompt=render(tail);
 return {prompt,diagnostics:{activeLore:candidates.filter(e=>!skippedLore.includes(e.title)).map(e=>e.title),omittedLore:lore.filter(e=>!candidates.includes(e)).map(e=>e.title),budgetSkippedLore:skippedLore,loreTokens,loreBudget,recapCharacters:recap.length,canonCharacters:String(w.memory||'').length,retainedCharacters:tail.length,omittedCharacters:source.length-tail.length,promptTokens:await count(prompt),budget,continuationPrefill:tail.length>0,beatIndex,activeBeat:activeBeat.slice(0,220),beatCount:beats.length,scenePace:pace,manuscriptStarted:!!manuscript.trim()}};
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
