// Hero Tavern P0/P1 controller. All conversations remain native SillyTavern chats.
export async function initStory({getContext,frame,show}){
 const origin='http://127.0.0.1:8001',pending=new Map();let view=null,busy=false,syncing=false,scheduled=null,actionInstruction='';
 function rpc(route,data={}){return new Promise((resolve,reject)=>{const id=crypto.randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('Story service timed out.'))},600000);pending.set(id,{resolve,reject,timer});frame.contentWindow.postMessage({type:'hero-request',id,route,data},origin)});}
 const c=()=>getContext(),selected=()=>!!c().chatId&&(c().characterId!==undefined||!!c().groupId);
 const location=()=>c().groupId?{group:String(c().groupId),filename:c().chatId}:{avatar:c().characters[c().characterId].avatar,filename:c().chatId};
 const legacy=()=>String(c().groupId||c().characters[c().characterId]?.avatar||'character')+':'+c().chatId;
 const card=()=>c().characters[c().characterId]?.data?.extensions?.hero_tavern||{};
 function identities(){for(const m of c().chat){m.extra=m.extra||{};m.extra.heroMessageId ||=m.heroMessageId||crypto.randomUUID();m.heroMessageId=m.extra.heroMessageId;}}
 let personaModule=await import('../../personas.js');
 async function sync(){if(!selected())return null;identities();await c().saveChat();const v=await rpc('/story/sync',{location:location(),template:card(),members:c().groupId?(c().groups.find(g=>g.id===c().groupId)?.members||[]):[],legacyMemoryKey:legacy(),profile:{name:String(c().characters[c().characterId]?.name||'').slice(0,180),description:String(c().characters[c().characterId]?.description||'').slice(0,4400),personality:String(c().characters[c().characterId]?.personality||'').slice(0,2000),scenario:String(c().characters[c().characterId]?.scenario||'').slice(0,1500),personaAvatar:personaModule.user_avatar,persona:c().powerUserSettings?.persona_description||'',model:c().onlineStatus,promptProfile:c().powerUserSettings?.instruct?.preset||''}});c().chatMetadata.hero_tavern={schemaVersion:1,sessionId:v.session.id,characterId:v.session.characterId};view=v;publish();return v;}
 function publish(){frame.contentWindow.postMessage({type:'hero-story-view',view},origin);updateMessageMenus();renderTrackerStrip();const title=document.querySelector('#hero-session-name');if(title)title.textContent=view?.session.title||'Select a chat';}
 function notify(error){window.toastr?.error(error.message||String(error),'Hero Tavern');}
 async function open(session){c().stopGeneration?.();if(session.profile?.personaAvatar){if(c().powerUserSettings.personas?.[session.profile.personaAvatar])await personaModule.setUserAvatar(session.profile.personaAvatar);else window.toastr?.warning('The saved player persona is missing; its association was preserved.');}if(c().groupId!==session.location.group){if(session.location.group){await c().openGroupChat(session.location.group,session.location.filename);return sync()}const index=c().characters.findIndex(x=>x.avatar===session.location.avatar);if(index<0)throw Error('This session’s character is missing. Import its card or archive first.');if(Number(c().characterId)!==index)await c().selectCharacterById(String(index));}if(session.location.group)await c().openGroupChat(session.location.group,session.location.filename);else await c().openCharacterChat(session.location.filename);await sync();show('chat');}
 async function run(op,data={}){
  if(busy)throw Error('A story operation is still running.');busy=true;
  try{
   if(op==='open'){const target=await rpc('/story/get',{id:data.id});await open(target.session);return target;}
   if(op==='portrait-editor'){show('characters');return null;}
   if(op==='list')return rpc('/story/list',data);
   if(op==='import'){const result=await rpc('/story/import',data);await c().getCharacters();return result;}
   if(op==='character-update'){
    if(c().groupId)throw Error('Select a single character first.');const base=data.card.spec?data.card.data:data.card,avatar=c().characters[c().characterId]?.avatar;const keys=['name','description','personality','scenario','first_mes','mes_example'];const fields=Object.fromEntries(keys.map(k=>[k,String(base[k]||'')]));if(!fields.name.trim())throw Error('Enter a name.');const response=await fetch('/api/characters/merge-attributes',{method:'POST',headers:c().getRequestHeaders(),body:JSON.stringify({avatar,...fields,data:{...fields,tags:base.tags||[],alternate_greetings:base.alternate_greetings||[],extensions:base.extensions||{}}})});if(!response.ok)throw Error('Native character save failed.');await c().getCharacters();const v=await sync();await rpc('/story/profile',{characterId:v.session.characterId,profile:data.profile});return sync();
   }
   if(op==='lore-save-native'){
    const name=String(data.name||'').trim();
    if(!name||name.length>120||/[\/\\]/.test(name))throw Error('Choose a lorebook name without slashes (up to 120 characters).');
    // Use the latest saved Hero lore state, without resaving the native chat.
    // This operation is also available while background tracker analysis runs.
    const loc=selected()?location():null;
    const saved=view?.session?.location;
    if(!view?.session||!loc||saved?.filename!==loc.filename||saved?.avatar!==loc.avatar||saved?.group!==loc.group)
     throw Error('Selected chat changed. Open the Lorebook tab again before saving.');
    const v=view;
    const headers=c().getRequestHeaders();
    const fetchWorld=async(route,body,missingOk=false)=>{
     const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
     try{
      const response=await fetch('/api/worldinfo/'+route,{
       method:'POST',headers,body:JSON.stringify(body),signal:controller.signal
      });
      if(missingOk&&[400,404].includes(response.status))return null;
      if(!response.ok)throw Error('SillyTavern World Info '+route+' failed (HTTP '+response.status+'): '+(await response.text()).slice(0,350));
      if(route==='get')return response.json();
      return true;
     }finally{clearTimeout(timer)}
    };
    const old=await fetchWorld('get',{name},true)||{entries:{}};
    const entries=Object.fromEntries(Object.entries(old.entries||{}).filter(([,e])=>!e.extensions?.hero_tavern));
    let uid=Math.max(-1,...Object.keys(entries).map(Number))+1;
    for(const e of v.session.lore){
     entries[uid]={uid,key:e.keywords||[],keysecondary:[],comment:e.label||'Hero lore',content:e.text,
      constant:!e.keywords?.length,selective:true,selectiveLogic:0,order:100,position:0,
      disable:true,extensions:{hero_tavern:{id:e.id,condition:e.condition,visibility:e.visibility}}};uid++;
    }
    await fetchWorld('edit',{name,data:{...old,entries,hero_tavern:{schemaVersion:1,entries:v.session.lore}}});
    // The file is already saved. Refresh ST's world menu without blocking the save confirmation.
    Promise.resolve().then(()=>c().updateWorldInfoList()).catch(e=>console.warn('World Info list refresh:',e.message));
    return {name,entries:Object.keys(entries).length};
   }
   if(op==='lore-load-native'){
    const v=await sync(),book=await c().loadWorldInfo(data.name);if(!book)throw Error('Lorebook not found.');const entries=book.hero_tavern?.entries||Object.values(book.entries||{}).filter(e=>!e.disable).map(e=>({id:'native-'+data.name+'-'+e.uid,label:e.comment||'Lore',text:e.content,keywords:e.constant?[]:e.key||[],visibility:'player'}));return rpc('/story/metadata',{id:v.session.id,lore:[...v.session.lore,...entries.filter(e=>!v.session.lore.some(x=>x.id===e.id))]});
   }
   if(op==='test-character')return rpc('/story/test-character',data);
    if(op==='tracker-remove'){
     const v=await sync();if(!v)throw Error('Select a character chat first.');
     const tracker=v.session.definitions.find(d=>d.owner+':'+d.id===data.key);if(!tracker)throw Error('Tracker not found.');
     const result=await rpc('/story/definition-delete',{id:v.session.id,key:data.key});
     const characterOwner='character:'+v.session.characterId;
     if(tracker.owner===characterOwner){
      const profile=v.characterProfile||{};
      const remaining=(profile.trackers||[]).filter(t=>!(t.id===tracker.id&&(t.owner===tracker.owner||t.owner==='character:self'||!t.owner)));
      const updated=await rpc('/story/profile',{characterId:v.session.characterId,profile:{...profile,trackers:remaining}});
      if(!c().groupId)await c().writeExtensionField(c().characterId,'hero_tavern',updated);
     }
     view=result;publish();return result;
    }
   if(op==='helper')return rpc('/story/helper',{...data,context:[c().characters[c().characterId]?.description||'',data.context||''].join('\n')});
   const v=await sync();if(!v)throw Error('Select a character and chat first.');
   if(op==='open'){const target=await rpc('/story/get',{id:data.id});await open(target.session);return target;}
   if(op==='fork'){c().stopGeneration?.();const result=await rpc('/story/fork',{...data,id:v.session.id});await open(result.session);return result;}
   if(op==='restore'){c().stopGeneration?.();const result=await rpc('/story/restore',{...data,id:v.session.id});await c().reloadCurrentChat();await sync();return result;}
   if(op==='undo-rollback'){if(!v.session.recoveryId)throw Error('No rollback recovery is recorded.');const recovery=await rpc('/story/get',{id:v.session.recoveryId});await open(recovery.session);return recovery;}
   if(op==='state-at')return rpc('/story/state-at',{...data,id:v.session.id});
   if(op==='preview')return rpc('/story/preview',{...data,id:v.session.id});
   if(op==='inspect')return rpc('/story/inspector',{id:v.session.id});
   if(op==='export')return rpc('/story/export',{...data,id:v.session.id});
   if(op==='generate'){
    const kind=data.kind,defaults={normal:'',descriptive:'Continue with richer scene detail, keeping established facts.',concise:'Continue concisely without repetition.',strict:'Stay strictly in character and honor all established facts.',next:'Advance naturally to the next scene without undoing established events.',unexpected:'Introduce a plausible unexpected event while preserving character agency.',emergency:'Introduce a plausible urgent situation without inventing irreversible injuries.'};
    if(kind==='time'){if(!Number.isFinite(data.amount)||data.amount<=0||data.amount>365||!['days','hours','turns'].includes(data.unit))throw Error('Choose a positive time skip and its unit.');data.instruction='Advance the story by '+data.amount+' '+data.unit+'. Preserve established injuries and show the passage of fictional time. '+(data.instruction||'');}
    actionInstruction=data.instruction||defaults[kind]||'';try{show('chat');if(kind==='continue')await c().generate('continue');else if(['normal','descriptive','concise','strict','custom'].includes(kind))await c().generate('regenerate');else await c().generate('normal',{automatic_trigger:true,quiet_prompt:actionInstruction,quietToLoud:true});const updated=await sync();return updated;}finally{actionInstruction='';}
   }
   if(op==='profile'){if(c().groupId)throw Error('Select a single character to edit its reusable template.');const value=await rpc('/story/profile',{characterId:v.session.characterId,profile:data.profile});await c().writeExtensionField(c().characterId,'hero_tavern',value);return value;}
   const result=await rpc('/story/'+op,{...data,id:v.session.id});if(result?.session){view=result;publish();}return result;
  }finally{busy=false;}
 }
 window.addEventListener('message',async e=>{
  if(e.origin!==origin||e.source!==frame.contentWindow)return;
  if(e.data?.type==='hero-response'){const p=pending.get(e.data.id);if(p){clearTimeout(p.timer);pending.delete(e.data.id);e.data.error?p.reject(Error(e.data.error)):p.resolve(e.data.value)}return;}
  if(e.data?.type==='hero-character-load'){const data=c().characters[c().characterId];if(data)frame.contentWindow.postMessage({type:'hero-character-data',card:{...data,...(data.data||{})}},origin);return;}
  if(e.data?.type==='hero-open-new-chat'){newDialog().catch(notify);return;}
  if(e.data?.type==='hero-story-command'){try{const result=await run(e.data.op,e.data.data);frame.contentWindow.postMessage({type:'hero-story-result',requestId:e.data.requestId,result},origin)}catch(error){frame.contentWindow.postMessage({type:'hero-story-result',requestId:e.data.requestId,error:error.message},origin);notify(error)}return;}
  if(e.data?.type==='hero-section-ready'&&['history','trackers','lore','inspector','creator'].includes(e.data.section))try{await sync()}catch(error){notify(error)};
 });
 const toolbar=document.createElement('div');toolbar.id='hero-session-toolbar';toolbar.innerHTML='<span id="hero-session-name">Select a chat</span><button data-story="new">Save & New Chat</button><button data-story="history">History</button><button data-story="trackers">Trackers</button><button data-story="lore">Lore</button><button data-story="inspector">Prompt Inspector</button><button id="hero-leading-prompt-button" data-story="leading">Leading Prompt</button><button id="hero-character-voice-toolbar" data-story="voice" title="Create, assign and preview this character’s voice">🎙 Character Voice</button>';
 const sheld=document.querySelector('#sheld');if(sheld)sheld.prepend(toolbar);
 const characterDrawer=document.querySelector('#right-nav-panel');
 if(characterDrawer&&!document.getElementById('hero-character-leading-prompt')){
  const button=document.createElement('button');button.id='hero-character-leading-prompt';button.type='button';
  button.textContent='✎ Leading Prompt';button.title='Permanent theme and behavioral guidance for the selected character';
  button.style.cssText='position:relative;z-index:1;display:block;margin:6px 0 12px;padding:8px 12px;border:1px solid #997b4e;border-radius:8px;background:#2e3748;color:#f6dfad;cursor:pointer';
  button.onclick=()=>openLeadingPrompt().catch(notify);characterDrawer.prepend(button);
 }

 const voiceButton=document.createElement('button');voiceButton.textContent='Character Voice';voiceButton.id='hero-character-voice';
 voiceButton.onclick=()=>openCharacterVoice().catch(error=>{const box=document.querySelector('.hero-story-dialog > section');if(box){const detail=document.createElement('p');detail.setAttribute('role','alert');detail.textContent='Character Voice could not open: '+error.message+'. Open Voices for model status and Diagnostics for startup errors.';box.append(detail)}notify(error)});(characterDrawer||toolbar).prepend(voiceButton);
 async function openCharacterVoice(characterIndex){
  const index=characterIndex??c().characterId,character=c().characters?.[index];if(!character)throw Error('Select a character to assign their voice.');
  const ext=character.data?.extensions?.hero_tavern||character.extensions?.hero_tavern||{};
  const {box}=dialog('Voice · '+character.name);
  // Render the character voice editor immediately: a busy/missing ModelBridge
  // must never hide the settings behind a pending /tts/status request.
  const state={profiles:[],voices:[],settings:{device:'cpu'}};let voiceCatalog=null;

  const help=document.createElement('p');help.textContent='Assign and preview dialogue and narrator voices for this character. Kokoro 82M offers fast natural English preset voices without WAV, Qwen CustomVoice has multilingual built-in voices, and Flash and cloning models require a WAV. Install weights before previewing.';
  const dialogue=document.createElement('select'),narrator=document.createElement('select'),mode=document.createElement('select');
  dialogue.id='hero-character-dialogue-voice';narrator.id='hero-character-narrator-voice';
  for(const field of [dialogue,narrator])field.append(new Option('Inherit global settings',''),...(state.profiles||[]).map(p=>new Option(p.name+' · '+p.voice.engine+' '+p.voice.variant,p.id)));
  mode.append(new Option('Same voice as character · combine narration and dialogue','same'),new Option('Separate narrator','separate'));
  dialogue.value=ext.voice?.dialogueProfileId||'';narrator.value=ext.voice?.narratorProfileId||'';mode.value=ext.voice?.narratorMode||'same';
  const update=()=>{narrator.hidden=mode.value==='same'};mode.onchange=update;update();
  const label=(text,field)=>{const el=document.createElement('label');el.textContent=text;el.append(field);return el};
  const text=document.createElement('textarea');text.value='*The door opens.* “Welcome to the tavern.”';
  const audio=document.createElement('audio');audio.controls=true;
  const status=document.createElement('p');status.setAttribute('role','status');

  const assignment=()=>({dialogueProfileId:dialogue.value,narratorMode:mode.value,narratorProfileId:mode.value==='same'?'':narrator.value});
  // A native Character Voice editor, not a link to an unrelated settings screen.
  const engine=document.createElement('select');engine.id='hero-character-voice-engine';
  for(const [id,title] of [['kokoro:kokoro','Kokoro 82M · fast voices · no WAV'],['qwen:custom-0.6','Qwen CustomVoice 0.6B · no WAV'],['qwen:custom-1.7','Qwen CustomVoice 1.7B · no WAV'],['qwen:design-1.7','Qwen VoiceDesign 1.7B · voice description'],['qwen:clone-0.6','Qwen Base 0.6B · WAV + transcript'],['qwen:clone-1.7','Qwen Base 1.7B · WAV + transcript'],['flash:flash','Chatterbox Flash · WAV']])engine.add(new Option(title,id));
  const speaker=document.createElement('select');speaker.id='hero-character-voice-speaker';
  const presetSpeakers={
    kokoro:[['af_heart','Heart · US female'],['af_bella','Bella · US female'],['af_nicole','Nicole · US female'],['af_sarah','Sarah · US female'],['am_adam','Adam · US male'],['am_michael','Michael · US male'],['am_echo','Echo · US male'],['bf_emma','Emma · UK female'],['bf_isabella','Isabella · UK female'],['bm_george','George · UK male'],['bm_lewis','Lewis · UK male']],
    qwen:['Ryan','Vivian','Serena','Aiden','Dylan','Eric','Ono_Anna','Sohee','Uncle_Fu'].map(name=>[name,name])
   };
   const preferredSpeaker={kokoro:'af_heart',qwen:'Ryan'};
   let activeSpeakerEngine='';
   const updateSpeakerOptions=()=>{
    const family=engine.value.startsWith('kokoro:')?'kokoro':'qwen';
    if(activeSpeakerEngine===family)return;
    if(activeSpeakerEngine)preferredSpeaker[activeSpeakerEngine]=speaker.value;
    const selected=preferredSpeaker[family];
    speaker.replaceChildren(...presetSpeakers[family].map(([id,label])=>new Option(label,id)));
    speaker.value=presetSpeakers[family].some(([id])=>id===selected)?selected:presetSpeakers[family][0][0];
    activeSpeakerEngine=family;
   };
   speaker.onchange=()=>{preferredSpeaker[activeSpeakerEngine]=speaker.value;};
   updateSpeakerOptions();
  const mood=document.createElement('textarea');mood.rows=2;mood.placeholder='Mood / timbre / speaking style supported by VoiceDesign and both CustomVoice sizes';
  const transcript=document.createElement('input');transcript.placeholder='Exact transcript of reference WAV';
  const wav=document.createElement('select');wav.add(new Option('Choose imported WAV',''));
  for(const item of state.voices||[])wav.add(new Option(item,item));
  const upload=document.createElement('input');upload.type='file';upload.accept='.wav,audio/wav';
  const importWav=document.createElement('button');importWav.textContent='Import WAV for this voice';
  importWav.onclick=async()=>{
   const file=upload.files?.[0];if(!file){status.textContent='Choose a WAV first.';return;}
   if(file.size>12000000){status.textContent='WAV must be below 12 MB.';return;}
   importWav.disabled=true;
   try{const base64=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(Error('Could not read WAV'));r.readAsDataURL(file)});
    const v=await rpc('/tts/import',{name:file.name.replace(/\.wav$/i,''),base64});wav.replaceChildren(new Option('Choose imported WAV',''),...(v.voices||[]).map(n=>new Option(n,n)));wav.value=file.name.toLowerCase().replace(/\.wav$/i,'').replace(/[^a-z0-9_-]/g,'').slice(0,60)+'.wav';status.textContent='Reference imported.';
   }catch(e){status.textContent=e.message}finally{importWav.disabled=false}
  };
  const device=document.createElement('select');device.append(new Option('CPU','cpu'),new Option('CUDA GPU','cuda'));device.value=state.settings.device;
  const voiceOptions=()=>{const [backend,variant]=engine.value.split(':');return {engine:backend,variant,device:device.value,language:backend==='kokoro'?'English':'Auto',speaker:speaker.value,reference:backend==='kokoro'?'':wav.value,referenceText:backend==='kokoro'?'':transcript.value,style:backend==='kokoro'?'':mood.value}};
  const updateVoice=()=>{
    updateSpeakerOptions();
   const chosen=engine.value,reference=chosen.startsWith('flash:')||chosen.includes(':clone-');
   wav.parentElement.hidden=!reference;upload.parentElement.hidden=!reference;importWav.hidden=!reference;
   transcript.parentElement.hidden=!chosen.includes(':clone-');
   mood.parentElement.hidden=!(chosen.includes(':design-')||chosen.includes(':custom-'));
   speaker.parentElement.hidden=!(chosen.includes(':custom-')||chosen.startsWith('kokoro:'));
   if(voiceCatalog){const [backend,variant]=chosen.split(':');status.textContent=voiceCatalog.downloadedModels?.[backend==='flash'?'flash':backend==='kokoro'?'kokoro':variant]?'Selected voice weights are installed. Preview to verify sound.':'Selected voice weights are missing. Click Install selected model + dependencies, then Preview.';}
  };
  const saveAssignment=async()=>{if(c().characters?.[index]!==character)throw Error('Character changed. Reopen voice editor.');const latest=character.data?.extensions?.hero_tavern||character.extensions?.hero_tavern||{};const updated={...latest,characterUuid:latest.characterUuid||crypto.randomUUID(),voice:assignment()};await c().writeExtensionField(index,'hero_tavern',updated);if(character.data)character.data.extensions={...(character.data.extensions||{}),hero_tavern:updated};};
  const quick=document.createElement('button');quick.id='hero-character-voice-quick';quick.textContent='Create & assign selected voice';
  quick.onclick=async()=>{quick.disabled=true;try{const voice=voiceOptions(),name=character.name+' · '+voice.engine+' '+voice.variant+' '+(voice.speaker||'');
   const r=await rpc('/tts/profiles/save',{name,voice});dialogue.add(new Option(name,r.profile.id));dialogue.value=r.profile.id;
   await saveAssignment();status.textContent='Voice saved on character card. Preview to check speech.';
  }catch(e){status.textContent=e.message}finally{quick.disabled=false}};
  const install=document.createElement('button');install.id='hero-character-voice-install';install.textContent='Install selected model + dependencies';
  install.onclick=async()=>{install.disabled=true;try{const voice=voiceOptions();
   await rpc('/tts/configure',{engine:voice.engine,variant:voice.variant,device:voice.device});
   const state=await rpc('/tts/setup',{});
   status.textContent=state.alreadyInstalled?'Weights and runtime are installed. Run Preview to test actual speech.':'Installation started. Progress and errors are shown in Voice Library; your character voice assignment remains saved.';
  }catch(e){status.textContent=e.message}finally{install.disabled=false}};
  engine.onchange=updateVoice;
  const previewDraft=document.createElement('button');previewDraft.id='hero-character-voice-preview-draft';previewDraft.textContent='Preview selected voice settings';
  previewDraft.onclick=async()=>{previewDraft.disabled=true;status.textContent='Testing the selected voice model…';try{
   const voice=voiceOptions(),result=await rpc('/tts/speak',{...voice,text:text.value.replace(/[*“”«»]/g,'').slice(0,400)});
   audio.src=origin+result.url;status.textContent='Selected '+voice.variant+' voice generated. Save a voice profile and assign it below to use it in chat.';
   await audio.play().catch(()=>{status.textContent+=' Press Play to listen.'});
  }catch(e){status.textContent='Selected voice preview failed: '+e.message+'. Check Voice Library for installed weights and speech job log.'}finally{previewDraft.disabled=false}};
   const preview=document.createElement('button');preview.textContent='Preview character + narrator';preview.onclick=async()=>{preview.disabled=true;status.textContent='Generating preview…';try{const result=await rpc('/tts/message',{text:text.value,assignment:assignment()});audio.src=origin+result.url;status.textContent='Ready · '+result.segments+' synthesis segment(s)';await audio.play().catch(()=>{status.textContent='Ready. Press Play.'})}catch(e){status.textContent=e.message}finally{preview.disabled=false}};
  const save=document.createElement('button');save.textContent='Save character voice';save.onclick=async()=>{try{await saveAssignment();status.textContent='Saved on character card.'}catch(e){status.textContent='Save failed: '+e.message}};
  const setup=document.createElement('button');setup.textContent='Open Voice Library / create voice';setup.onclick=()=>{box.parentElement.remove();show('voices')};
  box.append(help,label('Character voice ',dialogue),label('Narration ',mode),label('Narrator voice ',narrator),label('Voice engine ',engine),label('Hardware ',device),label('Preset speaker ',speaker),label('Mood / description ',mood),label('Reference WAV ',wav),label('Transcript ',transcript),label('Import WAV ',upload),importWav,quick,install,text,previewDraft,preview,audio,save,setup,status);updateVoice();
  // Prefill the controls from cached character settings; fetch the global
  // voice catalog *after* the modal exists and never replace an edited choice.
  const refresh=document.createElement('button');refresh.textContent='Refresh installed voices';
  refresh.onclick=()=>loadVoiceCatalog();
  box.append(refresh);
  const loadVoiceCatalog=async()=>{
   refresh.disabled=true;
   const priorDialogue=dialogue.value||ext.voice?.dialogueProfileId||'',priorNarrator=narrator.value||ext.voice?.narratorProfileId||'',priorWav=wav.value;
   status.textContent='Checking installed voices…';
   try{
   const result=await rpc('/tts/status',null);voiceCatalog=result;
    const items=(result.profiles||[]).filter(p=>p&&p.id);
    for(const select of [dialogue,narrator]){
     const wanted=select===dialogue?priorDialogue:priorNarrator;
     select.replaceChildren(new Option('Inherit global settings',''),...items.map(p=>new Option(p.name+' · '+p.voice.engine+' '+p.voice.variant,p.id)));
     if(wanted&&!items.some(p=>p.id===wanted))select.add(new Option('Previously assigned · missing profile ('+wanted+')',wanted));
     select.value=wanted;
    }
    wav.replaceChildren(new Option('Choose imported WAV',''),...(result.voices||[]).map(name=>new Option(name,name)));
    wav.value=priorWav;
    if(!device.dataset.changed&&result.settings?.device)device.value=result.settings.device;
    updateVoice();
   }catch(error){status.textContent='Voice library unavailable: '+(error.message||error)+'. Kokoro, CustomVoice and VoiceDesign model choices remain visible; preview requires installed weights.';}
   finally{refresh.disabled=false;}
  };
  device.onchange=()=>device.dataset.changed='true';
  loadVoiceCatalog();
 }
 const style=document.createElement('style');style.textContent='#hero-session-toolbar{display:flex;gap:7px;align-items:center;flex-wrap:wrap;padding:8px 12px;background:#202939;border-bottom:1px solid #3a4960;flex-shrink:0;font:12px system-ui}#hero-session-name{flex:1;min-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#hero-session-toolbar button,.hero-message-menu button{background:#27354a;border:1px solid #455874;color:#dce8f6;border-radius:6px;padding:5px 8px;cursor:pointer}.hero-message-menu{font:11px system-ui;margin:6px 0;display:flex;gap:5px;flex-wrap:wrap}.hero-story-dialog{position:fixed;inset:0;z-index:2500;background:#080c12cc;display:grid;place-items:center}.hero-story-dialog>section{background:#1e2939;color:#e6edf7;border:1px solid #53627b;border-radius:14px;padding:24px;width:min(680px,90vw);max-height:85vh;overflow:auto}.hero-story-dialog button,.hero-story-dialog input,.hero-story-dialog select,.hero-story-dialog textarea{font:inherit;background:#253247;color:#e6edf7;border:1px solid #53627b;border-radius:8px;padding:10px;margin:6px 3px}.hero-story-dialog textarea{width:90%;min-height:100px}.hero-story-dialog pre{white-space:pre-wrap;overflow-wrap:anywhere}';document.head.append(style);
 toolbar.onclick=e=>{const op=e.target.dataset.story;if(!op)return;if(op==='new')newDialog().catch(notify);else if(op==='leading')openLeadingPrompt().catch(notify);else if(op==='voice')openCharacterVoice().catch(notify);else{show(op);sync().catch(notify)}};
 function dialog(title){const bg=document.createElement('div');bg.className='hero-story-dialog';const box=document.createElement('section'),h=document.createElement('h2');h.textContent=title;box.append(h);bg.append(box);document.body.append(bg);const close=document.createElement('button');close.textContent='Cancel';close.onclick=()=>bg.remove();box.append(close);return {bg,box,close};}
 async function openLeadingPrompt(){
  if(c().groupId||!c().characters?.[c().characterId]||Number(c().characterId)<0){window.toastr?.info('Select a single character to edit their leading prompt.');return;}
  const character=c().characters?.[c().characterId],ext=character?.data?.extensions?.hero_tavern||character?.extensions?.hero_tavern||{};
  const {bg,box}=dialog('Character leading prompt · '+(character?.name||'Selected character'));
  const description=document.createElement('p');description.textContent='Persistent guidance for this character: story theme, pacing, point of view, behavior rules or things the AI should keep in mind. This is added to every chat generation. It does not create a tracker or automatically update state.';
  const field=document.createElement('textarea');field.id='hero-leading-prompt-field';field.maxLength=4000;field.rows=7;field.placeholder='Example: Keep the story grounded in political intrigue; the character remains suspicious, speaks tersely, and does not control the player’s dialogue.';field.value=String(ext.leadingPrompt||'');
  const note=document.createElement('small');note.textContent='0–4,000 characters · Saved on the character card · Empty text disables it.';
  const save=document.createElement('button');save.id='hero-leading-prompt-save';save.textContent='Save leading prompt';
  const clear=document.createElement('button');clear.id='hero-leading-prompt-clear';clear.textContent='Clear prompt';
  const status=document.createElement('p');status.setAttribute('role','status');
  async function savePrompt(value){
   save.disabled=true;clear.disabled=true;status.textContent='Saving to selected character…';
   try{
    const current=c().characters?.[c().characterId];
    if(!current||current.avatar!==character.avatar)throw Error('Character selection changed. Reopen Leading Prompt.');
    const currentProfile=current.data?.extensions?.hero_tavern||current.extensions?.hero_tavern||{};
    const updated={...currentProfile,leadingPrompt:value.slice(0,4000)};
    await c().writeExtensionField(c().characterId,'hero_tavern',updated);
    if(current.data){current.data.extensions={...(current.data.extensions||{}),hero_tavern:updated}}
    if(view?.session?.characterId&&view.session.location?.avatar===character.avatar)await rpc('/story/profile',{characterId:view.session.characterId,profile:updated});
    status.textContent='Saved for '+(current.name||'this character')+'. It will apply to the next reply.';
    setTimeout(()=>{if(bg.isConnected)bg.remove()},450);
   }catch(error){status.textContent='Save failed: '+error.message;save.disabled=false;clear.disabled=false;}
  }
  save.onclick=()=>savePrompt(field.value);
  clear.onclick=()=>{field.value='';savePrompt('')};
  box.append(description,field,note,save,clear,status);
 }
 async function newDialog(){const v=await sync();if(!v)throw Error('Select a chat first.');const {bg,box}=dialog('New chat · original story stays saved'),title=document.createElement('input');title.placeholder='Session title';box.append(title);const episode=document.createElement('select');episode.append(new Option('Default opening',''));for(const e of v.characterProfile?.episodes||v.session.episodes||[])episode.append(new Option(e.title,e.id));box.append(episode);const carry=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Review continuity for a new chapter';carry.append(summary);const keys=[];for(const d of v.session.definitions.filter(d=>d.visibility!=='hidden')){const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=true;label.append(check,document.createTextNode(d.label));carry.append(label);keys.push({check,key:d.owner+':'+d.id});}const notes=document.createElement('textarea');notes.value=[v.memory.notes,v.memory.summary].filter(Boolean).join('\n');carry.append(notes);box.append(carry);
  for(const [mode,label]of [['fresh','Fresh Start'],['continue','Continue in New Session'],['duplicate','Duplicate Entire Chat']]){const button=document.createElement('button');button.textContent=label;button.onclick=async()=>{try{button.disabled=true;await run('fork',{mode,title:title.value||undefined,episodeId:episode.value,carryKeys:mode==='continue'?keys.filter(x=>x.check.checked).map(x=>x.key):[],carryMemory:mode==='continue'?notes.value:''});bg.remove()}catch(error){button.disabled=false;notify(error)}};box.append(button);}
  for(const mark of v.session.bookmarks){const button=document.createElement('button');button.textContent='Start from '+mark.label;button.onclick=async()=>{try{const index=v.messages.findIndex(m=>m.extra.heroMessageId===mark.messageId);await run('fork',{mode:'branch',atIndex:index,bookmarkId:mark.id,title:title.value||mark.label});bg.remove()}catch(error){notify(error)}};box.append(button);}
 }
 async function rewind(index){const preview=await run('preview',{index}),{bg,box}=dialog('Rollback preview'),text=document.createElement('pre');text.textContent=preview.affected+' later messages are affected.\n'+preview.changes.map(x=>x.key+': '+JSON.stringify(x.from)+' → '+JSON.stringify(x.to)).join('\n')+'\n'+preview.memory+'\n'+preview.media;box.append(text);for(const [op,label]of [['fork','Rewind as New Branch (recommended)'],['restore','Restore This Session · preserve future as recovery']]){const b=document.createElement('button');b.textContent=label;b.onclick=async()=>{try{b.disabled=true;await run(op,{mode:'branch',atIndex:index,expectedHead:preview.head});bg.remove()}catch(e){b.disabled=false;notify(e)}};box.append(b)}}

 const trackerStrip=document.createElement('section');trackerStrip.id='hero-live-trackers';trackerStrip.setAttribute('aria-label','Live character trackers');if(sheld)sheld.prepend(trackerStrip);
 const trackStyle=document.createElement('style');trackStyle.textContent=`
 #hero-live-trackers{background:#1b2737;color:#e9edf6;border-bottom:1px solid #40556d;padding:8px 12px;font:12px system-ui;display:block}
 #hero-live-trackers[hidden]{display:none}
 #hero-live-trackers .hero-track-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 8px}
 #hero-live-trackers .hero-track-head strong{font-size:13px}
 #hero-live-trackers button{font:inherit;background:#273850;border:1px solid #50617b;border-radius:7px;color:inherit;padding:5px 9px;cursor:pointer}
 #hero-live-trackers .hero-track-grid{display:flex;gap:8px;flex-wrap:wrap}
 #hero-live-trackers .hero-track-card{border:1px solid #40546c;background:#233247;border-radius:10px;padding:9px 11px;min-width:145px;max-width:260px;flex:1 1 150px;display:flex;flex-direction:column;gap:6px}
 #hero-live-trackers .hero-track-title{display:flex;gap:6px;align-items:center;font-weight:600}
 #hero-live-trackers .hero-track-value{font-size:13px;overflow-wrap:anywhere}
 #hero-live-trackers .hero-track-bar{height:6px;border-radius:12px;background:#46546a;overflow:hidden}
 #hero-live-trackers .hero-track-bar>span{display:block;background:#e3bc7c;height:100%;border-radius:12px}
 #hero-live-trackers .hero-track-card small{color:#b0c0d2;font-size:11px;line-height:1.4;max-height:44px;overflow:hidden}
 #hero-live-trackers .hero-track-meta{color:#acc0d5}
 #hero-live-trackers details{width:100%}
 #hero-live-trackers details>summary{cursor:pointer;margin-top:3px}
 #hero-live-trackers .hero-track-actions{display:flex;gap:5px;flex-wrap:wrap}
 @media(max-width:700px){#hero-live-trackers .hero-track-card{min-width:110px;flex-basis:130px}#hero-live-trackers{padding:7px}}
 `;document.head.append(trackStyle);
 function renderTrackerStrip(){
  trackerStrip.hidden=!view?.session||!selected();if(trackerStrip.hidden)return;
  trackerStrip.replaceChildren();const head=document.createElement('div');head.className='hero-track-head';
  const name=document.createElement('strong');name.textContent='WTracker · current scene';head.append(name);
  const analysis=view.session.lastAnalysis,status=document.createElement('span');status.className='hero-track-meta';
  status.textContent=analysis?.partial?'Update needs retry: '+(analysis.error||analysis.errors?.[0]||'Unknown error'):analysis?'Snapshot saved · '+analysis.changes+' changed fields':'Waiting for the first scene snapshot';head.append(status);
  const update=document.createElement('button');update.textContent='Update now';update.onclick=async()=>{update.disabled=true;try{const current=await sync();view=await rpc('/story/analyze',{id:current.session.id,recheck:true});publish()}catch(e){notify(e)}finally{update.disabled=false}};head.append(update);
  const manage=document.createElement('button');manage.textContent='Edit trackers';manage.onclick=()=>{show('trackers');sync().catch(notify)};head.append(manage);
  const collapse=document.createElement('button');collapse.textContent=trackerStrip.dataset.collapsed==='true'?'Expand':'Collapse';collapse.onclick=()=>{trackerStrip.dataset.collapsed=trackerStrip.dataset.collapsed==='true'?'false':'true';renderTrackerStrip()};head.append(collapse);trackerStrip.append(head);
  if(trackerStrip.dataset.collapsed==='true')return;
  const grid=document.createElement('div');grid.className='hero-track-grid';
  for(const d of view.session.definitions.filter(d=>d.enabled!==false&&d.visibility!=='hidden')){
   const key=d.owner+':'+d.id;if(!Object.hasOwn(view.context.state,key))continue;
   const card=document.createElement('article');card.className='hero-track-card';const title=document.createElement('strong');title.textContent=d.label;
   const value=view.context.state[key],text=document.createElement('div');text.className='hero-track-value';text.style.whiteSpace='pre-wrap';text.textContent=typeof value==='string'?value:JSON.stringify(value,null,2);card.append(title,text);grid.append(card);
  }
  trackerStrip.append(grid);
 }
 let currentGeneration='normal';c().eventSource.on(c().eventTypes.GENERATION_STARTED,type=>{currentGeneration=type;});
 // SillyTavern does not await async GENERATE_AFTER_DATA handlers. Never await
 // saveChat()/sync() here: the prompt may already be sent before hero_context
 // and tracker/character metadata reach the inference backend.
 c().eventSource.on(c().eventTypes.GENERATE_AFTER_DATA,(data,dryRun)=>{
  if(dryRun||!selected()||['quiet','impersonate'].includes(currentGeneration))return;
  const current=c(),loc=location(),stored=current.chatMetadata?.hero_tavern||{};
  const matches=!!view?.session&&view.session.location?.filename===loc.filename&&view.session.location?.avatar===loc.avatar&&view.session.location?.group===loc.group;
  const sessionId=matches?view.session.id:stored.sessionId||'';
  const messages=current.chat.map(m=>({role:m.is_user?'user':m.is_system?'system':'assistant',name:m.name,text:m.mes}));
  const char=current.characters?.[current.characterId],cardData=char?.data||char||{};
  data.hero_context={...(data.hero_context||{}),id:sessionId||legacy(),...(sessionId?{sessionId}:{ }),messages,generationType:currentGeneration};
  data.hero_context.character={
   name:String(cardData.name||char?.name||'').slice(0,180),
   description:String(cardData.description||'').slice(0,4400),
   personality:String(cardData.personality||'').slice(0,2000),
   scenario:String(cardData.scenario||'').slice(0,1500),
   mes_example:String(cardData.mes_example||'').slice(0,1000),
   leadingPrompt:String(cardData.extensions?.hero_tavern?.leadingPrompt||char?.extensions?.hero_tavern?.leadingPrompt||'').slice(0,4000)
  };
  if(actionInstruction)data.hero_context.oneReply=actionInstruction;
 });
 let generating=false,rerunAfterSync=false;c().eventSource.on(c().eventTypes.GENERATION_STARTED,(_type,_options,dryRun)=>{if(!dryRun)generating=true});c().eventSource.on(c().eventTypes.GENERATION_ENDED,()=>{generating=false});
 const schedule=()=>{if(syncing){rerunAfterSync=true;return;}clearTimeout(scheduled);scheduled=setTimeout(async()=>{
  if(generating){schedule();return;}
  if(syncing){rerunAfterSync=true;return;}
  if(!selected())return;
  syncing=true;
  try{
   let v=await sync();
   if(v.session.definitions.some(d=>d.enabled!==false&&d.updateMode!=='manual')){
    // One background analysis per cycle. A fast next-turn event is coalesced,
    // rather than blocking SillyTavern or flooding an already-busy local model.
    try{
     v=await rpc('/story/analyze',{id:v.session.id});view=v;publish();
     const analysis=v.session.lastAnalysis||{};
     if(analysis.partial||analysis.failed){
      const wait=Math.max(1500,(analysis.retryAt||Date.now()+15000)-Date.now());
      clearTimeout(scheduled);scheduled=setTimeout(schedule,wait+250);
     }else if(analysis.backlog>0){
      clearTimeout(scheduled);scheduled=setTimeout(schedule,700);
     }
    }catch(error){
     window.toastr?.warning('WTracker will retry; the saved snapshot is unchanged. '+error.message,'Tracker diagnostics');
     clearTimeout(scheduled);scheduled=setTimeout(schedule,18000);
    }
   }
  }catch(error){notify(error)}finally{syncing=false;if(rerunAfterSync){rerunAfterSync=false;schedule()}}
 },500)};
 for(const name of ['CHAT_CHANGED','GENERATION_ENDED','MESSAGE_SWIPED','MESSAGE_EDITED','MESSAGE_DELETED','MESSAGE_RECEIVED','MESSAGE_SENT'])if(c().eventTypes[name])c().eventSource.on(c().eventTypes[name],schedule);
 const observer=new MutationObserver(()=>updateMessageMenus());if(document.querySelector('#chat'))observer.observe(document.querySelector('#chat'),{childList:true});
 window.HeroStory={sync,run,get view(){return view},newDialog,rewind};
 return window.HeroStory;
}
