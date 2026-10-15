'use strict';
/**
 * Normalize a single image request before it reaches model selection, ComfyUI,
 * gallery metadata or a sampler. Editing a prior image is ALWAYS explicit.
 */
const crypto=require('node:crypto');
const MODES=new Set(['txt2img','img2img','inpaint','outpaint','upscale']);
function parseSeed(value){
 if(value===undefined||value===null||String(value).trim()===''||String(value).trim()==='-1')return -1;
 const n=Number(value);
 if(!Number.isSafeInteger(n)||n<0||n>2147483647)throw Error('Seed must be -1 (random), or an integer from 0 to 2147483647.');
 return n;
}
function normalizeImageRequest(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Invalid image request.');
 const data={...input};
 const mode=data.operation==null||data.operation===''?'txt2img':data.operation;
 if(!MODES.has(mode))throw Error('Unknown image operation.');
 data.operation=mode;
 data.seed=parseSeed(data.seed);
 const warnings=[];
 const ignored=['sourceName','maskData','denoise','outpaint','outpaintPadding'];
 if(mode==='txt2img'){
  for(const name of ignored)if(data[name]!==undefined&&data[name]!==null&&data[name]!==''&&data[name]!==false){warnings.push('Ignoring stale '+name+' for fresh text-to-image generation.');delete data[name];}
  // Reference images are opt-in on the current request, never sticky state.
  if(data.referenceName&&!data.useReference){warnings.push('Ignoring unconfirmed reference image on text-to-image request.');delete data.referenceName;}
 }
 if(mode==='img2img'||mode==='inpaint'||mode==='outpaint'||mode==='upscale'){
  if(typeof data.sourceName!=='string'||!data.sourceName.trim())throw Error('This edit requires an explicitly chosen source image.');
 }
 if(mode==='inpaint'&&(!data.maskData||typeof data.maskData!=='string'))throw Error('Inpainting requires an explicit painted mask.');
 if(mode!=='inpaint'&&data.maskData){delete data.maskData;warnings.push('Ignored mask outside inpainting.');}
 if(data.batch_size==null||data.batch_size==='')data.batch_size=1;
 if(![1,2,4].includes(Number(data.batch_size)))throw Error('Choose 1, 2 or 4 images per batch.');
 data.batch_size=Number(data.batch_size);
 if(mode!=='txt2img'&&data.batch_size!==1){data.batch_size=1;warnings.push('Image edits run one image at a time.');}
 if(data.lora==null)data.lora=[];
 if(!Array.isArray(data.lora)||data.lora.length>3)throw Error('Choose at most 3 active LoRAs.');
 if(data.modelPack&&data.modelPack.startsWith('qwen21-')){
  if(data.lora.length)throw Error('Qwen Image cannot use FLUX/SDXL LoRAs.');
  if(data.cfg_scale==null||Number(data.cfg_scale)>2){warnings.push('Qwen-Image 2.1 uses CFG 1, not generic SDXL guidance.');data.cfg_scale=1;}
  if(Number(data.cfg_scale)===1&&data.negative_prompt?.trim())warnings.push('Qwen Image at CFG 1 ignores the negative prompt. Put required composition and anatomy in the main prompt, or use CFG 2 with possible oversharpening.');
  if(['img2img','inpaint'].includes(mode)&&data.denoise!=null&&Number(data.denoise)!==1){warnings.push('Qwen reference edits use the reference in conditioning and a full denoising pass; SDXL strength does not apply.');data.denoise=1;}
  data.sampler_name='Euler';data.scheduler='simple';
 }
 if(data.modelPack==='flux-klein'){
  // FLUX.2 Klein distilled sampling uses Euler/simple and CFG 1, not SDXL CFG.
  if(data.cfg_scale==null||Number(data.cfg_scale)>2){warnings.push('FLUX.2 Klein uses CFG 1; reset leftover SDXL guidance.');data.cfg_scale=1;}
  data.sampler_name='Euler';data.scheduler='simple';
  if(data.steps==null||Number(data.steps)>20){warnings.push('FLUX.2 Klein is distilled; using 4 steps instead of a stale SDXL preset.');data.steps=4;}
 }
 if(data.modelPack==='z-turbo'){
  if(data.cfg_scale==null||Number(data.cfg_scale)>2){data.cfg_scale=1;warnings.push('Z-Image Turbo uses low guidance.');}
  if(data.steps==null||Number(data.steps)>20){data.steps=9;warnings.push('Z-Image Turbo uses 9 steps by default.');}
  data.sampler_name='Euler';data.scheduler='simple';
 }
 if(data.modelPack==='z-turbo'&&mode!=='txt2img')throw Error('Z-Image Turbo only supports text-to-image in the built-in workflow.');
 if(!['sdxl','flux-klein'].includes(data.modelPack)&&!String(data.modelPack||'').startsWith('qwen21-')&&data.modelPack!=='z-turbo'&&data.modelPack!=='koboldcpp'&&data.workflowId==null&&data.lora.length){
  throw Error('LoRAs are not compatible with the selected model.');
 }
 return {data,warnings,requestedOperation:mode,seedMode:data.seed===-1?'random':'fixed'};
}
function imagePromptHash(prompt){return crypto.createHash('sha256').update(String(prompt||'')).digest('hex').slice(0,16);}
module.exports={parseSeed,normalizeImageRequest,imagePromptHash};
