// DOM integration test of the shipped panel against the real StoryAPI/StoryStore.
// This verifies UI behavior, not live LLM semantics or Chromium rendering.
const {JSDOM}=require(process.env.HERO_JSDOM_PATH||'../.ci/browser/node_modules/jsdom');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {createStoryStore}=require('../manager/StoryStore.cjs'),{createStoryAPI}=require('../manager/StoryAPI.cjs');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-wtracker-dom-')),folder=path.join(root,'SillyTavern/data/default-user/chats/Lyra');fs.mkdirSync(folder,{recursive:true});
 const file=path.join(folder,'Scene.jsonl');fs.writeFileSync(file,[{character_name:'Lyra',chat_metadata:{}},{name:'Lyra',is_user:false,mes:'Lyra waits in the tavern.',extra:{}}].map(JSON.stringify).join('\n')+'\n');
 const store=createStoryStore(root);let view=store.sync({avatar:'Lyra.png',filename:'Scene'});const id=view.session.id;
 const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../manager/ModelPanel.html'),'utf8'),{url:'http://127.0.0.1:8001/',runScripts:'outside-only'}),w=dom.window,$=s=>w.document.querySelector(s);w.structuredClone=structuredClone;
 try{
  const api=createStoryAPI(store,{generate:async request=>{if(!request.json_schema)return {choices:[{text:JSON.stringify({trackers:[{id:'courage',type:'number',initialValue:40,min:0,max:100,label:'Courage'}]})}]};const result=Object.fromEntries(Object.entries(request.json_schema.properties).map(([key,s])=>[key,s.title==='Location'?'Tavern':s.type==='array'?[]:s.type==='number'?0:s.type==='object'?{}:s.pattern?'--:--':'Unknown']));return {choices:[{text:JSON.stringify(result)}]};}});
  const render=()=>w.HeroWTrackerRender(store.view(id),send,render),send=async(op,data={})=>{view=await api.action('/story/'+op,{id,...data});render();return view};
  w.eval(fs.readFileSync(path.join(__dirname,'../manager/WTrackerPanel.js'),'utf8'));render();
  const click=async button=>{assert.ok(button,'Button exists');await button.onclick();assert.equal($('#story-error').textContent,'')};
  assert.equal(w.document.querySelectorAll('#wtracker-values article').length,4);
  await click($('#wtracker-update'));assert.equal(store.view(id).context.state['character:'+view.session.characterId+':location'],'Tavern');assert.match($('#wtracker-status').textContent,/Snapshot saved/);
  const field=$('#wtracker-values article');field.querySelector('.wtracker-value-editor textarea').value='<script>changed location</script>';await click([...field.querySelectorAll('button')].find(b=>b.textContent==='Save value'));
  assert.equal(store.view(id).context.state['character:'+view.session.characterId+':location'],'<script>changed location</script>');assert.equal(w.document.querySelectorAll('#wtracker-values script').length,0);
  await click([...w.document.querySelectorAll('#wtracker-presets button')].find(b=>b.textContent==='Add Health & Injuries'));assert.ok(store.get(id).definitions.some(d=>d.type==='injuries'));
  $('#wtracker-id').value='coins';$('#wtracker-label').value='Coins';$('#wtracker-type').value='number';$('#wtracker-initial').value='12';await click($('#wtracker-add'));assert.ok(store.get(id).definitions.some(d=>d.id==='coins'));
  $('#wtracker-brief').value='A courage tracker';await click($('#wtracker-design'));await click($('#wtracker-drafts button'));assert.ok(store.get(id).definitions.some(d=>d.id==='courage'));
  const coins=[...w.document.querySelectorAll('#wtracker-values article')].find(n=>n.querySelector('h3')?.textContent==='Coins');await click([...coins.querySelectorAll('button')].find(b=>b.textContent==='Delete field'));assert.equal(store.get(id).definitions.some(d=>d.id==='coins'),false);
  console.log('WTracker DOM integration passed: update, render, manual correction, safe text, presets, custom fields, AI designer and deletion.');
 }finally{dom.window.close();fs.rmSync(root,{recursive:true,force:true})}
})().catch(error=>{console.error(error);process.exitCode=1});
