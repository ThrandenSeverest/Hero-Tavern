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
 return relative!==''&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);
}
function createDiskCare(root){
 const downloads=path.join(root,'Downloads'),transactions=path.join(root,'Story','transactions'),logs=path.join(root,'Logs');
 const categories=[
  ['Models',path.join(root,'Models')],['Image models',path.join(root,'ImageModels')],
  ['Generated images',path.join(root,'Images')],['Chat data',path.join(root,'SillyTavern','data')],
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
 function report(){
  const items=safeItems();
  let freeBytes=null;try{const s=fs.statfsSync(root);freeBytes=s.bavail*s.bsize}catch{}
  return {categories:categories.map(([name,target])=>({name,bytes:bytesAt(target)})),cleanupItems:items,reclaimableBytes:items.reduce((v,x)=>v+x.bytes,0),freeBytes,
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
 return {report,cleanup};
}
module.exports={createDiskCare,bytesAt};
if(require.main===module){
  const root=process.argv[2];
  if(!root)throw Error('Pass the installed Hero Tavern directory.');
  const result=createDiskCare(root).cleanup({confirm:true});
  process.stdout.write('Completed Hero Tavern temporary cleanup: '+result.freedBytes+' bytes; '+result.errors.length+' warnings.\n');
}
