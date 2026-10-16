// Conversation/lore utilities. Tracker state is owned by the WTracker adapter.
const crypto=require('node:crypto');
const clone=x=>JSON.parse(JSON.stringify(x)),hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function parseModelJSON(raw){
 const text=String(raw).replace(/<think>[\s\S]*?<\/think>/gi,'');
 for(let start=0;start<text.length;start++){
  if(text[start]!=='{')continue;let depth=0,quoted=false,escaped=false;
  for(let i=start;i<text.length;i++){const c=text[i];if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}if(c==='"'){quoted=true;continue;}if(c==='{')depth++;if(c==='}'&&--depth===0){try{return JSON.parse(text.slice(start,i+1))}catch{break}}}
 }
 throw Error('The model returned incomplete or invalid JSON. No tracker values were changed.');
}
function conditionPass(condition,state,context={}){
 if(!condition)return true;
 if(condition.all)return condition.all.every(c=>conditionPass(c,state,context));if(condition.any)return condition.any.some(c=>conditionPass(c,state,context));
 let v=condition.key?state[condition.key]:context[condition.field];if(condition.key&&condition.field)v=v?.[condition.field];const target=condition.value;
 switch(condition.op||'eq'){case 'eq':return v===target;case 'ne':return v!==target;case 'gte':return Number(v)>=Number(target);case 'lte':return Number(v)<=Number(target);case 'contains':return Array.isArray(v)?v.includes(target):String(v||'').toLowerCase().includes(String(target).toLowerCase());default:return false;}
}
function scopeTemplate(value,owner){if(typeof value==='string'&&value.startsWith('character:self'))return value.replace('character:self',owner);if(Array.isArray(value))return value.map(v=>scopeTemplate(v,owner));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[scopeTemplate(k,owner),scopeTemplate(v,owner)]));return value;}

const W=require('./WTracker.cjs');
module.exports={parseModelJSON,scopeTemplate,clone,hash,conditionPass,...W};
