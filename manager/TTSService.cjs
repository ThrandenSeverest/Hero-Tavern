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
 let child=null,pending=new Map(),sequence=0,install=null,installOutput='',fault='',busy=false;
 const voices=path.join(root,'Voices'),cache=path.join(root,'TTSCache');fs.mkdirSync(voices,{recursive:true});fs.mkdirSync(cache,{recursive:true});
 const executable=()=>{const dir=path.join(root,'TTSRuntime',settings.engine);return process.platform==='win32'?path.join(dir,'Scripts','python.exe'):path.join(dir,'bin','python');};
 const status=()=>({settings,ready:fs.existsSync(executable())&&fs.existsSync(path.join(root,'TTSRuntime',settings.engine,'.installed')),running:!!child,busy,installing:!!install,installOutput:installOutput.slice(-5000),error:fault,voices:fs.readdirSync(voices).filter(x=>/^[a-z0-9_-]+\.wav$/i.test(x))});
 const stop=()=>{if(child){child.kill();child=null;}for(const p of pending.values())p.reject(Error('Speech engine stopped'));pending.clear();};
 const configure=next=>{if(!next||typeof next!=='object')throw Error('Invalid voice settings');const previous=settings.engine;const updated={...settings};for(const key of ['engine','variant','device','language','speaker','narratorSpeaker','enabled','autoPlay','dialogueReference','narratorReference','referenceText','narratorReferenceText','style'])if(next[key]!==undefined)updated[key]=next[key];if(!['flash','qwen'].includes(updated.engine))throw Error('Choose Flash or Qwen3-TTS');if(!['cpu','cuda'].includes(updated.device))throw Error('Invalid device');if(!['custom-0.6','custom-1.7','clone-0.6','clone-1.7','design-1.7'].includes(updated.variant))throw Error('Invalid Qwen3 variant');for(const key of ['speaker','narratorSpeaker','language','dialogueReference','narratorReference','referenceText','narratorReferenceText','style'])if(typeof updated[key]!=='string'||updated[key].length>1200)throw Error('Invalid voice setting');for(const key of ['enabled','autoPlay'])if(typeof updated[key]!=='boolean')throw Error('Invalid playback setting');settings=updated;fs.writeFileSync(file,JSON.stringify(settings,null,2));if(previous!==settings.engine)stop();return status();};
 const installEngine=()=>{if(install)throw Error('Installation already running');if(child)stop();const target=path.join(root,'TTSRuntime',settings.engine);fs.mkdirSync(path.dirname(target),{recursive:true});
  // Use an explicit Python executable. pip installation is isolated from KoboldCpp and ComfyUI.
  const python=process.env.HERO_TTS_PYTHON||'python';const engine=settings.engine;installOutput='Creating isolated Python environment…';fault='';
  if(process.platform==='win32'&&!process.env.HERO_TTS_PYTHON){
   // Portable uv downloads managed Python 3.11; never requires a system Python or Git.
   const ps="$ErrorActionPreference='Stop'; $dir=$env:HERO_TTS_RUNTIME; New-Item -ItemType Directory -Force $dir | Out-Null; $uv=Join-Path $dir 'uv.exe'; if(-not (Test-Path $uv)){ $zip=Join-Path $dir 'uv.zip'; $unpack=Join-Path $dir 'uv-package'; Invoke-WebRequest -Uri 'https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip' -OutFile $zip -UseBasicParsing; Expand-Archive -Path $zip -DestinationPath $unpack -Force; $exe=Get-ChildItem -LiteralPath $unpack -Recurse -Filter uv.exe | Select-Object -First 1; if(-not $exe){throw 'uv.exe missing from official archive'}; Copy-Item $exe.FullName $uv -Force; Remove-Item $zip -Force; Remove-Item $unpack -Recurse -Force }; $env:UV_PYTHON_INSTALL_DIR=Join-Path $dir 'python'; & $uv python install 3.11; if($LASTEXITCODE -ne 0){throw 'Portable Python download failed'}; & $uv venv $env:HERO_TTS_TARGET --python 3.11 --python-preference only-managed; if($LASTEXITCODE -ne 0){throw 'Creating TTS environment failed'}";
   install=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',ps],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,HERO_TTS_RUNTIME:path.join(root,'TTSRuntime'),HERO_TTS_TARGET:target}});
  }else install=spawn(python,['-m','venv',target],{windowsHide:true,stdio:['ignore','pipe','pipe']});const current=install;
  const log=x=>{installOutput+=(x.toString());installOutput=installOutput.slice(-12000)};current.stdout.on('data',log);current.stderr.on('data',log);
  current.on('error',e=>{fault='Python unavailable: '+e.message;install=null});
  current.on('close',code=>{if(install!==current)return;if(code!==0){fault='Python environment creation failed: '+installOutput;install=null;return;}
   installOutput+='\nInstalling '+engine+' dependencies…';const pip=process.platform==='win32'?path.join(target,'Scripts','python.exe'):path.join(target,'bin','python');
   const packages=engine==='flash'?['chatterbox-flash']:['qwen-tts','soundfile'];
   const args=['-m','pip','install','--upgrade',...packages];install=spawn(pip,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});const pkg=install;pkg.stdout.on('data',log);pkg.stderr.on('data',log);
   pkg.on('error',e=>{fault='Dependency installation failed: '+e.message;install=null});pkg.on('close',c=>{if(install!==pkg)return;if(c){fault='TTS dependency installation failed; check log and compatible PyTorch CUDA wheels.';install=null;return;}
    if(engine==='flash'){
     installOutput+='\nApplying PyTorch 2.7 CUDA 12.8 compatibility for RTX 5070…';
     const args=['-m','pip','install','--upgrade','torch==2.7.1','torchaudio==2.7.1','torchvision==0.22.1','--index-url','https://download.pytorch.org/whl/cu128'];
     install=spawn(pip,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});const gpu=install;gpu.stdout.on('data',log);gpu.stderr.on('data',log);gpu.on('error',e=>{fault='CUDA dependencies failed: '+e.message;install=null});gpu.on('close',result=>{if(install!==gpu)return;if(result)fault='Compatible RTX 5070 PyTorch installation failed; inspect installer output.';else fs.writeFileSync(path.join(target,'.installed'),new Date().toISOString());install=null;});return;
    }
    fs.writeFileSync(path.join(target,'.installed'),new Date().toISOString());install=null;});
  });return status();
 };
 function start(){if(child)return child;if(!fs.existsSync(executable()))throw Error('Install the selected TTS engine first in Voices settings.');
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
   if(ref&&!fs.existsSync(ref))throw Error('Reference WAV not found');const task={engine,variant:input.variant||settings.variant,device:settings.device,text:input.text,language:input.language||settings.language,speaker:input.speaker||settings.speaker,style:String(input.style||settings.style||'').slice(0,500),reference:ref,referenceText:String(input.referenceText||settings.referenceText||'').slice(0,1000)};
   const key=hash(task),dest=path.join(cache,key+'.wav');if(fs.existsSync(dest))return {url:'/tts/audio/'+key+'.wav',cached:true};
   const result=await call(task),bytes=Buffer.from(result.audio,'base64');if(bytes.length<44||bytes.subarray(0,4).toString()!=='RIFF'||bytes.length>18000000)throw Error('Invalid WAV from speech engine');fs.writeFileSync(dest,bytes);return {url:'/tts/audio/'+key+'.wav',cached:false};
  }finally{busy=false;}
 }
 function importVoice(data){const name=String(data.name||'').toLowerCase().replace(/[^a-z0-9_-]/g,'').slice(0,60);if(!name)throw Error('Choose a voice name');const buf=Buffer.from(String(data.base64||''),'base64');if(buf.length<1000||buf.length>12000000||buf.toString('ascii',0,4)!=='RIFF'||buf.toString('ascii',8,12)!=='WAVE')throw Error('Import a WAV sample up to 12 MB');fs.writeFileSync(path.join(voices,name+'.wav'),buf);return status();}
 function removeVoice(data){const name=String(data.name||'');if(!/^[a-z0-9_-]+\.wav$/.test(name))throw Error('Invalid voice');fs.rmSync(path.join(voices,name),{force:true});return status();}
 function readAudio(url){if(!/^\/tts\/audio\/[a-f0-9]{32}\.wav$/.test(url))return null;const f=path.join(cache,path.basename(url));return fs.existsSync(f)?f:null;}
 return {splitSpeech,status,configure,installEngine,speak,importVoice,removeVoice,readAudio,stop};
}
module.exports={createTTS,splitSpeech};
