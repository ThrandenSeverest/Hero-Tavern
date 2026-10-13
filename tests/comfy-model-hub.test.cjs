'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {PACKS,composeStatus,createModelHub}=require('../manager/ComfyModelHub.cjs');
const {recipeGraph}=require('../manager/ComfyRecipes.cjs');
const {resolveRuntime,createComfyRuntime}=require('../manager/ComfyRuntime.cjs');
const root=()=>fs.mkdtempSync(path.join(os.tmpdir(),'hero-managed-comfy-'));
const settings={prompt:'Three separate elven adventurers gathered around a fountain.',width:768,height:768,steps:12,cfg_scale:5,seed:94,batch_size:1,negative_prompt:'blurry'};
test('Model catalog includes full multi-component dependencies and reports missing files precisely',()=>{
 const flux=PACKS.find(p=>p.id==='flux-klein'),z=PACKS.find(p=>p.id==='z-turbo');
 assert.ok(flux.files.find(f=>f.group==='diffusion_models'&&f.name==='flux-2-klein-4b.safetensors'));
 assert.ok(flux.files.find(f=>f.group==='text_encoders'));
 assert.ok(z.files.find(f=>f.group==='vae'));
 const none=composeStatus({}).find(p=>p.id==='flux-klein');
 assert.equal(none.installed,false);assert.equal(none.missing.length,3);
 const ready=composeStatus({diffusion_models:flux.files.filter(f=>f.group==='diffusion_models').map(f=>f.name),
   text_encoders:flux.files.filter(f=>f.group==='text_encoders').map(f=>f.name),
   vae:flux.files.filter(f=>f.group==='vae').map(f=>f.name)}).find(p=>p.id==='flux-klein');
 assert.equal(ready.installed,true);assert.deepEqual(ready.missing,[]);
});
test('Existing FLUX FP8 filename and nested ComfyUI model folders are recognized without an SDXL checkpoint',()=>{
 const {resolvePackFiles}=require('../manager/ComfyModelHub.cjs');
 const pack=PACKS.find(p=>p.id==='flux-klein');
 const listing={
  checkpoints:[],
  diffusion_models:['flux/flux-2-klein-4b-fp8.safetensors'],
  text_encoders:['encoders/qwen_3_4b.safetensors'],
  vae:['flux2-vae.safetensors']
 };
 const flux=composeStatus(listing).find(p=>p.id==='flux-klein');
 assert.equal(flux.installed,true);
 assert.deepEqual(flux.missing,[]);
 const names=resolvePackFiles(pack,listing);
 assert.equal(names.diffusion_models,'flux/flux-2-klein-4b-fp8.safetensors');
 const result=recipeGraph(pack,settings,{resolvedFiles:names});
 assert.equal(Object.values(result.graph).find(node=>node.class_type==='UNETLoader').inputs.unet_name,'flux/flux-2-klein-4b-fp8.safetensors');
});
test('FLUX.2 Klein text-to-image uses correct Qwen encoder, Flux2Scheduler and latent, not SDXL nodes',()=>{
 const p=PACKS.find(p=>p.id==='flux-klein'),result=recipeGraph(p,settings);
 const values=Object.values(result.graph);
 assert.ok(values.some(n=>n.class_type==='CLIPLoader'&&n.inputs.type==='flux2'));
 assert.ok(values.some(n=>n.class_type==='EmptyFlux2LatentImage'));
 assert.ok(values.some(n=>n.class_type==='Flux2Scheduler'));
 assert.ok(values.some(n=>n.class_type==='SamplerCustomAdvanced'));
 assert.equal(values.find(n=>n.class_type==='UNETLoader').inputs.unet_name,'flux-2-klein-4b.safetensors');
 assert.equal(result.seed,94);
});
test('FLUX.2 Klein reference edit uses VAEEncode and ReferenceLatent; masked edit protects original pixels',()=>{
 const pack=PACKS.find(p=>p.id==='flux-klein');
 const reference=recipeGraph(pack,{...settings,operation:'img2img'}, {source:'hero.png'});
 assert.ok(Object.values(reference.graph).some(n=>n.class_type==='ReferenceLatent'));
 assert.ok(Object.values(reference.graph).some(n=>n.class_type==='VAEEncode'));
 const mask=recipeGraph(pack,{...settings,operation:'inpaint'}, {source:'hero.png',mask:'mask.png'});
 assert.ok(Object.values(mask.graph).some(n=>n.class_type==='ImageCompositeMasked'));
 assert.ok(Object.values(mask.graph).some(n=>n.class_type==='LoadImageMask'));
 assert.throws(()=>recipeGraph(pack,{...settings,operation:'inpaint'}, {source:'hero.png'}),/requires a saved source/);
});
test('Z-Image Turbo uses lumina2 Qwen loader, AuraFlow scheduler and limited batch size',()=>{
 const pack=PACKS.find(p=>p.id==='z-turbo'),result=recipeGraph(pack,settings);
 const nodes=Object.values(result.graph);
 assert.ok(nodes.some(n=>n.class_type==='CLIPLoader'&&n.inputs.type==='lumina2'));
 assert.ok(nodes.some(n=>n.class_type==='ModelSamplingAuraFlow'&&n.inputs.shift===3));
 assert.equal(nodes.find(n=>n.class_type==='KSampler').inputs.steps,settings.steps);
 assert.throws(()=>recipeGraph(pack,{...settings,batch_size:5}),/Choose 1, 2 or 4/);
 assert.throws(()=>recipeGraph(pack,{...settings,operation:'inpaint'}),/text-to-image only/);
});
test('ComfyUI model paths stay inside a selected existing ComfyUI model root',async()=>{
 const home=root();try{
  fs.mkdirSync(path.join(home,'models','checkpoints'),{recursive:true});
  const hub=createModelHub(home);
  assert.throws(()=>hub.configure({modelRoot:'../bad'}),/full|directory/i);
  const configured=hub.configure({modelRoot:path.join(home,'models')});
  assert.equal(configured.settings.modelRoot,path.join(home,'models'));
  hub.select({id:'z-turbo'});
  assert.equal(createModelHub(home).snapshot().settings.selected,'z-turbo');
  await assert.rejects(()=>hub.downloadPack({id:'z-turbo'}),/Confirm/);
 }finally{fs.rmSync(home,{recursive:true,force:true})}
});
test('Portable folder detection chooses only complete embedded Python and ComfyUI program layouts',()=>{
 const home=root();try{
  const portable=path.join(home,'ComfyUI_windows_portable');
  fs.mkdirSync(path.join(portable,'ComfyUI'),{recursive:true});
  fs.mkdirSync(path.join(portable,'python_embeded'),{recursive:true});
  assert.equal(resolveRuntime(home),null);
  fs.writeFileSync(path.join(portable,'ComfyUI','main.py'),'print("test")');
  fs.writeFileSync(path.join(portable,'python_embeded','python.exe'),'test executable');
  const found=resolveRuntime(home);
  assert.equal(found.base,portable);
  assert.ok(found.models.endsWith(path.join('ComfyUI','models')));
  const runtime=createComfyRuntime(home);
  assert.equal(runtime.status().running,false);
 }finally{fs.rmSync(home,{recursive:true,force:true})}
});
