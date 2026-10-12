'use strict';
// Release regression: every manager runtime file must appear in all three
// independent installer manifests. Prevents "Cannot find module" at startup.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
const files=fs.readdirSync(path.join(root,'manager')).filter(name=>/\.(?:cjs|js|ps1|html|json)$/.test(name)).sort();
const installer=fs.readFileSync(path.join(root,'installer','Install.ps1'),'utf8');
const bootstrap=fs.readFileSync(path.join(root,'launcher','Bootstrap.cs'),'utf8');
const pipeline=fs.readFileSync(path.join(root,'.github','workflows','build-windows.yml'),'utf8');
test('every manager asset is copied by installer, extracted by Bootstrap, and compiled into EXE',()=>{
 for(const name of files){
  assert.ok(installer.includes("'"+name+"'"),'installer copy list lacks '+name);
  assert.ok(bootstrap.includes('"'+name+'"'),'Bootstrap extract list lacks '+name);
  assert.ok(pipeline.includes(name+','+name)||['ModelManager.ps1','LaunchLocalAI.ps1','HeroExtension.json','HeroExtension.js','HeroImages.js','HeroStory.js'].includes(name),'Windows EXE resource lacks '+name);
 }
});
test('all statically imported relative modules resolve to bundled runtime modules',()=>{
 for(const name of files.filter(n=>/\.(cjs|js)$/.test(n))){
  const src=fs.readFileSync(path.join(root,'manager',name),'utf8');
  const referenced=[...src.matchAll(/\brequire\s*\(\s*['"](\.\/[^'"]+)['"]\s*\)/g)];
  for(const [,rel] of referenced){
   const target=path.normalize(path.join('manager',name,'..',rel)),basename=path.basename(target);
   assert.equal(path.dirname(target),'manager','Relative dependency outside manager in '+name+': '+rel);
   assert.ok(fs.existsSync(path.join(root,target)),'Missing source dependency '+name+' → '+rel);
   assert.ok(installer.includes("'"+basename+"'"),'Missing installation dependency '+name+' → '+basename);
   assert.ok(bootstrap.includes('"'+basename+'"'),'Missing EXE extraction dependency '+name+' → '+basename);
   assert.ok(pipeline.includes(basename+','+basename),'Missing EXE compile resource '+name+' → '+basename);
  }
 }
});
test('SceneComposition is a startup dependency of ComfyWorkflows',()=>{
 const src=fs.readFileSync(path.join(root,'manager','ComfyWorkflows.cjs'),'utf8');
 assert.match(src,/require\(['"]\.\/SceneComposition\.cjs['"]\)/);
 assert.ok(installer.includes("'SceneComposition.cjs'"));
 assert.ok(bootstrap.includes('"SceneComposition.cjs"'));
 assert.ok(pipeline.includes('SceneComposition.cjs,SceneComposition.cjs'));
});
