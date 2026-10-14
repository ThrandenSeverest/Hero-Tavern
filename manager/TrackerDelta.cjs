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
   const packet=JSON.parse(clean);
   // Accept both legacy operations and a much simpler complete-value delta format.
   // Every change still requires exact evidence and passes StoryState validation.
   const changes=Array.isArray(packet.changes)?packet.changes:packet.operations;
   if(!Array.isArray(changes)||changes.length>100)throw Error('Expected changes or operations array (maximum 100)');
   rows=changes.map(op=>{
    if(!op||typeof op!=='object')throw Error('Change must be an object');
    const key=op.key??op.trackerId??op.tracker,verb=String(op.verb??op.op??'SET').toUpperCase(),id=op.sourceMessageId??op.messageId??op.evidence?.messageId,evidence=typeof op.evidence==='string'?op.evidence:op.evidence?.quote;
    if(typeof key!=='string'||typeof id!=='string'||typeof evidence!=='string'||!Object.hasOwn(op,'value'))throw Error('Change needs key, value, sourceMessageId and verbatim evidence');
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
   const d=known.get(key)||definitions.find(item=>item.id===key&&definitions.filter(candidate=>candidate.id===key).length===1),message=byId.get(id);
   const resolvedKey=d?keyOf(d):key;
   if(!d||d.enabled===false||d.updateMode==='manual')throw Error('Unknown or manual-only tracker '+key);
   if(!message||!evidence||!String(message.mes||message.text||'').includes(evidence))throw Error('Evidence is not an exact quote from '+id);
   const previous=working[resolvedKey];if(previous===undefined)throw Error('Tracker is not available in this chat');
   let value=copy(previous);
   if(['INCREASE','DECREASE'].includes(verb)){
    if(d.type!=='number')throw Error('Increment/decrement requires number tracker');
    const delta=num(payload);if(delta<=0)throw Error('Change must be positive');
    value=Math.max(d.min,Math.min(d.max,value+(verb==='INCREASE'?delta:-delta)));
   }else if(verb==='SET'){
    if(!['number','boolean','enum','text','clock','record','quest','timer','relationship','list','injuries'].includes(d.type))throw Error('SET unsupported for this tracker type');
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
    const code='wound_'+require('node:crypto').createHash('sha256').update(resolvedKey+id+location+cause).digest('hex').slice(0,12);
    if(value.some(x=>x.id===code))continue;
    value.push({id:code,location,cause,severity:severity||'minor',status:'fresh',pain:num(pain),symptoms,limitations,treatment:'',scar:''});
   }else if(verb==='TREAT'){
    if(d.type!=='injuries')throw Error('TREAT requires injury tracker');
    const [wound,status,treatment,pain]=payload.split(/\s*\|\s*/).map(x=>x.trim());
    const found=value.find(x=>x.id===wound);if(!found)throw Error('No injury with that ID');
    if(status)found.status=status;if(treatment)found.treatment=treatment;if(pain)found.pain=num(pain);
   }else throw Error('Unknown operation '+verb);
   validateValue(d,value);if(JSON.stringify(value)===JSON.stringify(previous))continue;
   output.push({key:resolvedKey,value,sourceMessageId:id,evidence,reason:verb+' from observed turn'});
   working[resolvedKey]=value;
  }catch(error){issues.push((Array.isArray(row)?row.join(' :: '):row).slice(0,200)+': '+error.message);}
 }
 return {changes:output,issues,recognized};
}
// Explicit typed facts can be committed without waiting for the LLM.
// Free-form actions (wounds, meals, quests, relationships, etc.) still go through
// evidence-backed model operations; deterministic extraction never guesses them.
function explicitStateChanges(definitions,messages,state){
 const result=[],working=copy(state);
 const escapeRegExp=x=>String(x).replace(/[.*+?^\${}()|[\]\\]/g,'\\$&');
 for(const message of messages){
  const content=String(message.mes||message.text||''),id=message.extra?.heroMessageId;
  if(!id||!content.trim())continue;
  for(const d of definitions.filter(d=>d.enabled!==false&&d.updateMode!=='manual')){
   const key=keyOf(d);if(!Object.hasOwn(working,key))continue;
   let found=null,value;
   if(d.type==='clock'){
    const pattern=/\b(?:it(?:'|’)s|it is|the time is|current time(?: is)?|time is|clock (?:reads|shows)|сейчас|время(?: сейчас)?)\s*(?:at\s*)?[:=–-]?\s*([01]?\d|2[0-3]):([0-5]\d)\b/gi;
    for(const m of content.matchAll(pattern)){
     if(/\b(?:not|isn(?:'|’)t|wasn(?:'|’)t|не|нет)\s*$/i.test(content.slice(Math.max(0,m.index-18),m.index)))continue;
     found=m[0];value=String(Number(m[1])).padStart(2,'0')+':'+m[2];
    }
   }
   if(!found){
    const names=[d.label,d.id.replace(/_/g,' ')].filter(Boolean);
    for(const name of names){
     const short=name.replace(/\s*\([^)]*\)\s*$/,'').trim();
     if(short.length<3)continue;
     const re=new RegExp('(?:^|[\\n;.!?]\\s*|\\b(?:my|the|current|our)\\s+)('+escapeRegExp(short)+')\\s*(?::|=|\\bis\\b|\\bnow\\b|\\breads\\b|\\bshows\\b|\\bbecomes\\b|\\bchanged to\\b)\\s*([^\\n;!?]+)','gi');
     for(const m of content.matchAll(re)){
      const literal=m[2].trim().replace(/[”"'\s]+$/,'').trim();
      let candidate;
      try{
       if(d.type==='number'){const match=/^-?\d+(?:\.\d+)?/.exec(literal);if(!match)continue;candidate=Number(match[0]);}
       else if(d.type==='clock'){const match=/^([01]?\d|2[0-3]):([0-5]\d)\b/.exec(literal);if(!match)continue;candidate=String(Number(match[1])).padStart(2,'0')+':'+match[2];}
       else if(d.type==='boolean'){if(!/^(true|false|yes|no|on|off)\b/i.test(literal))continue;candidate=/^(true|yes|on)\b/i.test(literal);}
       else if(d.type==='enum'){candidate=d.allowedValues?.find(x=>x.toLowerCase()===literal.toLowerCase());if(candidate===undefined)continue;}
       else if(d.type==='text'){candidate=literal.split(/\.\s+(?=[A-ZА-ЯЁ])/)[0].replace(/\.$/,'').slice(0,6000);}
       else if(['list','record','quest','timer','relationship','injuries'].includes(d.type)){candidate=JSON.parse(literal);}
       else continue;
       validateValue(d,candidate);
      }catch{continue;}
      found=m[0].trim();value=candidate;
     }
     if(found)break;
    }
   }
   if(!found||JSON.stringify(working[key])===JSON.stringify(value))continue;
   try{validateValue(d,value)}catch{continue}
   result.push({key,value,sourceMessageId:id,evidence:found,reason:'Explicit '+d.type+' state in finalized dialogue'});
   working[key]=copy(value);
  }
 }
 return result;
}
function explicitClockChanges(definitions,messages,state){return explicitStateChanges(definitions.filter(d=>d.type==='clock'),messages,state);}
function trackerInstructions(definitions,state,messages,contextMessages=[]){
 const allowed=definitions.filter(d=>d.enabled!==false&&d.updateMode!=='manual');
 const entries=allowed.map(d=>({key:keyOf(d),type:d.type,label:d.label,description:d.description||'',changeRules:d.changeRules||'',maxDelta:d.maxDelta,allowedValues:d.allowedValues,current:state[keyOf(d)]}));
 return 'You are a factual state transition extractor, not a storyteller. Return ONLY one JSON object. Format: {"changes":[{"key":"exact manifest key","value":"the NEW complete value, preserving its JSON type","sourceMessageId":"exact source ID","evidence":"EXACT verbatim quote from that source proving the event"}]}. If no established change, return {"changes":[]}. Do not add Markdown or analysis.\\n'+
 'For number trackers value is a number, for booleans a boolean, for lists a complete string array, for structured records a complete JSON object with ALL unchanged fields retained, for injuries a complete array that never erases established wounds, and for other trackers their matching typed value. The legacy operations array is also supported. Existing {"operations":[{"key":"...","verb":"INCREASE|DECREASE|SET|ADD|REMOVE|FIELD|WOUND|TREAT","value":"...","sourceMessageId":"...","evidence":"..."}]} is also accepted if easier for incremental updates.\\n'+
 'Only include real changes, directly proven by one of the eligible source messages. Do not guess hidden emotional states or arbitrary numeric levels, change unrelated fields, reverse proven injuries, or treat plans/hypotheticals as completed actions. Preserve all previously established facts and unchanged fields; modest numeric changes must respect maxDelta and the permitted range.\\n'+
 'Tracker manifest:\\n'+JSON.stringify(entries)+'\\nEarlier context (read-only; never cite these as source IDs):\\n'+JSON.stringify(contextMessages.map(m=>({speaker:m.is_user?'Player':m.name||'Character',text:String(m.mes||m.text||'').slice(0,2400)})))+'\\nMessages eligible for evidence-backed changes:\\n'+JSON.stringify(messages.map(m=>({id:m.extra?.heroMessageId,speaker:m.is_user?'Player':m.name||'Character',text:String(m.mes||m.text||'').slice(0,6000)})));
}
module.exports={parseCommands,trackerInstructions,explicitClockChanges,explicitStateChanges};
