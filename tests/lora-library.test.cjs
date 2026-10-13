'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createLoRAManager,identifyBase,familyForPack,compatible}=require('../manager/LoRAManager.cjs');
const {recipeGraph}=require('../manager/ComfyRecipes.cjs');
const {PACKS}=require('../manager/ComfyModelHub.cjs');
function mockLoRA(filename,metadata={'ss_base_model_version':'Flux.2 Klein 4B'}){
 const h={'__metadata__':metadata,'lora.unet.foo':{dtype:'F32',shape:[1],data_offsets:[0,4]}};
 const bytes=Buffer.from(JSON.stringify(h)),prefix=Buffer.alloc(8);prefix.writeBigUInt64LE(BigInt(bytes.length));
 fs.writeFileSync(filename,Buffer.concat([prefix,bytes,Buffer.alloc(4)]));
}
test('LoRA family matching distinguishes Flux.2 Klein, Flux.1, SDXL and Qwen Image 2.1',()=>{
 assert.equal(identifyBase('Flux.2 Klein 4B'),'flux2-klein');
 assert.equal(identifyBase('Flux.2 Klein 9B FP8'),'flux2-klein-9b');
 assert.equal(compatible('flux2-klein-9b','flux-klein'),false);
 assert.equal(identifyBase('Flux.1 D'),'flux1');
 assert.equal(identifyBase('Pony Diffusion XL'),'sdxl');
 assert.equal(identifyBase('Qwen-Image 2.1'),'qwen-image21');
 assert.equal(familyForPack('qwen21-q5km'),'qwen-image21');
 assert.equal(compatible('flux2-klein','flux-klein'),true);
 assert.equal(compatible('flux1','flux-klein'),false);
 assert.equal(compatible(null,'sdxl'),false);
});
test('LoRA browser detects safetensors metadata and refuses mismatched family at generation',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-lora-')),models=path.join(root,'models');fs.mkdirSync(path.join(models,'loras'),{recursive:true});
 try{
  mockLoRA(path.join(models,'loras','face.safetensors'));
  const library=createLoRAManager(root,{modelRoot:()=>models});
  let result=library.list({pack:'flux-klein'});
  assert.equal(result.items[0].compatible,true);
  assert.deepEqual(library.validateSelection([{name:'face.safetensors',strength:0.85}],'flux-klein'),[{name:'face.safetensors',strength:0.85}]);
  assert.throws(()=>library.validateSelection([{name:'face.safetensors'}],'sdxl'),/belongs to/);
  library.assign({name:'face.safetensors',family:'sdxl'});
  result=library.list({pack:'sdxl'});
  assert.equal(result.items[0].compatible,true);
  assert.equal(result.items[0].manual,true);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('Large local LoRA import uses chunks and rejects non-safetensors and filename traversal',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-upload-')),models=path.join(root,'models');
 fs.mkdirSync(path.join(models,'loras'),{recursive:true});
 try{
  const source=path.join(root,'original.safetensors');mockLoRA(source,{'ss_base_model_version':'SDXL 1.0'});
  const library=createLoRAManager(root,{modelRoot:()=>models});
  assert.throws(()=>library.begin({name:'../escaped.safetensors',size:100}),/safetensors|filename/i);
  const bytes=fs.readFileSync(source),job=library.begin({name:'imported.safetensors',size:bytes.length});
  library.chunk({id:job.id,part:bytes.toString('base64')});
  const done=library.finish({id:job.id});
  assert.equal(done.family,'sdxl');
  assert.equal(library.list({pack:'sdxl'}).items[0].compatible,true);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('FLUX.2 Klein graph receives validated model-only LoRA and second reference',()=>{
 const flux=PACKS.find(x=>x.id==='flux-klein');
 const graph=recipeGraph(flux,{prompt:'Swap clothes',operation:'inpaint',width:1024,height:1024,seed:12,lora:[{name:'face.safetensors',strength:0.9}]},{source:'target.png',reference:'donor.png',mask:'mask.png'});
 const nodes=Object.values(graph.graph);
 assert.ok(nodes.some(n=>n.class_type==='LoraLoaderModelOnly'));
 assert.equal(nodes.filter(n=>n.class_type==='ReferenceLatent').length,2);
 assert.ok(nodes.some(n=>n.class_type==='ImageCompositeMasked'));
});
