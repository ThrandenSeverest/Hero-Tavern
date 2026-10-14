// Per-chat continuity memory, invalidated by edits/rewinds. Never changes saved dialogue.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {filterReply}=require('./ReplyFilters.cjs');
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function memoryFile(root,id){if(typeof id!=='string'||!id||id.length>300)throw Error('Invalid chat identity.');return path.join(root,'Memories',digest(id)+'.json')}
function readMemory(root,id){const file=memoryFile(root,id);return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{summary:'',notes:'',covered:0,hash:''}}
function writeMemory(root,id,value){const file=memoryFile(root,id);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(value,null,2));fs.renameSync(file+'.tmp',file);return value}
function editMemory(root,id,{notes,reset=false}){if(typeof notes!=='string'||notes.length>6000)throw Error('Memory notes must be at most 6000 characters.');const old=readMemory(root,id);return writeMemory(root,id,{...old,notes,...(reset?{summary:'',covered:0,hash:''}:{})})}
function messagesFrom(input){if(!Array.isArray(input)||input.length>10000)throw Error('Invalid chat history.');return input.filter(x=>x&&typeof x.text==='string'&&x.text.trim()).map(x=>({role:x.role==='user'?'user':x.role==='system'?'system':'assistant',name:String(x.name||'').slice(0,100),text:x.role==='user'||x.role==='system'?x.text:filterReply(x.text,{stopAtSpeaker:false,removeModelTokens:true})})).filter(x=>x.text.trim());}
const transcript=messages=>messages.map(x=>`${x.name||x.role}: ${x.text}`).join('\n');
const chatML=messages=>messages.map(x=>`<|im_start|>${x.role}\n${x.name?x.name+': ':''}${x.text}<|im_end|>\n`).join('');
function basePrompt(prompt){const systems=[...prompt.matchAll(/<\|im_start\|>system\n[\s\S]*?<\|im_end\|>\n?/g)].map(x=>x[0]);if(systems.length)return systems.join('');const first=prompt.indexOf('<|im_start|>user');return first>=0?prompt.slice(0,first):prompt.replace(/<\|im_start\|>assistant[\s\S]*$/,'');}
function createMemory({root,countTokens,complete,setDiagnostics=()=>{}}){
 async function prepare(body,budget,settings){
  const h=body.hero_context;if(!h)return body.prompt;
  const all=messagesFrom(h.messages),id=h.id;
  if(!all.length)return body.prompt;
  let memory=readMemory(root,id);
  if(memory.covered>all.length||memory.hash!==digest(all.slice(0,memory.covered)))memory={...memory,summary:'',covered:0,hash:digest([])};
  if(!settings.memoryEnabled)memory={...memory,summary:'',covered:0};
  let start=settings.memoryEnabled?memory.covered:0;
  const base=basePrompt(body.prompt), tail='<|im_start|>assistant\n';
  const character=h.character||{};
  const fields=[
   ['Name',character.name,180],
   ['Canonical appearance and background',character.description,3100],
   ['Personality, speech, mannerisms and motivations',character.personality,1700],
   ['Scenario and relationships',character.scenario,1100],
   ['Dialogue examples',character.mes_example,650]
  ].map(([label,value,max])=>value?'['+label+']\n'+String(value).slice(0,max):'').filter(Boolean).join('\n');
  const characterBlock=fields?'<|im_start|>system\n[Canonical SillyTavern character contract]\n'+fields+
   '\nPortray THIS character, not a generic assistant. Respect their appearance, habits, temperament, motives, abilities and way of speaking. Respond in-scene with concrete reactions; never write the player’s choices, speech or actions. Current confirmed tracker state overrides older contradictory details, but not established identity.<|im_end|>\n':'';
  const render=()=>base+characterBlock+(memory.notes||memory.summary?'<|im_start|>system\n[Continuity memory — past events, not new dialogue]\n'+memory.notes+'\n'+memory.summary+'<|im_end|>\n':'')+chatML(all.slice(start))+tail;
  // Keep the freshest turns verbatim, including the latest user action. Summarize only older turns.
  while(await countTokens(render())>budget){
   if(all.length-start<=2)throw Error('The character card, memory notes and latest turn exceed the loaded context. Increase Hardware context or shorten the card/notes.');
   const room=Math.max(1,all.length-start-Math.min(settings.recentMessages,all.length-start-1));
   let end=start+room, chunk=all.slice(start,end);
   if(settings.memoryEnabled){
    const summaryBudget=Math.min(budget,settings.summaryInputBudget??budget);
    const header='Summarize established conversation facts for continuity. Preserve names, relationships, locations, promises, goals and unresolved events. Do not invent facts or repeat dialogue. Output compact factual notes only, without reasoning. /no_think\nPrevious memory:\n'+memory.summary+'\nOlder turns:\n';
    while(chunk.length>1&&await countTokens(header+transcript(chunk))>summaryBudget)chunk=all.slice(start,--end);
    if(await countTokens(header+transcript(chunk))>summaryBudget)throw Error('An older message exceeds the context needed for memory. Increase Hardware context or edit that message.');
    const summary=await complete(header+transcript(chunk),settings.memoryTokens);if(!summary.trim())throw Error('The model returned empty continuity memory. Retry before advancing the chat.');memory.summary=summary;
   }
   start=end;memory.covered=start;memory.hash=digest(all.slice(0,start));
  }
  // Disabling memory opts into explicit rolling context; it does not erase the saved memory.
  if(settings.memoryEnabled)writeMemory(root,id,memory);
  const prompt=render(),tokens=await countTokens(prompt);
  setDiagnostics({chatId:id,totalMessages:all.length,includedMessages:all.length-start,summarizedMessages:settings.memoryEnabled?start:0,promptTokens:tokens,promptBudget:budget});
  return prompt;
 }
 return {prepare};
}
module.exports={digest,readMemory,writeMemory,editMemory,messagesFrom,createMemory};
