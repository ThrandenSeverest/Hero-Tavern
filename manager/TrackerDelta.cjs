'use strict';
// Tracker updates are small, auditable commands, never a full-state JSON rewrite.
// UPDATE :: owner:key :: VERB :: value :: sourceMessageId :: exact evidence
const {keyOf,validateValue}=require('./StoryState.cjs');
const copy=x=>JSON.parse(JSON.stringify(x));
const num=x=>{const n=Number(String(x).trim());if(!Number.isFinite(n))throw Error('Expected a finite number');return n;};
function scalar(x){
 const v=String(x).trim();if(/^[\[{"]/.test(v)){try{return JSON.parse(v)}catch{}}if(v==='true')return true;if(v==='false')return false;
 if(v==='null')return null;if(/^-?(?:\d+|\d*\.\d+)$/.test(v))return Number(v);
 return v;
}
function parseCommands(raw,definitions,messages,state){
 const clean=String(raw||'').replace(/<think>[\s\S]*?(?:<\/think>|$)/gi,'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
 let rows,recognized=0;
 if(clean.startsWith('{')){
  try{
   const packet=JSON.parse(clean);if(!Array.isArray(packet.operations)||packet.operations.length>100)throw Error('Expected operations array (maximum 100)');
   rows=packet.operations.map(op=>{
    if(!op||typeof op!=='object')throw Error('Operation must be an object');
    const key=op.key??op.trackerId,verb=String(op.verb??op.op??'').toUpperCase(),id=op.sourceMessageId??op.evidence?.messageId,evidence=typeof op.evidence==='string'?op.evidence:op.evidence?.quote;
    if(typeof key!=='string'||typeof id!=='string'||typeof evidence!=='string'||!Object.hasOwn(op,'value'))throw Error('Operation needs key, verb, value, sourceMessageId and evidence');
    if(op.path&&op.path!=='/value')throw Error('Use FIELD for a single record field or SET at /value');
    return ['UPDATE',key,verb,typeof op.value==='string'?op.value:JSON.stringify(op.value),id,evidence];
   });recognized=rows.length||1;
  }catch(e){return {changes:[],issues:['Invalid operations JSON: '+e.message],recognized:0};}
 }else rows=clean.split(/\r?\n/).slice(0,100);

 const output=[],issues=[],known=new Map(definitions.map(d=>[keyOf(d),d])),byId=new Map(messages.map(m=>[m.extra?.heroMessageId,m]));
 const working=copy(state);
 for(const row of rows){
  if(!Array.isArray(row)&&!/^UPDATE\s*::\s*/i.test(row.trim()))continue;
  recognized++;
  try{
   const parts=Array.isArray(row)?row:row.trim().split(/\s+::\s+/);
   if(parts.length<6)throw Error('Provide key, verb, value, message ID and evidence');
   const [,key,verbRaw,payload,id,...rest]=parts,verb=verbRaw.toUpperCase(),evidence=rest.join(' :: ');
   const d=known.get(key),message=byId.get(id);
   if(!d||d.enabled===false||d.updateMode==='manual')throw Error('Unknown or manual-only tracker '+key);
   if(!message||!evidence||!String(message.mes||message.text||'').includes(evidence))throw Error('Evidence is not an exact quote from '+id);
   const previous=working[key];if(previous===undefined)throw Error('Tracker is not available in this chat');
   let value=copy(previous);
   if(['INCREASE','DECREASE'].includes(verb)){
    if(d.type!=='number')throw Error('Increment/decrement requires number tracker');
    const delta=num(payload);if(delta<=0)throw Error('Change must be positive');
    value=Math.max(d.min,Math.min(d.max,value+(verb==='INCREASE'?delta:-delta)));
   }else if(verb==='SET'){
    if(!['number','boolean','enum','text','clock','record','quest','timer','relationship'].includes(d.type))throw Error('SET unsupported for this type; use FIELD or ADD');
    value=scalar(payload);
    if(d.type==='record'){const shape=(old,next)=>{if(!next||typeof next!=='object'||Array.isArray(next))throw Error('Record SET needs an object');for(const key of Object.keys(old)){if(!Object.hasOwn(next,key))throw Error('Preserve unchanged record field '+key)}for(const key of Object.keys(next)){if(!Object.hasOwn(old,key)||['__proto__','constructor','prototype'].includes(key))throw Error('Unknown record field '+key);if(old[key]!==null&&typeof old[key]==='object'&&!Array.isArray(old[key]))shape(old[key],next[key]);else if(old[key]!==null&&(Array.isArray(old[key])?!Array.isArray(next[key]):typeof old[key]!==typeof next[key]))throw Error('Wrong type for record field '+key)}};shape(previous,value);}
   }else if(verb==='ADD'||verb==='REMOVE'){
    if(d.type!=='list')throw Error('ADD/REMOVE requires list');
    if(!payload.trim())throw Error('Empty list item');const item=payload.trim();
    value=verb==='ADD'?[...value.filter(v=>v!==item),item]:value.filter(v=>v!==item);
   }else if(verb==='FIELD'){
    if(!['record','quest','timer','relationship'].includes(d.type))throw Error('FIELD requires structured record/quest/timer/relationship');
    const match=/^([a-zA-Z][a-zA-Z0-9_.-]{0,80})(\+=|-=|=)([\s\S]*)$/.exec(payload);
    if(!match)throw Error('Use field=value, field+=item, or field-=item');
    const [,path,op,rawValue]=match,keys=path.split('.');
    if(keys.some(k=>k==='__proto__'||k==='constructor'||k==='prototype'))throw Error('Invalid field path');
    let object=value;
    for(let j=0;j<keys.length-1;j++){if(!object||typeof object!=='object'||Array.isArray(object)||!Object.hasOwn(object,keys[j]))throw Error('Unknown nested field');object=object[keys[j]];}
    const field=keys.at(-1);
    if(!object||typeof object!=='object'||Array.isArray(object))throw Error('Invalid record field');
    if(d.type==='record'&&!Object.hasOwn(object,field))throw Error('Record fields must be defined in the tracker template');
    if(op==='=')object[field]=scalar(rawValue);
    else {if(!Array.isArray(object[field]))throw Error('Append/remove requires existing list field');const item=rawValue.trim();if(!item)throw Error('Empty list item');if(op==='+='){if(!object[field].includes(item))object[field].push(item)}else object[field]=object[field].filter(v=>v!==item);}
   }else if(verb==='WOUND'){
    if(d.type!=='injuries')throw Error('WOUND requires injury tracker');
    const [location,severity,cause,pain='5',symptoms='',limitations='']=payload.split(/\s*\|\s*/).map(x=>x.trim());
    if(!location||!cause)throw Error('Wound needs body location and cause');
    const code='wound_'+require('node:crypto').createHash('sha256').update(key+id+location+cause).digest('hex').slice(0,12);
    if(value.some(x=>x.id===code))continue;
    value.push({id:code,location,cause,severity:severity||'minor',status:'fresh',pain:num(pain),symptoms,limitations,treatment:'',scar:''});
   }else if(verb==='TREAT'){
    if(d.type!=='injuries')throw Error('TREAT requires injury tracker');
    const [wound,status,treatment,pain]=payload.split(/\s*\|\s*/).map(x=>x.trim());
    const found=value.find(x=>x.id===wound);if(!found)throw Error('No injury with that ID');
    if(status)found.status=status;if(treatment)found.treatment=treatment;if(pain)found.pain=num(pain);
   }else throw Error('Unknown operation '+verb);
   validateValue(d,value);if(JSON.stringify(value)===JSON.stringify(previous))continue;
   output.push({key,value,sourceMessageId:id,evidence,reason:verb+' from observed turn'});
   working[key]=value;
  }catch(error){issues.push((Array.isArray(row)?row.join(' :: '):row).slice(0,200)+': '+error.message);}
 }
 return {changes:output,issues,recognized};
}
// Deterministic facts are independent of model formatting and never infer real-world time.
function explicitClockChanges(definitions,messages,state){
 const clocks=definitions.filter(d=>d.type==='clock'&&d.enabled!==false&&d.updateMode!=='manual');
 if(!clocks.length)return [];
 let match=null;
 for(const m of messages){
  const content=String(m.mes||m.text||'');
  const pattern=/\b(?:it(?:'|’)s|it is|the time is|current time(?: is)?|time is|clock (?:reads|shows)|сейчас|время(?: сейчас)?)\s*(?:at\s*)?[:=–-]?\s*([01]?\d|2[0-3]):([0-5]\d)\b/gi;
  for(const found of content.matchAll(pattern)){
   if(/\b(?:not|isn(?:'|’)t|wasn(?:'|’)t|не|нет)\s*$/i.test(content.slice(Math.max(0,found.index-18),found.index)))continue;
   if(!m.extra?.heroMessageId)continue;
   const hh=String(+found[1]).padStart(2,'0'),value=hh+':'+found[2];
   match={value,sourceMessageId:m.extra.heroMessageId,evidence:found[0]};
  }
 }
 if(!match)return [];
 return clocks.filter(d=>state[keyOf(d)]!==match.value).map(d=>({key:keyOf(d),...match,reason:'Explicit story time stated in finalized dialogue'}));
}
function trackerInstructions(definitions,state,messages){
 const allowed=definitions.filter(d=>d.enabled!==false&&d.updateMode!=='manual');
 const entries=allowed.map(d=>({key:keyOf(d),type:d.type,label:d.label,description:d.description||'',changeRules:d.changeRules||'',maxDelta:d.maxDelta,allowedValues:d.allowedValues,current:state[keyOf(d)]}));
 return 'You are a factual state transition extractor, not a storyteller. Return exactly one JSON object with an operations array. No Markdown or explanations. If nothing changes return {"operations":[]}.\n'+
 'Each operation has exactly these fields: {"key":"an exact key from the manifest","verb":"SET","value":"new value or operation payload","sourceMessageId":"an exact message ID","evidence":"an exact verbatim quote proving THIS change"}.\n'+
 'Allowed verbs: INCREASE, DECREASE (positive numeric value); SET (typed scalar or complete structured record); ADD, REMOVE (one list item); FIELD (string field=value, field+=item or field-=item); WOUND (location|severity|cause|pain|symptoms|limitations); TREAT (woundId|status|treatment|pain).\n'+
 'Only change trackers directly affected by the quoted event. A visitor entering does not change contents, hunger or injuries. Do not reset or empty objects without an explicit emptying event. Preserve all unchanged fields and their types. Never invent exact numeric levels; use modest deltas within maxDelta unless an exact value is explicitly stated. Record lists use JSON arrays, booleans use true/false. Hypotheticals, plans and intentions are not completed events. Leave unrelated trackers out.\n'+
 'Tracker manifest:\n'+JSON.stringify(entries)+'\nFinalized messages:\n'+JSON.stringify(messages.map(m=>({id:m.extra?.heroMessageId,speaker:m.is_user?'Player':m.name||'Character',text:String(m.mes||m.text||'').slice(0,6000)})));
}
module.exports={parseCommands,trackerInstructions,explicitClockChanges};
