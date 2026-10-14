'use strict';
// Tracker updates are small, auditable commands, never a full-state JSON rewrite.
// UPDATE :: owner:key :: VERB :: value :: sourceMessageId :: exact evidence
const {keyOf,validateValue}=require('./StoryState.cjs');
const copy=x=>JSON.parse(JSON.stringify(x));
const num=x=>{const n=Number(String(x).trim());if(!Number.isFinite(n))throw Error('Expected a finite number');return n;};
function scalar(x){
 const v=String(x).trim();if(v==='true')return true;if(v==='false')return false;
 if(v==='null')return null;if(/^-?(?:\d+|\d*\.\d+)$/.test(v))return Number(v);
 return v;
}
function parseCommands(raw,definitions,messages,state){
 const output=[],issues=[],known=new Map(definitions.map(d=>[keyOf(d),d])),byId=new Map(messages.map(m=>[m.extra?.heroMessageId,m]));
 const working=copy(state);
 for(const row of String(raw||'').replace(/<think>[\s\S]*?<\/think>/gi,'').split(/\r?\n/).slice(0,100)){
  if(!/^UPDATE\s*::\s*/i.test(row.trim()))continue;
  try{
   const parts=row.trim().split(/\s+::\s+/);
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
    if(!['number','boolean','enum','text','clock'].includes(d.type))throw Error('SET unsupported for this type; use FIELD or ADD');
    value=scalar(payload);
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
  }catch(error){issues.push(row.slice(0,200)+': '+error.message);}
 }
 return {changes:output,issues,recognized:output.length};
}
function trackerInstructions(definitions,state,messages){
 const allowed=definitions.filter(d=>d.enabled!==false&&d.updateMode!=='manual');
 const entries=allowed.map(d=>[keyOf(d),d.type,d.label,d.changeRules||d.description||'',JSON.stringify(state[keyOf(d)])].join(' | '));
 return 'You are a state transition extractor, not a storyteller. Read only the finalized turn(s) and confirmed state. Return ZERO or more lines with this exact format:\n'+
 'UPDATE :: tracker-owner:key :: VERB :: payload :: sourceMessageId :: exact verbatim evidence quote\n'+
 'Allowed VERB: INCREASE, DECREASE (positive number); SET (number, boolean, enum, text or clock); ADD, REMOVE (list item); FIELD (record/relationship/quest: field=value or field+=item or field-=item); WOUND (location|severity|cause|pain|symptoms|limitations); TREAT (woundId|status|treatment|pain).\n'+
 'For numeric changes use INCREASE or DECREASE, NEVER guess an exact value; use SET only for explicitly stated values. Numeric deltas should be modest and obey maxDelta. For records update only one field per line, do not replace the whole object. For meals add a short text to recentMeals only after actual eating; preserve old meals. For injuries add WOUND only if bodily injury was explicitly inflicted; use TREAT only on an existing injury. Character beliefs and hypotheticals are NOT facts. Output no JSON, prose, Markdown or explanation. If no confirmed changes, output NONE.\n'+
 'Tracker definitions and confirmed values:\n'+entries.join('\n')+
 '\nFinalized chat turns (each has exact ID and speaker):\n'+messages.map(m=>'ID '+m.extra?.heroMessageId+' | '+(m.is_user?'Player':m.name||'Character')+': '+String(m.mes||m.text||'').slice(0,1800)).join('\n');
}
module.exports={parseCommands,trackerInstructions};
