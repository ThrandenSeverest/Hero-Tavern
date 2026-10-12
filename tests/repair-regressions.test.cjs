const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../manager/Adventure.html'),'utf8');
function chunk(start,end){const a=html.indexOf(start),b=html.indexOf(end,a);assert.ok(a!==-1&&b>a,'Missing '+start);return html.slice(a,b);}
const directorCode=chunk('function conversationalNpc(action){','function npcPulsePrompt(');
const portraitCode=chunk('function npcPortraitSpec(n){','async function generateNpcPortrait(');
function npcContext(){
 const person={id:'tavern_keeper',name:'Савос',occupation:'трактирщик',personality:'сдержанный',goal:'поддерживать таверну',status:'alive',appearance:'Мужчина около сорока, зеленые глаза, каштановые волосы и борода'};
 const c=vm.createContext({console,G:{dialogue:{lastNpcId:'tavern_keeper',activeNpcId:'tavern_keeper'},world:{currentLocationId:'blind_moon'}},contextNpcs:()=>[person],recognizedSpell:()=>null,recentConversation:()=>'',directorPrompt:()=>'',aiJson:async()=>({phase:'resolve',narration:'Савос берёт кружку со стойки.',lines:[],patch:{}}),aiText:async()=> 'Сейчас налью вам пива. Светлое или тёмное?',addNarration:()=>{},addDialogue:()=>{},addSystem:()=>{},applyPatch:()=>{}});
 vm.runInContext(directorCode,c);return {c,person};
}
test('Russian short answers address active NPC: JS ASCII word boundaries do not suppress speech',()=>{
 const {c,person}=npcContext();
 for(const message of ['Да ищу','Пива мне пожалуйста','Спасибо','Спрашиваю Савоса о работе']){assert.equal(c.conversationalNpc(message)?.id,person.id,message);}
 assert.equal(c.isOrdinaryDialogue('Пива мне пожалуйста'),true);
 assert.equal(c.isOrdinaryDialogue('Я атакую разбойника'),false);
});
test('Director without lines elicits a grounded spoken NPC reply, not just narrator',async()=>{
 const {c}=npcContext(),spoken=[],narrated=[];
 c.addDialogue=(id,text)=>spoken.push({id,text});c.addNarration=text=>narrated.push(text);
 await c.resolvePlayerAction('Пива мне пожалуйста');
 assert.equal(spoken.length,1);assert.equal(spoken[0].id,'tavern_keeper');
 assert.match(spoken[0].text,/пива/);assert.equal(narrated.length,1);
});
test('Ordinary conversation does not roll a meaningless d20 even if director suggests a check',async()=>{
 const {c}=npcContext();let calls=0,rolls=0;const spoken=[];
 c.aiJson=async()=>++calls===1?{phase:'check',check:{kind:'ability',ability:'WIS',dc:10}}:{phase:'resolve',narration:'Савос кивает.',lines:[{npcId:'tavern_keeper',text:'Расскажу вам о городе.'}],patch:{}};
 c.rollCheck=()=>{rolls++;return {die:19,bonus:0,total:19,dc:10,success:true}};
 c.addDialogue=(id,text)=>spoken.push(text);
 await c.resolvePlayerAction('Да ищу');
 assert.equal(rolls,0);assert.equal(calls,2);assert.equal(spoken.length,1);
});
test('Savos portrait fixes adult male identity and requests direct 512x768 generation without refiner',()=>{
 const c=vm.createContext({});vm.runInContext(portraitCode,c);
 const spec=c.npcPortraitSpec({id:'tavern_keeper',name:'Савос',occupation:'трактирщик',appearance:'Мужчина с зелеными глазами, бородой, каштановыми волосами',personality:'сдержанный'});
 assert.match(spec.prompt,/ADULT HUMAN MAN.*GREEN EYES.*BEARD.*MUSTACHE/);
 assert.match(spec.options.negative_prompt,/woman, female/);
 assert.equal(spec.options.refine,false);assert.equal(spec.options.width,512);assert.equal(spec.options.height,768);
 assert.match(spec.prompt,/зелеными глазами/);
});
test('Hidden-thinking-only response receives bounded, no-thinking recovery instead of immediate API failure',async()=>{
 const {createPipeline}=require('../manager/ReplyPipeline.cjs'),root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-recover-'));let count=0;const calls=[];
 try{
  const pipeline=createPipeline({root,backendURL:'http://unused',getContextSize:()=>8192,getModelProfile:()=>({Template:'chatml',Family:'Qwen3'}),fetchBackend:async(url,request)=>{
   if(url.includes('tokencount'))return new Response(JSON.stringify({value:120}),{headers:{'Content-Type':'application/json'}});
   const body=JSON.parse(request.body);calls.push(body);count++;
   return new Response(JSON.stringify({choices:[{text:count===1?'<think>Thinking and never closing':'A faithful painted fantasy portrait of a bearded innkeeper.'}]}),{headers:{'Content-Type':'application/json'}});
  }});
  const result=await pipeline.generate({prompt:'<|im_start|>user\nWrite an image prompt<|im_end|>\n<|im_start|>assistant\n',stream:false},null,{mode:'image-prompt'});
  assert.match(result.choices[0].text,/bearded innkeeper/);
  assert.equal(count,2);assert.match(calls[1].prompt,/\/no_think/);
  assert.equal(pipeline.runSnapshot().emptyReplyRecovery.success,true);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('Image generation uses original prompt if optional LLM refiner is broken',async()=>{
 const {createStudio}=require('../manager/ImageStudio.cjs'),root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-refiner-fallback-'));
 fs.mkdirSync(path.join(root,'Images'));let input;
 try{
  const studio=createStudio(root,{ensureText:async()=>{},pipeline:{generate:async()=>{throw Error('hidden reasoning only')},abort(){}},getImageState:()=>({selected:'DreamShaper_8_pruned.safetensors'}),generateImage:async value=>{input=value;return {url:'/images/output/123-abcd.png',model:'DreamShaper'}}});
  const result=await studio.action('/studio/generate',{prompt:'The bearded green-eyed male innkeeper Savos',refine:true});
  assert.match(input.prompt,/male innkeeper Savos/);assert.match(result.refinementWarning,/hidden reasoning only/);
  assert.equal(result.refined,false);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
