const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {isWriterNonProse}=require('../manager/ReplyPipeline.cjs');
const {writerEvent}=require('../manager/WriterAPI.cjs');
const S=require('../manager/StoryState.cjs');
test('Writer rejects acknowledgement and review instead of saving them as prose',()=>{
 for(const s of ['OKAY NOW I UNDERSTAND WHAT AM I SUPPOSED TO DO','Okay now I understand! I will write the scene.','Sure, here is your novel continuation.','I understand the task. Let me begin.','Here is my revised story:','Review: The story could use...'])assert.ok(isWriterNonProse(s),'should reject '+s);
 assert.equal(isWriterNonProse('The rain struck the worn windows as she opened the door.'),'');
 assert.equal(isWriterNonProse('“I understand,” she said, drawing her blade.'),'');
});
test('Writer Say materializes exact dialogue; Do materializes actual action',()=>{
 assert.equal(writerEvent('say','Where is Savos?','Mira'),'Mira says, “Where is Savos?”');
 assert.equal(writerEvent('do','I open the door'),'You open the door.');
 assert.equal(writerEvent('do','open the door'),'You open the door.');
 assert.equal(writerEvent('do','I am running'),'You are running.');
 assert.throws(()=>writerEvent('say',''));
});
test('custom measurements are not timers, 24h story clock has strict validation',()=>{
 const def=S.validateDefinition({id:'weight',owner:'character:test',type:'number',label:'Body weight',initialValue:61.5,min:0,max:300,maxDelta:3,unit:'kg'});
 assert.equal(def.unit,'kg');assert.equal(S.validateValue(def,62),62);
 const clock=S.validateDefinition({id:'current_time',owner:'character:test',type:'clock',initialValue:'--:--',unit:'HH:mm'});
 for(const s of ['00:00','13:25','23:59','--:--'])assert.equal(S.validateValue(clock,s),s);
 for(const s of ['24:00','3:20','13:60','days',10])assert.throws(()=>S.validateValue(clock,s));
 assert.ok(S.TEMPLATE_DATA.find(x=>x[0]==='Location & Time')[1].some(d=>d.type==='clock'));
});
test('managed Qwen loader uses compatible fork and checks Qwen-Image 2.1 architecture',()=>{
 const c=fs.readFileSync(path.join(__dirname,'../manager/ImageModelCenter.cjs'),'utf8');
 assert.ok(c.includes('leejet/ComfyUI-GGUF'));assert.ok(c.includes('qwen_image21'));assert.ok(c.includes('backup'));
});
