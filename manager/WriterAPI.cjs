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
  if(op==='generate'){
   if(active)throw Error('Writer is already generating.');const s=store.read(data.id);if(s.version!==data.expectedVersion)throw Error('Save the draft before generating.');
   const operation=data.operation||'continue';if(!['continue','insert','rewrite'].includes(operation))throw Error('Unknown Writer operation.');
   const start=operation==='continue'?s.text.length:data.start,end=operation==='continue'?s.text.length:data.end;
   if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<start||end>s.text.length||operation==='rewrite'&&start===end)throw Error('Select a valid manuscript passage.');
   if(typeof (data.instruction||'')!=='string'||(data.instruction||'').length>2000)throw Error('Invalid rewrite instruction.');
   const controller=new AbortController();active=controller;const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)controller.abort();
   try{await ensureText(controller.signal);if(controller.signal.aborted)throw Error('Writer generation cancelled.');
    const r=await pipeline.generate({prompt:'',writerSettings:s.settings,hero_writer:{...s,operation,start,end,instruction:data.instruction||''},stream:false},controller.signal,{mode:'writer'});
    const candidate={id:crypto.randomUUID(),storyId:s.id,version:s.version,operation,start,end,text:r.choices[0].text,usage:r.usage,context:r.writerContext};candidates.set(candidate.id,candidate);while(candidates.size>50)candidates.delete(candidates.keys().next().value);return candidate;
   }finally{active=null;signal?.removeEventListener('abort',abort)}
  }
  throw Error('Unknown Writer action.');
 }
 return {action,store};
}
module.exports={createWriterAPI};
