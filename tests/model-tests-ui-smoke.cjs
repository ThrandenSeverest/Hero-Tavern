// Exercise stage selection against the shipped panel; unchecked stages must
// never submit inference jobs, even when their models are available.
const {JSDOM}=require(process.env.HERO_JSDOM_PATH||'../.ci/browser/node_modules/jsdom');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../manager/ModelPanel.html'),'utf8'),{url:'http://localhost/',runScripts:'outside-only'});
 const w=dom.window,$=s=>w.document.querySelector(s),calls=[];let exported;
 try{
  w.fetch=async(route,request)=>{
   calls.push({route,body:request.body&&JSON.parse(request.body)});
   const fixtures={
    '/diagnostics/check':{environment:{}},'/diagnostics/sample':{},'/gallery/list':{items:[]},
    '/model-tests/presets':{text2text:{prompt:'BLUE LANTERN'}},'/model-tests/history':[],
    '/status':{selected:'fixture',runningModel:'fixture'},
    '/comfy/status':{packs:[{id:'sdxl',name:'SDXL',installed:true}]},
    '/vision/status':{settings:{name:'vision',mmproj:'projector',mode:'cpu'}},
    '/tts/status':{ready:true,weightsReady:true,settings:{engine:'qwen'}},
    '/model-tests/text':{ok:true,text:'BLUE LANTERN'},
   };
   let value=fixtures[route];
   if(route==='/model-tests/workflow')value={id:'test-'+calls.length,kind:JSON.parse(request.body).kind,status:'passed',notes:[],prompt:'',at:new Date().toISOString()};
   if(route==='/model-tests/record')value={...JSON.parse(request.body),id:'record-'+calls.length,notes:[],at:new Date().toISOString()};
   if(route==='/tts/speak')return {ok:false,json:async()=>({error:'Speech engine exited: qwen; exit 3221225477 (0xc0000005).'})};
   if(route==='/tts/status'&&calls.some(x=>x.route==='/tts/speak'))value={...value,workerLog:'Windows fatal exception: access violation'};
   if(value===undefined)throw Error('Unexpected request: '+route);
   return {ok:true,json:async()=>value};
  };
  w.eval(fs.readFileSync(path.join(__dirname,'../manager/ModelTestsPanel.js'),'utf8'));
  await w.heroModelTestsRefresh();
  assert.equal(w.document.querySelectorAll('[data-flow-stage]').length,10);
  $('[data-flow-select="text"]').click();
  assert.equal(w.document.querySelectorAll('[data-flow-stage]:checked').length,5);
  const running=w.heroRunModelDiagnosticFlow();
  assert.ok([...w.document.querySelectorAll('[data-flow-stage]')].every(x=>x.disabled));
  await running;
  assert.deepEqual(calls.filter(x=>x.route==='/model-tests/workflow').map(x=>x.body.kind),['tracker','writer-agency','character-long']);
  for(const id of ['imageA','imageB','edit','vision','tts'])assert.match($('[data-flow-stage="'+id+'"]').closest('li').textContent,/SKIPPED — Unchecked/);
  assert.ok(!calls.some(x=>['/studio/generate','/tts/speak','/vision/analyze'].includes(x.route)));
  // Reload the script to verify persisted selection and Clear leaves preflight.
  w.eval(fs.readFileSync(path.join(__dirname,'../manager/ModelTestsPanel.js'),'utf8'));
  assert.equal(w.document.querySelectorAll('[data-flow-stage]:checked').length,5);
  $('[data-flow-select="none"]').click();calls.length=0;
  await w.heroRunModelDiagnosticFlow();
  assert.ok(!calls.some(x=>x.route.startsWith('/model-tests/')));
  assert.ok($('[data-flow-stage="preflight"]').checked);
  const speech=$('[data-flow-stage="tts"]');speech.checked=true;speech.onchange();
  await w.heroRunModelDiagnosticFlow();
  w.Blob=class{constructor(parts){exported=JSON.parse(parts.join(''));}};
  w.URL.createObjectURL=()=> 'blob:fixture';w.URL.revokeObjectURL=()=>{};w.HTMLAnchorElement.prototype.click=()=>{};
  $('#model-test-flow-export').click();
  assert.equal(exported.stages.tts.status,'failed');
  assert.match(exported.voiceAfter.workerLog,/access violation/);
  assert.deepEqual([...exported.selectedStages],['preflight','tts']);
  assert.equal(exported.stages.imageA.note,'Unchecked');
  console.log('Diagnostics DOM integration passed: selection, persistence, busy controls and no unchecked inference.');
 }finally{w.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
