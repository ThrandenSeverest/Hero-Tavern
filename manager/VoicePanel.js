(()=>{'use strict';const $=id=>document.getElementById(id);const token='__TOKEN__';
async function api(route,data){let r;try{r=await fetch(route,{method:data?'POST':'GET',headers:{'Content-Type':'application/json','X-Hero-Token':token},body:data?JSON.stringify(data):undefined})}catch(e){throw Error('Local voice service is unreachable. Restart Hero Tavern and check Diagnostics → startup logs. '+e.message)}let obj;try{obj=await r.json()}catch{throw Error('Voice service returned an invalid response (HTTP '+r.status+'). Check Diagnostics → startup logs.')}if(!r.ok)throw Error(obj.error||'Voice service failed (HTTP '+r.status+')');return obj;}
const human=n=>n>1073741824?(n/1073741824).toFixed(2)+' GiB':n>1048576?(n/1048576).toFixed(1)+' MiB':n>1024?(n/1024).toFixed(1)+' KiB':n+' bytes';
const ago=ts=>ts?Math.max(0,Math.round((Date.now()-ts)/1000)):0;
const duration=s=>s>=3600?Math.floor(s/3600)+'h '+Math.floor(s%3600/60)+'m':s>=60?Math.floor(s/60)+'m '+s%60+'s':s+'s';
const visibilityStyle=document.createElement('style');visibilityStyle.textContent='#voices [hidden]{display:none!important}';document.head.append(visibilityStyle);
let controlsLoaded=false,lastState=null,setupInProgress=false;
function restoreControls(s){
 $('tts-engine').value=s.settings.engine;$('tts-variant').value=s.settings.variant;
 $('tts-device').value=s.settings.device;$('tts-language').value=s.settings.language;
 $('tts-speaker').value=s.settings.speaker;$('tts-narrator').value=s.settings.narratorSpeaker;
 $('tts-enabled').checked=s.settings.enabled;$('tts-autoplay').checked=s.settings.autoPlay;
 $('tts-ref-text').value=s.settings.referenceText||'';
 $('tts-narrator-ref-text').value=s.settings.narratorReferenceText||'';
 $('tts-style').value=s.settings.style||'';
 controlsLoaded=true;modelControls();
}
async function refresh(){
 const s=await api('/tts/status');lastState=s;
 if(!controlsLoaded)restoreControls(s);voiceStatus(s);
 const prior=$('tts-voices').value;
 const names=s.voices||[];
 $('tts-voices').replaceChildren(...names.map(v=>new Option(v,v)));
 if(names.includes(prior))$('tts-voices').value=prior;
 for(const [id,key] of [['tts-dialogue-reference','dialogueReference'],['tts-narrator-reference','narratorReference']]){
  const field=$(id),existing=field.value||s.settings[key]||'';
  field.replaceChildren(new Option('None',''),...names.map(v=>new Option(v,v)));
  if(names.includes(existing))field.value=existing;
 }
 renderProfiles(s);return s;
}
function modelControls(){
 const kokoro=$('tts-engine').value==='kokoro',flash=$('tts-engine').value==='flash',variant=$('tts-variant').value,clone=!flash&&variant.startsWith('clone'),preset=kokoro||!flash&&variant.startsWith('custom'),style=!flash&&!kokoro&&['custom-0.6','custom-1.7','design-1.7'].includes(variant);
 for(const [id,show] of [['tts-variant',!flash&&!kokoro],['tts-language',!flash&&!kokoro],['tts-speaker',preset],['tts-narrator',preset],['tts-dialogue-reference',flash||clone&&!kokoro],['tts-narrator-reference',flash||clone&&!kokoro],['tts-ref-text',clone&&!kokoro],['tts-narrator-ref-text',clone&&!kokoro],['tts-style',style]])$(id).closest('label').hidden=!show;
 $('tts-model-help').textContent=kokoro?'Kokoro 82M: fast natural English voices, no WAV needed. Uses fixed preset voices; mood is not configurable.':flash?'Flash uses a reference WAV; no mood instruction.':clone?'Base clones a WAV and requires its exact transcript.':variant==='design-1.7'?'VoiceDesign creates a voice from your description. No WAV required. Save a profile to reuse the description; identity can vary between generations.':'CustomVoice uses a built-in speaker. No WAV required. An optional mood instruction works with both sizes.';
}
function renderProfiles(s){
 const select=$('tts-profile-list'),old=select.value;select.replaceChildren(new Option('Choose saved voice',''),...(s.profiles||[]).map(p=>new Option(p.name+' · '+p.voice.engine+' '+p.voice.variant,p.id)));select.value=old;
 $('tts-job-log').textContent=JSON.stringify(s.jobLog||[],null,2);
}
function voiceStatus(s){
 lastState=s;
 $('tts-job-log').textContent=JSON.stringify(s.jobLog||[],null,2);
 const engine=s.settings.engine==='flash'?'Chatterbox Flash':s.settings.engine==='kokoro'?'Kokoro 82M':'Qwen3-TTS '+s.settings.variant;
 const deps=s.installing?'IN PROGRESS':s.ready?'READY':s.error?'FAILED':'MISSING';
 const weights=s.downloading?'DOWNLOADING':s.weightsReady?'DOWNLOADED':s.downloadError?'FAILED':'MISSING';
 const verified=s.lastSynthesis?.engine===s.settings.engine&&(s.settings.engine==='flash'||s.lastSynthesis?.variant===s.settings.variant);const working=s.busy?'Synthesizing a speech preview…':verified?'Verified working · WAV generated '+s.lastSynthesis.at:s.running?'Speech engine running':s.ready&&s.weightsReady?'Both downloads present. Generate a speech preview to verify audio.':'Not ready to synthesize';
 const step=s.installing?(s.installStage==='python'?'1/3 · Preparing Python and uv':s.installStage==='cuda'?'2/3 · Installing RTX 5070 CUDA libraries':'2/3 · Installing TTS dependencies'):
   s.downloading?'3/3 · Downloading model weights':s.error?'Installation failed':s.downloadError?'Model download failed':s.ready&&s.weightsReady?'Ready for speech verification':'Waiting for setup';
 const seconds=s.installing?ago(s.installStartedAt):s.downloading?ago(s.downloadStartedAt):0;
 const inactivity=s.installing?ago(s.installChangedAt):s.downloading?ago(s.downloadChangedAt):0;
 const disk=s.downloading?' · '+human(s.downloadedBytes||0)+' stored in '+(s.downloadedFiles||0)+' files':'';
 $('tts-install-phase').textContent=step+(seconds?' · elapsed '+duration(seconds):'')+disk;
 $('tts-install-summary').textContent=engine+' · Dependencies: '+deps+' · Weights: '+weights+' · '+working;
 $('tts-setup-help').textContent=s.error?'Installer error: '+s.error+'\n'+(s.nextAction||'Press Retry installation.'):s.downloadError?'Download error: '+s.downloadError+'\nCheck your internet, Hugging Face access, and free disk space. Partially downloaded weights are kept.':s.installing||s.downloading?'Installation is active. Recent installer output '+duration(inactivity)+' ago. Larger PyTorch wheels and voice models may take several minutes. The operation continues if you switch tabs.':s.ready&&s.weightsReady?'Both parts are installed. Click Generate speech preview to confirm it works; files alone cannot verify synthesis.':s.nextAction||'Click Install + Download.';
 $('tts-model-downloads').textContent='Other downloaded voice variants: '+(Object.entries(s.downloadedModels||{}).filter(([,yes])=>yes).map(([kind])=>kind).join(', ')||'none')+'.';
 const log=[s.installOutput||'',s.downloadOutput||''].filter(Boolean).join('\n\n');
 $('tts-install-log').textContent=log.slice(-11000)||'No installer output yet. Click Install + Download.';
 $('tts-status').textContent=JSON.stringify({dependenciesReady:s.ready,weightsReady:s.weightsReady,phase:s.phase,installing:s.installing,downloading:s.downloading,error:s.error||s.downloadError||'',lastOutputSeconds:inactivity,downloadedBytes:s.downloadedBytes||0},null,2);
 const running=!!(s.installing||s.downloading);
 const progress=$('tts-install-progress');
 progress.hidden=!running;if(running)progress.removeAttribute('value');
 $('tts-install').disabled=running;
 $('tts-cancel-install').disabled=!s.installing;
 $('tts-download').disabled=running||!s.ready||s.weightsReady;
 $('tts-setup').disabled=running;
 $('tts-setup').textContent=running?'Installation in progress…':s.ready&&s.weightsReady?'Installed · test voice below':s.error||s.downloadError?'Retry installation + download':'Install + download with one click';
 $('tts-cancel-download').disabled=!s.downloading;
 $('tts-test').disabled=running||!s.ready||!s.weightsReady||s.busy;
 $('tts-install-status').setAttribute('aria-busy',String(running));
}
window.heroVoicesRefresh=()=>{controlsLoaded=false;return refresh()};
setInterval(async()=>{if($('voices').hidden)return;try{voiceStatus(await api('/tts/status'))}catch(e){$('tts-setup-help').textContent='Cannot contact the voice service: '+e.message}},2000);
const settingsFromForm=()=>({engine:$('tts-engine').value,variant:$('tts-variant').value,device:$('tts-device').value,language:$('tts-language').value,speaker:$('tts-speaker').value,narratorSpeaker:$('tts-narrator').value,enabled:$('tts-enabled').checked,autoPlay:$('tts-autoplay').checked,dialogueReference:$('tts-dialogue-reference').value,narratorReference:$('tts-narrator-reference').value,referenceText:$('tts-ref-text').value,narratorReferenceText:$('tts-narrator-ref-text').value,style:$('tts-style').value});
async function action(fn){try{$('tts-feedback').textContent='Sending request…';await fn();await refresh();if($('tts-feedback').textContent==='Sending request…')$('tts-feedback').textContent='Request accepted. See live installation progress above.'}catch(e){$('tts-feedback').textContent='Request failed: '+e.message;await refresh().catch(()=>{})}}
$('tts-refresh').onclick=()=>action(refresh);
$('tts-setup').onclick=()=>action(async()=>{
 $('tts-feedback').textContent='Saving selected model and starting setup…';
 await api('/tts/configure',settingsFromForm());
 const result=await api('/tts/setup',{});
 $('tts-feedback').textContent=result.alreadyInstalled?'Already installed. Generate a speech preview below.':result.alreadyRunning?'Setup is already running; watch the progress above.':'Setup started. Dependencies install first; model weights download automatically. You can leave this tab open or come back later.';
});
$('tts-save').onclick=()=>action(()=>api('/tts/configure',settingsFromForm()));
$('tts-install').onclick=()=>action(async()=>{await api('/tts/configure',settingsFromForm());await api('/tts/install',{})});
$('tts-download').onclick=()=>action(async()=>{await api('/tts/configure',settingsFromForm());await api('/tts/download',{})});
$('tts-cancel-install').onclick=()=>action(()=>api('/tts/install-cancel',{}));
$('tts-cancel-download').onclick=()=>action(()=>api('/tts/download-cancel',{}));
$('tts-stop').onclick=()=>action(()=>api('/tts/stop',{}));
$('tts-import').onclick=()=>action(async()=>{const file=$('tts-voice-file').files[0];if(!file)throw Error('Choose a WAV file');if(file.size>12000000)throw Error('WAV too large');const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file)});return api('/tts/import',{name:$('tts-voice-name').value||file.name.replace(/\.wav$/i,''),base64})});
$('tts-delete-voice').onclick=()=>action(async()=>{if(!$('tts-voices').value)return;return api('/tts/delete',{name:$('tts-voices').value})});
$('tts-test').onclick=()=>action(async()=>{const form=settingsFromForm();const v=await api('/tts/speak',{...form,text:$('tts-test-text').value,reference:form.dialogueReference});$('tts-audio').src=v.url;$('tts-feedback').textContent='Voice ready.';await $('tts-audio').play().catch(()=>{$('tts-feedback').textContent='Voice ready. Click Play.'})});
const extra=document.createElement('div');extra.className='card';extra.innerHTML='<p id="tts-model-help"></p><h3>Voice Library</h3><p>Save a built-in speaker, a designed voice or a clone configuration, then assign it through Characters → Character Voice.</p><label>Profile name<input id="tts-profile-name" placeholder="Mira — warm voice"></label><button id="tts-profile-save">Save current voice as new profile</button><label>Saved profiles<select id="tts-profile-list"></select></label><button id="tts-profile-load">Edit selected voice</button><button id="tts-profile-update">Update selected voice</button><button id="tts-profile-delete">Delete selected profile</button><details><summary>Speech job debug log</summary><pre id="tts-job-log" style="white-space:pre-wrap"></pre></details>';
$('tts-feedback').after(extra);
for(const id of ['tts-engine','tts-variant'])$(id).addEventListener('change',()=>{if($('tts-engine').value==='kokoro'){$('tts-variant').value='kokoro';$('tts-language').value='English';if(!/^([ab][fm]_)/.test($('tts-speaker').value))$('tts-speaker').value='af_heart';if(!/^([ab][fm]_)/.test($('tts-narrator').value))$('tts-narrator').value='af_heart';}else if($('tts-variant').value==='kokoro'){$('tts-variant').value='custom-0.6';}modelControls();});
const profileData=()=>{const form=settingsFromForm();return {name:$('tts-profile-name').value,voice:{...form,reference:form.dialogueReference}}};
$('tts-profile-save').onclick=()=>action(()=>api('/tts/profiles/save',profileData()));
$('tts-profile-update').onclick=()=>action(async()=>{if(!$('tts-profile-list').value)throw Error('Select a profile');return api('/tts/profiles/save',{...profileData(),id:$('tts-profile-list').value})});
$('tts-profile-delete').onclick=()=>action(async()=>{if(!$('tts-profile-list').value)return;if(!confirm('Delete this profile? Assigned characters will show a missing voice until reassigned. WAV recordings are kept.'))return;return api('/tts/profiles/delete',{id:$('tts-profile-list').value})});
$('tts-profile-load').onclick=()=>{const profile=lastState?.profiles?.find(p=>p.id===$('tts-profile-list').value);if(!profile)return;restoreControls({settings:{...lastState.settings,...profile.voice}});$('tts-dialogue-reference').value=profile.voice.reference||'';$('tts-profile-name').value=profile.name;$('tts-feedback').textContent='Editing profile. Preview or Update selected voice; global settings change only on Save voice settings.'};
modelControls();
})();
