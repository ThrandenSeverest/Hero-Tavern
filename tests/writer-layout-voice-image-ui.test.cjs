const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
test('Writer separates passages without narrowing the manuscript',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../manager/Writer.html'),'utf8');
 assert.match(html,/#writer-segments\{[^}]*width:100%;/);
 assert.match(html,/#writer-segments\{[^}]*flex:1 1 auto;/);
 assert.match(html,/\.writer-passage textarea\{[^}]*overflow:hidden;/);
 assert.match(html,/textarea\.scrollHeight/);
 assert.match(html,/g\.text\.trim\(\)\.split\(\/\\s\+\//);
});
test('Voice model downloader is explicit in Models and supports five Qwen voices plus Flash',()=>{
 const root=path.join(__dirname,'../manager');
 const panel=fs.readFileSync(path.join(root,'ModelPanel.html'),'utf8');
 const service=fs.readFileSync(path.join(root,'TTSService.cjs'),'utf8');
 const python=fs.readFileSync(path.join(root,'TTSModelDownload.py'),'utf8');
 assert.match(panel,/models-open-tts/);
 assert.match(panel,/tts-download/);
 assert.match(panel,/tts-model-downloads/);
 assert.match(service,/downloadModel/);
 assert.match(service,/cancelModelDownload/);
 assert.match(service,/weightsReady/);
 for(const id of ['flash','custom-0.6','custom-1.7','clone-0.6','clone-1.7','design-1.7'])assert.ok(python.includes('"'+id+'"'));
 const {createTTS}=require('../manager/TTSService.cjs');
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'hero-voice-models-'));
 try{const t=createTTS(temp);assert.equal(t.status().weightsReady,false);assert.throws(()=>t.downloadModel(),/Install selected voice engine dependencies/);assert.equal(t.status().downloading,false)}finally{fs.rmSync(temp,{recursive:true,force:true})}
});
test('Image Studio can use the exact passing controlled Qwen baseline',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../manager/ModelPanel.html'),'utf8');
 const studio=fs.readFileSync(path.join(__dirname,'../manager/ImageStudio.cjs'),'utf8');
 assert.match(html,/image-test-baseline/);
 for(const n of ["image-width","image-height","image-steps","image-cfg","image-seed","studio-preset","studio-refine","hero-post-auto","hero-upscale-auto","scene-enabled","hero-comfy-mode"])assert.ok(html.includes("el('"+n+"')"),n);
 assert.match(html,/Verified Qwen test configuration applied/);
 assert.match(html,/Effective text actually sent to ComfyUI/);
 assert.match(studio,/refinedPrompt:refined\.prompt/);
});
