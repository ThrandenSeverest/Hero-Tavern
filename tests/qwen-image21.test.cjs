'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {PACKS,QWEN_PACKS}=require('../manager/ComfyModelHub.cjs');
const {recipeGraph}=require('../manager/ComfyRecipes.cjs');
test('Qwen 2.1 Q5_K_M is available alongside optional GGUF quantizations, shared 8B encoder and VAE',()=>{
 assert.ok(QWEN_PACKS.length>=12);
 const pack=PACKS.find(x=>x.id==='qwen21-q5km');
 assert.ok(pack);assert.equal(pack.family,'qwen21');
 assert.match(pack.files[0].name,/Q5_K_M\.gguf$/);
 assert.match(pack.files[1].name,/qwen3vl_8b_int8_convrot/);
 assert.match(pack.files[2].name,/vae_bf16/);
});
test('Qwen ComfyUI text-to-image graph references its actual GGUF loader, encoder and VAE',()=>{
 const pack=QWEN_PACKS.find(p=>p.quant==='Q5_K_M');
 const workflow=recipeGraph(pack,{prompt:'Two characters in an inn',negative_prompt:'blur',operation:'txt2img',width:1024,height:1024,steps:25,cfg_scale:1,seed:123,batch_size:1});
 const nodes=Object.values(workflow.graph);
 const get=id=>nodes.find(x=>x.class_type===id);
 assert.ok(get('UnetLoaderGGUF'));
 assert.equal(get('CLIPLoader').inputs.type,'qwen_image');
 assert.equal(get('TextEncodeQwenImage21').inputs.prompt,'Two characters in an inn');
 assert.equal(get('TextEncodeQwenImage21').inputs.resolution,1024);
 assert.ok(get('KSampler'));assert.ok(get('SaveImage'));
});
test('Qwen inpainting requires mask, carries the reference and preserves original outside mask',()=>{
 const pack=QWEN_PACKS.find(p=>p.quant==='Q5_K_M');
 const params={prompt:'Replace hat',negative_prompt:'',operation:'inpaint',width:1024,height:1024,seed:10};
 assert.throws(()=>recipeGraph(pack,params,{source:'original.png'}),/mask/i);
 const result=recipeGraph(pack,params,{source:'original.png',mask:'mask.png'});
 const nodes=Object.values(result.graph);
 assert.ok(nodes.find(x=>x.class_type==='LoadImageMask'));
 assert.ok(nodes.find(x=>x.class_type==='ImageCompositeMasked'));
 assert.ok(nodes.find(x=>x.class_type==='TextEncodeQwenImage21').inputs['images.image_1']);
});