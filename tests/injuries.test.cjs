const {test}=require('node:test'),assert=require('node:assert/strict'),W=require('../manager/WTracker.cjs');
test('WTracker injury snapshots preserve details through story points and rollback',()=>{
 const d=W.validateDefinition({...W.TEMPLATE_DATA.find(t=>t[0]==='Health & Injuries')[1].find(d=>d.type==='injuries'),owner:'character:lyra'}),key=W.keyOf(d),session={definitions:[d],events:[],lore:[]};
 const messages=[{mes:'The arrow cuts her shoulder.',extra:{heroMessageId:'1'}},{mes:'A healer bandages it.',extra:{heroMessageId:'2'}}],wound={location:'left shoulder',condition:'fresh cut',treatment:'none',history:'arrow wound'};
 session.events.push(...W.propose(session,messages.slice(0,1),[{key,value:[wound],sourceMessageId:'1'}]));
 session.events.push(...W.propose(session,messages,[{key,value:[{...wound,condition:'treated, still painful',treatment:'bandage'}],sourceMessageId:'2'}]));
 assert.equal(W.stateAt(session,messages)[key][0].treatment,'bandage');assert.equal(W.stateAt(session,messages,0)[key][0].treatment,'none');assert.deepEqual(W.stateAt(session,messages,-1)[key],[]);assert.match(W.activeContext(session,messages).text,/still painful/);
 assert.throws(()=>W.validateValue(d,[{location:'arm'}]),/missing/);
});
