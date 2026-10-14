'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {recipeGraph}=require('../manager/ComfyRecipes.cjs'),{buildWorkflow}=require('../manager/ComfyWorkflows.cjs'),{createStudio}=require('../manager/ImageStudio.cjs');
const p={prompt:'A silver coat',negative_prompt:'',width:768,height:768,steps:20,cfg_scale:1,seed:1};
test('FLUX edit strength uses source latent and low noise schedule; new images remain full-noise',()=>{
 const pack={id:'flux-klein',family:'flux2',files:[]};
 const edit=recipeGraph(pack,{...p,operation:'img2img',denoise:.25},{source:'original.png'}).graph;
 const sampler=Object.values(edit).find(n=>n.class_type==='SamplerCustomAdvanced').inputs;
 assert.equal(edit[sampler.latent_image[0]].class_type,'VAEEncode');
 assert.equal(edit[sampler.sigmas[0]].class_type,'SplitSigmasDenoise');assert.equal(sampler.sigmas[1],1);assert.equal(edit[sampler.sigmas[0]].inputs.denoise,.25);
 const fresh=recipeGraph(pack,{...p,operation:'txt2img'}).graph;assert.ok(!Object.values(fresh).some(n=>n.class_type==='SplitSigmasDenoise'));
});
test('masked edits share adjusted mask in compositing and encoding; invalid edges fail',()=>{
 const g=buildWorkflow({checkpoint:'sdxl.safetensors',params:{...p,maskGrow:12,maskFeather:8,maskInvert:true},source:'a.png',mask:'m.png',mode:'inpaint'}).graph;
 const nodes=Object.values(g),compose=nodes.find(n=>n.class_type==='ImageCompositeMasked'),encode=nodes.find(n=>n.class_type==='VAEEncodeForInpaint');
 assert.deepEqual(compose.inputs.mask,encode.inputs.mask);assert.ok(nodes.some(n=>n.class_type==='InvertMask'));assert.equal(nodes.find(n=>n.class_type==='GrowMask').inputs.expand,12);
 assert.throws(()=>buildWorkflow({checkpoint:'sdxl.safetensors',params:{...p,maskFeather:1000},source:'a.png',mask:'m.png',mode:'inpaint'}),/Mask expansion/);
});
test('image edits do not inherit global style and prompt refinement explicitly preserves source',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-shared-'));fs.mkdirSync(path.join(root,'Images'));let generated,instruction;
 const s=createStudio(root,{ensureText:async()=>{},pipeline:{abort(){},async generate(x){instruction=x.prompt;return {choices:[{text:'Prompt: Change coat to silver.'}]}}},generateImage:async x=>{generated=x;return {url:'/images/output/1-a.png'}}});
 try{await s.action('/studio/generate',{prompt:'Change coat',sourceName:'a.png',operation:'img2img',refine:false});assert.equal(generated.prompt,'Change coat');
 const refined=await s.action('/studio/refine',{prompt:'Change coat',operation:'inpaint'});assert.match(instruction,/Describe only the requested changes/);assert.equal(refined.prompt,'Change coat to silver.');}finally{fs.rmSync(root,{recursive:true,force:true})}
});
