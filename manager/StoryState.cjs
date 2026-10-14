// Versioned state contract. Shared by the service and unit tests; dialogue never contains patches.
const crypto=require('node:crypto');
const clone=x=>JSON.parse(JSON.stringify(x)),hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const TYPES=['number','boolean','enum','text','list','relationship','timer','clock','quest','injuries','record'];
const keyOf=d=>d.owner+':'+d.id;
function parseModelJSON(raw){
 const text=String(raw).replace(/<think>[\s\S]*?<\/think>/gi,'');
 for(let start=0;start<text.length;start++){
  if(text[start]!=='{')continue;let depth=0,quoted=false,escaped=false;
  for(let i=start;i<text.length;i++){const c=text[i];if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}if(c==='"'){quoted=true;continue;}if(c==='{')depth++;if(c==='}'&&--depth===0){try{return JSON.parse(text.slice(start,i+1))}catch{break}}}
 }
 throw Error('The model returned incomplete or invalid JSON. No tracker values were changed.');
}
function validateDefinition(input){
 const d=clone(input);if(!d||!/^[-\w]{1,80}$/.test(d.id)||typeof d.owner!=='string'||!/^(character|player):[-\w]{1,100}$/.test(d.owner)||!TYPES.includes(d.type))throw Error('Tracker needs a unique ID, owner and supported type.');
 d.label=String(d.label||d.id).slice(0,150);
 d.description=String(d.description||'').slice(0,1200);
 d.category=String(d.category||'General').slice(0,50);
 d.icon=String(d.icon||'').slice(0,12);
 d.unit=String(d.unit||'').slice(0,24);
 d.instructions=String(d.instructions||'').slice(0,2400);
 d.changeRules=String(d.changeRules||'').slice(0,2400);
 d.alwaysInject=d.alwaysInject!==false;
 if(d.rules!==undefined&&(typeof d.rules!=='object'||Array.isArray(d.rules)||!d.rules))throw Error('Status rules must map statuses to story effects.');
 if(d.transitions!==undefined&&(typeof d.transitions!=='object'||Array.isArray(d.transitions)||!d.transitions))throw Error('Status transitions must map statuses to allowed next values.');
 d.updateMode=d.updateMode||'approval';if(!['automatic','approval','manual'].includes(d.updateMode))throw Error('Invalid tracker update mode.');
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
 if(d.type==='clock'&&!(typeof v==='string'&&(v==='--:--'||/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v))))throw Error(d.label+': use 24-hour HH:mm, or --:-- until the scene establishes a time.');
 if(d.type==='timer'&&(!v||!Number.isFinite(v.remaining)||v.remaining<0||!['story','wall'].includes(v.clock)))throw Error(d.label+': timer needs remaining duration and story/wall clock.');
 if(d.type==='quest'&&(!v||typeof v.stage!=='string'||!['inactive','active','complete','failed'].includes(v.status)))throw Error(d.label+': quest needs stage and status.');
 if(d.type==='record'){if(!v||typeof v!=='object'||Array.isArray(v)||JSON.stringify(v).length>24000||Object.keys(v).length>30)throw Error(d.label+': use a structured record (maximum 30 fields / 24000 characters).');const check=(x,depth=0)=>{if(depth>5)throw Error('Tracker record is too deeply nested.');if(x===null||typeof x==='boolean'||typeof x==='string'&&x.length<=6000||Number.isFinite(x))return;if(Array.isArray(x)&&x.length<=100){x.forEach(y=>check(y,depth+1));return}if(x&&typeof x==='object'&&Object.keys(x).length<=30){Object.values(x).forEach(y=>check(y,depth+1));return}throw Error('Invalid tracker record field.');};check(v);}
 if(d.type==='injuries')validateInjuries(v);
 return v;
}
function validateInjuries(v){
 if(!Array.isArray(v)||v.length>100)throw Error('Injuries must be an array of at most 100 records.');
 const ids=new Set();
 for(const injury of v){
  if(!injury||typeof injury!=='object'||Array.isArray(injury)||!/^[-\w]{1,80}$/.test(injury.id)||ids.has(injury.id))throw Error('Each injury needs a stable unique ID.');ids.add(injury.id);
  for(const key of ['location','cause','symptoms','limitations','treatment','scar'])if(typeof injury[key]!=='string'||injury[key].length>1200)throw Error('Injury '+key+' must be concise text.');
  if(!injury.location.trim()||!['minor','moderate','severe','critical'].includes(injury.severity)||!['fresh','treated','healing','healed','scarred'].includes(injury.status)||!Number.isFinite(injury.pain)||injury.pain<0||injury.pain>10)throw Error('Injury needs location, severity, status and pain 0–10.');
 }
 return v;
}
function validateInjuryChange(prior,next){
 const allowed={fresh:['fresh','treated','healing','healed','scarred'],treated:['treated','fresh','healing','healed','scarred'],healing:['healing','fresh','treated','healed','scarred'],healed:['healed','fresh','scarred'],scarred:['scarred','fresh']};
 for(const old of prior){const changed=next.find(n=>n.id===old.id);if(!changed)throw Error('Keep injury history, marking healed or scarred instead of deleting records.');if(changed.location!==old.location||changed.cause!==old.cause)throw Error('Injury ID, location and origin are stable; add a new injury for a different wound.');if(!allowed[old.status].includes(changed.status))throw Error('Invalid injury progression.');if(old.scar&&!changed.scar)throw Error('Preserve established scars.');}
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
 for(const d of session.definitions){const key=keyOf(d),relevant=d.enabled!==false&&(d.alwaysInject!==false||d.relevantKeywords.some(x=>text.includes(x.toLowerCase())));if(Object.hasOwn(state,key)&&relevant&&selected.length<cap){selected.push({key,label:d.label,category:d.category,description:d.description,value:state[key],unit:d.unit,rule:[d.rules?.[String(state[key])],d.instructions,d.changeRules].filter(Boolean).join(' | '),hidden:d.visibility==='hidden'});}else omitted.push(key);}
 const ctx={text,location:selected.filter(x=>/location/i.test(x.key)).map(x=>x.value).join(' '),time:selected.filter(x=>/time/i.test(x.key)).map(x=>x.value).join(' ')};
 const lore=(session.lore||[]).map(e=>{const keyword=!e.keywords?.length||e.keywords.some(k=>text.includes(k.toLowerCase()));const active=keyword&&conditionPass(e.condition,state,ctx);return {...e,active,reason:!keyword?'No keyword match':!active?'State condition not met':'Keyword and state condition matched'};});
 return {state,trackers:selected,omitted,lore,provenance:session.events.filter(e=>e.status==='confirmed').map(e=>({key:e.key,sourceMessageId:e.sourceMessageId,reason:e.reason})),text:'[Confirmed story state — authoritative over conflicting older dialogue or memory; respect naturally, do not recite]\n'+selected.map(x=>x.label+(x.unit?' ('+x.unit+')':'')+': '+JSON.stringify(x.value)+(x.description?' — '+x.description:'')+(x.rule?' | Story and change rules: '+x.rule:'')).join('\n')+'\n'+lore.filter(e=>e.active).map(e=>'[Lore '+e.id+'] '+e.text).join('\n')};
}
function propose(session,messages,patch,{manual=false,approve=false}={}){
 if(!Array.isArray(patch)||patch.length>100)throw Error('State analysis must return at most 100 changes.');const state=stateAt(session,messages),events=[];
 for(const item of patch){
  const d=session.definitions.find(d=>keyOf(d)===item.key);if(!d)throw Error('Unknown tracker owner/ID.');const source=messages.find(m=>m.extra?.heroMessageId===item.sourceMessageId);if(!source)throw Error('State change references a missing message.');
  const introduced=d.introducedAt?messages.findIndex(m=>m.extra?.heroMessageId===d.introducedAt):-1;if(!manual&&introduced>messages.indexOf(source))throw Error('Tracker starting values were established after this message; no retrospective AI change.');validateValue(d,item.value);if(!manual&&(d.updateMode==='manual'||d.enabled===false))throw Error('This tracker is manual only.');
  const evidence=String(item.evidence||'');if(!manual&&(!evidence||!String(source.mes).includes(evidence)))throw Error('State change needs an exact evidence quote from its source message.');
  if(!manual&&session.events.some(e=>e.key===item.key&&e.sourceMessageId===item.sourceMessageId&&e.status==='confirmed'&&e.authority==='user'))continue;
  const prior=state[item.key];if(d.type==='record'&&!manual){for(const field of Object.keys(prior))if(!Object.hasOwn(item.value,field))throw Error('Preserve unchanged record fields: '+field);if(Array.isArray(prior.recentMeals)&&prior.recentMeals.slice(-19).some(meal=>!item.value.recentMeals?.some(next=>JSON.stringify(next)===JSON.stringify(meal))))throw Error('Preserve recent established meal history.');}if(d.type==='injuries'&&!manual)validateInjuryChange(prior,item.value);if(!manual&&JSON.stringify(prior)===JSON.stringify(item.value))continue;if(d.type==='enum'&&d.transitions?.[prior]&&!d.transitions[prior].includes(item.value)&&!manual&&!approve)throw Error('This status transition is not allowed.');
  const major=d.type==='number'&&Math.abs(item.value-prior)>d.maxDelta||d.type==='list'&&JSON.stringify(prior)!==JSON.stringify(item.value)||d.type==='quest'&&['complete','failed'].includes(item.value.status)||d.type==='timer'&&item.value.clock==='wall';
  const status=manual||approve?'confirmed':d.updateMode==='approval'||major||item.ambiguous?'pending':'confirmed';
  const sourceSignature=signature(source),eventId=manual?crypto.randomUUID():hash({key:item.key,sourceMessageId:item.sourceMessageId,sourceSignature,value:item.value});
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
 ['Health & Injuries',[
  {id:'health',label:'Physical condition',category:'Vitals',icon:'❤️',description:'Overall physical wellbeing, not hit points. 100 is healthy; 0 is incapacitated.',type:'number',initialValue:100,min:0,max:100,maxDelta:15,unit:'%',updateMode:'automatic',instructions:'At 75–99 show fatigue or mild pain if established; 40–74 make exertion difficult; 1–39 show severe functional limits; at 0 incapacitation needs an explicit event.',changeRules:'Only change after explicit harm, illness, treatment or recovery in the story. Ordinary rest never instantly removes injuries.'},
  {id:'injuries',label:'Injuries & recovery',category:'Injuries',icon:'🩹',type:'injuries',initialValue:[],updateMode:'automatic',description:'Persistent records for every established injury: body location, origin, severity, pain, limitations, treatment, healing and scars.',instructions:'Respect each active injury in actions and dialogue. Treated wounds still hurt. Healed injuries retain their history and established scars.',changeRules:'Add only explicit injuries. Keep stable IDs and origin. Update symptoms, pain and treatment when narrated; recovery requires elapsed story time or explicit healing. Mark healed/scarred rather than deleting. Do not copy the overall health percentage into this ledger.'}

 ]],
 ['Hunger & Meals',[
  {id:'hunger',label:'Hunger & recent meals',category:'Vitals',icon:'🍲',type:'record',initialValue:{fullness:null,summary:'Hunger and meals not established yet.',lastMealAt:'Unknown',recentMeals:[]},updateMode:'automatic',description:'Fullness plus persistent meal details. Unknown values stay unknown.',instructions:'Use meal history and time since the last established meal to inform hunger, energy and food choices. Keep recentMeals as entries with food, portion, story time and any explicit effects.',changeRules:'Add a meal only when actually eaten, not offered or planned. Keep the last 20 established meals. Do not invent meal times, ingredients, portions or elapsed time. Update fullness only from evidence; preserve all other fields when changing a field.'}
 ]],
 ['Scars & Appearance',[
  {id:'scars',label:'Permanent scars',category:'Appearance',icon:'🩹',type:'list',initialValue:[],updateMode:'approval',description:'One entry per scar: body location, appearance, origin and whether visible.',changeRules:'Only add after healing or an explicitly established old scar. Never erase permanent scars without an explicit event.'},
  {id:'appearance',label:'Current appearance',category:'Appearance',icon:'👤',type:'text',initialValue:'Unchanged',updateMode:'automatic',description:'Stable visible facts: hairstyle, dirt, bruises and other distinctive details.',changeRules:'Update only when outward appearance visibly changes.'}
 ]],
 ['Trust & Affection',[
  {id:'trust',label:'Trust in the player',category:'Relationships',icon:'🤝',type:'number',initialValue:30,min:0,max:100,maxDelta:8,unit:'%',updateMode:'approval',description:'0 hostile distrust; 25 wary; 50 neutral; 75 reliable ally; 100 profound trust.',instructions:'Dialogue and willingness to confide should reflect trust, but avoid treating a percentage as automatic consent.',changeRules:'Increase for proven reliability, decrease for deception or betrayal. Small everyday interactions change at most a few points.'},
  {id:'relationships',label:'Relationship bonds',category:'Relationships',icon:'💞',type:'relationship',initialValue:{},min:0,max:100,updateMode:'approval',description:'Separate 0–100 trust or closeness values for explicitly known people.'}
 ]],
 ['Stress & Mood',[
  {id:'mood',label:'Current mood',category:'Mind',icon:'🎭',type:'enum',initialValue:'calm',allowedValues:['calm','happy','worried','angry','afraid'],rules:{calm:'Behavior is measured.',happy:'More relaxed and receptive.',worried:'Distracted and watchful.',angry:'Irritable, not automatically violent.',afraid:'Cautious or hesitant, not automatically helpless.'},updateMode:'automatic',changeRules:'Base changes on clearly established actions and circumstances, never on guessed hidden feelings.'},
  {id:'stress',label:'Stress',category:'Mind',icon:'⚡',type:'number',initialValue:0,min:0,max:100,maxDelta:15,unit:'%',updateMode:'approval',description:'0 relaxed; 25 tense; 50 strained; 75 overwhelmed; 100 near breakdown.',instructions:'Reflect established stress in speech, choices and concentration, not an arbitrary status announcement.'}
 ]],
 ['Inventory & Equipment',[
  {id:'inventory',label:'Carried inventory',category:'Equipment',icon:'🎒',type:'list',initialValue:[],updateMode:'approval',description:'Confirmed possessions only, with quantities if known.',changeRules:'Add when acquired; remove when sold, used, lost or given away. Never fabricate items.'},
  {id:'equipment',label:'Currently equipped',category:'Equipment',icon:'⚔️',type:'list',initialValue:[],updateMode:'approval',description:'Items currently worn or held, including which hand or body slot if relevant.'}
 ]],
 ['Secrets & Knowledge',[
  {id:'secret_known',label:'Hidden secret learned',category:'Knowledge',icon:'🔒',type:'boolean',initialValue:false,visibility:'hidden',updateMode:'approval',description:'A specific secret has been revealed to this character, not merely mentioned to the reader.'},
  {id:'known_names',label:'Known people',category:'Knowledge',icon:'📖',type:'list',initialValue:[],updateMode:'approval',description:'People the owner has actually met or learned about in-story.'}
 ]],
 ['Location & Time',[
  {id:'location',label:'Current location',category:'World',icon:'📍',type:'text',initialValue:'Starting location',updateMode:'automatic',description:'Precisely named current scene location. Avoid inventing unexplored places.',changeRules:'Update after explicitly moving to a new location.'},\n  {id:'current_time',label:'Current story time (24h)',category:'World',icon:'🕒',type:'clock',initialValue:'--:--',unit:'HH:mm',updateMode:'automatic',description:'Local time INSIDE the story, in 24-hour HH:mm format. --:-- means no story time is established. Not the computer clock.',instructions:'Keep daylight, locations, NPC schedules and elapsed time coherent. Never announce or change the time without an event.',changeRules:'Update only from an explicit stated time or reliable progression of an established fictional clock. Use HH:mm (00:00–23:59); do not confuse duration with an absolute clock time.'},
  {id:'recovery',label:'Recovery countdown',category:'Time',icon:'⏳',type:'timer',unit:'days',initialValue:{remaining:3,clock:'story'},updateMode:'approval',description:'Story days of medically established healing remaining; never use real-world clock time without opting in.'}
 ]],
 ['Quests & Flags',[
  {id:'quest',label:'Current quest',category:'Quests',icon:'📜',type:'quest',initialValue:{stage:'Not started',status:'inactive'},updateMode:'approval',description:'Tracks explicit narrative objective, stage and completion status.'},
  {id:'door_unlocked',label:'Door unlocked',category:'World',icon:'🔑',type:'boolean',initialValue:false,updateMode:'automatic',description:'Whether this particular door was opened by a confirmed action.'}
 ]],
 ['Clothing & Appearance',[
  {id:'clothing',label:'Worn clothing',category:'Appearance',icon:'👗',type:'text',initialValue:'Usual outfit',updateMode:'automatic',description:'Current clothes, condition, dirt, damage, accessories and changes that persist across scenes.',changeRules:'Only change after dressing, undressing, soiling or repairing clothes.'}
 ]]
];
function scopeTemplate(value,owner){if(typeof value==='string'&&value.startsWith('character:self'))return value.replace('character:self',owner);if(Array.isArray(value))return value.map(v=>scopeTemplate(v,owner));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[scopeTemplate(k,owner),scopeTemplate(v,owner)]));return value;}
module.exports={parseModelJSON,scopeTemplate,clone,hash,TYPES,keyOf,validateDefinition,validateValue,initialState,signature,stateAt,conditionPass,activeContext,propose,reconcile,validateInjuries,validateInjuryChange,TEMPLATE_DATA};
