'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {imagePromptHash}=require('./ImageRequest.cjs');
const PRESETS=Object.freeze({
 text2text:{label:'Text → Text',model:'loaded KoboldCpp text model',prompt:'Output exactly the following text, with no introduction or extra characters: BLUE LANTERN',expected:'BLUE LANTERN'},
 text2image:{label:'Text → Image',model:'selected image model',prompt:'A single RED ceramic teapot standing on a WHITE marble table. Bright daylight, simple clean composition, no humans, no lettering. The teapot is the only subject.',secondPrompt:'A single GREEN frog sitting in a TRANSPARENT glass bowl against a BLUE backdrop. No people, no teapot, no lettering.',width:768,height:768,steps:24,seed:-1,refine:false,preset:'raw'},
 image2image:{label:'Image → Image',model:'selected edit-capable image model',prompt:'Edit the supplied image: change the main object to vivid BLUE. Preserve the original composition, viewpoint and background; change its color clearly.',width:768,height:768,steps:24,seed:-1,denoise:0.7,refine:false,preset:'raw'},
 image2text:{label:'Image → Text',model:'loaded local vision model + projector',question:'Describe the visible main subject and its color, composition, and surroundings in two factual sentences. Do not explain your task.'}
});
const kinds=Object.keys(PRESETS);
const GALLERY=/^\d{12,17}-[a-f0-9]{8,24}\.png$/;
function imageStats(bytes){
 if(bytes.length<50||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('Output is not a valid PNG.');
 let i=8,width=0,height=0,bits=0,type=0,parts=[],palette=null;
 while(i+12<=bytes.length){
  const len=bytes.readUInt32BE(i),name=bytes.toString('ascii',i+4,i+8),end=i+12+len;
  if(end>bytes.length||len>75000000)throw Error('Malformed PNG chunk.');
  if(name==='IHDR'){width=bytes.readUInt32BE(i+8);height=bytes.readUInt32BE(i+12);bits=bytes[i+16];type=bytes[i+17];}
  if(name==='IDAT')parts.push(bytes.subarray(i+8,i+8+len));
  if(name==='PLTE')palette=bytes.subarray(i+8,i+8+len);
  i=end;if(name==='IEND')break;
 }
 if(!width||!height||width>4096||height>4096||!parts.length)throw Error('PNG has invalid dimensions or no image data.');
 const channels={0:1,2:3,3:1,4:2,6:4}[type],fingerprint=[];
 if(bits===8&&channels&&width*height*channels<77000000){
  try{
   const row=width*channels,raw=zlib.inflateSync(Buffer.concat(parts),{maxOutputLength:(row+1)*height+1024});
   if(raw.length<(row+1)*height)throw Error('PNG data incomplete.');
   const columns=8,rows=8,bins=Array.from({length:columns*rows},()=>[0,0,0,0]),prior=Buffer.alloc(row);
   let o=0;
   for(let y=0;y<height;y++){
    const filter=raw[o++],decoded=Buffer.allocUnsafe(row);
    for(let x=0;x<row;x++){
     const up=prior[x],left=x>=channels?decoded[x-channels]:0,upperLeft=x>=channels?prior[x-channels]:0;
     let predictor=0;
     if(filter===1)predictor=left;else if(filter===2)predictor=up;
     else if(filter===3)predictor=Math.floor((left+up)/2);
     else if(filter===4){const p=left+up-upperLeft,a=Math.abs(p-left),b=Math.abs(p-up),c=Math.abs(p-upperLeft);predictor=a<=b&&a<=c?left:b<=c?up:upperLeft;}
     else if(filter!==0)throw Error('Unsupported PNG filter.');
     decoded[x]=(raw[o++]+predictor)&255;
    }
    // Compute coarse spatial color fingerprint. This catches nearly identical
    // pictures despite metadata, different compression or renamed output files.
    for(let x=0;x<width;x+=Math.max(1,Math.floor(width/120))){
     let rgb;
     const k=x*channels;
     if(type===2||type===6)rgb=[decoded[k],decoded[k+1],decoded[k+2]];
     else if(type===3&&palette)rgb=[palette[decoded[k]*3]||0,palette[decoded[k]*3+1]||0,palette[decoded[k]*3+2]||0];
     else rgb=[decoded[k],decoded[k],decoded[k]];
     const box=Math.min(7,Math.floor(y*8/height))*8+Math.min(7,Math.floor(x*8/width));
     const bin=bins[box];for(let c=0;c<3;c++)bin[c]+=rgb[c];bin[3]++;
    }
    decoded.copy(prior);
   }
   for(const bin of bins)for(let k=0;k<3;k++)fingerprint.push(bin[3]?Math.round(bin[k]/bin[3]):0);
  }catch(e){return {width,height,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),decodeWarning:e.message};}
 }
 return {width,height,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),colorFingerprint:fingerprint};
}
function distance(a,b){
 if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length||!a.length)return null;
 return Math.round(a.reduce((sum,x,i)=>sum+Math.abs(x-b[i]),0)/a.length*100)/100;
}
function createModelTests(root){
 const folder=path.join(root,'Diagnostics'),journal=path.join(folder,'model-tests.json');
 fs.mkdirSync(folder,{recursive:true});
 function history(){try{const value=JSON.parse(fs.readFileSync(journal,'utf8'));return Array.isArray(value)?value.slice(-120):[]}catch{return []}}
 function record(input){
  if(!input||!kinds.includes(input.kind))throw Error('Unknown model test.');
  if(!['passed','warning','failed','skipped'].includes(input.status))throw Error('Invalid test status.');
  if(typeof input.model!=='string'||input.model.length>200)throw Error('Invalid tested model.');
  const previous=history(),entry={id:crypto.randomUUID(),at:new Date().toISOString(),kind:input.kind,model:input.model,status:input.status,elapsedMs:Number.isFinite(Number(input.elapsedMs))?Math.max(0,Math.round(Number(input.elapsedMs))):null,prompt:String(input.prompt||'').slice(0,5000),settings:input.settings&&typeof input.settings==='object'?input.settings:{},notes:Array.isArray(input.notes)?input.notes.slice(0,8).map(n=>String(n).slice(0,400)):[],text:String(input.text||'').slice(0,12000)};
  if(input.error){entry.error=String(input.error).slice(0,1500);entry.status='failed';}
  if(input.kind==='text2text'){
   if(!entry.error){
    const raw=entry.text.trim();
    if(raw!==PRESETS.text2text.expected){entry.status='warning';entry.notes.push('Expected exact text "'+PRESETS.text2text.expected+'"; received '+JSON.stringify(raw.slice(0,180))+'.');}
    else entry.notes.push('Exact instruction-following text matched.');
   }
  }
  if(input.kind==='image2text'&&!entry.text.trim()&&!entry.error){entry.status='failed';entry.notes.push('Vision model returned an empty description.');}
  if(['text2image','image2image'].includes(input.kind)&&!entry.error){
   const name=String(input.imageName||'');
   if(!GALLERY.test(name))throw Error('Model test image must be a saved Hero Tavern gallery PNG.');
   const filename=path.join(root,'Images',name),raw=fs.readFileSync(filename);
   const stats=imageStats(raw);entry.imageName=name;entry.image=stats;
   entry.promptHash=imagePromptHash(entry.prompt);
   const older=[...previous].reverse().find(x=>x.kind===input.kind&&x.model===entry.model&&x.image);
   if(older){
    const differ=older.promptHash!==entry.promptHash||older.settings?.seed!==entry.settings.seed;
    const identical=older.image.sha256===stats.sha256;
    const delta=distance(older.image.colorFingerprint,stats.colorFingerprint);
    entry.comparison={previousId:older.id,identicalBytes:identical,meanColorDifference:delta};
    if(differ&&identical){entry.status='failed';entry.notes.push('Byte-identical PNG despite a changed prompt or seed: possible stale output/cache or disconnected conditioning.');}
    else if(differ&&delta!==null&&delta<5){entry.status=entry.status==='failed'?'failed':'warning';entry.notes.push('Very similar spatial color fingerprint despite changed prompt/seed. Inspect images side-by-side for stuck conditioning.');}
   }
   if(stats.decodeWarning)entry.notes.push('PNG decode could not be fully analyzed: '+stats.decodeWarning);
   else if(stats.colorFingerprint&&new Set(stats.colorFingerprint).size<7){entry.status=entry.status==='failed'?'failed':'warning';entry.notes.push('Unusually flat/low-detail color distribution; inspect for blank output.');}
  }
  previous.push(entry);
  fs.writeFileSync(journal,JSON.stringify(previous.slice(-120),null,2));
  return entry;
 }
 return {presets:()=>PRESETS,history,record};
}
module.exports={PRESETS,imageStats,distance,createModelTests};