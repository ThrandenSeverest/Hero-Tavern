'use strict';
// Model-specific ComfyUI graphs. End users choose "FLUX" or "Z-Image"; no JSON or nodes.
const crypto=require('node:crypto'),{buildWorkflow}=require('./ComfyWorkflows.cjs');
function recipeGraph(pack,params,{checkpoint='',source,mask,reference,resolvedFiles={}}={}){
 if(pack.family==='qwen21'){
  const mode=params.operation||'txt2img';
  if(!['txt2img','img2img','inpaint'].includes(mode))throw Error('Qwen Image supports generation and local editing. Use SDXL for upscaling.');
  if(mode!=='txt2img'&&!source)throw Error('Select a gallery image for Qwen editing.');
  if(mode==='inpaint'&&!mask)throw Error('Paint an area to change before Qwen inpainting.');
  if(params.lora?.length)throw Error('Standard SDXL LoRAs are incompatible with Qwen Image.');
  const nodes={};let k=0;const n=(class_type,inputs)=>{const id=String(++k);nodes[id]={class_type,inputs};return [id,0]};
  const files=Object.fromEntries(pack.files.map(f=>[f.group,resolvedFiles[f.group]||f.name]));
  const model=n('UnetLoaderGGUF',{unet_name:files.diffusion_models});
  const clip=n('CLIPLoader',{clip_name:files.text_encoders,type:'qwen_image',device:'default'});
  const vae=n('VAELoader',{vae_name:files.vae});
  const width=params.width||1024,height=params.height||1024;
  const sourceNode=source?n('LoadImage',{image:source}):null;
  const textInputs={clip,vae,prompt:params.prompt,negative_prompt:params.negative_prompt||'',resolution:1024};
  if(sourceNode)textInputs['images.image_1']=sourceNode;
  const encoded=n('TextEncodeQwenImage21',textInputs);
  const latent=sourceNode?[encoded[0],2]:n('EmptyLatentImage',{width,height,batch_size:params.batch_size||1});
  const seed=params.seed==null||params.seed<0?crypto.randomInt(0,2147483647):params.seed;
  const positive=[encoded[0],0],negative=[encoded[0],1];
  const sample=n('KSampler',{model,positive,negative,latent_image:latent,seed,steps:params.steps||25,cfg:params.cfg_scale||1,sampler_name:'euler',scheduler:'simple',denoise:mode==='txt2img'?1:params.denoise??0.7});
  const result=n('VAEDecode',{samples:sample,vae});
  let output=result;
  if(mode==='inpaint'){const masked=n('LoadImageMask',{image:mask,channel:'red'});output=n('ImageCompositeMasked',{destination:sourceNode,source:result,mask:masked,x:0,y:0,resize_source:false});}
  const saved=n('SaveImage',{images:output,filename_prefix:'HeroTavern_Qwen21'});
  return {graph:nodes,saveId:saved[0],mode,seed,batch:params.batch_size||1,packId:pack.id};
 }
 if(pack.id==='sdxl')return buildWorkflow({checkpoint,params,source,mask,mode:params.operation,lora:params.lora||[],upscaleModel:params.upscaleModel||'',upscaleFactor:params.upscaleFactor||2});
 const mode=params.operation||'txt2img';
 if(mode!=='txt2img'){
  if(pack.family==='zimage')throw Error('Z-Image Turbo preset is text-to-image only. Switch to FLUX.2 Klein for reference editing or SDXL for masked inpainting.');
  if(!['img2img','inpaint'].includes(mode)||!source||(mode==='inpaint'&&!mask))throw Error('FLUX.2 Klein reference editing requires a saved source image (plus a mask for local editing).');
 }
 if(params.lora?.length&&pack.family!=='flux2')throw Error('This image family does not yet support model-specific LoRA injection.');
 const files=Object.fromEntries(pack.files.map(x=>[x.group,resolvedFiles[x.group]||x.name]));
 const nodes={};let seq=0;
 const n=(type,inputs)=>{const id=String(++seq);nodes[id]={class_type:type,inputs};return [id,0]};
 const seed=params.seed<0||params.seed==null?crypto.randomInt(0,2147483647):params.seed;
 if(!Number.isInteger(seed)||seed<0||seed>2147483647)throw Error('Invalid model seed.');
 const width=params.width??1024,height=params.height??1024,count=params.batch_size||1;
 if(!Number.isInteger(width)||!Number.isInteger(height)||width%8||height%8||width<256||height<256||width>1536||height>1536)throw Error('Use width/height 256–1536, multiples of 8.');
 if(![1,2,4].includes(count))throw Error('Choose 1, 2 or 4 images.');
 if(typeof params.prompt!=='string'||!params.prompt.trim()||params.prompt.length>12000)throw Error('Enter an image description.');
 let model=n('UNETLoader',{unet_name:files.diffusion_models,weight_dtype:'default'});
 if(pack.family==='flux2')for(const item of params.lora||[]){if(typeof item.name!=='string'||!/^[^\\/]+(?:[\\/][^\\/]+)*\.safetensors$/i.test(item.name)||item.name.includes('..'))throw Error('Invalid FLUX LoRA name.');const weight=Number(item.strength??0.8);if(!Number.isFinite(weight)||weight< -2||weight>2)throw Error('Invalid FLUX LoRA strength.');model=n('LoraLoaderModelOnly',{model,lora_name:item.name,strength_model:weight});}
 const clip=n('CLIPLoader',{clip_name:files.text_encoders,type:pack.family==='zimage'?'lumina2':'flux2',device:'default'});
 const vae=n('VAELoader',{vae_name:files.vae});
 const positive=n('CLIPTextEncode',{text:params.prompt,clip});
 let positiveCondition=positive;
 if(pack.family==='flux2'&&source){
  const input=n('LoadImage',{image:source});
  const encoded=n('VAEEncode',{pixels:input,vae});
  positiveCondition=n('ReferenceLatent',{conditioning:positiveCondition,latent:encoded});
 }
 if(pack.family==='flux2'&&reference){const ref=n('LoadImage',{image:reference});const refLatent=n('VAEEncode',{pixels:ref,vae});positiveCondition=n('ReferenceLatent',{conditioning:positiveCondition,latent:refLatent});}
 const negative=n('ConditioningZeroOut',{conditioning:positiveCondition});
 let sampled;
 if(pack.family==='zimage'){
  const m=n('ModelSamplingAuraFlow',{model,shift:3});
  const latent=n('EmptyLatentImage',{width,height,batch_size:count});
  sampled=n('KSampler',{model:m,positive,negative,latent_image:latent,seed,steps:pack.steps,cfg:pack.cfg,sampler_name:'euler',scheduler:'normal',denoise:1});
 }else if(pack.family==='flux2'){
  const latent=n('EmptyFlux2LatentImage',{width,height,batch_size:count});
  const noise=n('RandomNoise',{noise_seed:seed}),sampler=n('KSamplerSelect',{sampler_name:'euler'});
  const guider=n('CFGGuider',{model,positive:positiveCondition,negative,cfg:1});
  const sigmas=n('Flux2Scheduler',{steps:4,width,height});
  sampled=n('SamplerCustomAdvanced',{noise,guider,sampler,sigmas,latent_image:latent});
 }else throw Error('Unsupported image model family.');
 const decoded=n('VAEDecode',{samples:sampled,vae});
 let result=decoded;
 if(pack.family==='flux2'&&mode==='inpaint'){
  const original=n('LoadImage',{image:source}),area=n('LoadImageMask',{image:mask,channel:'red'});
  result=n('ImageCompositeMasked',{destination:original,source:decoded,mask:area,x:0,y:0,resize_source:false});
 }
 const saved=n('SaveImage',{images:result,filename_prefix:'HeroTavern_'+pack.id.replace(/-/g,'_')});
 return {graph:nodes,saveId:saved[0],mode,seed,batch:count,packId:pack.id};
}
module.exports={recipeGraph};
