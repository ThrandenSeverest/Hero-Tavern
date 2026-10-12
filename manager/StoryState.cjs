// Versioned state contract. Shared by the service and unit tests; dialogue never contains patches.
const crypto=require('node:crypto');
const clone=x=>JSON.parse(JSON.stringify(x)),hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const TYPES=['number','boolean','enum','text','list','relationship','timer','quest'];
const keyOf=d=>d.owner+':'+d.id;
function validateDefinition(input){
 const d=clone(input);if(!d||!/^[-\w]{1,80}$/.test(d.id)||typeof d.owner!=='string'||!/^(character|player):[-\w]{1,100}$/.test(d.owner)||!TYPES.includes(d.type))throw Error('Tracker needs a unique ID, owner and supported type.');
 d.label=String(d.label||d.id).slice(0,150);d.updateMode=d.updateMode||'approval';if(!['automatic','approval','manual'].includes(d.updateMode))throw Error('Invalid tracker update mode.');
 d.visibility=d.visibility||'player';if(!['player','hidden'].includes(d.visibility))throw Error('Invalid visibility.');d.version=Number(d.version)||1;d.relevantKeywords=Array.isArray(d.relevantKeywords)?d.relevantKeywords.map(String):[];
 if(d.type==='number'||d.type==='relationship'){d.min=Number.isFinite(d.min)?d.min:0;d.max=Number.isFinite(d.max)?d.max:100;if(d.min>d.max)throw Error('Invalid tracker range.');d.maxDelta=Number.isFinite(d.maxDelta)?Math.max(0,d.maxDelta):10;}
 if(d.type==='enum'){if(!Array.isArray(d.allowedValues)||!d.allowedValues.length||d.allowedValues.some(x=>typeof x!=='string'))throw Error('Enum needs allowed statuses.');}
 validateValue(d,d.initialValue);return d;
}
function validateValue(d,v){
 if(d.type==='number'&&(!Number.isFinite(v)||v<d.min||v>d.max))throw Error(d.label+': value outside bounds.');
 if(d.type==='boolean'&&typeof v!=='boolean')throw Error(d.label+': use true or false.');
 if(d.type==='enum'&&!d.allowedValues.includes(v))throw Error(d.label+': invalid status.');
 if(d.type==='text'&&(typeof v!=='string'||v.length>6000))throw Error(d.label+': use a short fact.');
 if(d.type==='list'&&(!Array.isArray(v)||v.length>500||v.some(x=>typeof x!=='string'||x.length>500)))throw Error(d.label+': use a list of short entries.');
 if(d.type==='relationship'&&(!v||typeof v!=='object'||Array.isArray(v)||Object.values(v).some(x=>!Number.isFinite(x)||x<d.min||x>d.max)))throw Error(d.label+': invalid relationship values.');
 if(d.type==='timer'&&(!v||!Number.isFinite(v.remaining)||v.remaining<0||!['story','wall'].includes(v.clock)))throw Error(d.label+': timer needs remaining duration and story/wall clock.');
 if(d.type==='quest'&&(!v||typeof v.stage!=='string'||!['inactive','active','complete','failed'].includes(v.status)))throw Error(d.label+': quest needs stage and status.');
 return v;
}
function initialState(definitions){return Object.fromEntries(definitions.map(d=>[keyOf(d),clone(d.initialValue)]));}
function signature(m){return hash({id:m.extra?.heroMessageId,text:m.mes||m.text||'',swipe:m.swipe_id??0,owner:m.original_avatar||m.name||'',role:!!m.is_user});}
function stateAt(session,messages,index=messages.length-1){
 const applicable=session.definitions.filter(d=>!d.introducedAt||messages.slice(0,index+1).some(m=>m.extra?.heroMessageId===d.introducedAt));const state=initialState(applicable),allowed=new Map(messages.slice(0,index+1).map((m,i)=>[m.extra?.heroMessageId,{signature:signature(m),index:i}]));
 for(const e of session.events){const source=allowed.get(e.sourceMessageId);if(e.status==='confirmed'&&source&&source.signature===e.sourceSignature&&(!e.sourcePrefix||e.sourcePrefix===hash(messages.slice(0,source.index+1).map(signature)))){if(e.op==='define')state[e.key]=clone(e.value);else if(Object.hasOwn(state,e.key))state[e.key]=clone(e.value);}}
 return state;
}
function conditionPass(condition,state,context={}){
 if(!condition)return true;
 if(condition.all)return condition.all.every(c=>conditionPass(c,state,context));if(condition.any)return condition.any.some(c=>conditionPass(c,state,context));
 let v=condition.key?state[condition.key]:context[condition.field];if(condition.key&&condition.field)v=v?.[condition.field];const target=condition.value;
 switch(condition.op||'eq'){case 'eq':return v===target;case 'ne':return v!==target;case 'gte':return Number(v)>=Number(target);case 'lte':return Number(v)<=Number(target);case 'contains':return Array.isArray(v)?v.includes(target):String(v||'').toLowerCase().includes(String(target).toLowerCase());default:return false;}
}
function activeContext(session,messages,query='',cap=24){
 const state=stateAt(session,messages),text=String(query).toLowerCase(),selected=[],omitted=[];
 for(const d of session.definitions){const key=keyOf(d),relevant=d.enabled!==false&&(d.alwaysInject!==false||d.relevantKeywords.some(x=>text.includes(x.toLowerCase())));if(Object.hasOwn(state,key)&&relevant&&selected.length<cap){selected.push({key,label:d.label,value:state[key],rule:d.rules?.[String(state[key])]||d.instructions||'',hidden:d.visibility==='hidden'});}else omitted.push(key);}
 const ctx={text,location:selected.filter(x=>/location/i.test(x.key)).map(x=>x.value).join(' '),time:selected.filter(x=>/time/i.test(x.key)).map(x=>x.value).join(' ')};
 const lore=(session.lore||[]).map(e=>{const keyword=!e.keywords?.length||e.keywords.some(k=>text.includes(k.toLowerCase()));const active=keyword&&conditionPass(e.condition,state,ctx);return {...e,active,reason:!keyword?'No keyword match':!active?'State condition not met':'Keyword and state condition matched'};});
 return {state,trackers:selected,omitted,lore,provenance:session.events.filter(e=>e.status==='confirmed').map(e=>({key:e.key,sourceMessageId:e.sourceMessageId,reason:e.reason})),text:'[Confirmed story state — authoritative over conflicting older dialogue or memory; respect naturally, do not recite]\n'+selected.map(x=>x.label+': '+JSON.stringify(x.value)+(x.rule?' — '+x.rule:'')).join('\n')+'\n'+lore.filter(e=>e.active).map(e=>'[Lore '+e.id+'] '+e.text).join('\n')};
}
function propose(session,messages,patch,{manual=false,approve=false}={}){
 if(!Array.isArray(patch)||patch.length>100)throw Error('State analysis must return at most 100 changes.');const state=stateAt(session,messages),events=[];
 for(const item of patch){
  const d=session.definitions.find(d=>keyOf(d)===item.key);if(!d)throw Error('Unknown tracker owner/ID.');const source=messages.find(m=>m.extra?.heroMessageId===item.sourceMessageId);if(!source)throw Error('State change references a missing message.');
  const introduced=d.introducedAt?messages.findIndex(m=>m.extra?.heroMessageId===d.introducedAt):-1;if(!manual&&introduced>messages.indexOf(source))throw Error('Tracker starting values were established after this message; no retrospective AI change.');validateValue(d,item.value);if(!manual&&(d.updateMode==='manual'||d.enabled===false))throw Error('This tracker is manual only.');
  const evidence=String(item.evidence||'');if(!manual&&(!evidence||!String(source.mes).includes(evidence)))throw Error('State change needs an exact evidence quote from its source message.');
  if(!manual&&session.events.some(e=>e.key===item.key&&e.sourceMessageId===item.sourceMessageId&&e.status==='confirmed'&&e.authority==='user'))continue;
  const prior=state[item.key];if(!manual&&JSON.stringify(prior)===JSON.stringify(item.value))continue;if(d.type==='enum'&&d.transitions?.[prior]&&!d.transitions[prior].includes(item.value)&&!manual&&!approve)throw Error('This status transition is not allowed.');
  const major=d.type==='number'&&Math.abs(item.value-prior)>d.maxDelta||d.type==='list'&&JSON.stringify(prior)!==JSON.stringify(item.value)||d.type==='quest'&&['complete','failed'].includes(item.value.status)||d.type==='timer'&&item.value.clock==='wall';
  const status=manual||approve?'confirmed':d.updateMode==='approval'||major||item.ambiguous?'pending':'confirmed';
  const sourceSignature=signature(source),eventId=hash({key:item.key,sourceMessageId:item.sourceMessageId,sourceSignature,value:item.value});
  if(session.events.some(e=>e.eventId===eventId&&e.status!=='invalid')||events.some(e=>e.eventId===eventId))continue;
  const event={eventId,op:'set',key:item.key,previous:clone(prior),value:clone(item.value),sourceMessageId:item.sourceMessageId,sourceSignature,sourcePrefix:hash(messages.slice(0,messages.indexOf(source)+1).map(signature)),sourceSwipeId:source.swipe_id??0,authority:manual||approve?'user':'model',reason:String(item.reason||evidence||'Manual edit').slice(0,1000),evidence,status,at:Date.now()};events.push(event);if(status==='confirmed')state[item.key]=clone(item.value);
 }
 return events;
}
function reconcile(session,messages){
 const old=session.messageSignatures||[],fresh=messages.map(signature);let changed=0;while(changed<old.length&&changed<fresh.length&&old[changed]===fresh[changed])changed++;
 for(const e of session.events){const i=messages.findIndex(m=>m.extra?.heroMessageId===e.sourceMessageId),valid=i>=0&&signature(messages[i])===e.sourceSignature&&(!e.sourcePrefix||e.sourcePrefix===hash(fresh.slice(0,i+1)));
  if(!valid&&e.status!=='invalid'){e.invalidPreviousStatus=e.status;e.status='invalid';}else if(valid&&e.status==='invalid'&&e.invalidPreviousStatus){e.status=e.invalidPreviousStatus;delete e.invalidPreviousStatus;}
 }
 if(changed<old.length){session.revision++;session.pending=[];}
 session.messageSignatures=fresh;session.headMessageId=messages.at(-1)?.extra?.heroMessageId||null;session.state=stateAt(session,messages);return {changed:changed<old.length,firstChanged:changed};
}
const TEMPLATE_DATA=[
 ['Health & Injuries',[{id:'health',label:'Health',type:'number',initialValue:100,min:0,max:100,updateMode:'approval'},{id:'wound',label:'Left shoulder injury',type:'enum',initialValue:'uninjured',allowedValues:['uninjured','fresh','bandaged','healing','scarred'],transitions:{uninjured:['fresh'],fresh:['bandaged','healing'],bandaged:['healing'],healing:['scarred','uninjured'],scarred:['fresh']},rules:{fresh:'Pain and limited use of the left arm.',bandaged:'Protected, but still painful; bandaging is not healing.',healing:'Improving with established treatment and story time.',scarred:'Healed with a lasting visible mark.'},updateMode:'automatic'}]],
 ['Scars & Appearance',[{id:'scars',label:'Scars',type:'list',initialValue:[],updateMode:'approval'},{id:'appearance',label:'Current appearance',type:'text',initialValue:'Unchanged',updateMode:'automatic'}]],
 ['Trust & Affection',[{id:'trust',label:'Trust',type:'number',initialValue:30,min:0,max:100,updateMode:'approval'},{id:'relationships',label:'Relationships',type:'relationship',initialValue:{},min:0,max:100,updateMode:'approval'}]],
 ['Stress & Mood',[{id:'mood',label:'Mood',type:'enum',initialValue:'calm',allowedValues:['calm','happy','worried','angry','afraid'],updateMode:'automatic'},{id:'stress',label:'Stress',type:'number',initialValue:0,min:0,max:100,updateMode:'approval'}]],
 ['Inventory & Equipment',[{id:'inventory',label:'Inventory',type:'list',initialValue:[],updateMode:'approval'},{id:'equipment',label:'Equipment',type:'list',initialValue:[],updateMode:'approval'}]],
 ['Secrets & Knowledge',[{id:'secret_known',label:'Secret known',type:'boolean',initialValue:false,visibility:'hidden',updateMode:'approval'},{id:'known_names',label:'Known names',type:'list',initialValue:[],updateMode:'approval'}]],
 ['Location & Time',[{id:'location',label:'Location',type:'text',initialValue:'Starting location',updateMode:'automatic'},{id:'recovery',label:'Recovery time',type:'timer',initialValue:{remaining:3,clock:'story'},updateMode:'approval'}]],
 ['Quests & Flags',[{id:'quest',label:'Current quest',type:'quest',initialValue:{stage:'Not started',status:'inactive'},updateMode:'approval'},{id:'door_unlocked',label:'Door unlocked',type:'boolean',initialValue:false,updateMode:'automatic'}]],
 ['Clothing & Appearance',[{id:'clothing',label:'Clothing',type:'text',initialValue:'Usual outfit',updateMode:'automatic'}]]
];
function scopeTemplate(value,owner){if(typeof value==='string'&&value.startsWith('character:self'))return value.replace('character:self',owner);if(Array.isArray(value))return value.map(v=>scopeTemplate(v,owner));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[scopeTemplate(k,owner),scopeTemplate(v,owner)]));return value;}
module.exports={scopeTemplate,clone,hash,TYPES,keyOf,validateDefinition,validateValue,initialState,signature,stateAt,conditionPass,activeContext,propose,reconcile,TEMPLATE_DATA};
