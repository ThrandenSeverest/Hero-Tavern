// Local, on-demand TTS process manager. No network listener and no ambient shell.
'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process'),{createHash}=require('node:crypto');
function splitSpeech(raw,{speaker='Character',narrator='Narrator'}={}){
 const text=String(raw||'').replace(/<think>[\s\S]*?(?:<\/think>|$)/gi,'').replace(/<[^>]*>/g,' ').slice(0,12000);
 const segments=[];let buffer='',kind='narration',quote=false,action=false;
 const push=()=>{const t=buffer.replace(/\s+/g,' ').trim();if(t)for(const part of t.match(/.{1,400}(?:\s|$)|.{1,400}/g)||[])segments.push({kind,speaker:kind==='dialogue'?speaker:narrator,text:part.trim()});buffer='';};
 for(let i=0;i<text.length;i++){
  const ch=text[i];if(ch==='*'&&text[i+1]!=='*'&&text[i-1]!=='*'){push();action=!action;kind=quote&&!action?'dialogue':'narration';continue;}
  if((ch==='"'||ch==='“'||ch==='”'||ch==='«'||ch==='»')&&!action){push();quote=!quote;kind=quote?'dialogue':'narration';continue;}
  buffer+=ch;
 }
 push();return segments.filter(x=>x.text);
}
const KOKORO_VOICES=['af_heart','af_bella','af_nicole','af_sarah','am_adam','am_michael','am_echo','bf_emma','bf_isabella','bm_george','bm_lewis'];
const VARIANTS=['custom-0.6','custom-1.7','clone-0.6','clone-1.7','design-1.7'];
function capabilities(engine,variant){
 if(!['flash','qwen','kokoro'].includes(engine)||(engine==='qwen'&&!VARIANTS.includes(variant))||(engine==='flash'&&variant!=='flash'&&!VARIANTS.includes(variant))||(engine==='kokoro'&&variant!=='kokoro'))throw Error('Unsupported speech engine/model');
 return {presetSpeakers:(engine==='qwen'&&variant.startsWith('custom'))||engine==='kokoro',referenceAudio:engine==='flash'||variant.startsWith('clone'),referenceTranscript:engine==='qwen'&&variant.startsWith('clone'),voiceDesign:engine==='qwen'&&variant==='design-1.7',textStyleInstruction:engine==='qwen'&&['custom-0.6','custom-1.7','design-1.7'].includes(variant),maxTextCharacters:600};
}
function speechError(code,message){const error=Error(code+': '+message);error.code=code;return error;}
function planSpeech(text,dialogue,narrator){
 const merged=[];
 for(const span of splitSpeech(text)){
  const voice=span.kind==='narration'?narrator:dialogue,key=JSON.stringify(voice),last=merged.at(-1);
  if(last&&last.key===key)last.text+=' '+span.text;else merged.push({key,text:span.text,voice});
 }
 return merged.flatMap(({text,voice})=>{const out=[];while(text.length>600){let n=text.lastIndexOf(' ',600);if(n<1)n=600;out.push({text:text.slice(0,n),...voice});text=text.slice(n).trimStart()}if(text)out.push({text,...voice});return out;});
}
function createTTS(root){
 const file=path.join(root,'tts-settings.json');let settings={engine:'qwen',variant:'custom-0.6',device:'cpu',language:'Auto',speaker:'Ryan',narratorSpeaker:'Ryan',enabled:false,autoPlay:false,dialogueReference:'',narratorReference:'',referenceText:'',narratorReferenceText:'',style:''};
 try{settings={...settings,...JSON.parse(fs.readFileSync(file,'utf8'))}}catch{}
 let child=null,pending=new Map(),sequence=0,install=null,installOutput='',fault='',busy=false,downloader=null,downloadOutput='',downloadError='',downloadKind='';
 let installStage='idle',installStartedAt=0,installChangedAt=0,downloadStartedAt=0,downloadChangedAt=0,setupRequested=null;
 let diskCache={at:0,bytes:0,files:0},lastSynthesis=null,workerEngine='',messageBusy=false;
 const profileFile=path.join(root,'voice-profiles.json'),logFile=path.join(root,'Logs','tts-jobs.jsonl');
 let profiles={};try{profiles=JSON.parse(fs.readFileSync(profileFile,'utf8'))}catch(e){if(e.code!=='ENOENT')throw Error('Voice profiles could not be read; preserved file: '+e.message)}
 const jobLog=[];
 function logJob(event){const entry={at:new Date().toISOString(),...event};jobLog.push(entry);if(jobLog.length>50)jobLog.shift();fs.mkdirSync(path.dirname(logFile),{recursive:true});if(fs.existsSync(logFile)&&fs.statSync(logFile).size>2000000)fs.renameSync(logFile,logFile+'.previous');fs.appendFileSync(logFile,JSON.stringify(entry)+'\n');}
 function saveProfile(data){const id=data.id||require('node:crypto').randomUUID();if(['__proto__','constructor','prototype'].includes(id)||!/^[a-zA-Z0-9_-]{1,80}$/.test(id))throw Error('Invalid profile ID');const voice=normalizeVoice(data.voice||{});profiles[id]={id,name:String(data.name||'Voice').slice(0,100),voice};fs.writeFileSync(profileFile+'.tmp',JSON.stringify(profiles,null,2));fs.renameSync(profileFile+'.tmp',profileFile);return {profile:profiles[id]};}
 function deleteProfile(data){if(!Object.hasOwn(profiles,data.id))throw Error('Voice profile not found');delete profiles[data.id];fs.writeFileSync(profileFile+'.tmp',JSON.stringify(profiles,null,2));fs.renameSync(profileFile+'.tmp',profileFile);return status();}
 function normalizeVoice(input={}){
  const engine=input.engine??settings.engine,variant=input.variant??settings.variant,caps=capabilities(engine,variant);
  const voice={engine,variant,device:input.device??settings.device,language:input.language??settings.language,speaker:input.speaker??settings.speaker,reference:input.reference??settings.dialogueReference,referenceText:input.referenceText??settings.referenceText,style:input.style??settings.style};
  if(!['cpu','cuda'].includes(voice.device))throw Error('Invalid speech device');
  for(const key of ['language','speaker','reference','referenceText','style'])if(typeof voice[key]!=='string'||voice[key].length>1200)throw Error('Invalid '+key);
  if(!caps.referenceAudio){voice.reference='';voice.referenceText='';}
  if(!caps.referenceTranscript)voice.referenceText='';
  if(!caps.presetSpeakers)voice.speaker='';
  if(engine==='kokoro'){
   if(!KOKORO_VOICES.includes(voice.speaker))voice.speaker='af_heart';
   if(!['Auto','English'].includes(voice.language))throw speechError('TTS_LANGUAGE_UNSUPPORTED','Kokoro preset is English only; select Qwen for Russian or other languages.');
  }
  if(!caps.textStyleInstruction)voice.style='';
  return voice;
 }
 function resolveVoice(profileId,narrator=false){
  if(profileId&&!Object.hasOwn(profiles,profileId))throw speechError('TTS_CHARACTER_ROUTE_FAILED','Assigned voice profile is missing. Reassign it in Character Voice.');
  const voice=profileId?normalizeVoice(profiles[profileId].voice):normalizeVoice(narrator?{speaker:settings.narratorSpeaker,reference:settings.narratorReference,referenceText:settings.narratorReferenceText}:{});
  // Never demand an arbitrary WAV from a character that has no assigned voice
  // when a local no-reference CustomVoice model is already installed.
  if(capabilities(voice.engine,voice.variant).referenceAudio&&!voice.reference){
   if(installedWeight('kokoro','kokoro'))return normalizeVoice({engine:'kokoro',variant:'kokoro',speaker:narrator?'af_heart':'am_adam',language:'English',reference:''});
   const variant=['custom-0.6','custom-1.7'].find(kind=>installedWeight('qwen',kind))||'custom-0.6';
   return normalizeVoice({engine:'qwen',variant,speaker:narrator?(settings.narratorSpeaker||'Ryan'):(settings.speaker||'Ryan'),reference:'',style:''});
  }
  return voice;
 }
 function preflight(voice){
  const caps=capabilities(voice.engine,voice.variant);
  if(caps.referenceAudio&&!voice.reference)throw speechError('TTS_REFERENCE_REQUIRED',(voice.engine==='flash'?'Chatterbox Flash':'Qwen voice cloning')+' requires a reference WAV. Import a WAV in Voice models or assign a Qwen CustomVoice/VoiceDesign profile from Character Voice (no WAV required).');
  if(voice.reference&&!/^[a-z0-9_-]+\.wav$/i.test(voice.reference))throw speechError('TTS_BAD_REFERENCE_AUDIO','Invalid reference filename.');
  if(voice.reference&&!fs.existsSync(path.join(voices,voice.reference)))throw speechError('TTS_BAD_REFERENCE_AUDIO','Reference WAV is missing. Reassign it.');
  if(caps.referenceTranscript&&!voice.referenceText.trim())throw speechError('TTS_TRANSCRIPT_REQUIRED','Enter the exact words spoken in the reference sample.');
  if(caps.voiceDesign&&!voice.style.trim())throw speechError('TTS_STYLE_REQUIRED','Describe the voice for VoiceDesign.');
  if(caps.presetSpeakers&&!voice.speaker.trim())throw speechError('TTS_SPEAKER_UNSUPPORTED','Choose a built-in speaker.');
 }

 const appendInstall=(line)=>{installOutput=(installOutput+String(line)).slice(-16000);installChangedAt=Date.now();};
 const appendDownload=(line)=>{downloadOutput=(downloadOutput+String(line)).slice(-16000);downloadChangedAt=Date.now();};
 const failedInstall=(reason)=>{fault=String(reason).slice(0,2000);installStage='failed';installChangedAt=Date.now();install=null;setupRequested=null;};
 const bytesOnDisk=(folder)=>{
  if(Date.now()-diskCache.at<2000)return diskCache;
  let bytes=0,files=0;const dirs=[folder];
  while(dirs.length&&files<12000){const dir=dirs.pop();let nodes;try{nodes=fs.readdirSync(dir,{withFileTypes:true})}catch{continue;}
   for(const node of nodes){if(node.isSymbolicLink())continue;const item=path.join(dir,node.name);
    if(node.isDirectory()){if(!node.name.startsWith('.git'))dirs.push(item)}
    else if(node.isFile()){try{bytes+=fs.statSync(item).size;files++}catch{}}
   }
  }
  diskCache={at:Date.now(),bytes,files};return diskCache;
 };
 const nextAction=()=>fault?'Repair dependencies; '+fault:downloadError?'Retry model download. '+downloadError:install?'Wait for dependency installation to finish':downloader?'Wait for model weights to finish downloading':!fs.existsSync(path.join(root,'TTSRuntime',settings.engine,'.installed'))?'Install Python dependencies':!installedWeight(settings.engine,settings.variant)?'Download the selected voice weights':'Generate a speech preview to verify synthesis';
 const voices=path.join(root,'Voices'),cache=path.join(root,'TTSCache');fs.mkdirSync(voices,{recursive:true});fs.mkdirSync(cache,{recursive:true});
 const executable=(engine=settings.engine)=>{const dir=path.join(root,'TTSRuntime',engine);return process.platform==='win32'?path.join(dir,'Scripts','python.exe'):path.join(dir,'bin','python');};
 const weightsDir=(engine,variant)=>path.join(root,'TTSModels',engine,engine==='flash'?'flash':variant);
 const installedWeight=(engine,variant)=>fs.existsSync(path.join(weightsDir(engine,variant),'.hero-downloaded'));
 const currentKind=()=>settings.engine==='flash'?'flash':settings.engine==='kokoro'?'kokoro':settings.variant;
 const status=()=>{
  const ready=fs.existsSync(executable())&&fs.existsSync(path.join(root,'TTSRuntime',settings.engine,'.installed'));
  const weightsReady=installedWeight(settings.engine,settings.variant);
  const storage=downloader?bytesOnDisk(weightsDir(settings.engine,settings.variant)):{bytes:0,files:0};
  return {settings,capabilities:capabilities(settings.engine,settings.variant),profiles:Object.values(profiles),jobLog,lastSynthesis,ready,weightsReady,downloadedModels:{flash:installedWeight('flash','flash'),kokoro:installedWeight('kokoro','kokoro'),...Object.fromEntries(['custom-0.6','custom-1.7','clone-0.6','clone-1.7','design-1.7'].map(variant=>[variant,installedWeight('qwen',variant)]))},
   running:!!child,busy:busy||messageBusy,installing:!!install,installStage,installStartedAt,installChangedAt,
   installOutput:installOutput.slice(-12000),downloading:!!downloader,downloadKind,downloadStartedAt,downloadChangedAt,
   downloadOutput:downloadOutput.slice(-12000),downloadError,error:fault,lastSynthesis,
   setupQueued:!!setupRequested,phase:install?'dependencies:'+installStage:downloader?'weights':fault?'error':ready&&weightsReady?'ready':'idle',
   nextAction:nextAction(),downloadedBytes:storage.bytes,downloadedFiles:storage.files,
   voices:fs.readdirSync(voices).filter(x=>/^[a-z0-9_-]+\.wav$/i.test(x))};
 };
 const stop=()=>{if(child){child.kill();child=null;}for(const p of pending.values())p.reject(Error('Speech engine stopped'));pending.clear();};

 function downloadModel(){
   if(install||downloader)throw Error('Finish the running voice installation or download first.');
   if(!status().ready)throw Error('Install selected voice engine dependencies first, then download its model weights.');
   const engine=settings.engine,variant=settings.variant,kind=currentKind(),target=weightsDir(engine,variant);
   if(installedWeight(engine,variant))return {alreadyInstalled:true,kind,path:target};
   fs.mkdirSync(target,{recursive:true});
   downloadOutput='Starting '+(engine==='flash'?'Chatterbox Flash':engine==='kokoro'?'Kokoro 82M':'Qwen3-TTS '+variant)+' model download…';downloadStartedAt=Date.now();downloadChangedAt=downloadStartedAt;diskCache.at=0;
   downloadError='';downloadKind=kind;
   downloader=spawn(executable(),['-u',path.join(root,'TTSModelDownload.py'),kind,target],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PYTHONUNBUFFERED:'1',HF_HUB_ENABLE_HF_TRANSFER:'0'}});
   const current=downloader,log=data=>appendDownload(data.toString());
   current.stdout.on('data',log);current.stderr.on('data',log);
   current.on('error',e=>{downloadError='Download could not start: '+e.message+'. Verify that the speech Python runtime and huggingface_hub were installed.';downloadChangedAt=Date.now();setupRequested=null;if(downloader===current)downloader=null;});
   current.on('close',code=>{if(downloader!==current)return;downloader=null;if(code!==0||!installedWeight(engine,variant)){downloadError='Weight download failed. Last output: '+(downloadOutput.slice(-1300)||'No process output. Check internet access and available disk space.');}else appendDownload('\nVoice model weights are ready. Use Generate speech preview to verify audio.');setupRequested=null;downloadChangedAt=Date.now();});
   return {started:true,kind,path:target};
 }
 function cancelModelDownload(){
   if(!downloader)return {cancelled:false};const p=downloader;downloader=null;
   if(process.platform==='win32'&&p.pid)spawn('taskkill.exe',['/PID',String(p.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'}).on('error',()=>{});
   else p.kill();
   downloadError='Download interrupted; partial files can be resumed safely.';downloadChangedAt=Date.now();setupRequested=null;return {cancelled:true};
 }

 const configure=next=>{if(!next||typeof next!=='object')throw Error('Invalid voice settings');if(busy||messageBusy)throw Error('Wait for speech generation or cancel it before changing global settings');const previous=settings.engine;const updated={...settings};for(const key of ['engine','variant','device','language','speaker','narratorSpeaker','enabled','autoPlay','dialogueReference','narratorReference','referenceText','narratorReferenceText','style'])if(next[key]!==undefined)updated[key]=next[key];if(!['flash','qwen','kokoro'].includes(updated.engine))throw Error('Choose Flash, Kokoro or Qwen3-TTS');if(!['cpu','cuda'].includes(updated.device))throw Error('Invalid device');if(updated.engine==='qwen'&&!VARIANTS.includes(updated.variant)||updated.engine==='flash'&&updated.variant!=='flash'&&!VARIANTS.includes(updated.variant))throw Error('Invalid speech variant');for(const key of ['speaker','narratorSpeaker','language','dialogueReference','narratorReference','referenceText','narratorReferenceText','style'])if(typeof updated[key]!=='string'||updated[key].length>1200)throw Error('Invalid voice setting');for(const key of ['enabled','autoPlay'])if(typeof updated[key]!=='boolean')throw Error('Invalid playback setting');if((install||downloader||setupRequested)&&(settings.engine!==updated.engine||settings.variant!==updated.variant))throw Error('Wait for the current voice installation or cancel the download before selecting another model.');settings=updated;fs.writeFileSync(file,JSON.stringify(settings,null,2));if(previous!==settings.engine)stop();return status();};
 const installEngine=(options={})=>{
  if(install)throw Error('Voice dependency installation is already running. Check its live installation stage.');
  if(downloader)throw Error('A voice weight download is already running. Wait or cancel it before repairing dependencies.');
  if(child)stop();
  const engine=settings.engine,variant=settings.variant,target=path.join(root,'TTSRuntime',engine);
  fs.mkdirSync(path.dirname(target),{recursive:true});
  fs.rmSync(path.join(target,'.installed'),{force:true}); // never claim success after an interrupted repair
  installOutput='';fault='';installStage='python';installStartedAt=Date.now();installChangedAt=installStartedAt;
  if(options.downloadWeights)setupRequested={engine,variant};else setupRequested=null;
  appendInstall('Step 1/3: Checking isolated Python 3.11 and the uv package installer…\n');
  const python=process.env.HERO_TTS_PYTHON||'python';
  const isWindows=process.platform==='win32'&&!process.env.HERO_TTS_PYTHON;
  const pythonExe=isWindows?path.join(target,'Scripts','python.exe'):path.join(target,process.platform==='win32'?'Scripts':'bin',process.platform==='win32'?'python.exe':'python');
  const done=()=>{
   fs.writeFileSync(path.join(target,'.installed'),new Date().toISOString());
   install=null;installStage='complete';installChangedAt=Date.now();
   appendInstall('Dependency installation completed. Python runtime ready.\n');
   if(setupRequested?.engine===settings.engine&&setupRequested?.variant===settings.variant){
    if(installedWeight(engine,variant)){setupRequested=null;appendInstall('Voice weights already present. Run the speech preview to verify output.\n');}
    else{setupRequested=null;appendInstall('Step 3/3: Downloading '+engine+' '+variant+' voice weights…\n');try{downloadModel()}catch(e){downloadError='Automatic model download did not start: '+e.message;downloadChangedAt=Date.now();}}
   }
  };
  const runChild=(command,args,phase,onSuccess)=>{
   installStage=phase;installChangedAt=Date.now();
   let current;
   try{current=spawn(command,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,UV_PROGRESS:'1',PYTHONUNBUFFERED:'1'}});}
   catch(e){failedInstall('Cannot start '+phase+': '+e.message);return;}
   install=current;
   current.stdout.on('data',x=>appendInstall(x.toString()));
   current.stderr.on('data',x=>appendInstall(x.toString()));
   current.on('error',e=>{if(install===current)failedInstall('Cannot launch '+phase+': '+e.message)});
   current.on('close',code=>{
    if(install!==current)return;
    if(code!==0){const tail=installOutput.slice(-1600);failedInstall('TTS '+phase+' failed (exit '+code+'). '+tail);return;}
    try{onSuccess()}catch(e){failedInstall('Cannot complete '+phase+': '+e.message)}
   });
  };
  const installPackages=()=>{
   appendInstall('\nStep 2/3: Installing '+engine+' packages into '+pythonExe+'…\n');
   const packages=engine==='flash'?['chatterbox-flash','soundfile','huggingface_hub']:engine==='kokoro'?['kokoro>=0.9.4','soundfile','huggingface_hub']:['qwen-tts','soundfile','huggingface_hub'];
   const command=isWindows?path.join(root,'TTSRuntime','uv.exe'):pythonExe;
   // uv pip directly manages environments without needing "python -m pip".
   const args=isWindows?['pip','install','--python',pythonExe,'--upgrade',...packages]:['-m','pip','install','--upgrade',...packages];
   runChild(command,args,'packages',()=>{
    if(engine!=='flash'&&engine!=='kokoro'){done();return;}
    appendInstall('\nStep 2/3: Installing PyTorch CUDA 12.8 wheels for the RTX 5070…\n');
    const wheels=['torch==2.7.1','torchaudio==2.7.1','torchvision==0.22.1'];
    const gpuArgs=isWindows?['pip','install','--python',pythonExe,'--upgrade',...wheels,'--index-url','https://download.pytorch.org/whl/cu128']:['-m','pip','install','--upgrade',...wheels,'--index-url','https://download.pytorch.org/whl/cu128'];
    runChild(command,gpuArgs,'cuda',done);
   });
  };
  if(!isWindows){
   runChild(python,['-m','venv',target],'python',installPackages);
  }else{
   // uv venv does not seed pip by default; using uv pip avoids missing-pip failures.
   // A valid existing environment is reused; invalid environments are preserved with a .recovery suffix.
   // Ensure uv exists even when the venv already exists.
   const ps=[
    "$ErrorActionPreference='Stop'",
    "$dir=$env:HERO_TTS_RUNTIME; $target=$env:HERO_TTS_TARGET",
    "New-Item -ItemType Directory -Force $dir | Out-Null",
    "$uv=Join-Path $dir 'uv.exe'",
    "if(-not (Test-Path $uv)){",
    " Write-Output 'Downloading official uv package manager…'",
    " $zip=Join-Path $dir 'uv.zip'; $unpack=Join-Path $dir 'uv-package'",
    " Invoke-WebRequest -Uri 'https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip' -OutFile $zip -UseBasicParsing",
    " Expand-Archive -Path $zip -DestinationPath $unpack -Force",
    " $exe=Get-ChildItem -LiteralPath $unpack -Recurse -Filter uv.exe | Select-Object -First 1",
    " if(-not $exe){throw 'uv.exe missing from official archive'}",
    " Copy-Item $exe.FullName $uv -Force; Remove-Item $zip -Force; Remove-Item $unpack -Recurse -Force",
    "}",
    "$venvPython=Join-Path $target 'Scripts\\python.exe'; $valid=$false",
    "if(Test-Path -LiteralPath $venvPython){ try { & $venvPython -c 'import sys; assert sys.version_info[:2] == (3, 11)' *> $null; $valid=($LASTEXITCODE -eq 0) } catch { $valid=$false } }",
    "if($valid){ Write-Output 'Reusing existing Python 3.11 environment (pip module not required).' } else {",
    " if(Test-Path -LiteralPath $target){ $backup=$target+'.recovery-'+[DateTime]::UtcNow.ToString('yyyyMMddHHmmss')+'-'+[Guid]::NewGuid().ToString('N').Substring(0,6); Move-Item -LiteralPath $target -Destination $backup -ErrorAction Stop; Write-Output ('Preserved incomplete runtime at '+$backup) }",
    " $env:UV_PYTHON_INSTALL_DIR=Join-Path $dir 'python'",
    " & $uv python install 3.11; if($LASTEXITCODE -ne 0){throw 'Portable Python download failed'}",
    " & $uv venv $target --python 3.11 --python-preference only-managed; if($LASTEXITCODE -ne 0){throw 'Creating TTS environment failed'}",
    "}"
   ].join('\n');
   const prevSpawn=spawn;
   // Environment is passed explicitly to the PowerShell subprocess.
   const env={...process.env,HERO_TTS_RUNTIME:path.join(root,'TTSRuntime'),HERO_TTS_TARGET:target};
   let proc;
   try{proc=prevSpawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',ps],{windowsHide:true,stdio:['ignore','pipe','pipe'],env})}
   catch(e){failedInstall('Cannot start Windows Python bootstrap: '+e.message);return status();}
   install=proc;
   proc.stdout.on('data',x=>appendInstall(x.toString()));
   proc.stderr.on('data',x=>appendInstall(x.toString()));
   proc.on('error',e=>{if(install===proc)failedInstall('PowerShell bootstrap failed: '+e.message)});
   proc.on('close',code=>{
    if(install!==proc)return;
    if(code!==0){failedInstall('Python/uv bootstrap failed (exit '+code+'): '+installOutput.slice(-1800));return;}
    installPackages();
   });
  }
  return status();
 };
 const cancelInstall=()=>{
  if(!install)return {cancelled:false};
  const current=install;install=null;setupRequested=null;installStage='cancelled';
  fault='Voice dependency installation cancelled. Existing voice models and recordings are safe; click Retry when ready.';
  installChangedAt=Date.now();appendInstall('\nCancelled by user. Partial Python runtime was preserved.\n');
  if(process.platform==='win32'&&current.pid)spawn('taskkill.exe',['/PID',String(current.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'}).on('error',()=>{});
  else current.kill();
  return {cancelled:true};
 };
 const setup=()=>{
  if(install||downloader)return {...status(),alreadyRunning:true};
  const current=status();
  if(current.ready&&current.weightsReady)return {...current,alreadyInstalled:true};
  if(current.ready){setupRequested=null;return {...downloadModel(),...status()}}
  return installEngine({downloadWeights:true});
 };
 function start(engine,variant){
  if(child&&workerEngine!==engine)stop();if(child)return child;
  if(!fs.existsSync(executable(engine)))throw speechError('TTS_ENGINE_NOT_INSTALLED','Install '+engine+' in Voice Models.');
  if(!installedWeight(engine,variant))throw speechError('TTS_WEIGHTS_MISSING','Download '+engine+' '+variant+' in Voice Models.');
  const proc=spawn(executable(engine),['-u',path.join(root,'TTSWorker.py')],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONUNBUFFERED:'1'}});child=proc;workerEngine=engine;fault='';
  let buffer='';proc.stdout.on('data',d=>{buffer+=d.toString();let n;while((n=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,n);buffer=buffer.slice(n+1);let item;try{item=JSON.parse(line)}catch{continue}const p=pending.get(item.id);if(!p)continue;pending.delete(item.id);item.ok?p.resolve(item):p.reject(Error(item.error||'Speech synthesis failed'));}});
  proc.stderr.on('data',d=>{const text=d.toString();if(/Traceback|Error:|CUDA out of memory/i.test(text))fault=text.slice(-600)});
  proc.on('error',e=>{if(child===proc){fault=e.message;stop()}});proc.on('exit',()=>{if(child!==proc)return;child=null;for(const p of pending.values())p.reject(Error('Speech engine exited. '+fault));pending.clear()});
  proc.stdin.on('error',e=>{if(child===proc){fault=e.message;stop()}});return proc;
 }
 function call(task){const proc=start(task.engine,task.variant),id=++sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(speechError('TTS_TIMEOUT','Speech worker timed out and was stopped. Retry a shorter segment.'));stop()},180000);pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v)},reject:e=>{clearTimeout(timer);reject(e)}});proc.stdin.write(JSON.stringify({id,type:'generate',...task})+'\n');});}
 const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0,32);
 async function speak(input,internal=false){
  if(busy||messageBusy&&!internal)throw Error('TTS busy. Wait for speech generation.');
  if(typeof input?.text!=='string'||!input.text.trim()||input.text.length>600)throw Error('Speech text must be 1–600 characters');busy=true;
  const started=Date.now(),jobId=require('node:crypto').randomUUID();let task;
  try{
   const voice=normalizeVoice(input);
   if(!installedWeight(voice.engine,voice.variant))throw speechError('TTS_WEIGHTS_MISSING','The selected '+voice.engine+' '+voice.variant+' weights are not installed. Open Character Voice → Voice Library → Install + download; no WAV is needed for Qwen CustomVoice.');
   preflight(voice);
   const ref=voice.reference?path.join(voices,voice.reference):'';
   task={...voice,text:input.text,reference:ref,referenceHash:ref?createHash('sha256').update(fs.readFileSync(ref)).digest('hex'):'',modelPath:weightsDir(voice.engine,voice.variant)};
   task.audioFormat='pcm24-v1';task.modelRevision=fs.readFileSync(path.join(task.modelPath,'.hero-downloaded'),'utf8');
   const key=hash(task),dest=path.join(cache,key+'.wav');let cached=fs.existsSync(dest)&&fs.statSync(dest).size>44;
   if(!cached){const result=await call(task),bytes=Buffer.from(result.audio,'base64');if(bytes.length<44||bytes.subarray(0,4).toString()!=='RIFF'||bytes.subarray(8,12).toString()!=='WAVE'||bytes.length>18000000)throw speechError('TTS_EMPTY_OR_INVALID_WAV','Speech engine returned invalid audio.');fs.writeFileSync(dest,bytes);}
   lastSynthesis={engine:task.engine,variant:task.variant,device:task.device,at:new Date().toISOString(),cached};
   logJob({jobId,event:'completed',messageId:input.messageId,engine:task.engine,variant:task.variant,device:task.device,characters:task.text.length,cached,elapsedMs:Date.now()-started});
   return {url:'/tts/audio/'+key+'.wav',cached,jobId};
  }catch(e){logJob({jobId,event:'failed',messageId:input.messageId,engine:task?.engine||input.engine||settings.engine,variant:task?.variant||input.variant||settings.variant,error:e.message,elapsedMs:Date.now()-started});throw e}finally{busy=false;}
 }
 async function speakMessage(input){
  try{return await synthesizeMessage(input)}catch(e){logJob({event:'message_failed',messageId:input?.messageId,error:e.message});throw e}
 }
 async function synthesizeMessage(input){
  if(messageBusy||busy)throw Error('TTS busy. Wait for speech generation.');
  if(typeof input.text!=='string'||input.text.length>12000)throw Error('Speech message must be at most 12,000 characters');
  const assignment=input.assignment||{},dialogue=resolveVoice(assignment.dialogueProfileId),narrator=assignment.narratorMode==='same'?dialogue:resolveVoice(assignment.narratorProfileId,true);
  const segments=planSpeech(input.text,dialogue,narrator);if(!segments.length)throw Error('No visible text to speak');
  for(const segment of segments)preflight(segment);
  messageBusy=true;
  try{const parts=[];for(const segment of segments)parts.push(await speak({...segment,messageId:input.messageId},true));
   // Workers normalize to PCM16 mono 24 kHz, so joining does not change pitch or tempo.
   if(parts.length===1)return {...parts[0],segments:1};
   const chunks=parts.map(part=>{const wav=fs.readFileSync(readAudio(part.url));let offset=12;while(offset+8<=wav.length){const size=wav.readUInt32LE(offset+4);if(wav.toString('ascii',offset,offset+4)==='data')return wav.subarray(offset+8,offset+8+size);offset+=8+size+(size%2)}throw Error('WAV data chunk missing');});
   const pcm=Buffer.concat(chunks),head=Buffer.alloc(44);head.write('RIFF');head.writeUInt32LE(36+pcm.length,4);head.write('WAVEfmt ',8);head.writeUInt32LE(16,16);head.writeUInt16LE(1,20);head.writeUInt16LE(1,22);head.writeUInt32LE(24000,24);head.writeUInt32LE(48000,28);head.writeUInt16LE(2,32);head.writeUInt16LE(16,34);head.write('data',36);head.writeUInt32LE(pcm.length,40);
   const key=hash({format:'pcm24-v1',parts:parts.map(p=>p.url)});fs.writeFileSync(path.join(cache,key+'.wav'),Buffer.concat([head,pcm]));return {url:'/tts/audio/'+key+'.wav',segments:segments.length,cached:parts.every(p=>p.cached)};
  }finally{messageBusy=false;}
 }
 function importVoice(data){const name=String(data.name||'').toLowerCase().replace(/[^a-z0-9_-]/g,'').slice(0,60);if(!name)throw Error('Choose a voice name');const buf=Buffer.from(String(data.base64||''),'base64');if(buf.length<1000||buf.length>12000000||buf.toString('ascii',0,4)!=='RIFF'||buf.toString('ascii',8,12)!=='WAVE')throw Error('Import a WAV sample up to 12 MB');if(busy||messageBusy)throw Error('Wait for speech before replacing a sample');stop();fs.writeFileSync(path.join(voices,name+'.wav'),buf);return status();}
 function removeVoice(data){const name=String(data.name||'');if(!/^[a-z0-9_-]+\.wav$/.test(name))throw Error('Invalid voice');fs.rmSync(path.join(voices,name),{force:true});return status();}
 function readAudio(url){if(!/^\/tts\/audio\/[a-f0-9]{32}\.wav$/.test(url))return null;const f=path.join(cache,path.basename(url));return fs.existsSync(f)?f:null;}
 return {splitSpeech,status,configure,installEngine,setup,cancelInstall,downloadModel,cancelModelDownload,speak,speakMessage,saveProfile,deleteProfile,importVoice,removeVoice,readAudio,stop};
}
module.exports={createTTS,splitSpeech,capabilities,planSpeech};
