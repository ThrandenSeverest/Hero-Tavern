'use strict';
// Model-specific ComfyUI graphs. End users choose "FLUX" or "Z-Image"; no JSON or nodes.
const crypto=require('node:crypto'),{buildWorkflow}=require('./ComfyWorkflows.cjs');
function recipeGraph(pack,params,{checkpoint='',source,mask}={}){
 if(pack.id==='sdxl')return buildWorkflow({checkpoint,params,source,mask,mode:params.operation,lora:params.lora||[],upscaleModel:params.upscaleModel||'',upscaleFactor:params.upscaleFactor||2});
 const mode=params.operation||'txt2img';
 if(mode!=='txt2img'){
  if(pack.family==='zimage')throw Error('Z-Image Turbo preset is text-to-image only. Switch to FLUX.2 Klein for reference editing or SDXL for masked inpainting.');
  if(!['img2img','inpaint'].includes(mode)||!source||(mode==='inpaint'&&!mask))throw Error('FLUX.2 Klein reference editing requires a saved source image (plus a mask for local editing).');
 }
 if(params.lora?.length)throw Error('This preset needs a model-specific LoRA workflow. Clear standard SDXL LoRAs before generating.');
 const files=Object.fromEntries(pack.files.map(x=>[x.group,x.name]));
 const nodes={};let seq=0;
 const n=(type,inputs)=>{const id=String(++seq);nodes[id]={class_type:type,inputs};return [id,0]};
 const seed=params.seed<0||params.seed==null?crypto.randomInt(0,2147483647):params.seed;
 if(!Number.isInteger(seed)||seed<0||seed>2147483647)throw Error('Invalid model seed.');
 const width=params.width??1024,height=params.height??1024,count=params.batch_size||1;
 if(!Number.isInteger(width)||!Number.isInteger(height)||width%8||height%8||width<256||height<256||width>1536||height>1536)throw Error('Use width/height 256–1536, multiples of 8.');
 if(![1,2,4].includes(count))throw Error('Choose 1, 2 or 4 images.');
 if(typeof params.prompt!=='string'||!params.prompt.trim()||params.prompt.length>12000)throw Error('Enter an image description.');
 const model=n('UNETLoader',{unet_name:files.diffusion_models,weight_dtype:'default'});
 const clip=n('CLIPLoader',{clip_name:files.text_encoders,type:pack.family==='zimage'?'lumina2':'flux2',device:'default'});
 const vae=n('VAELoader',{vae_name:files.vae});
 const positive=n('CLIPTextEncode',{text:params.prompt,clip});
 let positiveCondition=positive;
 if(pack.family==='flux2'&&source){
  const input=n('LoadImage',{image:source});
  const encoded=n('VAEEncode',{pixels:input,vae});
  positiveCondition=n('ReferenceLatent',{conditioning:positive,latent:encoded});
 }
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
