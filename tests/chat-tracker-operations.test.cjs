'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const S=require('../manager/StoryState.cjs');
const {parseCommands,trackerInstructions}=require('../manager/TrackerDelta.cjs');
const {createMemory}=require('../manager/ContextMemory.cjs');
const base={owner:'character:lyra',updateMode:'automatic'};
const definitions=[
 S.validateDefinition({...base,id:'health',label:'Health',type:'number',min:0,max:100,maxDelta:15,initialValue:70}),
 S.validateDefinition({...base,id:'mood',label:'Mood',type:'enum',allowedValues:['calm','happy','angry'],initialValue:'calm'}),
 S.validateDefinition({...base,id:'items',label:'Items',type:'list',initialValue:['key']}),
 S.validateDefinition({...base,id:'hunger',label:'Hunger',type:'record',initialValue:{fullness:null,summary:'Unknown',recentMeals:[]}}),
 S.validateDefinition({...base,id:'injuries',label:'Injuries',type:'injuries',initialValue:[]})
];
const key=id=>'character:lyra:'+id,make=(text,id='turn01')=>({extra:{heroMessageId:id},mes:text,name:'Lyra',is_user:false});
test('typed tracker updates change numbers, enum, list and record without JSON replies',()=>{
 const messages=[make('She eats hot soup, laughs, and finds a coin.')],state=S.initialState(definitions);
 const commands=[
 'UPDATE :: '+key('health')+' :: INCREASE :: 3 :: turn01 :: laughs',
 'UPDATE :: '+key('mood')+' :: SET :: happy :: turn01 :: laughs',
 'UPDATE :: '+key('items')+' :: ADD :: coin :: turn01 :: finds a coin',
 'UPDATE :: '+key('hunger')+' :: FIELD :: summary=Eaten a hot soup :: turn01 :: eats hot soup',
 'UPDATE :: '+key('hunger')+' :: FIELD :: recentMeals+=hot soup :: turn01 :: eats hot soup'
 ].join('\n');
 const r=parseCommands(commands,definitions,messages,state);
 assert.equal(r.issues.length,0,JSON.stringify(r.issues));assert.equal(r.changes.length,5);
 assert.deepEqual(r.changes.at(-1).value,{fullness:null,summary:'Eaten a hot soup',recentMeals:['hot soup']});
 assert.equal(r.changes[0].value,73);assert.equal(r.changes[1].value,'happy');assert.deepEqual(r.changes[2].value,['key','coin']);
 assert.match(trackerInstructions(definitions,state,messages),/operations array/);
});
test('removes items, decreases bounded values and declines fabricated evidence',()=>{
 const messages=[make('Lyra gave away her old key, then stumbled.')],state=S.initialState(definitions);
 const r=parseCommands([
 'UPDATE :: '+key('items')+' :: REMOVE :: key :: turn01 :: gave away her old key',
 'UPDATE :: '+key('health')+' :: DECREASE :: 200 :: turn01 :: stumbled',
 'UPDATE :: '+key('mood')+' :: SET :: angry :: turn01 :: She was stabbed',
 'UPDATE :: '+key('mood')+' :: SET :: angry :: not-real :: stumbled'
 ].join('\n'),definitions,messages,state);
 assert.equal(r.changes.length,2);assert.equal(r.changes[1].value,0);assert.equal(r.issues.length,2);
});
test('wounds retain deterministic identity; same evidence cannot create duplicate wound',()=>{
 const messages=[make('An arrow pierces her left shoulder.')],state=S.initialState(definitions);
 const line='UPDATE :: '+key('injuries')+' :: WOUND :: left shoulder|moderate|arrow impact|6|bleeding|limited arm movement :: turn01 :: An arrow pierces her left shoulder.';
 const r=parseCommands(line+'\n'+line,definitions,messages,state);
 assert.equal(r.changes.length,1);assert.equal(r.changes[0].value[0].location,'left shoulder');
 assert.equal(r.changes[0].value[0].status,'fresh');
 assert.equal(r.changes[0].value[0].pain,6);
 assert.equal(r.issues.length,0);
});
test('tracker event patch remains rollback-safe and respects manual authority',()=>{
 const session={definitions,messageSignatures:[],events:[],revision:0},messages=[make('The arrow hurts and the guard takes the key.')];
 S.reconcile(session,messages);
 const r=S.propose(session,messages,[{key:key('health'),value:65,sourceMessageId:'turn01',evidence:'The arrow hurts',reason:'hurt'}]);
 assert.equal(r[0].status,'confirmed');session.events.push(...r);
 assert.equal(S.stateAt(session,messages)[key('health')],65);
 const altered=[make('The arrow missed.', 'turn01')];S.reconcile(session,altered);
 assert.equal(S.stateAt(session,altered)[key('health')],70);
});
test('chat memory includes canonical character card and no injected thinking prefill',async()=>{
 const root=require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(),'hero-char-'));
 try{
  const m=createMemory({root,countTokens:async s=>s.length,complete:async()=>''});
  const prompt=await m.prepare({prompt:'<|im_start|>system\nStory.<|im_end|>\n<|im_start|>assistant\n',hero_context:{
   id:'test',messages:[{role:'user',name:'Player',text:'Hello'}],character:{
    name:'Lyra',description:'Silver hair, scar over the right eyebrow.',
    personality:'Suspicious, terse and sarcastic.',scenario:'The winter tavern',mes_example:'"Go away," she muttered.'
   }
  }},9000,{memoryEnabled:false,recentMessages:4,memoryTokens:128});
  for(const word of ['Silver hair','right eyebrow','Suspicious','winter tavern','Go away'])assert.ok(prompt.includes(word),word);
  assert.ok(prompt.includes('Player: Hello'));assert.doesNotMatch(prompt,/<think>\s*<\/think>/);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('extension injects character metadata and visible tracker state is refreshed after each turn',()=>{
 const story=fs.readFileSync(path.join(__dirname,'../extension/story.js'),'utf8');
 assert.match(story,/data\.hero_context\.character/);
 assert.match(story,/data\.hero_context\.messages=c\(\)\.chat\.map/);
 assert.match(story,/GENERATION_ENDED/);
 assert.match(story,/\/story\/analyze/);
 assert.doesNotMatch(story,/data\.api_type!=='koboldcpp'/);
 assert.match(story,/Update now/);
});

test('JSON record operations preserve array/boolean types, accept no-op state, and reject unknown fields',()=>{
 const d=S.validateDefinition({...base,id:'contents',label:'Bowl contents',type:'record',initialValue:{waste:['leaves'],overflow:true}}),k=S.keyOf(d),m=make('She empties the bowl. It is no longer overflowing.');
 const packet=value=>JSON.stringify({operations:[{key:k,verb:'SET',value,sourceMessageId:'turn01',evidence:'She empties the bowl.'}]});
 const r=parseCommands(packet({waste:[],overflow:false}),[d],[m],{[k]:d.initialValue});assert.equal(r.issues.length,0);assert.deepEqual(r.changes[0].value,{waste:[],overflow:false});
 const noop=parseCommands(packet(d.initialValue),[d],[m],{[k]:d.initialValue});assert.equal(noop.changes.length,0);assert.ok(noop.recognized);
 assert.ok(parseCommands(packet({waste:[],overflow:false,invented:1}),[d],[m],{[k]:d.initialValue}).issues.length);
 assert.ok(parseCommands(packet({waste:'empty',overflow:false}),[d],[m],{[k]:d.initialValue}).issues.length);
 const empty=parseCommands('{"operations":[]}',[d],[m],{[k]:d.initialValue});assert.equal(empty.issues.length,0);assert.ok(empty.recognized);
 const field=parseCommands(JSON.stringify({operations:[{key:k,verb:'FIELD',value:'waste=[]',sourceMessageId:'turn01',evidence:'She empties the bowl.'}]}),[d],[m],{[k]:d.initialValue});assert.deepEqual(field.changes[0].value,{waste:[],overflow:true});
});
