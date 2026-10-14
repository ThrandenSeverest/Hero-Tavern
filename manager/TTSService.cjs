// Local, on-demand TTS process manager. No network listener and no ambient shell.
'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process'),{createHash}=require('node:crypto');
function splitSpeech(raw,{speaker='Character',narrator='Narrator'}={}){
 const text=String(raw||'').replace(/<think>[\s\S]*?<\/think>/gi,'').replace(/<[^>]*>/g,' ').slice(0,12000);
 const segments=[];let buffer='',kind='narration',quote=false,action=false;
 const push=()=>{const t=buffer.replace(/\s+/g,' ').trim();if(t)for(const part of t.match(/.{1,400}(?:\s|$)|.{1,400}/g)||[])segments.push({kind,speaker:kind==='dialogue'?speaker:narrator,text:part.trim()});buffer='';};
 for(let i=0;i<text.length;i++){
  const ch=text[i];if(ch==='*'&&text[i+1]!=='*'&&text[i-1]!=='*'){push();action=!action;kind=quote&&!action?'dialogue':'narration';continue;}
  if((ch==='"'||ch==='“'||ch==='”'||ch==='«'||ch==='»')&&!action){push();quote=!quote;kind=quote?'dialogue':'narration';continue;}
  buffer+=ch;
 }
 push();return segments.filter(x=>x.text);
}
function createTTS(root){
 const file=path.join(root,'tts-settings.json');let settings={engine:'flash',variant:'custom-0.6',device:'cpu',language:'Auto',speaker:'Ryan',narratorSpeaker:'Ryan',enabled:false,autoPlay:false,dialogueReference:'',narratorReference:'',referenceText:'',narratorReferenceText:'',style:''};
 try{settings={...settings,...JSON.parse(fs.readFileSync(file,'utf8'))}}catch{}
 let child=null,pending=new Map(),sequence=0,install=null,installOutput='',fault='',busy=false,downloader=null,downloadOutput='',downloadError='',downloadKind='';
 let installStage='idle',installStartedAt=0,installChangedAt=0,downloadStartedAt=0,downloadChangedAt=0,setupRequested=null;
 let diskCache={at:0,bytes:0,files:0},lastSynthesis=null;
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
 const executable=()=>{const dir=path.join(root,'TTSRuntime',settings.engine);return process.platform==='win32'?path.join(dir,'Scripts','python.exe'):path.join(dir,'bin','python');};
 const weightsDir=(engine,variant)=>path.join(root,'TTSModels',engine,engine==='flash'?'flash':variant);
 const installedWeight=(engine,variant)=>fs.existsSync(path.join(weightsDir(engine,variant),'.hero-downloaded'));
 const currentKind=()=>settings.engine==='flash'?'flash':settings.variant;
 const status=()=>{
  const ready=fs.existsSync(executable())&&fs.existsSync(path.join(root,'TTSRuntime',settings.engine,'.installed'));
  const weightsReady=installedWeight(settings.engine,settings.variant);
  const storage=downloader?bytesOnDisk(weightsDir(settings.engine,settings.variant)):{bytes:0,files:0};
  return {settings,ready,weightsReady,downloadedModels:{flash:installedWeight('flash','flash'),...Object.fromEntries(['custom-0.6','custom-1.7','clone-0.6','clone-1.7','design-1.7'].map(variant=>[variant,installedWeight('qwen',variant)]))},
   running:!!child,busy,installing:!!install,installStage,installStartedAt,installChangedAt,
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
   downloadOutput='Starting '+(engine==='flash'?'Chatterbox Flash':'Qwen3-TTS '+variant)+' model download…';downloadStartedAt=Date.now();downloadChangedAt=downloadStartedAt;diskCache.at=0;
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

 const configure=next=>{if(!next||typeof next!=='object')throw Error('Invalid voice settings');const previous=settings.engine;const updated={...settings};for(const key of ['engine','variant','device','language','speaker','narratorSpeaker','enabled','autoPlay','dialogueReference','narratorReference','referenceText','narratorReferenceText','style'])if(next[key]!==undefined)updated[key]=next[key];if(!['flash','qwen'].includes(updated.engine))throw Error('Choose Flash or Qwen3-TTS');if(!['cpu','cuda'].includes(updated.device))throw Error('Invalid device');if(!['custom-0.6','custom-1.7','clone-0.6','clone-1.7','design-1.7'].includes(updated.variant))throw Error('Invalid Qwen3 variant');for(const key of ['speaker','narratorSpeaker','language','dialogueReference','narratorReference','referenceText','narratorReferenceText','style'])if(typeof updated[key]!=='string'||updated[key].length>1200)throw Error('Invalid voice setting');for(const key of ['enabled','autoPlay'])if(typeof updated[key]!=='boolean')throw Error('Invalid playback setting');if((install||downloader||setupRequested)&&(settings.engine!==updated.engine||settings.variant!==updated.variant))throw Error('Wait for the current voice installation or cancel the download before selecting another model.');settings=updated;fs.writeFileSync(file,JSON.stringify(settings,null,2));if(previous!==settings.engine)stop();return status();};
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
   const packages=engine==='flash'?['chatterbox-flash','huggingface_hub']:['qwen-tts','soundfile','huggingface_hub'];
   const command=isWindows?path.join(root,'TTSRuntime','uv.exe'):pythonExe;
   // uv pip directly manages environments without needing "python -m pip".
   const args=isWindows?['pip','install','--python',pythonExe,'--upgrade',...packages]:['-m','pip','install','--upgrade',...packages];
   runChild(command,args,'packages',()=>{
    if(engine!=='flash'){done();return;}
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
 function start(){if(child)return child;if(!fs.existsSync(executable()))throw Error('Install the selected TTS engine first in Voices settings.');if(!installedWeight(settings.engine,settings.variant))throw Error('Download the selected TTS model weights in Voice Models first.');
  const script=path.join(root,'TTSWorker.py');child=spawn(executable(),['-u',script],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONUNBUFFERED:'1'}});fault='';
  let buffer='';child.stdout.on('data',d=>{buffer+=d.toString();let n;while((n=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,n);buffer=buffer.slice(n+1);try{const item=JSON.parse(line),p=pending.get(item.id);if(!p)continue;pending.delete(item.id);item.ok?p.resolve(item):p.reject(Error(item.error||'Speech synthesis failed'));}catch(e){fault=e.message}}});
  child.stderr.on('data',d=>{const s=d.toString();if(/Traceback|Error:|CUDA out of memory/i.test(s))fault=s.slice(-600)});
  child.on('error',e=>{fault=e.message;stop()});child.on('exit',()=>{child=null;for(const p of pending.values())p.reject(Error('Speech engine exited. '+fault));pending.clear()});return child;
 }
 function call(task){const proc=start(),id=++sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('TTS timed out'))},180000);pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v)},reject:e=>{clearTimeout(timer);reject(e)}});proc.stdin.write(JSON.stringify({id,type:'generate',...task})+'\n');});}
 const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0,32);
 async function speak(input){if(busy)throw Error('TTS busy. Wait for playback generation.');if(typeof input?.text!=='string'||!input.text.trim()||input.text.length>600)throw Error('Speech text must be 1–600 characters');busy=true;
  try{const engine=input.engine||settings.engine;if(engine!==settings.engine)throw Error('Select the desired TTS engine first');
   const reference=input.reference||settings.dialogueReference||'';if(reference&&!/^[a-z0-9_-]+\.wav$/i.test(reference))throw Error('Invalid reference voice');const ref=reference?path.join(voices,reference):'';
   if(ref&&!fs.existsSync(ref))throw Error('Reference WAV not found');const task={engine,variant:input.variant||settings.variant,modelPath:weightsDir(settings.engine,settings.variant),device:settings.device,text:input.text,language:input.language||settings.language,speaker:input.speaker||settings.speaker,style:String(input.style||settings.style||'').slice(0,500),reference:ref,referenceText:String(input.referenceText||settings.referenceText||'').slice(0,1000)};
   const key=hash(task),dest=path.join(cache,key+'.wav');if(fs.existsSync(dest)&&fs.statSync(dest).size>44){lastSynthesis={engine:task.engine,variant:task.variant,at:new Date().toISOString(),cached:true};return {url:'/tts/audio/'+key+'.wav',cached:true};}
   const result=await call(task),bytes=Buffer.from(result.audio,'base64');if(bytes.length<44||bytes.subarray(0,4).toString()!=='RIFF'||bytes.length>18000000)throw Error('Invalid WAV from speech engine');fs.writeFileSync(dest,bytes);lastSynthesis={engine:task.engine,variant:task.variant,at:new Date().toISOString(),cached:false};return {url:'/tts/audio/'+key+'.wav',cached:false};
  }finally{busy=false;}
 }
 function importVoice(data){const name=String(data.name||'').toLowerCase().replace(/[^a-z0-9_-]/g,'').slice(0,60);if(!name)throw Error('Choose a voice name');const buf=Buffer.from(String(data.base64||''),'base64');if(buf.length<1000||buf.length>12000000||buf.toString('ascii',0,4)!=='RIFF'||buf.toString('ascii',8,12)!=='WAVE')throw Error('Import a WAV sample up to 12 MB');fs.writeFileSync(path.join(voices,name+'.wav'),buf);return status();}
 function removeVoice(data){const name=String(data.name||'');if(!/^[a-z0-9_-]+\.wav$/.test(name))throw Error('Invalid voice');fs.rmSync(path.join(voices,name),{force:true});return status();}
 function readAudio(url){if(!/^\/tts\/audio\/[a-f0-9]{32}\.wav$/.test(url))return null;const f=path.join(cache,path.basename(url));return fs.existsSync(f)?f:null;}
 return {splitSpeech,status,configure,installEngine,setup,cancelInstall,downloadModel,cancelModelDownload,speak,importVoice,removeVoice,readAudio,stop};
}
module.exports={createTTS,splitSpeech};
