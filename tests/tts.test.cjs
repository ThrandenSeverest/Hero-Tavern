const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createTTS,splitSpeech}=require('../manager/TTSService.cjs');
test('narration and quoted speech remain separate',()=>{const out=splitSpeech('*She smiles.* "Hello there!" *She waves.*',{speaker:'Mira'});assert.deepEqual(out.map(x=>x.kind),['narration','dialogue','narration']);assert.equal(out[1].speaker,'Mira');});
test('no visible model thinking reaches the synthesizer',()=>{const out=splitSpeech('<think>secret decisions</think> "Welcome"');assert.equal(JSON.stringify(out).includes('secret'),false);});
test('local profiles validate voice settings and input paths',()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-tts-'));try{const svc=createTTS(root);assert.equal(svc.status().settings.engine,'qwen');assert.throws(()=>svc.configure({engine:'external'}));assert.equal(svc.configure({engine:'qwen',variant:'custom-1.7'}).settings.engine,'qwen');assert.throws(()=>svc.removeVoice({name:'../outside.wav'}));assert.equal(svc.readAudio('/tts/audio/../../bad.wav'),null);svc.stop();}finally{fs.rmSync(root,{recursive:true,force:true})}});
test('CustomVoice 0.6B preserves the supported style instruction in saved profiles',()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-tts-style-'));try{const svc=createTTS(root);const voice=svc.saveProfile({name:'Gentle',voice:{engine:'qwen',variant:'custom-0.6',speaker:'Ryan',style:'Speak gently'}}).profile.voice;assert.equal(voice.style,'Speak gently');assert.equal(svc.status().capabilities.textStyleInstruction,true);svc.stop();}finally{fs.rmSync(root,{recursive:true,force:true})}});

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

test('speech planner merges identical settings and preserves different narrator boundaries',()=>{
 const {planSpeech}=require('../manager/TTSService.cjs'),v={engine:'qwen',variant:'custom-1.7',speaker:'Ryan'};
 assert.equal(planSpeech('*Waves.* «Hello.» *Smiles.*',v,v).length,1);
 assert.equal(planSpeech('*Waves.* «Hello.» *Smiles.*',v,{...v,speaker:'Vivian'}).length,3);
 const parts=planSpeech('word '.repeat(400),v,v);assert.ok(parts.length>1);assert.ok(parts.every(p=>p.text.length<=600));
 assert.equal(splitSpeech('<think>unfinished private reasoning').length,0);
});
function synthesisHarness(root){
 const commands=[],tasks=[],children=[];let fail=false,crash=false;
 const wav=Buffer.alloc(52);wav.write('RIFF');wav.writeUInt32LE(44,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(8,40);
 function spawn(command){commands.push(command);const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin=new EventEmitter();child.kill=()=>setImmediate(()=>child.emit('exit',0));child.stdin.write=line=>{const task=JSON.parse(line);tasks.push(task);if(crash){setImmediate(()=>{child.emit('exit',3221225477);child.stderr.emit('data',Buffer.from('Windows fatal exception: access violation'));child.emit('close',3221225477,null)});return;}setImmediate(()=>child.stdout.emit('data',Buffer.from(JSON.stringify(fail?{id:task.id,ok:false,error:'fixture failure'}:{id:task.id,ok:true,audio:wav.toString('base64')})+'\n')))};children.push(child);return child;}
 for(const engine of ['qwen','flash']){const dir=path.join(root,'TTSRuntime',engine,process.platform==='win32'?'Scripts':'bin');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,process.platform==='win32'?'python.exe':'python'),'fixture');}
 for(const [engine,variant] of [['flash','flash'],...['custom-0.6','custom-1.7','clone-0.6','clone-1.7','design-1.7'].map(v=>['qwen',v])]){const dir=path.join(root,'TTSModels',engine,variant);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'.hero-downloaded'),'revision1');}
 const mod={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../manager/TTSService.cjs'),'utf8'),{module:mod,require:n=>n==='node:child_process'?{spawn}:require(n),process,Buffer,setTimeout,clearTimeout,console});
 return {service:mod.exports.createTTS(root),commands,tasks,setFail:v=>{fail=v},setCrash:v=>{crash=v}};
}
test('real service routes profiles to exact model paths, combines response audio and preserves global settings',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tts-route-'));const h=synthesisHarness(root),s=h.service;
 try{
  const a=s.saveProfile({name:'Dialogue',voice:{engine:'qwen',variant:'custom-1.7',speaker:'Ryan',style:'Warm'}}).profile;
  const b=s.saveProfile({name:'Narrator',voice:{engine:'qwen',variant:'design-1.7',style:'A calm adult narrator'}}).profile;
  const one=await s.speakMessage({text:'*Waves.* "Welcome."',assignment:{dialogueProfileId:a.id,narratorMode:'same'}});
  assert.equal(h.tasks.length,1);assert.equal(one.segments,1);assert.equal(h.tasks[0].variant,'custom-1.7');assert.equal(h.tasks[0].modelPath,path.join(root,'TTSModels','qwen','custom-1.7'));
  const mixed=await s.speakMessage({text:'*The door opens.* "Come inside."',assignment:{dialogueProfileId:a.id,narratorProfileId:b.id,narratorMode:'separate'}});
  assert.equal(mixed.segments,2);assert.equal(fs.readFileSync(s.readAudio(mixed.url)).readUInt32LE(40),16);
  assert.equal(s.status().settings.engine,'qwen');
  const cached=await s.speakMessage({text:'*Waves.* "Welcome."',assignment:{dialogueProfileId:a.id,narratorMode:'same'}});assert.equal(cached.cached,true);
  assert.equal(createTTS(root).status().profiles.length,2);
  s.deleteProfile({id:a.id});await assert.rejects(s.speakMessage({text:'Test',assignment:{dialogueProfileId:a.id}}),/TTS_CHARACTER_ROUTE_FAILED/);
 }finally{s.stop();fs.rmSync(root,{recursive:true,force:true})}
});
test('model-specific preflight distinguishes preset, design, clone and Flash; failed jobs recover and log',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tts-preflight-')),h=synthesisHarness(root),s=h.service;
 try{
  await assert.rejects(s.speak({text:'Hello',engine:'flash'}),/TTS_REFERENCE_REQUIRED/);
  await assert.rejects(s.speak({text:'Hello',engine:'qwen',variant:'design-1.7',style:''}),/TTS_STYLE_REQUIRED/);
  fs.writeFileSync(path.join(root,'Voices','sample.wav'),'reference');
  await assert.rejects(s.speak({text:'Hello',engine:'qwen',variant:'clone-0.6',reference:'sample.wav',referenceText:''}),/TTS_TRANSCRIPT_REQUIRED/);
  await s.speak({text:'Hello',engine:'qwen',variant:'custom-0.6',reference:'missing.wav',style:'Speak gently'});
  assert.equal(h.tasks.at(-1).style,'Speak gently');assert.equal(h.tasks.at(-1).reference,'');
  h.setFail(true);await assert.rejects(s.speak({text:'Failure',engine:'qwen',variant:'custom-1.7'}),/fixture failure/);assert.equal(s.status().busy,false);
  h.setFail(false);await s.speak({text:'Recovered',engine:'qwen',variant:'custom-1.7'});
  await s.speak({text:'Flash',engine:'flash',reference:'sample.wav'});
  assert.ok(h.commands.some(x=>x.includes(path.join('TTSRuntime','flash'))));
  assert.ok(s.status().jobLog.some(e=>e.event==='failed'));assert.ok(fs.existsSync(path.join(root,'Logs','tts-jobs.jsonl')));
 }finally{s.stop();fs.rmSync(root,{recursive:true,force:true})}
});

