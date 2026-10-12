'use strict';
// Ordinary GPT-style assistant inside the local Hero Tavern manager.
(()=>{
 const $=id=>document.getElementById(id);
 const state={initialized:false,busy:false,chat:null,files:[],selectedFile:'',draft:null};
 const setStatus=t=>{$('assistant-status').textContent=t};
 async function req(route,data){return request(route,data)}
 function btn(name,fn,variant=''){
  const b=document.createElement('button');b.type='button';b.textContent=name;
  if(variant)b.className=variant;b.onclick=fn;return b;
 }
 function renderChats(result){
  if(!result)return;
  state.chat=result.chat;
  const container=$('assistant-conversations');container.replaceChildren();
  for(const item of result.history||[]){
   const element=btn((item.id===result.current?'● ':'')+item.title.slice(0,70),async()=>{
    try{const next=await req('/assistant/select',{id:item.id});renderChats(next);setStatus('Conversation opened.')}catch(e){setStatus(e.message)}
   });
   if(item.id===result.current)element.classList.add('primary');
   container.append(element);
  }
  const messages=$('assistant-messages');messages.replaceChildren();
  for(const message of result.chat?.messages||[])addMessage(message.role,message.text,message.sources||[]);
  messages.scrollTop=messages.scrollHeight;
 }
 function addMessage(role,body,sources=[]){
  const area=$('assistant-messages'),bubble=document.createElement('div');
  bubble.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;padding:15px 18px;border-radius:12px;margin:12px 0;max-width:95%;background:'+(role==='user'?'#334358':'#202d41')+';border:1px solid #44516a;';
  const label=document.createElement('strong');label.textContent=role==='assistant'?'Qwen Assistant':'You';
  const text=document.createElement('div');text.textContent=body;text.style.marginTop='8px';
  bubble.append(label,text);area.append(bubble);
  if(sources.length){
   const box=document.createElement('div');box.className='card';
   const heading=document.createElement('strong');heading.textContent='Web sources (Brave Search excerpts)';
   box.append(heading);
   for(let i=0;i<Math.min(5,sources.length);i++){
    const item=sources[i],link=document.createElement('a');
    if(!item.url?.startsWith('https://'))continue;
    link.href=item.url;link.target='_blank';link.rel='noopener noreferrer';
    link.textContent='['+(i+1)+'] '+item.title;
    const preview=document.createElement('p');preview.className='small';preview.textContent=item.snippet;
    box.append(link,preview);
   }
   area.append(box);
  }
  area.scrollTop=area.scrollHeight;
 }
 function selectedMode(){return $('assistant-depth').value}
 function selectedFile(){return $('assistant-file-list').value}
 function fileOptions(items){
  state.files=items||[];const list=$('assistant-file-list'),last=list.value||state.selectedFile;
  list.replaceChildren(new Option('Select imported text file',''),...state.files.map(f=>new Option(f.name+' · rev '+f.revision+' · '+Math.ceil(f.size/1024)+' KiB',f.id)));
  if(state.files.some(f=>f.id===last))list.value=last;
  state.selectedFile=list.value;
 }
 async function refreshFiles(){
  try{const data=await req('/assistant/files');fileOptions(data.files)}catch(e){setStatus('Files: '+e.message)}
 }
 async function refresh(){
  if(state.busy)return;
  try{
   const [sessions,info]=await Promise.all([req('/assistant/chats'),req('/assistant/status')]);
   renderChats(sessions);fileOptions(info.files);
   $('assistant-model').textContent=(info.model||'No model loaded')+' · '+(info.loadedContext||8192)+' context · '+(info.busy?info.phase:'Ready');
   state.initialized=true;
  }catch(e){setStatus(e.message)}
 }
 function withBusy(run){
  return async()=>{
   if(state.busy)return;state.busy=true;
   $('assistant-send').disabled=true;$('assistant-edit').disabled=true;
   try{await run()}catch(e){setStatus(e.message)}
   finally{state.busy=false;$('assistant-send').disabled=false;$('assistant-edit').disabled=false}
  };
 }
 $('assistant-send').onclick=withBusy(async()=>{
  const prompt=$('assistant-input').value.trim();
  if(!prompt)throw Error('Enter a message.');
  const usesWeb=$('assistant-web').checked;
  const key=$('assistant-web-key').value.trim();
  if(usesWeb&&!key)throw Error('Web search is enabled; enter your Brave Search API key.');
  addMessage('user',prompt);$('assistant-input').value='';
  setStatus(selectedMode()==='deep'?'Deep Think: planning and then answering…':'Generating with local Qwen…');
  try{
   const reply=await req('/assistant/message',{prompt,mode:selectedMode(),web:usesWeb,searchQuery:usesWeb?$('assistant-web-query').value.trim():undefined,apiKey:usesWeb?key:undefined,fileId:$('assistant-include-file').checked?selectedFile():undefined});
   addMessage('assistant',reply.answer);
   const saved=await req('/assistant/chats');renderChats(saved);
   setStatus('Answer complete · '+reply.model+(reply.webUsed?' · web sources attached':'')+(reply.planningPasses===2?' · 2-pass Deep Think':''));
  }catch(e){$('assistant-input').value=prompt;throw e}
 });
 $('assistant-cancel').onclick=async()=>{try{await req('/assistant/cancel',{});setStatus('Cancellation requested.')}catch(e){setStatus(e.message)}};
 $('assistant-new').onclick=async()=>{try{const d=await req('/assistant/new',{});renderChats({current:d.chat.id,chat:d.chat,history:d.history});setStatus('New conversation created.')}catch(e){setStatus(e.message)}};
 $('assistant-delete-chat').onclick=async()=>{if(!state.chat||!confirm('Delete this assistant conversation? Imported files remain.'))return;try{renderChats(await req('/assistant/delete',{id:state.chat.id,confirm:true}));setStatus('Conversation deleted.')}catch(e){setStatus(e.message)}};
 $('assistant-qwen').onclick=withBusy(async()=>{
  if(!confirm('Load Qwen3 8B Abliterated as the shared local text model? The currently loaded roleplay model will be stopped and can be reselected later. No second model will stay loaded in GPU memory.'))return;
  const desired='qwen3-8b-abliterated-Q4_K_M.gguf';
  let info=await req('/status');
  if(!info.installed?.includes(desired))throw Error('Qwen Abliterated has not been downloaded. Open Model library, download the Qwen default GGUF, then return here.');
  if(info.generationState!=='idle'||info.imageJob)throw Error('Finish the running AI task before changing models.');
  if(info.backendRunning&&info.runningModel!==desired){
   setStatus('Unloading previous roleplay model…');
   await req('/stop',{});
   for(let i=0;i<45;i++){
    await new Promise(r=>setTimeout(r,1000));
    info=await req('/status');if(!info.backendRunning)break;
   }
   if(info.backendRunning)throw Error('Old text model did not shut down. See Diagnostics.');
  }
  if(info.selected!==desired)await req('/select',{name:desired});
  info=await req('/status');
  if(!info.backendRunning)await req('/start',{});
  setStatus('Loading Qwen3 Abliterated. Existing chats and files stay intact…');
  for(let i=0;i<180;i++){
   await new Promise(r=>setTimeout(r,1000));
   info=await req('/status');
   if(info.backendReady&&info.runningModel===desired)break;
   if(info.engineState==='error')throw Error(info.backendError||'Qwen model could not start.');
  }
  if(!info.backendReady||info.runningModel!==desired)throw Error('Qwen did not finish loading. Check Diagnostics.');
  setStatus('Qwen3 Abliterated ready. The RP model can be restored later in Model library.');
  $('assistant-model').textContent=desired+' · '+(info.loadedContext||8192)+' tokens';
 });
 $('assistant-web').onchange=()=>{
  $('assistant-web-settings').hidden=!$('assistant-web').checked;
  if($('assistant-web').checked)setStatus('Web search sends the entered query to Brave Search. Imported file contents are not automatically uploaded. The key is kept only in this browser tab.');
 };
 $('assistant-depth').onchange=()=>{
  const mode=selectedMode();
  $('assistant-depth-info').textContent=mode==='fast'?'Fast: ordinary Qwen answer.':mode==='think'?'Think: Qwen3 /think, hidden reasoning is never displayed.':'Deep Think: a preliminary planning response followed by a separate final-answer generation; slower but more deliberate.';
 };
 $('assistant-depth').dispatchEvent(new Event('change'));
 $('assistant-attach').onclick=withBusy(async()=>{
  const file=$('assistant-upload').files?.[0];if(!file)throw Error('Choose a text file first.');
  if(file.size>300000)throw Error('Maximum imported file is 300 KiB.');
  const text=await file.text();
  const data=await req('/assistant/file-import',{name:file.name,text});
  fileOptions(data.files);$('assistant-file-list').value=data.file.id;await loadFile();
  $('assistant-upload').value='';
  setStatus('Imported a safe workspace COPY of '+data.file.name+'. Your original disk file was not changed.');
 });
 async function loadFile(){
  const id=selectedFile();
  if(!id){$('assistant-original').value='';return}
  const result=await req('/assistant/file-get',{id});
  $('assistant-original').value=result.file.text;
  $('assistant-proposal').value='';$('assistant-file-name').textContent=result.file.name+' · revision '+result.file.revision;
  state.selectedFile=id;state.draft=null;$('assistant-apply').disabled=true;
 }
 $('assistant-file-list').onchange=()=>loadFile().catch(e=>setStatus(e.message));
 $('assistant-edit').onclick=withBusy(async()=>{
  const id=selectedFile(),prompt=$('assistant-edit-request').value.trim();if(!id)throw Error('Choose an imported file.');
  if(!prompt)throw Error('Describe the change to this file.');
  setStatus('Asking Qwen to propose a complete revised file without changing the original…');
  const result=await req('/assistant/file-edit',{fileId:id,prompt,mode:selectedMode()});
  state.draft=result;
  $('assistant-proposal').value=result.proposed;
  $('assistant-apply').disabled=!result.changed;
  const orig=result.original.split('\n'),out=result.proposed.split('\n');
  let first=0;while(first<orig.length&&first<out.length&&orig[first]===out[first])first++;
  let suffix=0;while(suffix<orig.length-first&&suffix<out.length-first&&orig[orig.length-1-suffix]===out[out.length-1-suffix])suffix++;
  const diff=$('assistant-diff');diff.replaceChildren();
  const section=(name,lines,color)=>{
   const box=document.createElement('pre');box.style.cssText='white-space:pre-wrap;max-height:240px;overflow:auto;border-left:4px solid '+color;
   box.textContent=name+'\n'+lines.slice(0,45).join('\n')+(lines.length>45?'\n… additional changed lines omitted from preview':'');diff.append(box);
  };
  section('BEFORE',orig.slice(first,orig.length-suffix),'#d28c87');
  section('AFTER',out.slice(first,out.length-suffix),'#86c7a8');
  setStatus(result.changed?'Draft is ready. Review both text fields and the changed section, then confirm Apply.':'Qwen proposed no changes.');
 });
 $('assistant-apply').onclick=withBusy(async()=>{
  if(!state.draft)throw Error('There is no saved draft to apply.');
  if(!confirm('Apply the proposed changes to the imported workspace copy? A previous revision will be saved. Your original computer file will NOT be overwritten.'))return;
  const result=await req('/assistant/file-apply',{id:state.draft.fileId,confirm:true});
  fileOptions(result.files);$('assistant-file-list').value=result.file.id;await loadFile();
  setStatus('Updated workspace file to revision '+result.file.revision+'. The original external file is untouched.');
 });
 $('assistant-restore').onclick=withBusy(async()=>{
  const id=selectedFile(),revision=Number($('assistant-revision').value);
  if(!id)throw Error('Select a workspace file first.');
  if(!Number.isInteger(revision)||revision<1)throw Error('Enter a valid previous revision.');
  if(!confirm('Restore revision '+revision+'? The current workspace copy will first be backed up; the original disk file stays unchanged.'))return;
  const {file}=await req('/assistant/file-restore',{id,revision,confirm:true});
  await refreshFiles();$('assistant-file-list').value=file.id;await loadFile();
  setStatus('Restored revision '+revision+' into new revision '+file.revision+'.');
 });
 $('assistant-remove-file').onclick=withBusy(async()=>{
  const id=selectedFile();if(!id)return;
  if(!confirm('Remove this imported workspace copy? Your external file stays unchanged.'))return;
  const result=await req('/assistant/file-delete',{id,confirm:true});fileOptions(result.files);await loadFile();setStatus('Workspace copy removed.');
 });
 $('assistant-export').onclick=async()=>{
  try{const id=selectedFile();if(!id)throw Error('Choose a file.');
   const {file}=await req('/assistant/file-get',{id});
   const href=URL.createObjectURL(new Blob([file.text],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');
   a.href=href;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(href),2000);
   setStatus('Exported '+file.name+'. Choose where to save it in your browser.');
  }catch(e){setStatus(e.message)}
 };
 $('assistant-input').addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){$('assistant-send').click()}});
 window.heroAssistantLoad=()=>{if(!state.initialized)refresh()};
})();
