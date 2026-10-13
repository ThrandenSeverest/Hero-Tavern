const {test}=require('node:test'),assert=require('node:assert/strict'),S=require('../manager/StoryState.cjs');
const injury={id:'shoulder-cut',location:'left shoulder',cause:'arrow',severity:'moderate',status:'fresh',pain:6,symptoms:'bleeding',limitations:'limited arm movement',treatment:'none',scar:''};
function fixture(){const d=S.validateDefinition({...S.TEMPLATE_DATA[0][1].find(d=>d.type==='injuries'),owner:'character:lyra'});return {definitions:[d],events:[],lore:[]}}
const message=(id,text)=>({mes:text,extra:{heroMessageId:id}});
test('Independent wounds update live, treatment preserves symptoms, scars and history survive rollback',()=>{
 const s=fixture(),key=S.keyOf(s.definitions[0]),messages=[message('1','An arrow cuts my left shoulder.'),message('2','The shoulder is bandaged but still hurts.'),message('3','After weeks the wound heals, leaving a thin scar.')];
 s.events.push(...S.propose(s,messages.slice(0,1),[{key,value:[injury],sourceMessageId:'1',evidence:'An arrow cuts my left shoulder.'}]));assert.equal(s.events[0].status,'confirmed');
 const treated={...injury,status:'treated',treatment:'bandage',symptoms:'pain',pain:5};s.events.push(...S.propose(s,messages.slice(0,2),[{key,value:[treated],sourceMessageId:'2',evidence:'The shoulder is bandaged but still hurts.'}]));
 const scarred={...treated,status:'scarred',pain:0,symptoms:'none',limitations:'none',scar:'thin scar'};s.events.push(...S.propose(s,messages,[{key,value:[scarred],sourceMessageId:'3',evidence:'After weeks the wound heals, leaving a thin scar.'}]));
 assert.equal(S.stateAt(s,messages)[key][0].scar,'thin scar');assert.equal(S.stateAt(s,messages,1)[key][0].status,'treated');assert.deepEqual(S.stateAt(s,messages, -1)[key],[]);
 assert.throws(()=>S.propose(s,messages,[{key,value:[],sourceMessageId:'3',evidence:'After weeks'}]),/Keep injury history/);
 assert.throws(()=>S.propose(s,messages,[{key,value:[{...scarred,scar:''}],sourceMessageId:'3',evidence:'After weeks'}]),/Preserve established scars/);
 assert.match(S.activeContext(s,messages).text,/thin scar/);
});
test('Injury schema rejects duplicate IDs, invalid pain, swapped origins and ungrounded changes',()=>{
 const s=fixture(),key=S.keyOf(s.definitions[0]),messages=[message('1','A wound appeared.')];
 assert.throws(()=>S.validateInjuries([injury,injury]),/unique/);assert.throws(()=>S.validateInjuries([{...injury,pain:11}]),/pain/);
 assert.throws(()=>S.propose(s,messages,[{key,value:[injury],sourceMessageId:'1',evidence:'invented'}]),/evidence/);
 assert.throws(()=>S.validateInjuryChange([injury],[{...injury,location:'right ankle'}]),/stable/);
 assert.equal(S.TEMPLATE_DATA[0][1].some(d=>d.id==='wound'),false);
});
