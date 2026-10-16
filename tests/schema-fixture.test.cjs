const {test}=require('node:test'),assert=require('node:assert/strict');
const W=require('../manager/WTracker.cjs'),value=require('./fixtures/schema-value.cjs');
test('Browser backend fixture returns valid complete tracker data without state examples',()=>{
 const fields=[['clock','--:--'],['text','Unknown'],['number',0],['injuries',[]],['quest',{stage:'Unknown',status:'inactive'}]].map(([type,initialValue],i)=>W.validateDefinition({id:'test'+i,owner:'character:mira',type,initialValue}));
 const q=W.buildRequest(fields,W.initialState(fields),[{name:'Mira',mes:'Waits.'}]);
 const snapshot=value(q.json_schema);
 assert.equal(snapshot.field_0,'--:--');assert.equal(W.readSnapshot(JSON.stringify(snapshot),fields).length,fields.length);
});
