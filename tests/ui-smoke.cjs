// Browser test against upstream SillyTavern and a real child-process Kobold API fixture.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {spawn}=require('node:child_process'),{once}=require('node:events');
const {chromium}=require('../.ci/browser/node_modules/playwright');
const {configure}=require('../manager/ConfigureTavern.cjs');
const {createBridge}=require('../manager/ModelBridge.cjs');
const repo=path.resolve(__dirname,'..'),st=path.join(repo,'.ci/SillyTavern'),root=path.join(repo,'.ci/Hero Tavern UI '+Date.now());
let debugPage=null,debugErrors=[];
async function waitFor(check,ms=120000){const end=Date.now()+ms;while(Date.now()<end){try{if(await check())return}catch{}await new Promise(r=>setTimeout(r,250))}let detail='';try{const html=await(await fetch('http://127.0.0.1:8001/')).text(),token=/const token='([^']+)'/.exec(html)?.[1];detail=JSON.stringify(await(await fetch('http://127.0.0.1:8001/status',{headers:{'X-Hero-Token':token}})).json())}catch{}
if(debugPage){try{const browser=await debugPage.evaluate(async()=>{const {getContext}=await import('/scripts/extensions.js');const c=getContext();return {onlineStatus:c.onlineStatus,engineChip:document.querySelector('#hero-engine-chip')?.textContent,api:document.querySelector('#main_api')?.value,type:document.querySelector('#textgen_type')?.value,url:document.querySelector('#koboldcpp_api_url_text')?.value,frameLoaded:document.querySelector('#hero-model-frame')?.contentWindow!==null};});detail='Browser: '+JSON.stringify(browser)+'; JS errors: '+JSON.stringify(debugErrors.slice(-15))+'; Bridge: '+detail;}catch(e){detail+='; Browser diagnostic failed: '+e.message}}throw Error('Timed out waiting for UI/engine: '+detail)}
(async()=>{
 // This is the disposable cloned UI fixture, never a user's installed profile.
 fs.rmSync(path.join(st,'data'),{recursive:true,force:true});
 fs.mkdirSync(root,{recursive:true});fs.mkdirSync(path.join(root,'Models'),{recursive:true});
 for(const file of ['models.json','ModelPanel.html','Adventure.html','AdventureAdapter.js','spells.json','StoryPanel.js', 'CreatorPanel.js', 'VoicePanel.js', 'SharedTools.js', 'ModelTestsPanel.js', 'CapabilityAuditUI.js', 'AssistantPanel.js', 'ImageModelCenterUI.js', 'LoRALibraryUI.js', 'Writer.html'])fs.copyFileSync(path.join(repo,'manager',file),path.join(root,file));
 const ext=path.join(st,'public/scripts/extensions/hero-tavern');fs.mkdirSync(ext,{recursive:true});
 fs.copyFileSync(path.join(repo,'manager/ReplyFilters.cjs'),path.join(ext,'reply-filters.js'));
 for(const file of ['index.js','manifest.json','story.js','images.js'])fs.copyFileSync(path.join(repo,'extension',file),path.join(ext,file));
 configure(st);
 // Reproduce the user's existing wrong connection profile; repair must happen in the UI.
 const settingsPath=path.join(st,'data/default-user/settings.json');const settings=JSON.parse(fs.readFileSync(settingsPath));
 settings.firstRun=false;settings.main_api='kobold';settings.api_server='http://127.0.0.1:5000/api';fs.writeFileSync(settingsPath,JSON.stringify(settings));
 const log=fs.openSync(path.join(repo,'.ci/sillytavern-smoke.log'),'w');
 const tavern=spawn(process.execPath,['server.js','--port','8000','--listen','false','--browserLaunchEnabled','false'],{cwd:st,stdio:['ignore',log,log]});fs.closeSync(log);
 const bridge=createBridge(root,{backendCommand:process.execPath,backendPrefix:[path.join(repo,'tests/fixtures/fake-kobold.cjs')],pollInterval:100,tavernPath:st,thinkingCommand:process.execPath,thinkingPrefix:[path.join(repo,'tests/fixtures/fake-kobold.cjs')],imageCommand:process.execPath,imagePrefix:[path.join(repo,'tests/fixtures/fake-kobold.cjs')]});
 let browser;
 try{
  await waitFor(async()=>(await fetch('http://127.0.0.1:8000/')).ok);
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];debugPage=page;debugErrors=errors;page.on('pageerror',e=>errors.push(e.message));page.on('response',async r=>{if(r.status()>=400&&r.url().includes('127.0.0.1:8001'))console.log('Bridge request failed:',r.url(),r.status(),await r.text().catch(()=>''));});page.on('console',m=>{if(m.type()==='error')console.log('Browser error:',m.text())});
  await page.goto('http://127.0.0.1:8000/');await page.locator('#hero-shell').waitFor({timeout:120000});
  await page.locator('#hero-welcome').waitFor({state:'visible'});
  await waitFor(async()=>await page.evaluate(()=>{const title=document.querySelector('.hero-welcome-title');const r=title.getBoundingClientRect();return !!document.elementFromPoint(r.left+20,r.top+20)?.closest('#hero-welcome')}));
  await page.screenshot({path:path.join(repo,'.ci/hero-home-qa.png')});await page.locator('#hero-welcome-close').click();await page.waitForTimeout(1200);if(!await page.locator('#hero-welcome').isHidden())throw Error('Dismissed welcome returned over controls');
  // User appearance settings and native recent-chat navigation are accessible from the Hero sidebar.
  await page.locator('.hero-nav[data-hero="appearance"]').click();
  await page.locator('#hero-appearance').waitFor({state:'visible'});
  await page.locator('#hero-font-size').evaluate(el=>{el.value='21';el.dispatchEvent(new Event('input',{bubbles:true}))});
  await page.locator('#hero-panel-opacity').evaluate(el=>{el.value='100';el.dispatchEvent(new Event('input',{bubbles:true}))});
  const appearance=await page.evaluate(()=>({
   font:document.documentElement.style.getPropertyValue('--hero-content-font'),
   opacity:document.documentElement.style.getPropertyValue('--hero-pane-opacity'),
   stored:JSON.parse(localStorage.getItem('hero.tavern.appearance.v2'))
  }));
  if(appearance.font!=='21px'||appearance.opacity!=='1'||appearance.stored.font!==21)throw Error('Appearance settings did not persist: '+JSON.stringify(appearance));
  await page.locator('#hero-appearance-reset').click();
  await page.locator('.hero-nav[data-hero="recent-chats"]').click();
  await page.locator('#hero-recent').waitFor({state:'visible'});
  await waitFor(async()=>(await page.locator('#hero-recent-status').textContent()).includes('saved chats'));
  await page.locator('.hero-nav[data-hero="chat"]').click();
  await page.locator('.hero-nav[data-hero="models"]').click();const panel=page.frameLocator('#hero-model-frame');
  await panel.getByRole('button',{name:'Download Qwen default'}).waitFor();
  await panel.locator('#models-open-tts').click();
  await panel.locator('#tts-download').waitFor({state:'visible'});
  if(!await panel.locator('#tts-model-downloads').count())throw Error('TTS download status missing.');
  // Real bridge + model-specific controls: presets never require a reference WAV.
  await panel.locator('#tts-engine').selectOption('qwen');
  await panel.locator('#tts-variant').selectOption('custom-0.6');
  if(await panel.locator('#tts-ref-text').isVisible()||await panel.locator('#tts-style').isVisible())throw Error('Preset 0.6B exposes unsupported clone/style controls');
  await panel.locator('#tts-variant').selectOption('design-1.7');
  if(!await panel.locator('#tts-style').isVisible()||await panel.locator('#tts-speaker').isVisible())throw Error('VoiceDesign has wrong controls');
  await panel.locator('#tts-style').fill('A warm adult storyteller voice');
  await panel.locator('#tts-profile-name').fill('QA designed voice');
  await panel.locator('#tts-profile-save').click();
  await waitFor(async()=>(await panel.locator('#tts-profile-list option').allTextContents()).some(t=>t.includes('QA designed voice')));
  // Central capability checker must run in the real manager iframe, not just unit tests.
  await panel.locator('[data-tab="model-center"]').click();
  await panel.locator('#hero-capability-check').click();
  await waitFor(async()=>{const text=await panel.locator('#hero-capability-results').innerText();return text.includes('Character Chat')&&text.includes('Adventure')&&text.includes('Voice');},30000);
  await panel.locator('[data-tab="models"]').click();
  await page.locator('.hero-nav[data-hero="models"]').click();

  await waitFor(async()=>(await panel.locator('#state').textContent()).includes('No model selected'));
  const model=path.join(root,'Models','model with spaces.gguf'),bytes=Buffer.alloc(1024*1024);bytes.write('GGUF');bytes.writeUInt32LE(3,4);fs.writeFileSync(model,bytes);
  await waitFor(async()=>await panel.locator('#installed option').count()===1);await panel.locator('#select').click();
  await waitFor(async()=>await page.evaluate(async()=>{const {getContext}=await import('/scripts/extensions.js');return getContext().onlineStatus==='fixture-kobold-model'}));
  const connected=await page.evaluate(()=>({api:document.querySelector('#main_api').value,type:document.querySelector('#textgen_type').value,url:document.querySelector('#koboldcpp_api_url_text').value}));
  if(connected.api!=='textgenerationwebui'||connected.type!=='koboldcpp'||new URL(connected.url).origin!=='http://127.0.0.1:8001'||new URL(connected.url).pathname.replace(/\/$/,'')!=='/inference')throw Error('Incorrect auto connection: '+JSON.stringify(connected));
  // Writer is a dedicated top-level manuscript workspace using the existing engine.
  await page.locator('.hero-nav[data-hero="writer"]').click();
  const writer=page.frameLocator('#hero-writer-frame');
  await writer.locator('#writer-view-mode').click();
  await writer.locator('#manuscript').waitFor();
  await writer.locator('#manuscript').fill('Лира ждала у двери таверны.');
  await writer.locator('#memory').fill('Лира ранена в левое плечо.');
  // Scene planning edits the outline, not the user's prose; active beat remains author-controlled.
  await writer.locator('#writer-scene-pace').selectOption('fast');
  await writer.locator('#plan-beats').click();
  await waitFor(async()=>(await writer.locator('#beats-editor').inputValue()).includes('guard refuses Mira'),60000);
  if((await writer.locator('#manuscript').inputValue())!=='Лира ждала у двери таверны.')throw Error('AI beat planning overwrote manuscript prose');
  await writer.locator('#beat-next').click();
  if(!(await writer.locator('#beat-status').textContent()).includes('Active 2/4'))throw Error('Writer beat cursor did not advance');
  await writer.locator('#beat-prev').click();
  await writer.locator('#save').click();
  await waitFor(async()=>(await writer.locator('#status').textContent()).startsWith('Saved ·'));
  await writer.locator('#continue').click();
  await waitFor(async()=>(await writer.locator('#manuscript').inputValue()).includes('Fixture generation works.'),60000);
  if(await writer.locator('#candidate').count()||await writer.locator('#accept').count()||await writer.locator('#reject').count())throw Error('Obsolete Writer Accept/Reject candidate UI remains');
  const initialPassage=await writer.locator('#manuscript').inputValue();
  if(!initialPassage.startsWith('Лира ждала у двери таверны.'))throw Error('Writer lost original manuscript during generation');
  await writer.locator('#retry').click();
  await waitFor(async()=>(await writer.locator('#status').textContent()).includes('Regenerated'),60000);
  const regenerated=await writer.locator('#manuscript').inputValue();
  if(regenerated!==initialPassage||regenerated.split('Fixture generation works.').length!==2)throw Error('Regenerate duplicated the original generation or lost its anchor');
  await writer.locator('#writer-view-mode').click();
  await waitFor(async()=>await writer.locator('.writer-passage.generated').count()>=1);
  if(!await writer.locator('.writer-passage.generated button').filter({hasText:'Regenerate this'}).count())throw Error('Writer generation cards have no independent regenerate action');
  const passageLayout=await writer.locator('#writer-segments').evaluate(el=>{
    const box=el.getBoundingClientRect(),card=el.querySelector('.writer-passage'),inside=card?.querySelector('textarea'),c=card?.getBoundingClientRect(),editor=el.parentElement.getBoundingClientRect();
    return {width:box.width,editor:editor.width,card:c?.width,visibleHeight:inside?.clientHeight,scrollHeight:inside?.scrollHeight};
  });
  if(passageLayout.width<Math.min(passageLayout.editor-50,600)||passageLayout.card<passageLayout.width-70)throw Error('Writer cards collapsed into narrow columns: '+JSON.stringify(passageLayout));
  if(passageLayout.visibleHeight<130||passageLayout.scrollHeight>passageLayout.visibleHeight+5)throw Error('Writer text area is vertically clipped: '+JSON.stringify(passageLayout));

  // Re-render after a long manuscript edit and ensure card scroll position survives.
  await writer.locator('#writer-view-mode').click();
  await writer.locator('#manuscript').fill(Array.from({length:65},(_,i)=>'Chapter passage '+i+': The characters remember where they stood while the rain fell across the village.').join('\n\n'));
  await writer.locator('#recap').fill('Previous chapters: Lyra reached the village after the bridge collapsed.');
  await writer.locator('#save').click();
  await waitFor(async()=>(await writer.locator('#status').textContent()).startsWith('Saved'));
  await writer.locator('#writer-view-mode').click();
  const scrollTest=await writer.locator('#writer-segments').evaluate(async el=>{
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   const range=el.scrollHeight-el.clientHeight;
   el.scrollTop=Math.max(0,Math.floor(range*.5));
   const before=el.scrollTop,view=el.ownerDocument.defaultView;
   view.renderPassages();
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   return {before,after:el.scrollTop,max:range};
  });
  if(scrollTest.max<100||Math.abs(scrollTest.after-scrollTest.before)>35)throw Error('Writer passages jumped after rerender: '+JSON.stringify(scrollTest));
  const writerRecap=await writer.locator('#recap').inputValue();
  if(!writerRecap.includes('bridge collapsed'))throw Error('Writer continuity recap was not persisted in the editor');

  if(!await writer.locator('#history button').count())throw Error('Writer failed to preserve revision history');
  await writer.locator('#fork').click();await waitFor(async()=>(await writer.locator('#title').inputValue()).includes('branch'));
  await page.screenshot({path:path.join(repo,'.ci/hero-writer-qa.png')});
  await page.locator('.hero-nav[data-hero="generation"]').click();
  await panel.locator('#thinkingMode').selectOption('separate');await panel.locator('#replyStyle').selectOption('dialogue');
  await panel.locator('#instructions').fill('Keep answers concise.');await panel.locator('#save-generation').click();
  await waitFor(()=>JSON.parse(fs.readFileSync(path.join(root,'generation.json'),'utf8')).thinkingMode==='separate');
  await panel.locator('#filter-sample').evaluate(el=>{el.closest('details').open=true});
  await panel.locator('#filter-sample').fill('<think>PRIVATE_PREVIEW</think>Hello, friend.');await panel.locator('#preview-filters').click();
  await waitFor(async()=>(await panel.locator('#filter-result').textContent())==='Hello, friend.');
  const generated=await page.evaluate(async()=>{const {getRequestHeaders}=await import('/script.js');const r=await fetch('/api/backends/text-completions/generate',{method:'POST',headers:getRequestHeaders(),body:JSON.stringify({api_server:'http://127.0.0.1:8001/inference',api_type:'koboldcpp',prompt:'hello',max_tokens:8,stream:false})});if(!r.ok)throw Error('Generation route failed');return r.json()});
  if(!JSON.stringify(generated).includes('Fixture generation works.'))throw Error('Generation did not reach the engine');
  if(/PRIVATE|<think>/.test(JSON.stringify(generated)))throw Error('Private planning/reasoning leaked into final reply');
  const engineStats=await(await fetch('http://127.0.0.1:5001/api/extra/teststats')).json();
  if(engineStats.planning<1||engineStats.completions<2)throw Error('Separate planning did not use an extra engine generation');
  const streamed=await page.evaluate(async()=>{const {getRequestHeaders}=await import('/script.js');const r=await fetch('/api/backends/text-completions/generate',{method:'POST',headers:getRequestHeaders(),body:JSON.stringify({api_server:'http://127.0.0.1:8001/inference',api_type:'koboldcpp',prompt:'hello',max_tokens:8,stream:true})});if(!r.ok)throw Error('Streaming route failed');return r.text()});
  if(!streamed.includes('Fixture generation works.')||/PRIVATE|<think>|<thi/.test(streamed))throw Error('Streamed reasoning reached the chat client');
  await page.screenshot({path:path.join(repo,'.ci/hero-generation-qa.png')});
  await page.locator('.hero-nav[data-hero="characters"]').click();await page.locator('#right-nav-panel').waitFor({state:'visible'});
  await waitFor(async()=>await page.evaluate(()=>{const panel=document.querySelector('#right-nav-panel').getBoundingClientRect(),toolbar=document.querySelector('#top-settings-holder').getBoundingClientRect(),chat=document.querySelector('#sheld').getBoundingClientRect();return panel.top>=toolbar.bottom-1&&chat.right<=panel.left+1}));
  await page.evaluate(async()=>{const {getContext}=await import('/scripts/extensions.js');const c=getContext();if(c.characters.length)await c.selectCharacterById('0')});
  await waitFor(async()=>await page.locator('#hero-welcome').isHidden());
  const clip=await page.evaluate(()=>[...document.querySelectorAll('#chat .mes_text')].some(el=>el.scrollWidth>el.clientWidth+2));if(clip)throw Error('Character drawer clips dialogue');
  await page.screenshot({path:path.join(repo,'.ci/hero-characters-qa.png')});
  // Real character screen must expose voice creation and model-specific controls.
  await page.locator('#hero-character-voice').click();
  await page.locator('#hero-character-voice-engine').waitFor({state:'visible'});
  await page.locator('#hero-character-voice-engine').selectOption('qwen:custom-0.6');
  if(!await page.locator('#hero-character-voice-speaker').isVisible())throw Error('Qwen CustomVoice speaker controls are missing');
  await page.locator('#hero-character-voice-quick').click();
  await waitFor(async()=>(await page.locator('#hero-character-dialogue-voice option').count())>1);
  await page.getByRole('button',{name:'Save character voice'}).click();
  await waitFor(async()=>(await page.locator('.hero-story-dialog [role="status"]').textContent()).includes('Saved on character card.'));
  await page.getByRole('button',{name:'Cancel',exact:true}).last().click();

  // Generate through the actual chat event path, not only a manual API request.
  await page.locator('#hero-character-leading-prompt').click();
  await page.locator('#hero-leading-prompt-field').fill('Scene theme: slow-burning mystery; remain terse and suspicious.');
  await page.locator('#hero-leading-prompt-save').click();
  await waitFor(async()=>await page.evaluate(async()=>{const {getContext}=await import('/scripts/extensions.js');const c=getContext();return c.characters[c.characterId]?.data?.extensions?.hero_tavern?.leadingPrompt?.includes('slow-burning mystery')}));
  await page.locator('.hero-story-dialog').waitFor({state:'hidden'});
  await page.locator('.hero-nav[data-hero="chat"]').click();
  await page.evaluate(async()=>{const {getContext}=await import('/scripts/extensions.js');const c=getContext();for(const message of [{name:c.name1,is_user:true,is_system:false,mes:'HISTORY_MARKER: we promised a blue cloak.',send_date:new Date().toISOString()},{name:c.name2,is_user:false,is_system:false,mes:'I will keep that promise.',send_date:new Date().toISOString()},{name:c.name1,is_user:true,is_system:false,mes:'What did we promise?',send_date:new Date().toISOString()}]){c.chat.push(message);c.addOneMessage(message)}await c.generate('normal',{automatic_trigger:true});});
  const historyStats=await(await fetch('http://127.0.0.1:5001/api/extra/teststats')).json();if(!historyStats.lastPrompt.includes('HISTORY_MARKER')||!historyStats.lastPrompt.includes('What did we promise?'))throw Error('Actual chat generation lost previous turns');if(!historyStats.lastPrompt.includes('slow-burning mystery'))throw Error('Character leading prompt absent from generation');
  // P0/P1 controls operate on the actual native chat and sidecar state.
  await page.locator('.hero-nav[data-hero="trackers"]').click();const modelFrame=page.frames().find(f=>new URL(f.url()).port==='8001'&&new URL(f.url()).pathname==='/');
  await waitFor(async()=>await modelFrame.evaluate(()=>!!window.HeroStoryPanel?.view));
  await panel.locator('#tracker-presets label').filter({hasText:'Health & Injuries'}).locator('input').check();
  await waitFor(async()=>await modelFrame.evaluate(()=>HeroStoryPanel.view.session.definitions.some(d=>d.type==='number'&&d.id==='health')&&HeroStoryPanel.view.session.definitions.some(d=>d.type==='injuries')));
  const originalId=await page.evaluate(()=>HeroStory.view.session.id);
  const stateProof=await page.evaluate(async()=>{let v=await HeroStory.sync();const wound=v.session.definitions.find(d=>d.type==='injuries'),key=wound.owner+':'+wound.id;v=await HeroStory.run('patch',{patch:[{key,value:[{id:'shoulder-arrow',location:'left shoulder',cause:'arrow',severity:'moderate',status:'fresh',pain:6,symptoms:'pain',limitations:'limited arm movement',treatment:'none',scar:''}],sourceMessageId:v.messages.at(-1).extra.heroMessageId}]});const damaged=v.context.state[key];const branch=await HeroStory.run('fork',{mode:'branch',atIndex:0});const before=branch.context.state[key];await HeroStory.run('open',{id:v.session.id});const fresh=await HeroStory.run('fork',{mode:'fresh'});const reset=fresh.context.state[key];await HeroStory.run('open',{id:v.session.id});return {damaged,before,reset};});
  if(stateProof.damaged?.[0]?.status!=='fresh'||stateProof.reset?.length!==0||stateProof.before?.length)throw Error('Native branch/fresh tracker isolation failed: '+JSON.stringify(stateProof));
  await page.locator('.hero-nav[data-hero="trackers"]').click();await panel.locator('#tracker-values article').first().locator('summary').click();await panel.locator('#tracker-values article').first().locator('textarea').last().fill('Protect the established injury.');await page.evaluate(()=>HeroStory.sync());if(await panel.locator('#tracker-values article').first().locator('textarea').last().inputValue()!=='Protect the established injury.')throw Error('Background sync destroyed a behavior draft');await panel.getByRole('button',{name:'Save behavior'}).first().click();await waitFor(async()=>await modelFrame.evaluate(()=>HeroStoryPanel.view.session.definitions[0].version===2));await panel.locator('#tracker-ai-brief').fill('A courage tracker.');await panel.locator('#tracker-helper').click();await panel.getByRole('button',{name:'Review in editor'}).click();await panel.locator('#tracker-add').click();await waitFor(async()=>await modelFrame.evaluate(()=>HeroStoryPanel.view.session.definitions.some(d=>d.id==='courage')));await modelFrame.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(repo,'.ci/hero-trackers-qa.png')});
  await page.locator('.hero-nav[data-hero="lore"]').click();await panel.locator('#lore-ai-brief').fill('A hidden tavern vault.');await panel.locator('#lore-helper').click();await panel.getByRole('button',{name:'Review in editor'}).click();await panel.locator('#lore-save').click();await waitFor(async()=>await modelFrame.evaluate(()=>HeroStoryPanel.view.session.lore.some(e=>e.id==='vault')));
  await panel.locator('#lore-native-name').fill('Hero QA lore');await panel.locator('#lore-native-save').click();
  const worldPath=path.join(st,'data/default-user/worlds/Hero QA lore.json');
  await waitFor(async()=>{const status=await panel.locator('#lore-native-status').textContent().catch(()=>null);return fs.existsSync(worldPath)||status?.startsWith('Save failed:')||status?.startsWith('Saved ')},28000);
  if(!fs.existsSync(worldPath))throw Error('Native lore save failed: '+(await panel.locator('#lore-native-status').textContent())+'; error='+await panel.locator('#story-error').textContent()+'; worlds='+JSON.stringify(fs.readdirSync(path.dirname(worldPath))));await panel.locator('#lore-test').fill('vault');await panel.locator('#lore-preview').click();await modelFrame.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(repo,'.ci/hero-lore-qa.png')});
  await page.locator('.hero-nav[data-hero="chat"]').click();
  await page.evaluate(async()=>{const {getContext}=await import('/scripts/extensions.js');const c=getContext();const message={name:c.name1,is_user:true,is_system:false,mes:'Continue our conversation and remember my injured shoulder.',send_date:new Date().toISOString()};c.chat.push(message);c.addOneMessage(message);await HeroStory.sync();await c.generate('normal',{automatic_trigger:true});});
  await page.locator('#chat .hero-speak-message').last().click();
  await waitFor(async()=>(await page.locator('#chat .hero-voice-output').last().textContent()).includes('Voice failed:'));
  await page.locator('#hero-session-toolbar [data-story="inspector"]').click();await panel.locator('#inspector-refresh').click();await waitFor(async()=>(await panel.locator('#inspector-prompt').textContent()).includes('Confirmed story state'));if((await panel.locator('#inspector-prompt').textContent()).includes('OUTLINE_PRIVATE'))throw Error('Inspector leaked private plan');await page.screenshot({path:path.join(repo,'.ci/hero-inspector-qa.png')});
  await page.locator('.hero-nav[data-hero="generation"]').click();await panel.locator('#thinking-state').evaluate(el=>el.closest('details').open=true);await panel.locator('#thinking-save').click();await panel.locator('#thinking-start').click();await waitFor(async()=>(await panel.locator('#thinking-state').textContent())==='Planning model ready');await panel.locator('#planningSource').selectOption('different');await panel.locator('#save-generation').click();await waitFor(()=>JSON.parse(fs.readFileSync(path.join(root,'generation.json'),'utf8')).planningSource==='different');
  const twoModels=await page.evaluate(async()=>{const {getRequestHeaders}=await import('/script.js');return (await fetch('/api/backends/text-completions/generate',{method:'POST',headers:getRequestHeaders(),body:JSON.stringify({api_server:'http://127.0.0.1:8001/inference',api_type:'koboldcpp',prompt:'Continue the scene.',max_tokens:8,stream:false})})).json()});if(/PRIVATE/.test(JSON.stringify(twoModels)))throw Error('Two-model planning leaked');const plannerStats=await(await fetch('http://127.0.0.1:5003/api/extra/teststats')).json();if(plannerStats.planning<1)throw Error('Second planning child did not generate');await panel.locator('#planningSource').selectOption('same');await panel.locator('#save-generation').click();await panel.locator('#thinking-stop').click();
  await page.locator('.hero-nav[data-hero="memory"]').click();await waitFor(async()=>(await panel.locator('#memory-chat').textContent()).includes('·'));await panel.locator('#memory-notes').fill('The promised cloak is blue.');await panel.locator('#save-memory').click();await panel.locator('#refresh-memory').click();await waitFor(async()=>(await panel.locator('#memory-notes').inputValue())==='The promised cloak is blue.');await page.screenshot({path:path.join(repo,'.ci/hero-memory-qa.png')});
  await page.locator('.hero-nav[data-hero="creator"]').click();await panel.locator('#creator-level').selectOption('advanced');await panel.locator('#character-json').fill(JSON.stringify({name:'Hero QA Character',description:'A thoughtful guide.',personality:'Patient and curious.',scenario:'At a quiet tavern.',first_mes:'Welcome, traveller.',mes_example:'<START>\nHero QA Character: Tell me your story.'}));await panel.locator('#import-character').click();await waitFor(async()=>await page.evaluate(async()=>{const {getContext}=await import('/scripts/extensions.js');return getContext().characters.some(c=>c.name==='Hero QA Character')}));
  await page.locator('.hero-nav[data-hero="creator"]').click();await panel.locator('#creator-level').selectOption('simple');await panel.locator('#creator-name').fill('Hero Simple QA');await panel.locator('#creator-description').fill('An innkeeper with a careful memory.');await panel.locator('#creator-personality').fill('Thoughtful.');await panel.locator('#creator-scenario').fill('A rainy tavern.');await panel.locator('#creator-leading-prompt').fill('Never forget the sealed letters.');await panel.locator('#creator-first_mes').fill('Come inside.');await panel.locator('#episode-save').evaluate(el=>el.closest('details').open=true);await panel.locator('#episode-title').fill('Storm');await panel.locator('#episode-greeting').fill('The storm has closed the road.');await panel.locator('#episode-save').click();await panel.locator('#import-character').click();await waitFor(async()=>await page.evaluate(async()=>{const {getContext}=await import('/scripts/extensions.js');const card=getContext().characters.find(c=>c.name==='Hero Simple QA');return card?.data?.extensions?.hero_tavern?.episodes?.some(e=>e.title==='Storm')&&card?.data?.extensions?.hero_tavern?.leadingPrompt==='Never forget the sealed letters.'}));await page.screenshot({path:path.join(repo,'.ci/hero-creator-qa.png')});
  const imageDir=path.join(root,'ImageModels');fs.mkdirSync(imageDir,{recursive:true});const checkpoint=Buffer.alloc(1024*1024),head=Buffer.from(JSON.stringify({tensor:{dtype:'F32',shape:[1],data_offsets:[0,4]}}));checkpoint.writeBigUInt64LE(BigInt(head.length));head.copy(checkpoint,8);fs.writeFileSync(path.join(imageDir,'QA portrait.safetensors'),checkpoint);
  await page.locator('.hero-nav[data-hero="images"]').click();
  await panel.locator('[data-tab="image-setup"]').click();
  await waitFor(async()=>await panel.locator('#image-installed option').count()===1);
  await panel.locator('#image-select').click();await panel.locator('#image-start').click();
  await waitFor(async()=>(await panel.locator('#image-state').textContent())==='Image engine ready');
  await panel.locator('[data-tab="images"]').click();
  const options=await panel.locator('#image-create-model option').evaluateAll(nodes=>nodes.map(x=>x.value));
  if(!['flux-klein','z-turbo','sdxl','koboldcpp','custom'].every(id=>options.includes(id)))throw Error('Image Studio unified model selector is incomplete');
  await panel.locator('#image-create-model').selectOption('flux-klein');
  await panel.locator('#image-model-center').waitFor({state:'attached'});
  if(!await panel.locator('#hero-lora-quick').isVisible()||!await panel.locator('#image-create-guide').isVisible())throw Error('Guided model status and one-click LoRA shelf must be visible during generation');
  if(!await panel.locator('#image-center-global').count())throw Error('Unified Image Model Center did not initialize');
  if(!await panel.locator('#image-center-chat').count()||!await panel.locator('#image-center-adventure').count())throw Error('Chat/Adventure image model selectors missing');
  await panel.locator('[data-tab="image-setup"]').click();
  if(!await panel.locator('#image-center-global').isVisible())throw Error('Unified model controls must be visible in Models & Setup');
  if(!await panel.locator('#image-center-install').isVisible()||!await panel.locator('#image-center-start').isVisible())throw Error('ComfyUI setup controls must be visible without opening Advanced settings');
  if(!await panel.locator('#hero-lora-library').isVisible())throw Error('LoRA Library must be visible in Models & Setup');
  await panel.locator('[data-tab="images"]').click();
  
  if(!await panel.locator('#image-generate').isEnabled())throw Error('FLUX Generate must not depend on legacy KoboldCpp ImageModels checkpoint');
  if(!await panel.locator('#image-installed').isHidden())throw Error('Legacy checkpoint picker belongs only in Models & Setup');
  await panel.locator('#image-create-model').selectOption('koboldcpp');
  await panel.locator('#image-prompt').fill('A quiet fantasy tavern.');
  if(!await panel.locator('#image-generate').isEnabled())throw Error('Generate is disabled despite a working legacy image engine.');
  await panel.locator('#image-generate').click();await panel.locator('#image-result').waitFor({state:'visible'});await page.screenshot({path:path.join(repo,'.ci/hero-images-qa.png')});
  await page.locator('.hero-nav[data-hero="diagnostics"]').click();
  // Diagnostics must expose the full multimodal flow, not just old result cards.
  await panel.locator('#diagnostic-open-flow').click();
  await panel.locator('#model-test-run-diagnostic-flow').waitFor({state:'visible'});
  if(await panel.locator('#model-test-flow-stages li').count()!==7)throw Error('Full diagnostics flow did not render all seven stages');
  await page.screenshot({path:path.join(repo,'.ci/hero-diagnostic-flow-qa.png')});
  await page.locator('.hero-nav[data-hero="diagnostics"]').click();
  await panel.locator('#diagnostic-history').fill('20');await panel.locator('#diagnostic-text').click();await waitFor(async()=>(await panel.locator('#diagnostic-text-result').textContent()).includes('"ok": true'));await panel.locator('#diagnostic-image').click();await waitFor(async()=>(await panel.locator('#diagnostic-image-result').textContent()).includes('"ok": true'));await panel.locator('#diagnostic-image-preview').waitFor({state:'visible'});await page.screenshot({path:path.join(repo,'.ci/hero-diagnostics-qa.png')});await page.locator('.hero-nav[data-hero="images"]').click();await panel.locator('#image-to-chat').click();await waitFor(async()=>await page.locator('#hero-workspace').isHidden());await waitFor(async()=>await page.evaluate(()=>[...document.querySelectorAll('#chat .mes_text img')].some(img=>new URL(img.src).origin===location.origin&&img.complete&&img.naturalWidth>0)));
  // Direct chat image tool uses optional refinement, persists provenance and resumes the text engine.
  await page.locator('#hero-chat-image').click();const imageDialog=page.locator('.hero-story-dialog');await imageDialog.locator('textarea').fill('A portrait of the innkeeper beside a window.');await imageDialog.locator('input[type="checkbox"]').check();
  await imageDialog.locator('select').first().selectOption('koboldcpp');
  // Check the same trusted iframe bridge used by the real Tavern image dialog;
  // otherwise a silently dropped model-selection message waits ten minutes.
  const shared=await Promise.race([
    page.evaluate(async()=>window.HeroImages&&typeof window.HeroImages.dialog==='function'),
    new Promise(resolve=>setTimeout(()=>resolve(false),4000))
  ]);
  if(!shared)throw Error('Tavern image tool failed to initialize');await imageDialog.getByRole('button',{name:'Generate and add to chat'}).click();await imageDialog.waitFor({state:'hidden',timeout:65000}).catch(async err=>{const output=await imageDialog.locator('pre').first().textContent().catch(()=>'(no visible error)');throw Error('Chat image generation did not finish. Dialog output: '+output+'; underlying wait: '+err.message.slice(0,300))});
  await waitFor(async()=>await page.evaluate(async()=>{const {getContext}=await import('/scripts/extensions.js');return getContext().chat.at(-1).extra?.hero_image?.originalPrompt==='A portrait of the innkeeper beside a window.'&&getContext().chat.at(-1).extra.hero_image.refinedPrompt.length>0}));
  const nativeProvider=await page.evaluate(async()=>{const {extension_settings}=await import('/scripts/extensions.js');return extension_settings.sd;});if(nativeProvider.source!=='auto'||nativeProvider.auto_url!=='http://127.0.0.1:8001')throw Error('Native chat image menu still uses an unavailable external provider');
  const nativeImage=await page.evaluate(async()=>{const {getRequestHeaders}=await import('/script.js');const r=await fetch('/api/sd/generate',{method:'POST',headers:getRequestHeaders(),body:JSON.stringify({url:'http://127.0.0.1:8001',prompt:'A painted fantasy tavern.',negative_prompt:'blurry',width:512,height:512,steps:20,cfg_scale:6,sampler_name:'DPM++ 2M Karras'})});return {status:r.status,value:await r.json()};});if(nativeImage.status!==200||!nativeImage.value.images?.[0])throw Error('Native SillyTavern chat image API failed: '+JSON.stringify(nativeImage));
  await page.screenshot({path:path.join(repo,'.ci/hero-chat-images-qa.png')});
  // The supplied director includes substantial game rules; load its documented context budget.
  await page.locator('.hero-nav[data-hero="models"]').click();await panel.locator('#stop').click();await waitFor(async()=>(await panel.locator('#state').textContent()).includes('AI stopped.'));
  await page.locator('.hero-nav[data-hero="hardware"]').click();await panel.locator('#contextSize').fill('16384');await panel.locator('#save-hardware').click();await waitFor(()=>JSON.parse(fs.readFileSync(path.join(root,'backend.json'),'utf8')).contextSize===16384);
  await page.locator('.hero-nav[data-hero="models"]').click();await panel.locator('#start').click();await waitFor(async()=>await page.evaluate(async()=>{const {getContext}=await import('/scripts/extensions.js');return getContext().onlineStatus==='fixture-kobold-model'}));
  await page.locator('.hero-nav[data-hero="adventure"]').click();const adventure=page.frameLocator('#hero-adventure-frame');await waitFor(async()=>(await adventure.locator('#pluginWarn').textContent()).includes('Hero Tavern'));
  const advFrame=page.frames().find(f=>f.url().endsWith('/adventure'));
  await advFrame.evaluate(async()=>{await newGameFromSetup();});
  await adventure.locator('#app').waitFor({state:'visible'});const adventureState=await advFrame.evaluate(async()=>{G.settings.npcInitiative=false;const before=G.world.turn;await resolvePlayerAction('Приветствую трактирщика.');await generateNpcPortrait('tavern_keeper');await saveGame(true);const loaded=await loadGame();return {player:loaded.player.name,spells:ILR140_CATALOG_STATUS.count,portrait:G.npcs.tavern_keeper.portrait,log:G.log.length,dm:G.world.dmPlans?.at(-1)?.plan,scene:G.log.filter(e=>e.type==='narration'||e.type==='dialogue').map(e=>e.text).join(' ')}});if(!adventureState.player||adventureState.spells!==514||!adventureState.portrait.startsWith('http://127.0.0.1:8001/images/output/')||!adventureState.log||adventureState.dm!=='PRIVATE_ADVENTURE_DM_FIXTURE'||!adventureState.scene.includes('Добро пожаловать')||adventureState.scene.includes('PRIVATE_ADVENTURE_DM_FIXTURE'))throw Error('Adventure rules/local portrait/save integration failed: '+JSON.stringify(adventureState));await page.screenshot({path:path.join(repo,'.ci/hero-adventure-qa.png')});
  await page.locator('.hero-nav[data-hero="images"]').click();await panel.locator('[data-tab="image-setup"]').click();if(await panel.locator('#image-stop').isEnabled())await panel.locator('#image-stop').click();await waitFor(async()=>(await panel.locator('#image-state').textContent())==='Image engine stopped');

  await page.locator('.hero-nav[data-hero="adventure"]').click();
  const initialHp=await advFrame.evaluate(()=>G.player.hp);if(initialHp<=0)throw Error('New Adventure must start with positive HP');
  await advFrame.evaluate(()=>openNpcProfile('tavern_keeper'));await adventure.locator('#npcProfile button').filter({hasText:'Сгенерировать портрет'}).waitFor({state:'visible'});await adventure.locator('#npcProfile button').filter({hasText:'Добавить в группу'}).waitFor({state:'visible'});await advFrame.evaluate(()=>closeNpcProfile());
  const custom=await advFrame.evaluate(()=>{HERO_applyCustomStart({prompt:'Investigate a missing caravan.',locationName:'Border village',locationDescription:'A quiet stone bridge.',memberIds:['tavern_keeper'],leaderId:'tavern_keeper',inventoryText:'Рацион ×3',replaceInventory:true});return {name:G.world.locations[G.world.currentLocationId].name,leader:G.party.leader.npcId,items:G.player.inventory,hp:G.player.hp};});if(custom.name!=='Border village'||custom.leader!=='tavern_keeper'||custom.items[0].qty!==3||custom.hp<=0)throw Error('Custom Adventure setup failed: '+JSON.stringify(custom));
  await page.locator('.hero-nav[data-hero="comfy-workflows"]').click();await panel.locator('#comfy-workflows').waitFor({state:'visible'});await panel.locator('#hero-api-workflow-file').waitFor({state:'visible'});
  await page.locator('.hero-nav[data-hero="writer"]').click();await writer.locator('#title').waitFor({state:'visible'});await writer.locator('#memory').fill('Established fact. '.repeat(1000));await writer.locator('[data-context-tab="persona"]').click();await writer.locator('#persona-name').fill('Mira');await writer.locator('#persona-description').fill('A traveller.');await writer.locator('#save').click();await waitFor(async()=>(await writer.locator('#status').textContent()).startsWith('Saved'));await writer.locator('#new').click();await waitFor(async()=>(await writer.locator('#memory').inputValue())==='');if((await writer.locator('#error').textContent()).trim())throw Error('Writer new story failed after editing memory/persona');
  await writer.locator('#import').setInputFiles({name:'sample.txt',mimeType:'text/plain',buffer:Buffer.from('Mira approached the gate.')});await waitFor(async()=>(await writer.locator('#manuscript').inputValue())==='Mira approached the gate.');const download=page.waitForEvent('download');await writer.locator('summary').filter({hasText:'Import / Export'}).click();await writer.locator('#export').click();const exported=await download;if(!exported.suggestedFilename().endsWith('.json'))throw Error('Writer export did not create JSON');
  // The drawer uses globally unique IDs even inside its shadow DOM.
  // Playwright pierces open shadow DOM, so assert the namespaced selector contract here.
  // Shared tools run inside Writer and insert reviewed output without submitting a story turn.
  const sharedTools=writer.locator('#hero-shared-tools');
  await writer.locator('#manuscript').focus();
  await writer.locator('#manuscript').evaluate(el=>el.setSelectionRange(0,el.value.length));
  await sharedTools.locator('#hero-tools-launch').click();
  await sharedTools.locator('#hero-tools-prompt').fill('Describe a quiet tavern.');
  await sharedTools.locator('#hero-tools-text').click();
  await waitFor(async()=>(await sharedTools.locator('#hero-tools-status').textContent())==='Done.');
  if(!(await sharedTools.locator('#hero-tools-output').textContent()).trim())throw Error('Shared text tool returned no result');
  await sharedTools.locator('#hero-tools-insert').click();
  if(!(await writer.locator('#manuscript').inputValue()).trim())throw Error('Shared result did not insert');
  await sharedTools.locator('[data-panel="images"]').click();
  const nested=sharedTools.frameLocator('#hero-tools-workspace');await nested.locator('#images').waitFor({state:'visible'});
  if(await nested.locator('#hero-shared-tools').count())throw Error('Shared workspace must not recursively mount another drawer');
  await sharedTools.locator('#hero-tools-close').click();
  await page.locator('.hero-nav[data-hero="models"]').click();
  await panel.locator('#stop').click();await waitFor(async()=>(await panel.locator('#state').textContent()).includes('AI stopped.'));
  if((await panel.locator('#error').textContent()).trim())throw Error('Stopping AI must not display an engine error.');
  await page.mouse.move(1400,950);
  await page.screenshot({path:path.join(repo,'.ci/hero-models-qa.png')});
  await page.locator('.hero-nav[data-hero="chat"]').click();await page.screenshot({path:path.join(repo,'.ci/hero-chat-qa.png')});
  if(await page.locator('#hero-exit-app').count()!==1)throw Error('Safe Exit app action is missing from the app sidebar');
  if(errors.some(e=>/Hero Tavern|hero-|ModelBridge/.test(e)))throw Error(errors.join('\n'));
  console.log('PASS: real SillyTavern UI opens without a model, integrates model controls, starts engine fixture, repairs old API settings, filters streamed reasoning, uses separate planning and docks character panels without clipping dialogue.');
 }finally{
  await browser?.close();await new Promise(r=>{bridge.close(r);bridge.closeAllConnections()});
  if(process.platform==='win32'){const kill=spawn('taskkill.exe',['/PID',String(tavern.pid),'/T','/F']);await once(kill,'exit')}else tavern.kill();
 }
})().catch(e=>{console.error(e);process.exitCode=1});
