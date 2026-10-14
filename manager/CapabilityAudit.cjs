'use strict';
// A read-only feature matrix. Installation is always initiated explicitly in the UI.
const MODES={
 chat:'Character Chat',adventure:'Adventure',writer:'Writer',imageStudio:'Image Studio',assistant:'Local Assistant'
};
const MODES_BY_FEATURE={
 text:['chat','adventure','writer','assistant'],
 image:['chat','adventure','imageStudio'],
 vision:['chat','adventure'],
 tts:['chat','adventure'],
 trackers:['chat','adventure'],
 imageEditing:['imageStudio'],
};
function latestPass(history,kind,model){
 return (history||[]).some(entry=>entry.kind===kind&&entry.status==='passed'&&(!model||entry.model===model));
}
function buildCapabilityReport({engine={},center={},vision={},tts={},tests=[],trackerSessions=[]}={}){
 const installed=new Set(engine.installed||[]),selection=engine.selected||'',active=engine.runningModel||'';
 const catalog=(engine.catalog||[]).filter(m=>m.Role!=='vision');
 const recommendedIndex=(engine.catalog||[]).findIndex(m=>m.Role!=='vision'&&m.Recommended);
 const defaultText=recommendedIndex>=0?recommendedIndex:(engine.catalog||[]).findIndex(m=>m.Role!=='vision');
 const textInstalled=!!selection&&installed.has(selection);
 const reuseText=!textInstalled?[...installed][0]:null;
 const textOnline=!!engine.backendReady&&active===selection;
 const issues=[];
 const text={
  id:'text',label:'Local text generation',description:'Text model for Chat, Adventure, Writer and Assistant.',
  state:!textInstalled?'missing':textOnline&&latestPass(tests,'text2text',active)?'verified':textOnline?'online':'installed',
  selected:selection,missing:!textInstalled?[reuseText?'Select an already installed GGUF model':'Download a local GGUF text model']:!textOnline?['Start the selected text model']:[],
  action:!textInstalled?(reuseText?{kind:'selectText',name:reuseText}:{kind:'text',index:Math.max(0,defaultText)}):!textOnline?{kind:'loadText'}:{kind:'test',tab:'diagnostics'}
 };
 const selections=center.choices||{},packs=center.models||[];
 function image(scope){
  const id=selections[scope]||selections.global||'sdxl';
  const pack=packs.find(p=>p.id===id);
  const missing=(pack?.missing||[]).slice(0,15);
  const available=!!pack?.installed&&!!pack?.ready;
  if(!pack?.installed&&!missing.length)missing.push('ComfyUI model weights or runtime missing');
  if(pack?.installed&&!available&&!missing.length)missing.push(pack.issue||'Start ComfyUI and verify installed model');
  return {id:'image-'+scope,label:'Image generation · '+(scope==='chat'?'Chat':scope==='adventure'?'Adventure':'Image Studio'),
   description:'Uses the selected '+scope+' model pack; ComfyUI dependencies are shared.',
   model:id,state:!pack?.installed?'missing':available&&latestPass(tests,'text2image',id)?'verified':available?'online':'installed',
   missing,action:{kind:'image',id},scope};
 }
 const images=[image('chat'),image('adventure'),image('global')];
 const availableFiles=new Set(vision.installed||[]);
 const visionConfigured=!!vision.settings?.name&&!!vision.settings?.mmproj;
 const visionInstalled=visionConfigured&&availableFiles.has(vision.settings.name)&&availableFiles.has(vision.settings.mmproj);
 const visionFeature={id:'vision',label:'Visual analysis',description:'Requires a vision GGUF and its matching multimodal projector; this is not image generation.',
  state:!visionInstalled?'missing':vision.ready&&latestPass(tests,'image2text',vision.settings.name)?'verified':vision.ready?'online':'installed',
  model:vision.settings?.name||'',missing:visionInstalled?[]:['Matching vision GGUF + mmproj are not installed or configured'],action:{kind:'vision'}};
 const voiceVariant=tts.settings?.variant||'custom-0.6',voiceEngine=tts.settings?.engine||'qwen';
 const voiceReady=!!tts.ready&&!!tts.weightsReady,voicePass=tts.lastSynthesis?.engine===voiceEngine&&tts.lastSynthesis?.variant===voiceVariant;
 const voice={id:'tts',label:'Character and narrator speech',description:'Engine dependencies + voice weights; a real WAV preview is needed to verify audio.',
  state:!voiceReady?'missing':voicePass?'verified':'installed',
  model:voiceEngine+' '+voiceVariant,missing:voiceReady?[]:[!tts.ready?'Voice Python runtime dependencies':'Selected voice model weights'],
  action:{kind:'tts'},warning:tts.error||tts.downloadError||''};
 const trackerProblems=trackerSessions.filter(s=>s.lastAnalysis?.failed||s.lastAnalysis?.partial||s.recentFailures?.length);
 const trackers={id:'trackers',label:'State trackers and character memory',
  description:'Code and saved sessions present. Working requires a completed chat turn, verified state change and next-reply injection.',
  state:trackerProblems.length?'warning':'unverified',
  missing:trackerProblems.length?['Recent tracker extraction errors in '+trackerProblems.length+' session(s)']:['Live end-to-end update must still be tested'],
  action:{kind:'test',tab:'diagnostics'}};
 const editPack=packs.find(p=>p.id===selections.global);
 const editing={id:'imageEditing',label:'Inpaint, img2img, upscale and custom workflows',description:'Advanced editing requires compatible ComfyUI workflows and nodes; image-generation readiness alone does not verify each operation.',
  state:editPack?.installed&&editPack.ready?'unverified':'missing',
  missing:editPack?.ready?['Run individual image-editing diagnostics to verify selected workflow']:['Configure a compatible image editing pack and ComfyUI nodes'],
  action:{kind:'test',tab:'diagnostics'}};
 const features=[text,...images,visionFeature,voice,trackers,editing];
 const byMode={
  chat:['text','image-chat','vision','tts','trackers'],
  adventure:['text','image-adventure','vision','tts','trackers'],
  writer:['text'],
  imageStudio:['image-global','imageEditing'],
  assistant:['text']
 };
 const summary={verified:features.filter(x=>x.state==='verified').length,online:features.filter(x=>x.state==='online').length,installed:features.filter(x=>x.state==='installed').length,missing:features.filter(x=>x.state==='missing').length,warning:features.filter(x=>x.state==='warning').length,unverified:features.filter(x=>x.state==='unverified').length};
 return {at:new Date().toISOString(),summary,features,modes:Object.fromEntries(Object.entries(byMode).map(([id,ids])=>[id,{label:MODES[id],features:ids.map(key=>features.find(item=>item.id===key)).filter(Boolean)}])),
  notice:'A downloaded model, an online backend and a successful real test are different statuses. Not every ComfyUI node or hosted-service capability is implemented.'};
}
module.exports={buildCapabilityReport};
