'use strict';
const crypto=require('node:crypto');
const {createWriterStore}=require('./WriterStore.cjs');
function createWriterAPI(root,pipeline,{ensureText=async()=>{}}={}){
 const store=createWriterStore(root),candidates=new Map();let active=null;
 async function action(route,data={},signal){
  const op=route.replace('/writer/api/','');
  if(op==='list')return store.list();if(op==='create')return store.create(data.story);if(op==='get')return store.read(data.id);
  if(op==='save')return store.save(data.id,data.story,data.expectedVersion);if(op==='restore')return store.restore(data.id,data.revision,data.expectedVersion);if(op==='fork')return store.fork(data.id);
  if(op==='import'){if(data.story?.schemaVersion!==1&&data.story?.schemaVersion!==undefined)throw Error('Unsupported Writer export version.');return store.create(data.story)}
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
   const operation=data.operation||'continue';if(!['continue','insert','rewrite','say','do'].includes(operation))throw Error('Unknown Writer operation.');
   let start=data.start,end=data.end,base=original.text;
   if(op==='regenerate'){const replacement=data.replacement;if(!replacement||!Number.isInteger(replacement.start)||typeof replacement.text!=='string'||original.text.slice(replacement.start,replacement.start+replacement.text.length)!==replacement.text)throw Error('Generated passage was edited. Use Undo or restore the previous draft before retrying.');base=original.text.slice(0,replacement.start)+original.text.slice(replacement.start+replacement.text.length);start=replacement.start;end=start;}
   else if(['continue','say','do'].includes(operation))start=end=base.length;
   if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<start||end>base.length||operation==='rewrite'&&start===end)throw Error('Select a valid manuscript passage.');
   if(['say','do'].includes(operation)&&!String(data.instruction||'').trim())throw Error('Enter dialogue or an action first.');
   const controller=new AbortController();active=controller;const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)controller.abort();
   try{await ensureText(controller.signal);const result=await pipeline.generate({prompt:'',writerSettings:original.settings,hero_writer:{...original,text:base,operation,start,end,instruction:data.instruction||''},stream:false},controller.signal,{mode:'writer'});let prose=String(result.choices?.[0]?.text||'').replace(/\{\{user\}\}/gi,()=>original.persona?.name?.trim()||'you');if(!prose.trim())throw Error('The model returned no prose; original draft preserved.');if(operation==='say'&&!prose.includes(String(data.instruction).trim()))prose=(original.persona?.name?.trim()||'You')+': «'+String(data.instruction).trim()+'»\n\n'+prose;
   const before=base.slice(0,start),after=base.slice(end);if(operation!=='rewrite'&&before&&!/\s$/.test(before)&&! /^[\s.,;:!?…)}\]]/.test(prose))prose=' '+prose;if(after&&prose&&/[\p{L}\p{N}]$/u.test(prose)&&/^[\p{L}\p{N}]/u.test(after))prose+=' ';
   const saved=store.save(original.id,{text:before+prose+after,label:op==='regenerate'?'Regenerated '+operation:'Generated '+operation},original.version);
   return {story:saved,replacement:{start,text:prose},usage:result.usage,context:result.writerContext};
   }finally{active=null;signal?.removeEventListener('abort',abort);}
  }
  if(op==='generate'){
   if(active)throw Error('Writer is already generating.');const s=store.read(data.id);if(s.version!==data.expectedVersion)throw Error('Save the draft before generating.');
   const operation=data.operation||'continue';if(!['continue','insert','rewrite','say','do'].includes(operation))throw Error('Unknown Writer operation.');
   const append=['continue','say','do'].includes(operation),start=append?s.text.length:data.start,end=append?s.text.length:data.end;
   if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<start||end>s.text.length||operation==='rewrite'&&start===end)throw Error('Select a valid manuscript passage.');
   if(typeof (data.instruction||'')!=='string'||(data.instruction||'').length>2000)throw Error('Invalid rewrite instruction.');
   if(['say','do'].includes(operation)&&!data.instruction?.trim())throw Error('Enter the dialogue or action first.');
   const controller=new AbortController();active=controller;const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)controller.abort();
   try{await ensureText(controller.signal);if(controller.signal.aborted)throw Error('Writer generation cancelled.');
    const r=await pipeline.generate({prompt:'',writerSettings:s.settings,hero_writer:{...s,operation,start,end,instruction:data.instruction||''},stream:false},controller.signal,{mode:'writer'});
    let prose=r.choices[0].text.replace(/\{\{user\}\}/gi,()=>s.persona?.name?.trim()||'you');if(operation==='say'&&!prose.includes(data.instruction.trim()))prose=(s.persona?.name?.trim()||'You')+': «'+data.instruction.trim()+'»\n\n'+prose;
    const candidate={id:crypto.randomUUID(),storyId:s.id,version:s.version,operation,start,end,text:prose,usage:r.usage,context:r.writerContext};candidates.set(candidate.id,candidate);while(candidates.size>50)candidates.delete(candidates.keys().next().value);return candidate;
   }finally{active=null;signal?.removeEventListener('abort',abort)}
  }
  throw Error('Unknown Writer action.');
 }
 return {action,store};
}
module.exports={createWriterAPI};
