const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../manager/Adventure.html'),'utf8');
const runtime=html.slice(html.indexOf('// Adventure: private rules decision'),html.indexOf('boot().then(()=>',html.indexOf('// Adventure: private rules decision')));
const lore=JSON.parse(html.match(/const HERO_ILREON_LORE=(.*);\n\/\/ Adventure:/)[1]);
function setup(){
 const npcs={tavern_keeper:{id:'tavern_keeper',name:'Савос',status:'alive',locationId:'tavern',homeLocationId:'tavern',memory:[],combat:{hp:25,maxHp:25,ac:15},appearance:'зелёные глаза',personality:'добрый'}};
 const c=vm.createContext({console,HERO_ILREON_LORE:lore,G:{npcs,world:{locations:{tavern:{name:'Таверна «У Савоса»',district:'Лостмарк'}},currentLocationId:'tavern',turn:1},party:{companions:{}},dialogue:{}},makeNpc:(id,name,occupation,locationId,extra)=>({id,name,occupation,locationId,memory:[],...extra}),seedNpcs:()=>npcs,migrateState:g=>g,locationNpcIds:()=>Object.keys(npcs).filter(id=>npcs[id].locationId==='tavern'),contextNpcs:()=>Object.values(npcs).filter(n=>n.locationId==='tavern'),activeCompanionIds:()=>[],recordNpcEvent:(n,text,type)=>n.memory.push({text,type,turn:1}),ILR136_markNpcDead:n=>{n.status='dead';return true},ILR136_removeFromParty:()=>{},applyNpcOp:o=>{const n=npcs[o.npcId];if(n&&o.locationId)n.locationId=o.locationId;},processNpcAction:()=>true,isOrdinaryDialogue:t=>/пива|спрашиваю/.test(t),directorPrompt:()=>'',addSystem:()=>{},addNarration:()=>{},ILR154_combatStateForNarrator:()=>({enemies:[]}),ILR154_combatNarrationBeat:()=>{},openNpcProfile:()=>{},ILR152_ensureRemains:()=>({corpse:true}),conversationalNpc:()=>npcs.tavern_keeper,recentConversation:()=>'',aiJson:async()=>({narration:'Савос ставит кружку.',lines:[{npcId:'tavern_keeper',text:'Вот ваше пиво.'}]})});
 vm.runInContext(runtime,c);c.HERO_syncIdentity(c.G);return c;
}
test('Narrator receives public decision only, never private plan, secret NPC memory or mechanics patch',async()=>{
 const c=setup();let prompt;c.aiJson=async p=>{prompt=p;return{narration:'Савос ставит кружку.',lines:[{npcId:'tavern_keeper',text:'Вот ваше пиво.'}]}};
 await c.HERO_narrateDecision('Пива', {publicResult:'Подал пиво.',privatePlan:'ULTRA_PRIVATE_ASSASSIN',patch:{secret:'PRIVATE_PATCH'},speechIntents:[]},null,null);
 assert.doesNotMatch(prompt,/ULTRA_PRIVATE|PRIVATE_PATCH|gmSecret|Сад Теней/);assert.match(prompt,/Подал пиво/);
});
test('Failed or incomplete public narration refuses the turn rather than displaying the DM plan',async()=>{
 const c=setup();await assert.rejects(c.HERO_narrateDecision('Пива',{privatePlan:'private'},null,null),/наблюдаемый/);
 c.aiJson=async()=>({narration:'Кружка на стойке.',lines:[]});await assert.rejects(c.HERO_narrateDecision('Пива',{publicResult:'Подал пиво'},null,null),/пропустил/);
});
test('Ordinary movement and speech have no rolls; opposed actions with concrete stakes keep checks',()=>{
 const c=setup();assert.equal(c.HERO_shouldSkipCheck('Иду к стойке',{kind:'skill',failureConsequence:'потерял время',uncertainty:'неясно'}),true);
 assert.equal(c.HERO_shouldSkipCheck('Пива пожалуйста',{kind:'skill'}),true);
 assert.equal(c.HERO_shouldSkipCheck('Взламываю замок',{kind:'skill',uncertainty:'замок сложный',failureConsequence:'стража услышит'}),false);
 assert.equal(c.HERO_shouldSkipCheck('Атакую',{kind:'attack'}),false);
});
test('Savos and masked persona share persistent memory and cannot appear together after load',()=>{
 const c=setup();c.recordNpcEvent(c.G.npcs.tavern_keeper,'Узнал имя игрока','dialogue');assert.equal(c.G.npcs.masked_assassin.memory[0].text,'Узнал имя игрока');
 c.applyNpcOp({op:'move',npcId:'masked_assassin',locationId:'tavern'});assert.equal(c.G.npcs.tavern_keeper.locationId,null);assert.equal(c.G.npcs.masked_assassin.locationId,'tavern');
 c.G=JSON.parse(JSON.stringify(c.G));c.HERO_syncIdentity(c.G);assert.equal(c.G.npcs.tavern_keeper.memory,c.G.npcs.masked_assassin.memory);
});
test('Savos death is staged, no actual death or lootable corpse; other NPCs remain mortal',()=>{
 const c=setup(),e={npcId:'tavern_keeper',hp:0};c.ILR136_markNpcDead(c.G.npcs.tavern_keeper,e);
 assert.equal(c.G.world.identityStates.savos.alive,true);assert.equal(c.G.npcs.tavern_keeper.status,'feigned_dead');assert.ok(c.G.npcs.tavern_keeper.combat.hp>0);assert.equal(c.ILR152_ensureRemains(e),null);
 const other={id:'guard',status:'alive'};c.ILR136_markNpcDead(other);assert.equal(other.status,'dead');
});
test('Canonical lore is bundled; old-party events are absent unless explicitly activated',()=>{
 const c=setup();assert.equal(lore.entries.length,305);assert.equal(lore.entries.filter(e=>e.category==='npc').length,159);
 const scenario=lore.entries.find(e=>e.category==='scenario');assert.ok(!c.HERO_loreFor(scenario.title).some(e=>e.id===scenario.id));
 c.G.world.activeScenarioIds=[scenario.id];assert.ok(c.HERO_loreFor(scenario.title).some(e=>e.id===scenario.id));
 assert.ok(c.HERO_loreFor('Савос').some(e=>e.id==='npc_savos'));
});
test('Real transactional action performs distinct DM and narrator requests and applies a patch once',async()=>{
 const c=setup(),calls=[],visible=[];let patches=0;
 Object.assign(c,{G:{...c.G,player:{hp:10}},deep:x=>JSON.parse(JSON.stringify(x)),recognizedSpell:()=>null,ILR130_hasEffect:()=>false,ILR130_consumeAmmo:()=>({ok:true}),ILR110_consumeActionResource:()=>({ok:true}),ILR130_cleanupEffects:()=>{},ILR132_shouldSkipDirectorCheck:()=>false,addNarration:t=>visible.push(t),addDialogue:(id,t)=>visible.push(t),refresh:()=>{},applyPatch:()=>patches++});
 c.aiJson=async(p,label)=>{calls.push(label);return label==='Director'?{phase:'resolve',privatePlan:'PRIVATE_DM_INTENT',publicResult:'Подал пиво.',patch:{coinDelta:{bronze:-3}}}:{narration:'Савос ставит кружку.',lines:[{npcId:'tavern_keeper',text:'Вот ваше пиво.'}]}};
 const a=html.indexOf('resolvePlayerAction=async function(action){',html.indexOf('// Preserve all 1.3.0 spell/ammo/resource transaction')),b=html.indexOf('const ILR132_prevMigrate',a);
 vm.runInContext(html.slice(a,b),c);assert.equal(await c.resolvePlayerAction('Пива'),true);
 assert.deepEqual(calls,['Director','Adventure narrator']);assert.equal(patches,1);assert.ok(!visible.join(' ').includes('PRIVATE_DM_INTENT'));assert.equal(c.G.world.dmPlans[0].plan,'PRIVATE_DM_INTENT');
});
test('Real action never applies the patch when external narrator fails',async()=>{
 const c=setup();let patches=0;
 Object.assign(c,{G:{...c.G,player:{hp:10}},deep:x=>JSON.parse(JSON.stringify(x)),recognizedSpell:()=>null,ILR130_hasEffect:()=>false,ILR130_consumeAmmo:()=>({ok:true}),ILR110_consumeActionResource:()=>({ok:true}),ILR130_cleanupEffects:()=>{},ILR132_shouldSkipDirectorCheck:()=>false,refresh:()=>{},applyPatch:()=>patches++});
 c.aiJson=async(p,label)=>{if(label==='Director')return{phase:'resolve',publicResult:'Подал пиво.',patch:{hpDelta:-3}};throw Error('Narrator truncated')};
 const a=html.indexOf('resolvePlayerAction=async function(action){',html.indexOf('// Preserve all 1.3.0 spell/ammo/resource transaction')),b=html.indexOf('const ILR132_prevMigrate',a);
 vm.runInContext(html.slice(a,b),c);await assert.rejects(c.resolvePlayerAction('Пива'),/truncated/);assert.equal(patches,0);assert.equal(c.G.player.hp,10);
});
