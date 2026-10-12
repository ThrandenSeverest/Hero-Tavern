// Storage diagnostics and conservative cleanup. Nothing in Models, ImageModels,
// Images, Story sessions, Memories, AdventureSaves or SillyTavern/data is ever deleted.
'use strict';
const fs=require('node:fs'),path=require('node:path');
function bytesAt(target){
 if(!fs.existsSync(target))return 0;
 let stat;try{stat=fs.lstatSync(target)}catch{return 0}
 if(stat.isSymbolicLink())return 0;
 if(stat.isFile())return stat.size;
 if(!stat.isDirectory())return 0;
 let bytes=0;
 for(const d of fs.readdirSync(target,{withFileTypes:true})){
   if(d.isSymbolicLink())continue;
   bytes+=bytesAt(path.join(target,d.name));
 }
 return bytes;
}
function isWithin(root,file){
 const relative=path.relative(root,file);
 if(relative===''||relative.startsWith('..'+path.sep)||relative==='..'||path.isAbsolute(relative))return false;
 // Check canonical paths too: a symlinked Downloads or transactions parent
 // must never allow cleanup to escape the installed application root.
 try{
  const base=fs.realpathSync(root),target=fs.realpathSync(file);
  const rel=path.relative(base,target);
  return !!rel&&rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel);
 }catch{return false;}
}
function createDiskCare(root){
 const downloads=path.join(root,'Downloads'),transactions=path.join(root,'Story','transactions'),logs=path.join(root,'Logs');
 let diskBaseline=null;
 const categories=[
  ['Models',path.join(root,'Models')],['Image models',path.join(root,'ImageModels')],
  ['Generated images',path.join(root,'Images')],['KoboldCpp extraction cache',path.join(root,'Cache','KoboldCpp')],['Chat data',path.join(root,'SillyTavern','data')],
  ['Story and transaction data',path.join(root,'Story')],['Adventure saves',path.join(root,'AdventureSaves')],
  ['Downloads',downloads],['Logs',logs],['Node dependencies',path.join(root,'SillyTavern','node_modules')],
  ['npm cache',path.join(process.env.LOCALAPPDATA||root,'npm-cache')]
 ];
 function safeItems(){
  const result=[];
  const add=(target,reason)=>{
   if(!isWithin(root,target))return;
   try{if(!fs.existsSync(target)||fs.lstatSync(target).isSymbolicLink())return;
     const bytes=bytesAt(target);if(bytes>0)result.push({id:result.length,path:target,relative:path.relative(root,target),reason,bytes});
   }catch{}
  };
  // Verified one-use setup archives; never touch .part downloads.
  if(fs.existsSync(downloads)){
   for(const d of fs.readdirSync(downloads,{withFileTypes:true})){
     if(d.isFile()&&(d.name==='SillyTavern-release.zip'||/^node-v[\d.]+-win-x64\.zip$/i.test(d.name)))add(path.join(downloads,d.name),'Completed installer archive');
     if(d.isDirectory()&&d.name==='ST-extracted'&&fs.existsSync(path.join(root,'SillyTavern','server.js')))add(path.join(downloads,d.name),'Completed setup extraction');
   }
  }
  // Only committed journals are disposable. Prepared/recovered/rolled-back are left for audit.
  if(fs.existsSync(transactions))for(const d of fs.readdirSync(transactions,{withFileTypes:true})){
   if(!d.isDirectory()||!/^[a-f0-9-]{36}$/i.test(d.name))continue;
   const folder=path.join(transactions,d.name),journal=path.join(folder,'journal.json');
   try{if(fs.lstatSync(folder).isSymbolicLink()||!fs.statSync(journal).isFile())continue;
     const j=JSON.parse(fs.readFileSync(journal,'utf8'));
     if(j.status==='committed'&&Array.isArray(j.entries))add(folder,'Completed story transaction backup');
   }catch{}
  }
  return result;
 }

 function fileActivity({limit=80}={}){
  const watched=[
   ['Generated images',path.join(root,'Images')],
   ['Image models',path.join(root,'ImageModels')],
   ['Text models',path.join(root,'Models')],
   ['Downloads',path.join(root,'Downloads')],
   ['Logs',path.join(root,'Logs')],
   ['Diagnostics',path.join(root,'Diagnostics')],
   ['ComfyUI file transfers',path.join(root,'Logs','image-files.jsonl')]
  ];
  const out=[];
  for(const [category,target] of watched){
   if(!fs.existsSync(target))continue;
   const names=fs.statSync(target).isDirectory()?fs.readdirSync(target).slice(-1500).map(n=>path.join(target,n)):[target];
   for(const file of names){
    try{
     const stat=fs.lstatSync(file);
     if(!stat.isFile()||stat.isSymbolicLink()||stat.isDirectory())continue;
     out.push({category,path:file,size:stat.size,modified:stat.mtime.toISOString()});
    }catch{}
   }
  }
  return out.sort((a,b)=>b.modified.localeCompare(a.modified)).slice(0,Math.min(200,Math.max(1,Number(limit)||80)));
 }
 function externalCacheReport(){
  const local=process.env.LOCALAPPDATA||'';
  const temp=process.env.TEMP||process.env.TMP||'';
  const result={};
  if(local){
   for(const [name,p] of [['NVIDIA DXCache',path.join(local,'NVIDIA','DXCache')],['npm download cache',path.join(local,'npm-cache')]]){
    try{result[name]={path:p,bytes:bytesAt(p)}}catch(e){result[name]={path:p,error:e.message}}
   }
  }
  if(temp){
   // Inventory: never assume all _MEI folders belong to Hero Tavern.
   let confirmed=0,count=0,possible=0;
   try{
    for(const entry of fs.readdirSync(temp,{withFileTypes:true})){
     if(!entry.isDirectory()||!/^_MEI\d+$/.test(entry.name))continue;
     const p=path.join(temp,entry.name);
     if(fs.lstatSync(p).isSymbolicLink())continue;
     const files=fs.readdirSync(p);
     const owned=files.some(n=>/^koboldcpp_(?:cublas|vulkan).*\.dll$/i.test(n));
     if(owned){count++;confirmed+=bytesAt(p)}else possible++;
    }
    result['KoboldCpp temp candidates']={path:temp,bytes:confirmed,count,unknownFolders:possible,cleanupAllowed:false,note:'These are identification candidates, not proven Hero Tavern-owned. No automatic deletion.'};
   }catch(e){result['KoboldCpp temp candidates']={path:temp,error:e.message}}
  }
  return result;
 }


 const runtimeRoot=path.join(root,'Cache','KoboldCpp');
 function runtimeCandidates(){
  const found=[],now=Date.now();
  for(const role of ['text','image','thinking']){
   const parent=path.join(runtimeRoot,role);
   try{
    if(!fs.existsSync(parent)||fs.lstatSync(parent).isSymbolicLink()||!fs.statSync(parent).isDirectory())continue;
    const parentReal=fs.realpathSync(parent);
    for(const name of fs.readdirSync(parent)){
     if(!/^_MEI\d+$/.test(name))continue;
     const dir=path.join(parent,name);
     try{
      const st=fs.lstatSync(dir);
      if(!st.isDirectory()||st.isSymbolicLink()||now-st.mtimeMs<15*60*1000)continue;
      if(path.dirname(fs.realpathSync(dir))!==parentReal)continue;
      const filenames=fs.readdirSync(dir);
      if(!filenames.some(x=>/^koboldcpp_(?:cublas|vulkan).*\.dll$/i.test(x)))continue;
      // Never traverse a directory containing a symbolic link/junction.
      let unsafe=false,checked=0;
      const scan=p=>{for(const n of fs.readdirSync(p)){if(++checked>20000){unsafe=true;return}const target=path.join(p,n),v=fs.lstatSync(target);if(v.isSymbolicLink()){unsafe=true;return}if(v.isDirectory())scan(target);if(unsafe)return}};
      scan(dir);if(unsafe)continue;
      found.push({role,path:dir,bytes:bytesAt(dir),ageMinutes:Math.floor((now-st.mtimeMs)/60000)});
     }catch{}
    }
   }catch{}
  }
  return found;
 }
 function cleanRuntime({confirm=false,enginesStopped=false}={}){
  if(confirm!==true)throw Error('Explicit confirmation required to remove owned runtime extraction files.');
  if(enginesStopped!==true)throw Error('All Hero Tavern engines must be stopped first.');
  if(process.platform==='win32'){
   const {execFileSync}=require('node:child_process');
   const output=execFileSync('tasklist.exe',['/FI','IMAGENAME eq koboldcpp.exe','/FO','CSV','/NH'],{encoding:'utf8',timeout:5000,windowsHide:true});
   if(/"?koboldcpp\.exe"?/i.test(output))throw Error('KoboldCpp is still running; cannot clean extracted runtime.');
  }else throw Error('Runtime cleanup is enabled only for Windows installations.');
  const before=fs.statfsSync(root),items=runtimeCandidates(),removed=[],errors=[];
  for(const item of items){
   try{
    if(!isWithin(runtimeRoot,item.path))continue;
    fs.rmSync(item.path,{recursive:true,force:false,maxRetries:0});
    removed.push(item.path);
   }catch(e){errors.push({path:item.path,error:e.message})}
  }
  const after=fs.statfsSync(root);
  return {removed,errors,estimatedBytes:items.filter(x=>removed.includes(x.path)).reduce((v,x)=>v+x.bytes,0),
    freeBytesChange:(after.bavail*after.bsize)-(before.bavail*before.bsize)};
 }

 function report(){
  const items=safeItems();
  let freeBytes=null;try{const s=fs.statfsSync(root);freeBytes=s.bavail*s.bsize}catch{}
  if(diskBaseline===null&&freeBytes!==null)diskBaseline=freeBytes;
  const sessionFreeChange=freeBytes===null||diskBaseline===null?null:freeBytes-diskBaseline;
  return {sessionFreeChange,storageWarning:sessionFreeChange!==null&&sessionFreeChange< -1073741824?'More than 1 GiB of free disk space disappeared during this app session. Inspect recent file activity and engine temp.':null,categories:categories.map(([name,target])=>({name,bytes:bytesAt(target)})),fileActivity:fileActivity(),externalCaches:externalCacheReport(),runtimeCandidates:runtimeCandidates(),cleanupItems:items,reclaimableBytes:items.reduce((v,x)=>v+x.bytes,0),freeBytes,
   note:'Only completed installer archives and committed transaction backups are eligible. Models, user images, chats, saves, npm cache and in-progress downloads are protected.'};
 }
 function cleanup({confirm=false}={}){
  if(confirm!==true)throw Error('Explicit confirmation is required before clearing temporary files.');
  // Re-enumerate on each request; do not trust client-supplied paths.
  const items=safeItems();let freedBytes=0;const removed=[],errors=[];
  for(const item of items){
   try{
    if(fs.lstatSync(item.path).isSymbolicLink()||!isWithin(root,item.path))continue;
    // Confirm journal again in case a transaction changed since scan.
    if(item.reason==='Completed story transaction backup'){
      const j=JSON.parse(fs.readFileSync(path.join(item.path,'journal.json'),'utf8'));
      if(j.status!=='committed')continue;
    }
    // Never remove setup archives unless the installed runtime & ST both exist.
    if(item.reason!=='Completed story transaction backup'){
      const exeDir=path.join(root,'Runtime');
      if(!fs.existsSync(path.join(root,'SillyTavern','server.js'))||!fs.existsSync(exeDir)||!fs.readdirSync(exeDir).length)continue;
    }
    fs.rmSync(item.path,{recursive:true,force:true,maxRetries:2});
    freedBytes+=item.bytes;removed.push(item.relative);
   }catch(e){errors.push({item:item.relative,error:e.message})}
  }
  return {freedBytes,removed,errors,report:report()};
 }
 function clearNpmCache({confirm=false}={}){
  if(confirm!==true)throw Error('Explicit consent required: npm cache can be shared with other applications.');
  const local=process.env.LOCALAPPDATA;
  if(!local)throw Error('LOCALAPPDATA is unavailable; npm cache not located.');
  const cache=path.join(local,'npm-cache');
  if(!fs.existsSync(cache))return {freedBytes:0,skipped:true};
  if(fs.lstatSync(cache).isSymbolicLink()||!fs.statSync(cache).isDirectory())throw Error('Refusing unexpected npm cache path.');
  if(path.dirname(fs.realpathSync(cache))!==fs.realpathSync(local))throw Error('Refusing npm cache outside LOCALAPPDATA.');
  const amount=bytesAt(cache);
  // Node/npm package cache only: installed packages under node_modules are untouched.
  fs.rmSync(cache,{recursive:true,force:true,maxRetries:2});
  return {freedBytes:amount,skipped:false};
 }
 return {report,cleanup,clearNpmCache,fileActivity,externalCacheReport,runtimeCandidates,cleanRuntime};
}
module.exports={createDiskCare,bytesAt};
if(require.main===module){
  const root=process.argv[2];
  if(!root)throw Error('Pass the installed Hero Tavern directory.');
  const result=createDiskCare(root).cleanup({confirm:true});
  process.stdout.write('Completed Hero Tavern temporary cleanup: '+result.freedBytes+' bytes; '+result.errors.length+' warnings.\n');
}
