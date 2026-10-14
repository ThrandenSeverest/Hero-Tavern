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

test('Qwen generated images follow text and use correct distilled sampler independent of stale SDXL controls',()=>{
 const pack=QWEN_PACKS.find(p=>p.id==='qwen21-q5km');
 const base={negative_prompt:'',width:1024,height:1024,operation:'txt2img',seed:-1,steps:25,cfg_scale:7,sampler_name:'DPM++ 2M Karras',scheduler:'karras'};
 const a=recipeGraph(pack,{...base,prompt:'A bright red hot air balloon above snowy Alps.'});
 const b=recipeGraph(pack,{...base,prompt:'A blue fish swimming in a glass bowl.'});
 const nodes=obj=>Object.values(obj.graph);
 const input=(o,type)=>nodes(o).find(x=>x.class_type===type).inputs;
 assert.equal(input(a,'TextEncodeQwenImage21').prompt,'A bright red hot air balloon above snowy Alps.');
 assert.equal(input(b,'TextEncodeQwenImage21').prompt,'A blue fish swimming in a glass bowl.');
 assert.equal(input(a,'KSampler').cfg,1);
 assert.equal(input(a,'KSampler').sampler_name,'euler');
 assert.equal(input(a,'KSampler').scheduler,'simple');
 assert.equal(input(a,'KSampler').denoise,1);
 assert.notEqual(input(a,'KSampler').seed,input(b,'KSampler').seed);
 assert.equal(input(a,'KSampler').latent_image[0],Object.entries(a.graph).find(([id,node])=>node.class_type==='TextEncodeQwenImage21')[0]);
 assert.notDeepEqual(a.graph,b.graph,'two text prompts must produce different ComfyUI conditioning graphs');
});
test('Qwen low-strength edits encode the source with matching VAE and discard stale SDXL CFG',()=>{
 const pack=QWEN_PACKS.find(p=>p.id==='qwen21-q5km');
 const g=recipeGraph(pack,{prompt:'Change the coat to black',negative_prompt:'',operation:'img2img',steps:25,cfg_scale:5,seed:234}, {source:'reference.png'});
 const encoded=Object.entries(g.graph).find(([,node])=>node.class_type==='TextEncodeQwenImage21');
 const sampler=Object.values(g.graph).find(node=>node.class_type==='KSampler').inputs;
 const sourceLatent=Object.entries(g.graph).find(([,node])=>node.class_type==='VAEEncode');
 assert.ok(sourceLatent);assert.deepEqual(sampler.latent_image,[sourceLatent[0],0]);
 assert.deepEqual(sourceLatent[1].inputs.vae,encoded[1].inputs.vae);
 assert.equal(sampler.cfg,1);
 assert.equal(sampler.scheduler,'simple');
});

test('Qwen non-1024 generation uses native 64-channel latent scaling, not an incompatible SD empty latent',()=>{
 const pack=QWEN_PACKS.find(p=>p.id==='qwen21-q5km');
 const g=recipeGraph(pack,{prompt:'Two knights standing in a castle',negative_prompt:'',operation:'txt2img',width:768,height:768,steps:25,cfg_scale:1,seed:14,batch_size:1});
 const entries=Object.entries(g.graph);
 assert.ok(!entries.some(([,node])=>node.class_type==='EmptyLatentImage'));
 const latent=entries.find(([,node])=>node.class_type==='LatentUpscale');
 assert.ok(latent);assert.equal(latent[1].inputs.width,768);assert.equal(latent[1].inputs.height,768);
 const encoded=entries.find(([,node])=>node.class_type==='TextEncodeQwenImage21');
 assert.deepEqual(latent[1].inputs.samples,[encoded[0],2]);
 const sample=entries.find(([,node])=>node.class_type==='KSampler');
 assert.deepEqual(sample[1].inputs.latent_image,[latent[0],0]);
});
