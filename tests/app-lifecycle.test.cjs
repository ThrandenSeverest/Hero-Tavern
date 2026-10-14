const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {once}=require('node:events');
const {requestExit}=require('../manager/AppLifecycle.cjs');
const {createBridge}=require('../manager/ModelBridge.cjs');
test('app exit requests are per-launch and do not target arbitrary user processes',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-exit-'));
 try{
  for(const candidate of ['',null,'../../bad', 'not-a-guid', 'a'.repeat(34)])assert.throws(()=>requestExit(root,candidate),/launcher is unavailable/);
  const id='e'.repeat(32),result=requestExit(root,id);
  assert.equal(result.requested,true);
  const folder=path.join(root,'Run');
  assert.deepEqual(fs.readdirSync(folder),['exit-'+id+'.request']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(folder,'exit-'+id+'.request'))).kind,'graceful-exit');
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('browser Exit requires authenticated POST and an active managed launcher',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-exit-api-'));
 let server;
 const previous=process.env.HERO_LAUNCHER_TOKEN;
 try{
  for(const name of ['models.json','ModelPanel.html'])fs.copyFileSync(path.join(__dirname,'../manager',name),path.join(root,name));
  process.env.HERO_LAUNCHER_TOKEN='a'.repeat(32);
  server=createBridge(root,{port:0,autoStart:false});
  await once(server,'listening');
  const url='http://127.0.0.1:'+server.address().port;
  const page=await(await fetch(url+'/')).text(),token=/const token='([a-f0-9]+)'/.exec(page)?.[1];
  assert.ok(token);
  const body=JSON.stringify({confirm:true});
  const headers={'X-Hero-Token':token,'Content-Type':'application/json',Origin:url};
  const send=(h,b=body)=>fetch(url+'/app/exit',{method:'POST',headers:h,body:b});
  assert.equal((await send({...headers,'X-Hero-Token':'invalid'})).status,403);
  assert.equal((await send({...headers,Origin:'https://example.com'})).status,403);
  assert.equal((await send(headers,JSON.stringify({confirm:false}))).status,400);
  assert.equal((await send(headers)).status,202);
  assert.ok(fs.existsSync(path.join(root,'Run','exit-'+'a'.repeat(32)+'.request')));
 }finally{
  if(server)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections()});
  if(previous===undefined)delete process.env.HERO_LAUNCHER_TOKEN;else process.env.HERO_LAUNCHER_TOKEN=previous;
  fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
});
test('app shell and installer contain a verified shutdown path',()=>{
 const root=path.join(__dirname,'..');
 const shell=fs.readFileSync(path.join(root,'extension','index.js'),'utf8');
 const manager=fs.readFileSync(path.join(root,'manager','ModelPanel.html'),'utf8');
 const launcher=fs.readFileSync(path.join(root,'manager','StartHeroTavern.ps1'),'utf8');
 assert.match(shell,/hero-exit-app/);
 assert.match(shell,/bridgeRequest\('\/app\/exit'/);
 assert.match(manager,/hero-manager-exit/);
 assert.match(launcher,/WaitForExit\(42000\)/);
 assert.match(launcher,/Test-ManagedProcess/);
 assert.match(launcher,/StartTime\.ToUniversalTime/);
 assert.match(launcher,/Get-NetTCPConnection/);
 assert.match(launcher,/shutdownRequest/);
 assert.match(launcher,/ReleaseMutex/);
 assert.doesNotMatch(launcher,/Read-Host 'Press Enter here to stop Hero Tavern'/);
});