test('Kokoro appears inside character Voice engine dropdown with selectable preset speakers and installation',()=>{
 const story=fs.readFileSync(path.join(__dirname,'../extension/story.js'),'utf8');
 const panel=fs.readFileSync(path.join(__dirname,'../manager/ModelPanel.html'),'utf8');
 const worker=fs.readFileSync(path.join(__dirname,'../manager/TTSWorker.py'),'utf8');
 const download=fs.readFileSync(path.join(__dirname,'../manager/TTSModelDownload.py'),'utf8');
 assert.match(story,/kokoro:kokoro','Kokoro 82M/);
 for(const name of ['af_heart','af_bella','am_adam','am_michael','bf_emma','bm_george']) assert.ok(story.includes("'"+name+"'"),name);
 assert.match(story,/updateSpeakerOptions\(\)/);
 assert.match(story,/speaker\.parentElement\.hidden=!\(chosen/);
 assert.match(story,/backend==='kokoro'\?'English'/);
 assert.match(story,/downloadedModels\?\.\[backend==='flash'\?'flash':backend==='kokoro'\?'kokoro':variant\]/);
 assert.match(panel,/<option value="kokoro">Kokoro 82M/);
 assert.match(worker,/if engine == "kokoro"/);
 assert.match(download,/"kokoro": "hexgrad\/Kokoro-82M"/);
});
test('Kokoro voice profiles need no WAV and retain voice per character',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-kokoro-profile-'));
 try{
  const t=createTTS(root),v=t.saveProfile({name:'Mira',voice:{engine:'kokoro',variant:'kokoro',speaker:'af_bella',language:'English',reference:'unused.wav',style:'unnecessary'}}).profile.voice;
  assert.equal(v.speaker,'af_bella');
  assert.equal(v.engine,'kokoro');
  assert.equal(v.variant,'kokoro');
  assert.equal(v.reference,'');
  assert.equal(v.style,'');
  assert.throws(()=>t.configure({engine:'kokoro',variant:'custom-0.6'}),/Invalid speech variant/);
  t.configure({engine:'kokoro',variant:'kokoro',language:'English',speaker:'am_adam'});
  assert.equal(t.status().capabilities.presetSpeakers,true);
  t.stop();
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});

test('Kokoro pins versioned requirements and marks old unverified runtimes as needing repair',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../manager/TTSService.cjs'),'utf8');
 const worker=fs.readFileSync(path.join(__dirname,'../manager/TTSWorker.py'),'utf8');
 for(const token of ['kokoro==0.9.4','transformers==4.49.0','misaki[en]==0.9.4','verify-imports','--check-dependencies','TTS_DEPENDENCIES_OUTDATED'])assert.ok(source.includes(token),token);
 assert.match(worker,/from transformers import AlbertModel, AlbertConfig/);
 assert.match(worker,/from kokoro import KModel, KPipeline/);
 assert.match(worker,/traceback\.format_exc\(\)\[-9000:\]/);
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'kokoro-dep-health-'));
 try{
  const svc=createTTS(root);svc.configure({engine:'kokoro',variant:'kokoro',language:'English'});
  const d=path.join(root,'TTSRuntime','kokoro',process.platform==='win32'?'Scripts':'bin');fs.mkdirSync(d,{recursive:true});
  fs.writeFileSync(path.join(d,process.platform==='win32'?'python.exe':'python'),'fixture');
  fs.writeFileSync(path.join(root,'TTSRuntime','kokoro','.installed'),'old-install');
  assert.equal(svc.status().ready,false);
  fs.writeFileSync(path.join(root,'TTSRuntime','kokoro','.installed'),'kokoro-0.9.4-transformers-4.49.0-cu128-v2\nverified');
  assert.equal(svc.status().ready,true);
  svc.stop();
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});

test('Native speech crash retains late stderr and Windows exit status in the job report',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tts-crash-')),h=synthesisHarness(root);
 try{
  h.setCrash(true);
  await assert.rejects(h.service.speak({text:'Crash diagnostics test.'}),e=>e.code==='TTS_WORKER_EXITED'&&/0xc0000005/.test(e.message)&&/access violation/.test(e.message));
  assert.match(h.service.status().workerLog,/access violation/);
  assert.match(fs.readFileSync(path.join(root,'Logs','tts-jobs.jsonl'),'utf8'),/access violation/);
 }finally{h.service.stop();fs.rmSync(root,{recursive:true,force:true})}
});
