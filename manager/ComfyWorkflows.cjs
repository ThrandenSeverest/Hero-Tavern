'use strict';
// Core-node ComfyUI graphs: txt2img, img2img, inpainting, scene regions, model upscale.
// No custom nodes or bundled checkpoints required.
const crypto=require('node:crypto');
const {validateScene,regionsForScene}=require('./SceneComposition.cjs');
const SAMPLERS={'DPM++ 2M Karras':['dpmpp_2m','karras'],'DPM++ 2S ancestral Karras':['dpmpp_2s_ancestral','karras'],'Euler':['euler','normal'],'Euler a':['euler_ancestral','normal'],'LCM':['lcm','normal']};
function modelName(value,label='Model'){
 if(typeof value!=='string'||value.length>260||!value||value.startsWith('/')||value.startsWith('\\')||value.includes('\0')||value.split(/[\\/]/).some(part=>part==='..'||part==='.'||!part))throw Error(label+' must be an installed relative model name.');
 return value;
}
function clamp(n,min,max,name){
 if(typeof n!=='number'||!Number.isFinite(n)||n<min||n>max)throw Error('Invalid '+name+' ('+min+'–'+max+').');
 return n;
}
function buildWorkflow({checkpoint,params,source,mask,mode,lora=[],upscaleModel='',upscaleFactor=2}={}){
 const validModes=['txt2img','img2img','inpaint','upscale'],operation=mode||(source?(mask?'inpaint':'img2img'):'txt2img');
 if(!validModes.includes(operation))throw Error('Unsupported ComfyUI operation.');
 if(operation!=='upscale'){modelName(checkpoint,'Checkpoint');if(!/\.safetensors$/i.test(checkpoint))throw Error('Choose an installed .safetensors checkpoint.');}
 if(operation!=='txt2img'&&!source)throw Error('A saved source image is required.');
 if(operation==='inpaint'&&!mask)throw Error('An inpaint mask is required.');
 if(operation!=='inpaint'&&mask)throw Error('Masks are supported only by inpainting.');
 const graph={};let seq=0;
 const node=(class_type,inputs)=>{const id=String(++seq);graph[id]={class_type,inputs};return [id,0]};
 if(operation==='upscale'){
  const image=node('LoadImage',{image:source});
  let result;
  if(upscaleModel){modelName(upscaleModel,'Upscaler');result=node('ImageUpscaleWithModel',{upscale_model:node('UpscaleModelLoader',{model_name:upscaleModel}),image});}
  else result=node('ImageScaleBy',{image,upscale_method:'lanczos',scale_by:clamp(Number(upscaleFactor),1,4,'upscale factor')});
  const saved=node('SaveImage',{images:result,filename_prefix:'HeroTavern_Upscaled'});
  return {graph,saveId:saved[0],mode:operation,seed:null,batch:1};
 }
 const p=params||{};
 if(typeof p.prompt!=='string'||!p.prompt.trim()||p.prompt.length>12000)throw Error('Describe the image to generate.');
 if(typeof p.negative_prompt!=='string'||p.negative_prompt.length>12000)throw Error('Invalid negative prompt.');
 if(!Number.isInteger(p.width)||!Number.isInteger(p.height)||p.width<256||p.height<256||p.width>2048||p.height>2048||p.width%8||p.height%8)throw Error('Use image dimensions divisible by eight, between 256 and 2048.');
 clamp(p.steps,1,100,'steps');clamp(p.cfg_scale,1,30,'guidance');
 const count=p.batch_size??1;
 if(!Number.isInteger(count)||count<1||count>4||(operation!=='txt2img'&&count!==1))throw Error('Choose 1–4 images; image edits are single-image jobs.');
 const seed=p.seed===-1?crypto.randomInt(0,2147483647):p.seed;
 if(!Number.isInteger(seed)||seed<0||seed>2147483647)throw Error('Invalid image seed.');
 const [sampler,scheduler]=SAMPLERS[p.sampler_name]||SAMPLERS['DPM++ 2M Karras'];
 const checkpointNode=node('CheckpointLoaderSimple',{ckpt_name:checkpoint});
 let model=[checkpointNode[0],0],clip=[checkpointNode[0],1],vae=[checkpointNode[0],2];
 if(!Array.isArray(lora)||lora.length>3)throw Error('Limit LoRAs to three per image.');
 for(const entry of lora){
  if(!entry||typeof entry!=='object')throw Error('Invalid LoRA selection.');
  const filename=modelName(entry.name,'LoRA');
  if(!/\.(?:safetensors|pt|ckpt)$/i.test(filename))throw Error('Invalid LoRA file extension.');
  const strength=clamp(Number(entry.strength??1),-2,2,'LoRA strength');
  const layer=node('LoraLoader',{model,clip,lora_name:filename,strength_model:strength,strength_clip:strength});
  model=[layer[0],0];clip=[layer[0],1];
 }
 const negative=node('CLIPTextEncode',{text:p.negative_prompt,clip});
 let positive=node('CLIPTextEncode',{text:p.prompt,clip});
 if(p.scene&&operation==='txt2img'){
  const scene=validateScene(p.scene),regions=regionsForScene(scene,p.width,p.height);
  positive=node('CLIPTextEncode',{text:'Detailed shared environment, coherent natural lighting: '+scene.background+'. Exactly '+regions.length+' characters.',clip});
  for(const region of regions){
   const condition=node('CLIPTextEncode',{text:'Character '+region.index+': '+region.description+'. Shared environment: '+scene.background,clip});
   const area=node('ConditioningSetArea',{conditioning:condition,width:region.width,height:region.height,x:region.x,y:region.y,strength:1});
   positive=node('ConditioningCombine',{conditioning_1:positive,conditioning_2:area});
  }
 }
 let latent,sourceNode,maskNode;
 if(operation==='txt2img')latent=node('EmptyLatentImage',{width:p.width,height:p.height,batch_size:count});
 else{
  sourceNode=node('LoadImage',{image:source});
  if(operation==='inpaint'){
   maskNode=node('LoadImageMask',{image:mask,channel:'red'});
   latent=node('VAEEncodeForInpaint',{pixels:sourceNode,vae,mask:maskNode,grow_mask_by:6});
  }else latent=node('VAEEncode',{pixels:sourceNode,vae});
 }
 const denoise=operation==='txt2img'?1:clamp(Number(p.denoise??0.65),0.05,1,'denoise strength');
 const sample=node('KSampler',{model,positive,negative,latent_image:latent,seed,steps:p.steps,cfg:p.cfg_scale,sampler_name:sampler,scheduler,denoise});
 const decoded=node('VAEDecode',{samples:sample,vae});
 const output=operation==='inpaint'?node('ImageCompositeMasked',{destination:sourceNode,source:decoded,mask:maskNode,x:0,y:0,resize_source:false}):decoded;
 const saved=node('SaveImage',{images:output,filename_prefix:operation==='inpaint'?'HeroTavern_Edit':'HeroTavern'});
 return {graph,saveId:saved[0],mode:operation,seed,batch:count};
}
module.exports={buildWorkflow,modelName,SAMPLERS};
