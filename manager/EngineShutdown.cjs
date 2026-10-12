// Graceful termination for Hero Tavern-owned KoboldCpp instances.
// Onefile PyInstaller needs its shutdown path to clean extracted CUDA DLLs.
'use strict';
const {spawn}=require('node:child_process');
const active=new WeakMap();
function shutdown(child,port,{graceMs=18000,log=()=>{}}={}){
 if(!child||!child.pid)return Promise.resolve({exited:true});
 if(active.has(child))return active.get(child);
 const result=new Promise(resolve=>{
  let completed=false;
  const finish=(value)=>{if(completed)return;completed=true;clearTimeout(timer);resolve(value)};
  const onExit=()=>finish({exited:true,graceful:true});
  child.once('exit',onExit);
  const fallback=()=>{
   if(completed||child.exitCode!==null)return;
   log('KoboldCpp shutdown timeout; emergency fallback PID '+child.pid+'. PyInstaller temp may survive.');
   if(process.platform==='win32')spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
   else child.kill('SIGKILL');
   setTimeout(()=>finish({exited:child.exitCode!==null,graceful:false}),1500).unref?.();
  };
  const timer=setTimeout(fallback,graceMs);
  timer.unref?.();
  // Only loopback and a process Hero Tavern itself spawned.
  fetch('http://127.0.0.1:'+port+'/api/extra/shutdown',{method:'POST',signal:AbortSignal.timeout(2500)})
   .then(r=>{if(!r.ok)log('KoboldCpp shutdown API HTTP '+r.status+' on '+port)})
   .catch(e=>log('KoboldCpp shutdown API unavailable on '+port+': '+e.message));
 });
 active.set(child,result);result.finally(()=>active.delete(child));
 return result;
}
module.exports={shutdown};