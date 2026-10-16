'use strict';
const crypto=require('node:crypto');
const {createWriterStore}=require('./WriterStore.cjs');
function writerEvent(operation,raw,name=''){
 if(!['say','do'].includes(operation))return '';
 const instruction=String(raw||'').replace(/[\r\n\t]+/g,' ').replace(/\s+/g,' ').trim();
 if(!instruction||instruction.length>2000)throw Error('Enter a dialogue or action of 1–2000 characters.');
 if(operation==='say'){
  // Treat the exact words as dialogue, not a suggestion for the AI to paraphrase.
  const spoken=instruction.replace(/^(?:"|“|«)/,'').replace(/(?:"|”|»)$/,'').trim();
  if(!spoken)throw Error('Enter words to say.');
  const actor=String(name||'').trim();
  return (actor?actor+' says, ':'You say, ')+'“'+spoken+'”';
 }
 let action=instruction.replace(/^\*+|\*+$/g,'').trim();
 if(/^(?:I|я)\s+/i.test(action))action=action.replace(/^I\s+am\s+/i,'You are ').replace(/^I\s+have\s+/i,'You have ').replace(/^I\s+/i,'You ').replace(/^я\s+/i,'Я ');
 else if(/^(?:(?:you|ты|вы)\s+)/i.test(action))action=action[0].toUpperCase()+action.slice(1);
 else if(/^[a-z]/.test(action)&&!(/^(?:he|she|they|savos|mira)\s+/i.test(action)))action='You '+action;
 else action=action[0].toUpperCase()+action.slice(1);
 return action.match(/[.!?…]$/)?action:action+'.';
}

