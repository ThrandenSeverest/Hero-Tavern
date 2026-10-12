// Existing generated PNGs remain the source of truth. Sidecars are optional.
'use strict';
const fs=require('node:fs'),path=require('node:path');
const NAME=/^\d{12,17}-[a-f0-9]{8,24}\.png$/;
function createImageGallery(root){
 const dir=path.join(root,'Images');fs.mkdirSync(dir,{recursive:true});
 function valid(name){if(typeof name!=='string'||!NAME.test(name))throw Error('Invalid gallery image filename.');const file=path.join(dir,name);if(fs.existsSync(file)&&fs.lstatSync(file).isSymbolicLink())throw Error('Gallery symlinks are not allowed.');return file;}
 function metadata(name){
  const file=valid(name),base={name,url:'/images/output/'+name,createdAt:fs.existsSync(file)?fs.statSync(file).mtimeMs:0};
  for(const suffix of ['.json','.studio.json']){
   const sidecar=file+suffix;
   if(fs.existsSync(sidecar)&&!fs.lstatSync(sidecar).isSymbolicLink()){
    try{const x=JSON.parse(fs.readFileSync(sidecar,'utf8'));if(x&&typeof x==='object'){
     for(const key of ['model','prompt','negative_prompt','originalPrompt','refinedPrompt','preset','seed','width','height','steps','cfg_scale','sampler_name','refinementWarning','favorite','tags'])if(x[key]!==undefined)base[key]=x[key];
     if(x.parameters&&typeof x.parameters==='object')for(const key of ['prompt','seed','width','height','steps','cfg_scale','negative_prompt','sampler_name'])if(x.parameters[key]!==undefined)base[key]=x.parameters[key];
    }}catch{}
   }
  }
  return base;
 }
 function list({search='',favorites=false,limit=100}={}){
  const names=fs.readdirSync(dir).filter(n=>NAME.test(n)&&fs.statSync(path.join(dir,n)).isFile()).sort().reverse();
  let items=names.map(metadata);
  if(favorites)items=items.filter(i=>i.favorite);
  if(search){const q=String(search).slice(0,100).toLowerCase();items=items.filter(x=>[x.name,x.model,x.prompt,x.originalPrompt,x.preset].some(t=>String(t||'').toLowerCase().includes(q)));}
  return {total:items.length,items:items.slice(0,Math.min(200,Math.max(1,Number(limit)||100)))};
 }
 function favorite({name,value}){
  const file=valid(name);if(!fs.existsSync(file))throw Error('Image does not exist.');
  const sidecar=file+'.studio.json';
  const obj=fs.existsSync(sidecar)?JSON.parse(fs.readFileSync(sidecar,'utf8')):{};
  obj.favorite=value===true;fs.writeFileSync(sidecar,JSON.stringify(obj,null,2));
  return metadata(name);
 }
 function remove({name,confirm=false}){
  if(confirm!==true)throw Error('Confirm image deletion explicitly.');
  const file=valid(name);if(!fs.existsSync(file))throw Error('Image does not exist.');
  fs.unlinkSync(file);
  for(const suffix of ['.json','.studio.json'])try{const side=file+suffix;if(fs.existsSync(side)&&!fs.lstatSync(side).isSymbolicLink())fs.unlinkSync(side)}catch{}
  return {deleted:true,name};
 }
 return {list,favorite,remove};
}
module.exports={createImageGallery};