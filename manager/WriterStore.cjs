'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const copy=x=>JSON.parse(JSON.stringify(x));
const DEFAULTS={maxReplyTokens:768,writerTwoPass:true,temperature:0.85,top_p:0.95,top_k:40,min_p:0.05,repetition_penalty:1.08};
function validate(input){
 const s=copy(input);for(const k of ['prompt','memory','note','text'])if(s[k]===undefined)s[k]='';if(s.title===undefined)s.title='Untitled story';if(s.lore===undefined)s.lore=[];
 for(const [k,max] of [['title',200],['prompt',200000],['text',1000000],['memory',200000],['note',50000]])if(typeof s[k]!=='string'||s[k].length>max)throw Error('Writer '+k+' must be text, at most '+max+' characters. Your draft is preserved.');
 s.persona={name:'',description:'',...s.persona};for(const [k,max] of [['name',200],['description',12000]])if(typeof s.persona[k]!=='string'||s.persona[k].length>max)throw Error('Invalid Writer persona '+k);
 if(!Array.isArray(s.lore)||s.lore.length>300)throw Error('Writer lorebook must have at most 300 entries.');
 for(const e of s.lore)if(!e||typeof e.title!=='string'||e.title.length>200||typeof e.text!=='string'||e.text.length>12000||!Array.isArray(e.keys)||e.keys.some(k=>typeof k!=='string'||!k.trim()||k.length>100)||e.keys.length>30)throw Error('Invalid lorebook entry.');
 s.settings={...DEFAULTS,...s.settings};if(typeof s.settings.writerTwoPass!=='boolean')throw Error('Invalid Writer two-pass setting');for(const [k,min,max] of [['maxReplyTokens',32,2048],['temperature',0,2],['top_p',0.01,1],['top_k',0,200],['min_p',0,1],['repetition_penalty',1,2]])if(!Number.isFinite(s.settings[k])||s.settings[k]<min||s.settings[k]>max)throw Error('Invalid Writer setting '+k);
 return s;
}
function createWriterStore(root){
 const dir=path.join(root,'Writer','stories');fs.mkdirSync(dir,{recursive:true});
 const file=id=>{if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid story ID.');return path.join(dir,id+'.json')};
 const read=id=>JSON.parse(fs.readFileSync(file(id),'utf8'));
 const write=s=>{const f=file(s.id),tmp=f+'.tmp';fs.writeFileSync(tmp,JSON.stringify(s));fs.renameSync(tmp,f);return copy(s)};
 function create(input={}){const now=Date.now();return write({...validate({title:'Untitled story',prompt:'',text:'',memory:'',note:'',lore:[],settings:DEFAULTS,...input}),schemaVersion:1,id:crypto.randomUUID(),version:1,createdAt:now,updatedAt:now,history:Array.isArray(input.history)?input.history.slice(-100).map(r=>({...validate(r),id:crypto.randomUUID(),at:Number(r.at)||now,label:String(r.label||'Imported revision').slice(0,150)})):[]})}
 function save(id,input,expected){const old=read(id);if(expected!==old.version)throw Error('Story changed in another window. Export your current draft before reloading.');const fields=Object.fromEntries(['title','prompt','text','memory','note','lore','settings','persona'].map(k=>[k,input[k]??old[k]])),next=validate(fields);
  if(JSON.stringify(fields)===JSON.stringify(Object.fromEntries(Object.keys(fields).map(k=>[k,old[k]]))))return old;
  const history=[...old.history,{id:crypto.randomUUID(),at:Date.now(),label:String(input.label||'Edit / autosave').slice(0,150),...Object.fromEntries(Object.keys(fields).map(k=>[k,old[k]]))}].slice(-100);
  return write({...old,...next,history,version:old.version+1,updatedAt:Date.now()});}
 function restore(id,revision,expected){const s=read(id),r=s.history.find(r=>r.id===revision);if(!r)throw Error('Revision not found.');return save(id,{...r,label:'Restore revision; later draft preserved'},expected)}
 function fork(id){const s=read(id);const result=create({...s,title:s.title+' · branch'});return write({...result,parentId:s.id,history:copy(s.history)})}
 return {create,read,save,restore,fork,list:()=>fs.readdirSync(dir).filter(n=>/^[a-f0-9-]{36}\.json$/.test(n)).map(n=>{const s=read(n.slice(0,-5));return {id:s.id,title:s.title,updatedAt:s.updatedAt,words:s.text.trim()?s.text.trim().split(/\s+/).length:0,parentId:s.parentId}}).sort((a,b)=>b.updatedAt-a.updatedAt)};
}
module.exports={createWriterStore,validate,DEFAULTS};
