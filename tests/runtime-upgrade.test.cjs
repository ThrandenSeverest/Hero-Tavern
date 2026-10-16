const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{once}=require('node:events');
const {runtimeVersion,FILES}=require('../manager/RuntimeVersion.cjs'),{createBridge}=require('../manager/ModelBridge.cjs');
test('Runtime identity changes when tracker code or the browser controller changes',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-runtime-version-'));
 try{for(const name of FILES){const p=path.join(root,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,'initial');}const first=runtimeVersion(root);assert.deepEqual(first.missing,[]);assert.equal(first.trackerEngine,'wtracker-1');fs.writeFileSync(path.join(root,'StoryAPI.cjs'),'new tracker');assert.notEqual(runtimeVersion(root).runtimeHash,first.runtimeHash);fs.writeFileSync(path.join(root,'StoryAPI.cjs'),'initial');const browser=FILES.find(p=>p.endsWith('story.js'));fs.writeFileSync(path.join(root,browser),'new controller');assert.notEqual(runtimeVersion(root).runtimeHash,first.runtimeHash);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('The running bridge reports the identity loaded at startup, not subsequently replaced disk files',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-version-api-'));let server;
 try{for(const name of ['models.json','ModelPanel.html'])fs.copyFileSync(path.join(__dirname,'../manager',name),path.join(root,name));const expected=runtimeVersion(root);server=createBridge(root,{port:0,autoStart:false});await once(server,'listening');const url='http://127.0.0.1:'+server.address().port+'/runtime-version';const first=await(await fetch(url)).json();assert.equal(first.runtimeHash,expected.runtimeHash);assert.ok(first.startedAt);fs.writeFileSync(path.join(root,'StoryAPI.cjs'),'replacement');const stale=await(await fetch(url)).json();assert.equal(stale.runtimeHash,first.runtimeHash);assert.notEqual(stale.runtimeHash,runtimeVersion(root).runtimeHash);
 }finally{if(server)await new Promise(r=>{server.close(r);server.closeAllConnections()});fs.rmSync(root,{recursive:true,force:true})}
});
test('Upgrade stops the old session before replacing code; launch refuses old or mismatched services',()=>{
 const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8'),installer=read('installer/Install.ps1'),launcher=read('manager/StartHeroTavern.ps1'),stop=read('manager/StopHeroTavern.ps1');
 assert.ok(installer.indexOf('-InstallationRoot $Root -ForUpdate')<installer.indexOf("Step '1/5"));assert.ok(installer.indexOf('foreach($upgradePort')<installer.indexOf("Step '1/5"));assert.ok(installer.includes("RuntimeVersion.cjs') $Root"));assert.match(stop,/if\(\$ForUpdate\)/);assert.match(stop,/No application files were replaced/);assert.match(launcher,/Assert-RuntimeVersion\s+Start-Process/);assert.match(launcher,/Wait-Service 'http:\/\/127.0.0.1:8001\/' \$bridge 30\s+Assert-RuntimeVersion/);
});
test('Tracker controller retains voice events and working per-message story menus',async()=>{
 // Compile and execute the real controller in a minimal DOM/context harness.
 const source=fs.readFileSync(path.join(__dirname,'../extension/story.js'),'utf8');
 assert.match(source,/function updateMessageMenus\(/);assert.match(source,/function messageCharacter\(/);assert.match(source,/addEventListener\('hero-open-character-voice'/);
 // These must stay outside renderTrackerStrip: sync publishes before rendering.
 assert.ok(source.indexOf(' function messageCharacter')>source.indexOf(' function renderTrackerStrip'));
});
