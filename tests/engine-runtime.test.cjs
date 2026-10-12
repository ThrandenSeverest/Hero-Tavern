'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {runtimeEnvironment}=require('../manager/EngineRuntime.cjs');
const {createDiskCare}=require('../manager/DiskCare.cjs');
test('KoboldCpp roles isolate TEMP without mutating parent environment',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-kobold-temp-'));
 try{
  const old=process.env.TEMP;
  const names=['text','image','thinking'].map(role=>runtimeEnvironment(root,role).TEMP);
  assert.equal(new Set(names).size,3);
  for(const p of names)assert.ok(fs.statSync(p).isDirectory());
  assert.equal(process.env.TEMP,old);
  assert.throws(()=>runtimeEnvironment(root,'../Models'),/Unexpected/);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('Scoped stale extraction can be inventoried but active and unknown folders cannot be cleared',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hero-temp-inventory-'));
 try{
  const parent=runtimeEnvironment(root,'text').TEMP;
  const good=path.join(parent,'_MEI123456'),bad=path.join(parent,'_MEI999999');
  fs.mkdirSync(good);fs.mkdirSync(bad);
  fs.writeFileSync(path.join(good,'koboldcpp_cublas.dll'),'library');
  fs.writeFileSync(path.join(bad,'unrelated.dll'),'unrelated');
  const old=new Date(Date.now()-20*60*1000);fs.utimesSync(good,old,old);fs.utimesSync(bad,old,old);
  const care=createDiskCare(root),found=care.runtimeCandidates();
  assert.equal(found.length,1);
  assert.equal(found[0].path,good);
  assert.throws(()=>care.cleanRuntime(),/confirmation/);
  assert.throws(()=>care.cleanRuntime({confirm:true}),/stopped/);
  assert.ok(fs.existsSync(good));
  assert.ok(fs.existsSync(bad));
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
