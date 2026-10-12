// Browser test against upstream SillyTavern and a real child-process Kobold API fixture.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {spawn}=require('node:child_process'),{once}=require('node:events');
const {chromium}=require('../.ci/browser/node_modules/playwright');
const {configure}=require('../manager/ConfigureTavern.cjs');
const {createBridge}=require('../manager/ModelBridge.cjs');
const repo=path.resolve(__dirname,'..'),st=path.join(repo,'.ci/SillyTavern'),root=path.join(repo,'.ci/Hero Tavern UI');
async function waitFor(check,ms=120000){const end=Date.now()+ms;while(Date.now()<end){try{if(await check())return}catch{}await new Promise(r=>setTimeout(r,250))}throw Error('Timed out waiting for UI/engine')}
(async()=>{
 fs.mkdirSync(root,{recursive:true});fs.mkdirSync(path.join(root,'Models'),{recursive:true});
 for(const file of ['models.json','ModelPanel.html'])fs.copyFileSync(path.join(repo,'manager',file),path.join(root,file));
 const ext=path.join(st,'public/scripts/extensions/hero-tavern');fs.mkdirSync(ext,{recursive:true});
 fs.copyFileSync(path.join(repo,'manager/ReplyFilters.cjs'),path.join(ext,'reply-filters.js'));
 for(const file of ['index.js','manifest.json'])fs.copyFileSync(path.join(repo,'extension',file),path.join(ext,file));
 configure(st);
 // Reproduce the user's existing wrong connection profile; repair must happen in the UI.
 const settingsPath=path.join(st,'data/default-user/settings.json');const settings=JSON.parse(fs.readFileSync(settingsPath));
 settings.firstRun=false;settings.main_api='kobold';settings.api_server='http://127.0.0.1:5000/api';fs.writeFileSync(settingsPath,JSON.stringify(settings));
 const log=fs.openSync(path.join(repo,'.ci/sillytavern-smoke.log'),'w');
 const tavern=spawn(process.execPath,['server.js','--port','8000','--listen','false','--browserLaunchEnabled','false'],{cwd:st,stdio:['ignore',log,log]});fs.closeSync(log);
 const bridge=createBridge(root,{backendCommand:process.execPath,backendPrefix:[path.join(repo,'tests/fixtures/fake-kobold.cjs')],pollInterval:100});
 let browser;
 try{
  await waitFor(async()=>(await fetch('http://127.0.0.1:8000/')).ok);
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8000/');await page.locator('#hero-shell').waitFor({timeout:120000});
  await page.locator('#hero-welcome').waitFor({state:'visible'});
  await waitFor(async()=>await page.evaluate(()=>{const title=document.querySelector('.hero-welcome-title');const r=title.getBoundingClientRect();return !!document.elementFromPoint(r.left+20,r.top+20)?.closest('#hero-welcome')}));
  await page.screenshot({path:path.join(repo,'.ci/hero-home-qa.png')});
  await page.locator('.hero-nav[data-hero="models"]').click();const panel=page.frameLocator('#hero-model-frame');
  await panel.getByRole('button',{name:'Download Qwen default'}).waitFor();
  await waitFor(async()=>(await panel.locator('#state').textContent()).includes('No model selected'));
  const model=path.join(root,'Models','model with spaces.gguf'),bytes=Buffer.alloc(1024*1024);bytes.write('GGUF');bytes.writeUInt32LE(3,4);fs.writeFileSync(model,bytes);
  await waitFor(async()=>await panel.locator('#installed option').count()===1);await panel.locator('#select').click();
  await waitFor(async()=>await page.evaluate(async()=>{const {getContext}=await import('/scripts/extensions.js');return getContext().onlineStatus==='fixture-kobold-model'}));
  const connected=await page.evaluate(()=>({api:document.querySelector('#main_api').value,type:document.querySelector('#textgen_type').value,url:document.querySelector('#koboldcpp_api_url_text').value}));
  if(connected.api!=='textgenerationwebui'||connected.type!=='koboldcpp'||new URL(connected.url).origin!=='http://127.0.0.1:8001'||new URL(connected.url).pathname.replace(/\/$/,'')!=='/inference')throw Error('Incorrect auto connection: '+JSON.stringify(connected));
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
  await page.locator('.hero-nav[data-hero="models"]').click();
  await panel.locator('#stop').click();await waitFor(async()=>(await panel.locator('#state').textContent()).includes('AI stopped.'));
  if((await panel.locator('#error').textContent()).trim())throw Error('Stopping AI must not display an engine error.');
  await page.mouse.move(1400,950);
  await page.screenshot({path:path.join(repo,'.ci/hero-models-qa.png')});
  await page.locator('.hero-nav[data-hero="chat"]').click();await page.screenshot({path:path.join(repo,'.ci/hero-chat-qa.png')});
  if(errors.some(e=>/Hero Tavern|hero-|ModelBridge/.test(e)))throw Error(errors.join('\n'));
  console.log('PASS: real SillyTavern UI opens without a model, integrates model controls, starts engine fixture, repairs old API settings, filters streamed reasoning, uses separate planning and docks character panels without clipping dialogue.');
 }finally{
  await browser?.close();await new Promise(r=>{bridge.close(r);bridge.closeAllConnections()});
  if(process.platform==='win32'){const kill=spawn('taskkill.exe',['/PID',String(tavern.pid),'/T','/F']);await once(kill,'exit')}else tavern.kill();
 }
})().catch(e=>{console.error(e);process.exitCode=1});
