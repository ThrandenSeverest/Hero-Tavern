'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('SillyTavern prompt hook injects canonical context synchronously',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../extension/story.js'),'utf8');
 const begin=source.indexOf('c().eventSource.on(c().eventTypes.GENERATE_AFTER_DATA,');
 const end=source.indexOf('let generating=false',begin);
 assert.ok(begin>=0&&end>begin,'Generation prompt integration missing');
 const hook=source.slice(begin,end);
 assert.match(hook,/GENERATE_AFTER_DATA,\(data,dryRun\)=>/);
 assert.doesNotMatch(hook,/GENERATE_AFTER_DATA,async\s*\(/);
 assert.doesNotMatch(hook,/await\s+(?:sync|rpc|current\.saveChat)\s*\(/);
 assert.match(hook,/data\.hero_context=/);
 assert.match(hook,/sessionId/);
 assert.match(hook,/data\.hero_context=\{[\s\S]*\bmessages\b/);
 assert.match(hook,/data\.hero_context\.character/);
 assert.match(hook,/leadingPrompt/);
});
