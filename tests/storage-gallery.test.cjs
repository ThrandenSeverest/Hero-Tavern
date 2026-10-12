const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {createDiskCare}=require('../manager/DiskCare.cjs');
const {createImageGallery}=require('../manager/ImageGallery.cjs');
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'hero-disk-gallery-'));
test('Disk cleanup deletes only finished setup files and committed story journals, never user saves or prepared rollback data',()=>{
 const root=temp();try{
  const mkdir=p=>fs.mkdirSync(path.join(root,p),{recursive:true});
  for(const d of ['Downloads','Runtime/node','SillyTavern/data','Story/transactions','Models','ImageModels','Images','AdventureSaves'])mkdir(d);
  fs.writeFileSync(path.join(root,'SillyTavern/server.js'),'ok');
  fs.writeFileSync(path.join(root,'Downloads/SillyTavern-release.zip'),'obsolete installer');
  fs.writeFileSync(path.join(root,'Downloads/download.part'),'active download');
  fs.writeFileSync(path.join(root,'Models/text.gguf'),'important');
  fs.writeFileSync(path.join(root,'ImageModels/stable.safetensors'),'important');
  fs.writeFileSync(path.join(root,'Images/user.png'),'important');
  fs.writeFileSync(path.join(root,'SillyTavern/data/chat.jsonl'),'important');
  fs.writeFileSync(path.join(root,'AdventureSaves/save.json'),'important');
  const committed=path.join(root,'Story/transactions',crypto.randomUUID()),prepared=path.join(root,'Story/transactions',crypto.randomUUID());
  for(const [folder,status] of [[committed,'committed'],[prepared,'prepared']]){
    fs.mkdirSync(folder);fs.writeFileSync(path.join(folder,'journal.json'),JSON.stringify({status,entries:[]}));
    fs.writeFileSync(path.join(folder,'0.before'),'old chat backup');
  }
  const care=createDiskCare(root),initial=care.report();
  assert.equal(initial.cleanupItems.length,2);
  assert.throws(()=>care.cleanup(),/confirmation/);
  const output=care.cleanup({confirm:true});
  assert.equal(output.removed.length,2);
  assert.ok(output.freedBytes>0);
  assert.ok(!fs.existsSync(committed));assert.ok(fs.existsSync(prepared));
  for(const p of ['Downloads/download.part','Models/text.gguf','ImageModels/stable.safetensors','Images/user.png','SillyTavern/data/chat.jsonl','AdventureSaves/save.json'])assert.ok(fs.existsSync(path.join(root,p)),p);
 }finally{fs.rmSync(root,{force:true,recursive:true})}
});
test('Gallery finds previously generated PNG and sidecars, allows favorites, setting reuse and deliberate deletion',()=>{
 const root=temp();try{
  const dir=path.join(root,'Images');fs.mkdirSync(dir);
  const name='1728765432100-abcdef123456.png';
  fs.writeFileSync(path.join(dir,name),Buffer.from([137,80,78,71,13,10,26,10]));
  fs.writeFileSync(path.join(dir,name+'.json'),JSON.stringify({model:'DreamShaper',width:512,height:768,seed:12345,prompt:'A cozy inn'}));
  fs.writeFileSync(path.join(dir,name+'.studio.json'),JSON.stringify({originalPrompt:'Савос в трактире',preset:'fantasy',favorite:false}));
  const gal=createImageGallery(root);let response=gal.list();assert.equal(response.total,1);assert.equal(response.items[0].seed,12345);
  assert.match(response.items[0].url,/^\/images\/output\//);
  assert.equal(gal.list({search:'савос'}).total,1);
  gal.favorite({name,value:true});assert.equal(gal.list({favorites:true}).total,1);
  assert.throws(()=>gal.remove({name}),/Confirm/);
  assert.throws(()=>gal.remove({name:'../../data/chat.jsonl',confirm:true}),/Invalid/);
  gal.remove({name,confirm:true});assert.equal(gal.list().total,0);
 }finally{fs.rmSync(root,{force:true,recursive:true})}
});
test('Installer no longer runs npm ci on every update, and embeds storage/gallery runtime',()=>{
 const code=fs.readFileSync(path.join(__dirname,'../installer/Install.ps1'),'utf8');
 const bootstrap=fs.readFileSync(path.join(__dirname,'../launcher/Bootstrap.cs'),'utf8');
 const yaml=fs.readFileSync(path.join(__dirname,'../.github/workflows/build-windows.yml'),'utf8');
 assert.match(code,/\$previousHash -ne \$lockHash/);
 assert.match(code,/if \(\$requiresNpm\)/);
 assert.match(code,/skipping npm ci/);
 assert.match(code,/DiskCare\.cjs/);
 assert.match(code,/ImageGallery\.cjs/);
 assert.match(bootstrap,/ImageGallery\.cjs/);assert.match(yaml,/ImageGallery\.cjs/);
});
test('Image Studio includes gallery and disk cleanup route, progress stage and safe confirmation',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../manager/ModelPanel.html'),'utf8');
 const bridge=fs.readFileSync(path.join(__dirname,'../manager/ModelBridge.cjs'),'utf8');
 for(const needle of ['data-tab="storage"','id="gallery-grid"','id="studio-progress"','id="disk-clean"'])assert.ok(html.includes(needle),needle);
 for(const route of ['/gallery/list','/storage/report','/storage/cleanup','/studio/progress'])assert.ok(bridge.includes(route),route);
 assert.match(html,/confirm\('Delete only confirmed temporary files/);
});