function createWriterAPI(root,pipeline,{ensureText=async()=>{}}={}){
 const store=createWriterStore(root),candidates=new Map();let active=null;
 async function action(route,data={},signal){
  const op=route.replace('/writer/api/','');
  if(op==='list')return store.list();if(op==='create')return store.create(data.story);if(op==='get')return store.read(data.id);
  if(op==='checkpoint')return store.checkpoint(data.id,data.label,data.expectedVersion);if(op==='checkpoint-restore')return store.restoreCheckpoint(data.id,data.checkpointId,data.expectedVersion);if(op==='checkpoint-delete')return store.deleteCheckpoint(data.id,data.checkpointId,data.expectedVersion);
  if(op==='save')return store.save(data.id,data.story,data.expectedVersion);if(op==='restore')return store.restore(data.id,data.revision,data.expectedVersion);if(op==='fork')return store.fork(data.id);if(op==='delete')return store.remove(data.id);
  if(op==='import'){if(data.story?.schemaVersion!==1&&data.story?.schemaVersion!==undefined)throw Error('Unsupported Writer export version.');return store.create(data.story)}
  if(op==='plan-beats'){
   if(active)throw Error('Writer is already generating.');
   const w=store.read(data.id);
   if(w.version!==data.expectedVersion)throw Error('Save the latest manuscript before planning its next beats.');
   if(!w.prompt.trim()&&!w.text.trim())throw Error('Add a story premise or manuscript prose before planning.');
   const controller=new AbortController();active=controller;const abort=()=>controller.abort();
   signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)controller.abort();
   try{
    await ensureText(controller.signal);if(controller.signal.aborted)throw Error('Scene planning cancelled.');
    const existing=(w.beats||[]).slice(w.beatIndex||0,w.beatIndex+4);
    const latest=String(w.text||'').slice(-4500);
    const direction='You are the beat planner for a fiction manuscript, NOT its narrator. Return exactly one JSON object: {"beats":["specific causal event", "..."]}. Produce 4 to 6 DISTINCT upcoming scene beats. Each beat must be a concrete event: character goal/action, friction or complication, and a resulting choice or change. Progress from the current manuscript endpoint through cause and effect. Do not replay the first scene or earlier finished events. Do not write prose, introductions or the novel itself. Never assume plans have already happened. Keep the established viewpoint, world, chronology and ongoing character agency. /no_think';
    const source='[Long-term premise; NOT the scene to restart]\n'+w.prompt.slice(0,3500)+'\n[Permanent canon]\n'+w.memory.slice(0,1800)+'\n[Earlier chapters — already happened]\n'+w.recap.slice(-2000)+'\n[Current direction]\n'+w.note.slice(0,700)+'\n[Existing scheduled beats — avoid duplication]\n'+existing.join('\n')+'\n[MANUSCRIPT TAIL — the current moment]\n'+latest+'\n[Instruction]\nPlan what happens AFTER this exact endpoint. Provide 4–6 sequential, consequential scenes or beats.';
    let error;
    for(let attempt=0;attempt<2;attempt++){
     const prompt='<|im_start|>system\n'+direction+'<|im_end|>\n<|im_start|>user\n'+source+(attempt?'\nYour last format was invalid: '+error+'. Return only one complete JSON object with a beats string array.':'')+'<|im_end|>\n<|im_start|>assistant\n';
     const response=await pipeline.generate({prompt,stream:false,max_tokens:1200,temperature:0.55,hero_mode:'utility'},controller.signal,{mode:'utility'});
     try{
      const {parseModelJSON}=require('./StoryState.cjs');
      const parsed=parseModelJSON(response.choices?.[0]?.text||'');
      if(!Array.isArray(parsed.beats)||parsed.beats.length<3||parsed.beats.length>8)throw Error('Expected 3–8 beats.');
      const beats=parsed.beats.map(x=>typeof x==='string'?x.trim():'');
      if(beats.some(x=>x.length<15||x.length>600)||new Set(beats.map(x=>x.toLowerCase())).size!==beats.length)throw Error('Beats must be distinct, descriptive sentences of 15–600 characters.');
      return {beats,atVersion:w.version,sourceCharacters:latest.length};
     }catch(e){error=e.message}
    }
    throw Error('Scene planner could not return a usable outline: '+error+'. Manuscript and existing beats were preserved.');
   }finally{active=null;signal?.removeEventListener('abort',abort);}
  }

  if(op==='cancel'){active?.abort();if(active)pipeline.abort();return {cancelled:!!active}}
  if(op==='accept'){
   const candidate=candidates.get(data.candidateId);if(!candidate||candidate.storyId!==data.id)throw Error('Candidate expired or belongs to another story.');
   const s=store.read(data.id);if(s.version!==candidate.version)throw Error('Draft changed after generation. Candidate preserved; copy it or retry from the new draft.');
   const before=s.text.slice(0,candidate.start),after=s.text.slice(candidate.end);let prose=candidate.text;if(candidate.operation!=='rewrite'&&before&&!/\s$/.test(before)&&prose&&!/^[\s.,;:!?…)}\]]/.test(prose))prose=' '+prose;if(after&&prose&&/[\p{L}\p{N}]$/u.test(prose)&&/^[\p{L}\p{N}]/u.test(after))prose+=' ';
   const result=store.save(s.id,{text:before+prose+after,label:'Accepted '+candidate.operation},s.version);
   return result;
  }
  if(op==='generate-apply'||op==='regenerate'){
   if(active)throw Error('Writer is already generating.');const original=store.read(data.id);
   if(original.version!==data.expectedVersion)throw Error('Draft changed in another window. Save and retry.');
   const operation=data.operation||'continue';if(!['continue','advance','insert','rewrite','say','do'].includes(operation))throw Error('Unknown Writer operation.');
   let start=data.start,end=data.end,base=original.text,existing=null;
   if(op==='regenerate'){
    if(data.generationId){
      existing=(original.generations||[]).find(g=>g.id===data.generationId);
      if(!existing||original.text.slice(existing.start,existing.end)!==existing.text)throw Error('This generation was manually edited or its boundary changed. Restore its revision or generate a new segment.');
      start=existing.start;end=existing.end;
    }else{
      const replacement=data.replacement;
      if(!replacement||!Number.isInteger(replacement.start)||typeof replacement.text!=='string'||original.text.slice(replacement.start,replacement.start+replacement.text.length)!==replacement.text)throw Error('Generated passage was edited. Use Undo or restore the previous draft before retrying.');
      start=replacement.start;end=start+replacement.text.length;
      existing=(original.generations||[]).find(g=>g.start===start&&g.end===end)||null;
    }
    base=original.text.slice(0,start)+original.text.slice(end);
    end=start;
   }
   else if(['continue','advance','say','do'].includes(operation))start=end=base.length;
   if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<start||end>base.length||operation==='rewrite'&&start===end)throw Error('Select a valid manuscript passage.');
   if(['say','do'].includes(operation)&&op!=='regenerate')writerEvent(operation,data.instruction,original.persona?.name);
   const controller=new AbortController();active=controller;const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)controller.abort();
   try{await ensureText(controller.signal);
    const instruction=op==='regenerate'?(existing?.instruction||''):(data.instruction||'');
    const event=op!=='regenerate'&&['say','do'].includes(operation)?writerEvent(operation,instruction,original.persona?.name):'';
    const tail=event?(base&& !/\s$/.test(base)?'\n\n':'')+event+'\n\n':'';
    const isMidpoint=op==='regenerate'&&start<original.text.length-(existing?.text?.length||0);
    const modelOperation=isMidpoint?'insert':operation;
    const position=op==='regenerate'?start:base.length;
    const writerText=op==='regenerate'?base.slice(0,position)+tail+base.slice(position):base+tail;
    const caret=position+tail.length;
    const result=await pipeline.generate({prompt:'',writerSettings:original.settings,hero_writer:{...original,text:writerText,operation:modelOperation,start:caret,end:caret,instruction},stream:false},controller.signal,{mode:'writer'});let prose=String(result.choices?.[0]?.text||'').replace(/\{\{user\}\}/gi,()=>original.persona?.name?.trim()||'you');if(!prose.trim())throw Error('The model returned no prose; original draft preserved.');if(event)prose=tail+prose;
   const before=base.slice(0,start),after=base.slice(end);if(operation!=='rewrite'&&before&&!/\s$/.test(before)&&! /^[\s.,;:!?…)}\]]/.test(prose))prose=' '+prose;if(after&&prose&&/[\p{L}\p{N}]$/u.test(prose)&&/^[\p{L}\p{N}]/u.test(after))prose+=' ';
   const nextText=before+prose+after;
   const prevSegments=(original.generations||[]).filter(g=>g.id!==existing?.id);
   const {reconcileGenerations}=require('./WriterStore.cjs');
   const segments=reconcileGenerations(original.text,nextText,prevSegments);
   if(event){const authorOffset=before.length+(prose.startsWith(' ')?1:0);segments.push({id:crypto.randomUUID(),kind:'manual',at:Date.now(),start:authorOffset,end:authorOffset+tail.length,text:tail,operation,instruction:String(instruction||'').slice(0,2000)});}
   segments.push({id:existing?.id||crypto.randomUUID(),kind:'generated',at:Date.now(),start:before.length+(event?prose.indexOf(tail)+tail.length:0),end:before.length+prose.length,text:event?prose.slice(prose.indexOf(tail)+tail.length):prose,operation,instruction:op==='regenerate'?(existing?.instruction||''):String(data.instruction||'').slice(0,2000)});
   // "Next Scene" is an explicit scene-advance command, not another
   // rewrite of the current beat. Move to the following beat only after
   // the prose is actually committed. Regeneration must not skip beats.
   const nextBeatIndex=op==='generate-apply'&&operation==='advance'
    ?Math.min((original.beats||[]).length,original.beatIndex+1):original.beatIndex;
   const saved=store.save(original.id,{text:nextText,generations:segments,beatIndex:nextBeatIndex,label:op==='regenerate'?'Regenerated '+operation:'Generated '+operation},original.version);
   return {story:saved,generation:saved.generations.find(g=>g.id===(existing?.id||segments.at(-1)?.id))||null,replacement:{start:before.length,text:prose},usage:result.usage,context:result.writerContext};
   }finally{active=null;signal?.removeEventListener('abort',abort);}
  }
  if(op==='generate'){
   if(active)throw Error('Writer is already generating.');const s=store.read(data.id);if(s.version!==data.expectedVersion)throw Error('Save the draft before generating.');
   const operation=data.operation||'continue';if(!['continue','advance','insert','rewrite','say','do'].includes(operation))throw Error('Unknown Writer operation.');
   const append=['continue','advance','say','do'].includes(operation),start=append?s.text.length:data.start,end=append?s.text.length:data.end;
   if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<start||end>s.text.length||operation==='rewrite'&&start===end)throw Error('Select a valid manuscript passage.');
   if(typeof (data.instruction||'')!=='string'||(data.instruction||'').length>2000)throw Error('Invalid rewrite instruction.');
   if(['say','do'].includes(operation))writerEvent(operation,data.instruction,s.persona?.name);
   const controller=new AbortController();active=controller;const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)controller.abort();
   try{await ensureText(controller.signal);if(controller.signal.aborted)throw Error('Writer generation cancelled.');
    const event=writerEvent(operation,data.instruction,s.persona?.name),tail=event?(s.text&&!/\s$/.test(s.text)?'\n\n':'')+event+'\n\n':'';
    const r=await pipeline.generate({prompt:'',writerSettings:s.settings,hero_writer:{...s,text:s.text+tail,operation,start:(s.text+tail).length,end:(s.text+tail).length,instruction:data.instruction||''},stream:false},controller.signal,{mode:'writer'});
    let prose=r.choices[0].text.replace(/\{\{user\}\}/gi,()=>s.persona?.name?.trim()||'you');if(event)prose=tail+prose;
    const candidate={id:crypto.randomUUID(),storyId:s.id,version:s.version,operation,start,end,text:prose,usage:r.usage,context:r.writerContext};candidates.set(candidate.id,candidate);while(candidates.size>50)candidates.delete(candidates.keys().next().value);return candidate;
   }finally{active=null;signal?.removeEventListener('abort',abort)}
  }
  throw Error('Unknown Writer action.');
 }
 return {action,store};
}
module.exports={createWriterAPI,writerEvent};
