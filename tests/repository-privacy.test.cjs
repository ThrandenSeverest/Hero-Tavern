'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const publicRuntime=['extension','manager','installer','launcher'];
const identity=/37243264\+ThrandenSeverest@users\.noreply\.github\.com|heroleaf@mail\.ru|[Аа]дамович\s+[Мм]ихаил\s+[Аа]лександрович/;
test('packaged runtime must not embed contributor contact details',()=>{
 for(const dir of publicRuntime){
  for(const entry of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){
   if(!entry.isFile()||!/\.(?:js|cjs|json|html|ps1|cs|cmd|py)$/i.test(entry.name))continue;
   const file=path.join(root,dir,entry.name),contents=fs.readFileSync(file,'utf8');
   assert.doesNotMatch(contents,identity,'A contact detail appeared in '+path.relative(root,file));
  }
 }
});
