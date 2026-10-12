'use strict';
// Deterministic layout planning. This is not a replacement for real regional conditioning:
// KoboldCpp receives one text prompt; ComfyUI receives spatially separated conditionings.
const RATIOS={row:'Horizontal lineup',grid:'Two-row grid'};
function validateScene(data={}){
 const scene=data.scene||data;
 const background=String(scene.background||'').trim();
 if(!background||background.length>3000)throw Error('Describe the scene/background (max 3000 characters).');
 if(!Array.isArray(scene.characters)||scene.characters.length<2||scene.characters.length>6)throw Error('A regional scene needs 2–6 separate characters.');
 const characters=scene.characters.map((item,i)=>{
  const description=String(typeof item==='string'?item:item?.description||'').trim();
  if(!description||description.length>1000)throw Error('Describe character '+(i+1)+' (max 1000 characters).');
  return {description};
 });
 const layout=scene.layout||'row';if(!RATIOS[layout])throw Error('Choose row or grid layout.');
 return {background,characters,layout};
}
function regionsForScene(scene,width,height){
 const n=scene.characters.length,columns=scene.layout==='grid'?Math.ceil(n/2):n,rows=scene.layout==='grid'?2:1;
 const round8=n=>Math.round(n/8)*8;
 const edgesX=Array.from({length:columns+1},(_,i)=>round8(width*i/columns));
 const edgesY=Array.from({length:rows+1},(_,i)=>round8(height*i/rows));
 return scene.characters.map((character,i)=>{
  const col=i%columns,row=Math.floor(i/columns);
  return {...character,index:i+1,x:edgesX[col],y:edgesY[row],width:edgesX[col+1]-edgesX[col],height:edgesY[row+1]-edgesY[row]};
 });
}
function scenePrompt(data){
 const scene=validateScene(data);
 const n=scene.characters.length,positions=scene.layout==='grid'?'two-row grid':'left-to-right horizontal lineup';
 return ['WIDE ENVIRONMENTAL GROUP SCENE: Exactly '+n+' distinct characters, '+positions+'. Do not merge people or add background bystanders.',
 'SETTING (shared environment, not a character): '+scene.background,
 'CAST — one distinct person for each numbered position:',
 ...scene.characters.map((c,i)=>'PERSON '+(i+1)+' of '+n+': '+c.description),
 'COMPOSITION: Every listed character must be present and distinguishable. Keep their unique species, outfits, hairstyles, weapons and actions assigned to the right person. Maintain one consistent environment and natural shared illumination. No extra characters. This is a group scene, not a single-person portrait.'].join('\n');
}
function comfyRegionalWorkflow(input={}){
 const scene=validateScene(input);
 const width=Number(input.width||1024),height=Number(input.height||1024),steps=Number(input.steps??28),cfg=Number(input.cfg_scale??6),seed=Number(input.seed??-1);
 const ckpt=String(input.checkpoint||'').trim();
 if(!ckpt||!ckpt.endsWith('.safetensors')||/[\\/\x00-\x1f]/.test(ckpt))throw Error('Enter the installed ComfyUI checkpoint filename (.safetensors).');
 if(![width,height].every(n=>Number.isInteger(n)&&n>=256&&n<=1536&&n%64===0))throw Error('Canvas dimensions must be multiples of 64 (256–1536).');
 if(!Number.isInteger(steps)||steps<1||steps>60||!Number.isFinite(cfg)||cfg<1||cfg>20||!Number.isInteger(seed)||seed< -1||seed>2147483647)throw Error('Invalid sampler settings.');
 const validSamplers={'DPM++ 2M Karras':['dpmpp_2m','karras'],'DPM++ 2S ancestral Karras':['dpmpp_2s_ancestral','karras'],'Euler':['euler','normal'],'Euler a':['euler_ancestral','normal'],'LCM':['lcm','normal']};
 const [sampler,scheduler]=validSamplers[input.sampler_name||'DPM++ 2M Karras']||validSamplers['DPM++ 2M Karras'];
 let counter=0;const graph={};const node=(type,inputs)=>{const id=String(++counter);graph[id]={class_type:type,inputs};return [id,0]};
 const checkpoint=node('CheckpointLoaderSimple',{ckpt_name:ckpt}),clip=[checkpoint[0],1],vae=[checkpoint[0],2],latent=node('EmptyLatentImage',{width,height,batch_size:1});
 const negative=node('CLIPTextEncode',{text:String(input.negative_prompt||'')+', extra people, duplicated characters, fused bodies, missing characters',clip});
 const regions=regionsForScene(scene,width,height);
 // A world-only conditioning avoids leaking one character's attributes into another region.
 let positive=node('CLIPTextEncode',{text:'Detailed coherent environment: '+scene.background+'. Wide group scene, harmonious lighting, no crowd or unnamed people.',clip});
 for(const region of regions){
  const text='ONE DISTINCT CHARACTER, person '+region.index+' of '+regions.length+': '+region.description+'. Shared setting: '+scene.background+'.';
  const condition=node('CLIPTextEncode',{text,clip});
  const area=node('ConditioningSetArea',{conditioning:condition,width:region.width,height:region.height,x:region.x,y:region.y,strength:1});
  positive=node('ConditioningCombine',{conditioning_1:positive,conditioning_2:area});
 }
 const sample=node('KSampler',{model:checkpoint,positive,negative,latent_image:latent,seed:seed===-1?Math.floor(Math.random()*2147483647):seed,steps,cfg,sampler_name:sampler,scheduler,denoise:1});
 const decoded=node('VAEDecode',{samples:sample,vae});
 node('SaveImage',{filename_prefix:'HeroTavern_Regional',images:decoded});
 return {workflow:graph,regions,scene,checkpoint:ckpt,width,height,engine:'ComfyUI'};
}
module.exports={validateScene,regionsForScene,scenePrompt,comfyRegionalWorkflow};
