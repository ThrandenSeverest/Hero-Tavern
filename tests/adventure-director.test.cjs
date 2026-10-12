const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../manager/Adventure.html'),'utf8');
function between(start,end){const a=html.indexOf(start),b=html.indexOf(end,a);assert.ok(a>=0&&b>a,'Missing Adventure '+start);return html.slice(a,b)}
const jsonCode=between('function parseJson(raw){','function extractImageUrl(');
const turnCode=between('async function submitAction(){','async function travelTo(');
test('Adventure parses prefaced fenced nested JSON and harmless trailing commas',()=>{
 const c=vm.createContext({console});vm.runInContext(jsonCode,c);
 const fence=String.fromCharCode(96).repeat(3);
 const result=c.parseJson('Here is JSON: '+fence+'json\n{"phase":"resolve","narration":"a {strange} place","lines":[],}\n'+fence);
 assert.equal(result.phase,'resolve');assert.equal(result.narration,'a {strange} place');assert.equal(result.lines.length,0);
});
test('Adventure retries truncated Director JSON once, validates response and stops after two failures',async()=>{
 let attempts=0;const c=vm.createContext({console,aiText:async()=>++attempts===1?'{"phase":"resolve","narration":"unfinished"':'{"phase":"resolve","narration":"Savos puts down a mug.","lines":[],"patch":{}}'});
 vm.runInContext(jsonCode,c);const value=await c.aiJson('Director JSON only','Director');
 assert.equal(value.phase,'resolve');assert.equal(attempts,2);
 let bad=0;c.aiText=async()=>{bad++;return '{"phase":"invalid"}'};
 await assert.rejects(c.aiJson('Director JSON only','Director'),/не прошли проверку JSON/);assert.equal(bad,2);
});
test('Adventure restores the player turn and all mutated resources if Director fails',async()=>{
 const input={value:'Пива мне пожалуйста'},c=vm.createContext({console,G:{player:{hp:12,inventory:[]},settings:{autoSave:false},undo:[],log:[],combat:{active:false}},busy:false,$:()=>input,deep:value=>JSON.parse(JSON.stringify(value)),migrateState:x=>x,createSnapshot:()=>({id:'snap1'}),setBusy:()=>{},refresh:()=>{},saveGame:async()=>{},enemyCombatPulse:async()=>{},runNpcInitiative:async()=>{}});
 c.addPlayer=text=>c.G.log.push({type:'player',text});c.addSystem=text=>c.G.log.push({type:'system',text});
 c.resolvePlayerAction=async()=>{c.G.player.hp=1;c.G.player.inventory.push({name:'phantom'});throw Error('Malformed director JSON')};
 vm.runInContext(turnCode,c);await c.submitAction();
 assert.equal(input.value,'Пива мне пожалуйста');assert.equal(c.G.player.hp,12);assert.equal(c.G.player.inventory.length,0);
 assert.equal(c.G.log.filter(x=>x.type==='player').length,0);assert.equal(c.G.log.filter(x=>x.type==='system').length,1);
});
