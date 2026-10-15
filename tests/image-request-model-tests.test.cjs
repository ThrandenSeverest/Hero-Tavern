const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {parseSeed,normalizeImageRequest}=require('../manager/ImageRequest.cjs');
const {createModelTests,PRESETS,imageStats}=require('../manager/ModelTests.cjs');
const {createWriterAPI}=require('../manager/WriterAPI.cjs');
const {buildWriterContext}=require('../manager/WriterContext.cjs');
test('empty image seed means random, fixed zero is deliberate, invalid seeds rejected',()=>{
 for(const seed of ['',undefined,null,-1,'-1'])assert.equal(parseSeed(seed),-1);
 assert.equal(parseSeed('0'),0);assert.equal(parseSeed('1234'),1234);
 for(const value of ['abc','2.2',-3,2147483648])assert.throws(()=>parseSeed(value));
});
test('text-to-image must never reuse stale edit source and mask',()=>{
 const original={prompt:'a blue sky',modelPack:'sdxl',operation:'txt2img',sourceName:'stale.png',maskData:'stale',denoise:0.7,seed:'',lora:[{name:'style.safetensors'}]};
 const result=normalizeImageRequest(original);
 assert.equal(result.data.operation,'txt2img');assert.equal(result.data.seed,-1);assert.equal(result.data.sourceName,undefined);assert.equal(result.data.maskData,undefined);assert.equal(result.data.denoise,undefined);
 assert.equal(result.data.lora.length,1);assert.equal(original.sourceName,'stale.png');
 assert.throws(()=>normalizeImageRequest({operation:'img2img',modelPack:'flux-klein',sourceName:''}),/source image/);
 assert.throws(()=>normalizeImageRequest({operation:'inpaint',modelPack:'sdxl',sourceName:'x.png'}),/mask/);
});
test('Qwen and FLUX defaults stay isolated from stale SDXL configs',()=>{
 const q=normalizeImageRequest({prompt:'red teapot',modelPack:'qwen21-q5km',cfg_scale:7,sampler_name:'DPM++ 2M Karras',scheduler:'karras',seed:-1}).data;
 assert.equal(q.cfg_scale,1);assert.equal(q.sampler_name,'Euler');assert.equal(q.scheduler,'simple');
 const flux=normalizeImageRequest({prompt:'green frog',modelPack:'flux-klein',cfg_scale:7,steps:40,seed:''}).data;
 assert.equal(flux.cfg_scale,1);assert.equal(flux.steps,4);assert.equal(flux.seed,-1);
 const sdxl=normalizeImageRequest({modelPack:'sdxl',cfg_scale:7,sampler_name:'DPM++ 2M Karras'}).data;
 assert.equal(sdxl.cfg_scale,7);assert.equal(sdxl.sampler_name,'DPM++ 2M Karras');
});
test('Qwen explains ineffective negative prompt and uses full denoising for reference edits',()=>{
 const a=normalizeImageRequest({prompt:'Correct anatomy',negative_prompt:'extra limbs',modelPack:'qwen21-q5km',cfg_scale:1,seed:10});
 assert.match(a.warnings.join(' '),/ignores the negative prompt/);
 const edit=normalizeImageRequest({prompt:'Change the coat',modelPack:'qwen21-q5km',operation:'img2img',sourceName:'source.png',denoise:0.25,seed:10});
 assert.equal(edit.data.denoise,1);assert.match(edit.warnings.join(' '),/full denoising pass/);
});
test('model testing presets contain all four operations and keep reports',()=>{
 assert.deepEqual(Object.keys(PRESETS).sort(),['image2image','image2text','text2image','text2text']);
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-tests-'));
 try{
  const app=createModelTests(root);
  const a=app.record({kind:'text2text',model:'Mock',prompt:PRESETS.text2text.prompt,text:'BLUE LANTERN',status:'passed',elapsedMs:20});
  const b=app.record({kind:'text2text',model:'Mock',prompt:PRESETS.text2text.prompt,text:'OKAY I UNDERSTAND',status:'passed',elapsedMs:25});
  assert.equal(a.status,'passed');assert.equal(b.status,'warning');assert.equal(app.history().length,2);
  const skipped=app.record({kind:'image2image',model:'qwen21-q5km',status:'skipped',notes:['Skipped on 12 GB GPU for safety.']});
  assert.equal(skipped.status,'skipped');assert.ok(skipped.notes[0].includes('12 GB'));
  assert.throws(()=>app.record({kind:'text2image',model:'Mock',imageName:'../../../secret.png',status:'passed'}));
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('Writer emits a real manuscript continuation prefill, not an assistant explanation request',async()=>{
 const w={text:'The clock struck midnight. A shadow entered the hall.',prompt:'Gothic mystery.',memory:'',lore:[],operation:'continue'};
 const result=await buildWriterContext(w,2200,async text=>Math.ceil(text.length/4));
 assert.ok(result.prompt.endsWith(w.text));
 assert.ok(result.prompt.includes('<|im_start|>assistant\n'));
 assert.ok(!result.prompt.endsWith('Write the passage now. Only story prose.'));
});
test('Writer saves and regenerates independent generation segments without losing later text',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-writer-segments-'));let number=0,observed=[];
 try{
  const api=createWriterAPI(root,{generate:async body=>{observed.push({...body.hero_writer});return{choices:[{text:['The door opened.','A wolf appeared.','A guard stepped in.'][number++]}]}}});
  const story=await api.action('/writer/api/create',{story:{text:'Once upon a time.'}});
  const a=await api.action('/writer/api/generate-apply',{id:story.id,expectedVersion:story.version,operation:'continue'});
  const b=await api.action('/writer/api/generate-apply',{id:story.id,expectedVersion:a.story.version,operation:'continue'});
  assert.equal(b.story.generations.length,2);
  const first=b.story.generations[0].id,secondText=b.story.generations[1].text;
  const refreshed=await api.action('/writer/api/regenerate',{id:story.id,expectedVersion:b.story.version,generationId:first,operation:'continue'});
  assert.equal(refreshed.story.generations.length,2);
  assert.equal(refreshed.story.generations[0].id,first);
  assert.equal(refreshed.story.generations[1].text,secondText);
  assert.ok(refreshed.story.text.includes('A guard stepped in.'));
  assert.ok(refreshed.story.text.includes(secondText));
  assert.equal(observed[2].operation,'insert');
  assert.ok(observed[2].text.includes(secondText));
  assert.ok(refreshed.story.history.some(x=>x.text===b.story.text));
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});

test('model tests use bounded cancellable requests and standalone roleplay-free text benchmark',()=>{
 const panel=fs.readFileSync(path.join(__dirname,'../manager/ModelTestsPanel.js'),'utf8');
 const bridge=fs.readFileSync(path.join(__dirname,'../manager/ModelBridge.cjs'),'utf8');
 const markup=fs.readFileSync(path.join(__dirname,'../manager/ModelPanel.html'),'utf8');
 const studio=fs.readFileSync(path.join(__dirname,'../manager/ImageStudio.cjs'),'utf8');
 assert.match(panel,/model-test-stop/);
 assert.match(panel,/terminateModelTest/);
 assert.match(panel,/model-test-include-heavy/);
 assert.match(panel,/modelTest:true/);
 assert.match(panel,/\/model-tests\/text/);
 assert.match(markup,/Include heavy Qwen image editing/);
 assert.match(bridge,/req.url==='\/model-tests\/text'/);
 assert.match(bridge,/input.modelTest===true/);
 assert.match(studio,/testTimeoutMs/);
});
