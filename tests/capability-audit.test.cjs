'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const S=require('../manager/StoryState.cjs');
const {buildCapabilityReport}=require('../manager/CapabilityAudit.cjs');
const {createStoryAPI}=require('../manager/StoryAPI.cjs');
const {createTTS}=require('../manager/TTSService.cjs');
const base={owner:'character:test',updateMode:'automatic'};
const def=(id,type,initialValue,extra={})=>S.validateDefinition({...base,id,type,initialValue,...extra});
const message=(text,id='m1')=>({mes:text,name:'Character',is_user:false,extra:{heroMessageId:id}});
test('capability report distinguishes downloaded, online and tested independently by mode',()=>{
 const input={
  engine:{selected:'rp.gguf',runningModel:'rp.gguf',installed:['rp.gguf'],backendReady:true,catalog:[{File:'rp.gguf',Recommended:true}]},
  center:{choices:{global:'sdxl',chat:'sdxl',adventure:'flux-klein'},models:[
   {id:'sdxl',installed:true,ready:true,missing:[]},{id:'flux-klein',installed:false,ready:false,missing:['vae/flux2-vae.safetensors']}]},
  vision:{settings:{name:'vision.gguf',mmproj:'mmproj.gguf'},installed:['vision.gguf']},
  tts:{settings:{engine:'qwen',variant:'custom-0.6'},ready:true,weightsReady:true},
  tests:[{kind:'text2text',model:'rp.gguf',status:'passed'}],
  trackerSessions:[]
 };
 const result=buildCapabilityReport(input),byId=id=>result.features.find(x=>x.id===id);
 assert.equal(byId('text').state,'verified');
 assert.equal(byId('image-chat').state,'online');
 assert.equal(byId('image-adventure').state,'missing');
 assert.equal(byId('vision').state,'missing');
 assert.equal(byId('tts').state,'installed');
 assert.equal(byId('trackers').state,'unverified');
 assert.ok(result.modes.chat.features.find(x=>x.id==='tts'));
 assert.ok(result.modes.adventure.features.find(x=>x.id==='image-adventure'));
 assert.ok(result.modes.writer.features.every(x=>x.id==='text'));
});
test('capability report reuses existing GGUF without suggesting another download',()=>{
 const report=buildCapabilityReport({engine:{selected:'',installed:['existing.gguf'],catalog:[{File:'new.gguf',Recommended:true}]}}),model=report.features.find(x=>x.id==='text');
 assert.equal(model.action.kind,'selectText');assert.equal(model.action.name,'existing.gguf');
});
test('unassigned Flash voice routes to installed Qwen CustomVoice rather than requesting a WAV',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-voice-fallback-'));
 try{
  const svc=createTTS(root);
  const p=path.join(root,'TTSModels','qwen','custom-0.6');fs.mkdirSync(p,{recursive:true});fs.writeFileSync(path.join(p,'.hero-downloaded'),'fixture');
  svc.configure({engine:'flash',variant:'flash',dialogueReference:'',narratorReference:''});
  await assert.rejects(svc.speakMessage({text:'Welcome.'}),e=>/TTS_ENGINE_NOT_INSTALLED/.test(e.message)&&!/TTS_REFERENCE_REQUIRED/.test(e.message));
  const preset=svc.saveProfile({name:'Custom',voice:{engine:'qwen',variant:'custom-0.6',speaker:'Ryan'}}).profile;
  assert.equal(preset.voice.variant,'custom-0.6');svc.stop();
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('missing reference routes to no-WAV voice even before weights are installed',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-voice-no-reference-'));
 try{
  const svc=createTTS(root);svc.configure({engine:'qwen',variant:'clone-0.6',dialogueReference:'',narratorReference:''});
  await assert.rejects(svc.speakMessage({text:'Welcome.'}),e=>/TTS_WEIGHTS_MISSING.*custom-0\.6/.test(e.message)&&!/TTS_REFERENCE_REQUIRED/.test(e.message));
  const saved=svc.saveProfile({name:'Old clone',voice:{engine:'qwen',variant:'clone-0.6',reference:''}}).profile;
  await assert.rejects(svc.speakMessage({text:'Welcome.',assignment:{dialogueProfileId:saved.id,narratorMode:'same'}}),e=>/TTS_WEIGHTS_MISSING.*custom-0\.6/.test(e.message)&&!/TTS_REFERENCE_REQUIRED/.test(e.message));
  svc.stop();
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('Windows packaging wires the compatibility UI and report route',()=>{
 const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
 assert.match(read('manager/ModelBridge.cjs'),/capabilities\/report/);
 assert.match(read('manager/ModelBridge.cjs'),/capability-audit\.js/);
 assert.match(read('manager/ModelPanel.html'),/capability-audit\.js/);
 assert.match(read('manager/CapabilityAuditUI.js'),/Find & download missing models/);
 for(const name of ['CapabilityAudit.cjs','CapabilityAuditUI.js']){
  for(const item of ['installer/Install.ps1','launcher/Bootstrap.cs','.github/workflows/build-windows.yml'])assert.ok(read(item).includes(name),item+' missing '+name);
 }
});
