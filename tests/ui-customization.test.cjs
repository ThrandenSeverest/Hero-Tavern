'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const {createMemory}=require('../manager/ContextMemory.cjs');
test('Recent Chats and appearance settings are first-class sidebar destinations with persistence',()=>{
 const src=read('extension/index.js');
 for(const item of ["['recent-chats','Recent Chats']","['appearance','Appearance']","const UI_KEY='hero.tavern.appearance.v2'","show = name","function refreshRecent()","window.HeroStory?.run('list'","window.HeroStory.run('open'","--hero-pane-opacity","--hero-content-font","--hero-background-display"])
  assert.ok(src.includes(item),'missing '+item);
 for(const field of ['hero-font-size','hero-ui-size','hero-panel-opacity','hero-chat-opacity','hero-blur','hero-rail-width','hero-show-background','hero-accent','hero-appearance-reset'])assert.ok(src.includes(field),'missing appearance control '+field);
 assert.match(src,/localStorage\.setItem\(UI_KEY/);
});
test('Leading Prompt is accessible in the character drawer and persists to the card without creating trackers',()=>{
 const ext=read('extension/story.js'),creator=read('manager/CreatorPanel.js'),panel=read('manager/ModelPanel.html');
 for(const marker of ['hero-character-leading-prompt','hero-leading-prompt-field','hero-leading-prompt-save','writeExtensionField','leadingPrompt:String','data.hero_context.character'])
  assert.ok(ext.includes(marker),'character prompt integration missing '+marker);
 assert.ok(ext.includes("leadingPrompt:value.slice(0,4000)"));
 assert.ok(creator.includes("leadingPrompt:$('creator-leading-prompt').value.slice(0,4000)"));
 assert.ok(panel.includes('id="creator-leading-prompt"'));
});
test('Chat memory injects the leading prompt without duplicating canonical character text already in native prompt',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hero-leading-prompt-'));
 try{
  const memory=createMemory({root:dir,countTokens:async x=>x.length,complete:async()=>''});
  const card='Lyra has silver hair, a red coat, and a scar near her eye.';
  const body={prompt:'<|im_start|>system\n'+card+'<|im_end|>\n<|im_start|>assistant\n',hero_context:{
   id:'hero-leading-1',messages:[{role:'user',name:'Player',text:'Where is the letter?'}],
   character:{name:'Lyra',description:card,personality:'Wary and sardonic.',leadingPrompt:'Keep a melancholy noir mystery tone.'}
  }};
  const result=await memory.prepare(body,6000,{memoryEnabled:false,recentMessages:6,memoryTokens:80});
  assert.equal(result.split(card).length-1,1,'character description should not be repeated');
  assert.match(result,/melancholy noir mystery tone/);
  assert.match(result,/Wary and sardonic/);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('Model and Writer frames accept parent UI size updates',()=>{
 for(const p of ['manager/ModelPanel.html','manager/Writer.html']){
  const s=read(p);assert.match(s,/hero-ui-settings/);assert.match(s,/hero-injected-font/);assert.match(s,/e\.origin|event\.origin/);
 }
});

test('Native lorebook save has an explicit API result and does not rely on UI refresh for persistence',()=>{
 const story=read('extension/story.js');
 assert.ok(story.includes("fetchWorld('edit'"));
 assert.ok(story.includes("fetchWorld('get'"));
 assert.ok(story.includes('updateWorldInfoList()'));
 assert.ok(story.includes('AbortController'));
});
