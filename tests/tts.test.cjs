const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createTTS,splitSpeech}=require('../manager/TTSService.cjs');
test('narration and quoted speech remain separate',()=>{const out=splitSpeech('*She smiles.* "Hello there!" *She waves.*',{speaker:'Mira'});assert.deepEqual(out.map(x=>x.kind),['narration','dialogue','narration']);assert.equal(out[1].speaker,'Mira');});
test('no visible model thinking reaches the synthesizer',()=>{const out=splitSpeech('<think>secret decisions</think> "Welcome"');assert.equal(JSON.stringify(out).includes('secret'),false);});
test('local profiles validate voice settings and input paths',()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-tts-'));try{const svc=createTTS(root);assert.equal(svc.status().settings.engine,'flash');assert.throws(()=>svc.configure({engine:'external'}));assert.equal(svc.configure({engine:'qwen',variant:'custom-1.7'}).settings.engine,'qwen');assert.throws(()=>svc.removeVoice({name:'../outside.wav'}));assert.equal(svc.readAudio('/tts/audio/../../bad.wav'),null);svc.stop();}finally{fs.rmSync(root,{recursive:true,force:true})}});

const vm=require('node:vm'),{EventEmitter}=require('node:events');
function fakeWindowsTTS(root,brokenAt=''){
 const original=fs.readFileSync(path.join(__dirname,'../manager/TTSService.cjs'),'utf8');
 const commands=[];let failAt=brokenAt;
 function fakeSpawn(command,args){
  commands.push({command,args});
  const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.pid=1024;child.kill=()=>{};
  setImmediate(()=>{
   const label=command==='powershell.exe'?'bootstrap':args[0]==='pip'?'packages':'download';
   if(label==='bootstrap'){
    const python=path.join(root,'TTSRuntime','qwen','Scripts','python.exe');
    fs.mkdirSync(path.dirname(python),{recursive:true});fs.writeFileSync(python,'fake python'); // valid existing venv but deliberately NO pip
    fs.writeFileSync(path.join(root,'TTSRuntime','uv.exe'),'fake uv');
   }
   if(failAt===label){child.stderr.emit('data',Buffer.from('Simulated '+label+' failure: no access to package server\n'));child.emit('close',1);return;}
   child.stdout.emit('data',Buffer.from(label+' succeeded\n'));
   if(label==='download'){
    const dir=path.join(root,'TTSModels','qwen','custom-0.6');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'.hero-downloaded'),'{}');
   }
   child.emit('close',0);
  });
  return child;
 }
 const mod={exports:{}};
 vm.runInNewContext(original,{module:mod,exports:mod.exports,require:name=>name==='node:child_process'?{spawn:fakeSpawn}:require(name),process:{...process,platform:'win32'},Buffer,setTimeout,clearTimeout,console},{filename:'TTSService.cjs'});
 return {service:mod.exports.createTTS(root),commands,setFail:v=>{failAt=v}};
}
async function waitForStatus(svc,predicate){
 for(let n=0;n<130;n++){const s=svc.status();if(predicate(s))return s;await new Promise(resolve=>setTimeout(resolve,10));}
 throw Error('Timed out waiting for mocked TTS completion: '+JSON.stringify(svc.status()));
}
test('one-click Qwen TTS setup succeeds even when its existing Python 3.11 venv has no pip module',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-tts-no-pip-'));try{
  const h=fakeWindowsTTS(root);
  const wav=path.join(root,'Voices','custom-voice.wav');fs.writeFileSync(wav,'saved user recording');
  h.service.configure({engine:'qwen',variant:'custom-0.6'});
  h.service.setup();
  const status=await waitForStatus(h.service,s=>s.ready&&s.weightsReady&&!s.installing&&!s.downloading);
  assert.equal(status.phase,'ready');
  const uv=h.commands.find(x=>x.args[0]==='pip');
  assert.ok(uv,'uv pip installation must run without python -m pip');
  assert.ok(uv.command.endsWith('uv.exe'));
  assert.ok(uv.args.includes('--python'));
  assert.ok(uv.args.includes('qwen-tts'));
  assert.equal(h.commands.some(x=>x.args[0]==='-m'&&x.args[1]==='pip'),false);
  assert.ok(h.commands.some(x=>x.args.some(v=>String(v).includes('TTSModelDownload.py'))));
  assert.equal(fs.readFileSync(wav,'utf8'),'saved user recording');
  h.service.stop();
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('failed voice package install is visible and retry resumes without deleting voices',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-tts-retry-'));try{
  const h=fakeWindowsTTS(root,'packages');h.service.configure({engine:'qwen',variant:'custom-0.6'});
  const wav=path.join(root,'Voices','custom-voice.wav');fs.writeFileSync(wav,'saved user recording');
  h.service.setup();
  const failed=await waitForStatus(h.service,s=>s.installStage==='failed'&&!s.installing);
  assert.match(failed.error,/packages failed/);
  assert.equal(failed.ready,false);
  assert.equal(failed.weightsReady,false);
  assert.match(failed.installOutput,/Simulated packages failure/);
  assert.equal(fs.readFileSync(wav,'utf8'),'saved user recording');
  h.setFail('');h.service.setup();
  const completed=await waitForStatus(h.service,s=>s.ready&&s.weightsReady&&!s.installing&&!s.downloading);
  assert.equal(completed.error,'');h.service.stop();
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('voice UI keeps one-click stages and backend owns dependency-to-weight transition',()=>{
 const ui=fs.readFileSync(path.join(__dirname,'../manager/VoicePanel.js'),'utf8');
 const panel=fs.readFileSync(path.join(__dirname,'../manager/ModelPanel.html'),'utf8');
 const bridge=fs.readFileSync(path.join(__dirname,'../manager/ModelBridge.cjs'),'utf8');
 assert.match(ui,/tts-setup/);assert.match(ui,/tts-install-stage|tts-install-phase/);
 assert.match(ui,/downloadedBytes/);assert.match(ui,/tts-install-log/);
 for(const id of ['tts-setup','tts-cancel-install','tts-install-progress','tts-install-phase','tts-install-summary','tts-setup-help','tts-install-log'])assert.ok(panel.includes('id="'+id+'"'));
 assert.match(bridge,/case '\/tts\/setup':result=tts\.setup\(\)/);assert.match(bridge,/case '\/tts\/install-cancel':result=tts\.cancelInstall\(\)/);
});
