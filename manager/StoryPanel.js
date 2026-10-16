// Accessible session / tracker / lore controls; native data is coordinated by the parent extension.
(()=>{
 let lastViewKey='',view=null,helperDraft=null,loreDrafts=[],pending=new Map();const $=id=>document.getElementById(id);
 const send=(op,data={})=>new Promise((resolve,reject)=>{const requestId=crypto.randomUUID(),timer=setTimeout(()=>{pending.delete(requestId);reject(Error('Story operation timed out.'))},600000);pending.set(requestId,{resolve,reject,timer});parent.postMessage({type:'hero-story-command',op,data,requestId},location.origin.replace(':8001',':8000'));});
 const fail=e=>{$('story-error').textContent=e.message||String(e)};
 const button=(label,fn)=>{const b=document.createElement('button');b.textContent=label;b.onclick=async()=>{b.disabled=true;try{$('story-error').textContent='';await fn()}catch(e){fail(e)}finally{b.disabled=false}};return b};
 const card=(title,text='')=>{const node=document.createElement('article');node.className='card';const h=document.createElement('strong'),p=document.createElement('p');h.textContent=title;p.textContent=text;node.append(h,p);return node};
 const key=d=>d.owner+':'+d.id;
 window.addEventListener('message',e=>{if(!trustedParent(e))return;if(e.data?.type==='hero-story-result'){const p=pending.get(e.data.requestId);if(p){clearTimeout(p.timer);pending.delete(e.data.requestId);e.data.error?p.reject(Error(e.data.error)):p.resolve(e.data.result)}return;}if(e.data?.type==='hero-story-view'){const next=e.data.view,nextKey=JSON.stringify([next.session.id,next.session.definitions,next.session.events,next.session.lastAnalysis,next.session.lore,next.session.bookmarks,next.session.recoveryId,next.session.title,next.messages.length,next.owners,next.context.state]);view=next;const editing=document.activeElement?.matches('input,textarea,select')&&document.activeElement.closest('#trackers');if(nextKey!==lastViewKey&&!editing){lastViewKey=nextKey;render();}}});
 async function history(){const sessions=await send('list',{query:$('story-search').value,archived:$('story-archived').checked}),list=$('story-sessions');list.replaceChildren();for(const s of sessions){const node=card(s.title,s.count+' messages · '+new Date(s.updatedAt).toLocaleString()+'\n'+String(s.last).slice(0,180));if(s.parent){const p=document.createElement('p');p.textContent='Branch from '+(sessions.find(x=>x.id===s.parent.sessionId)?.title||s.parent.sessionId);node.append(p,button('Open parent',()=>send('open',{id:s.parent.sessionId})));}node.append(button('Open',()=>send('open',{id:s.id})),button('Rename',async()=>{const title=prompt('Session title',s.title);if(title){await request('/story/metadata',{id:s.id,title});await history()}}),button(s.archived?'Unarchive':'Archive',async()=>{await request('/story/metadata',{id:s.id,archived:!s.archived});await history()}));list.append(node)}}
 function render(){if(!view)return;$('story-current').textContent=view.session.title+' · '+view.messages.length+' messages';window.HeroWTrackerRender?.(view,send,render);
  const marks=$('story-bookmarks');marks.replaceChildren();for(const m of view.session.bookmarks){const node=card(m.label,'Saved message '+(m.index+1));node.append(button('Start from bookmark',()=>send('fork',{mode:'branch',atIndex:view.messages.findIndex(x=>x.extra.heroMessageId===m.messageId),bookmarkId:m.id,title:m.label})));marks.append(node)}
  const condition=$('lore-condition-key'),old=condition.value;condition.replaceChildren(new Option('No state condition',''),...view.session.definitions.map(d=>new Option(d.label,key(d))));condition.value=old;
  const lore=$('lore-entries');lore.replaceChildren();for(const e of view.session.lore||[]){const activated=view.context.lore.find(x=>x.id===e.id),node=card(e.label||'Lore entry',e.visibility==='hidden'?'Hidden creator entry':e.text);const reason=document.createElement('p');reason.className='small';reason.textContent=activated?.reason||'Awaiting generation context';node.append(reason,button('Edit',()=>fillLore(e)),button('Remove',async()=>{view=await send('metadata',{lore:view.session.lore.filter(x=>x.id!==e.id)});render()}));lore.append(node)}
  $('story-undo').disabled=!view.session.recoveryId;
 }
 $('story-search-button').onclick=()=>history().catch(fail);$('story-archived').onchange=()=>history().catch(fail);
 $('story-new').onclick=()=>parent.postMessage({type:'hero-open-new-chat'},location.origin.replace(':8001',':8000'));
 $('story-duplicate').onclick=()=>send('fork',{mode:'duplicate'}).catch(fail);$('story-undo').onclick=()=>send('undo-rollback').catch(fail);
 $('story-export').onclick=async()=>{try{const packet=await send('export'),a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(packet)],{type:'application/json'}));a.download='hero-story-archive.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);if(packet.missingMedia.length)fail('Missing media dependencies: '+packet.missingMedia.join(', '))}catch(e){fail(e)}};
 $('story-export-md').onclick=async()=>{try{const packet=await send('export'),a=document.createElement('a');a.href=URL.createObjectURL(new Blob([packet.markdown],{type:'text/markdown'}));a.download='hero-story.md';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}catch(e){fail(e)}};
 $('story-import').onchange=async e=>{try{const packet=JSON.parse(await e.target.files[0].text()),result=await send('import',{packet});await history();if(result.missingMedia.length)fail('Imported with missing media: '+result.missingMedia.join(', '))}catch(e){fail(e)}};
 if($('lore-ai-brief'))$('lore-ai-brief').oninput=()=>{$('lore-ai-count').textContent=$('lore-ai-brief').value.length+' / 200,000 characters';};
 $('lore-helper').onclick=async()=>{try{
  const brief=$('lore-ai-brief').value;if(!brief.trim())throw Error('Describe the lore or paste source text.');
  $('lore-helper').disabled=true;$('lore-ai-status').textContent='Drafting lore entries…';
  const draft=await send('helper',{kind:'lore',brief,context:JSON.stringify(view?.session.profile||{})});
  const box=$('story-helper-drafts');box.replaceChildren();
  for(const item of draft.lore){const node=card(item.label||item.id,item.text),editor=document.createElement('textarea');editor.value=JSON.stringify(item,null,2);node.append(editor,button('Review in editor',()=>fillLore(JSON.parse(editor.value))),button('Add to this chat',async()=>{const entry=JSON.parse(editor.value);view=await send('metadata',{lore:[...view.session.lore.filter(e=>e.id!==entry.id),entry]});render()}));box.append(node);}
  $('lore-ai-status').textContent='Draft ready.';
 }catch(e){fail(e);$('lore-ai-status').textContent=e.message}finally{$('lore-helper').disabled=false}};
 function fillLore(e){$('lore-condition-field').value=e.condition?.field||'';$('lore-id').value=e.id||'';$('lore-title').value=e.label||'';$('lore-text').value=e.text||'';$('lore-keywords').value=(e.keywords||[]).join(', ');$('lore-hidden').checked=e.visibility==='hidden';$('lore-condition-key').value=e.condition?.key||'';$('lore-condition-op').value=e.condition?.op||'eq';$('lore-condition-value').value=e.condition?.value??'';}
 $('lore-native-save').onclick=async()=>{
  const button=$('lore-native-save'),name=$('lore-native-name').value.trim();
  button.disabled=true;$('story-error').textContent='';
  button.textContent='Saving lorebook…';
  const report=$('lore-native-status')||(()=>{const el=document.createElement('p');el.id='lore-native-status';el.setAttribute('role','status');button.after(el);return el})();
  report.textContent='Saving '+name+' to native SillyTavern World Info…';
  try{
   const result=await Promise.race([
    send('lore-save-native',{name}),
    new Promise((_,reject)=>setTimeout(()=>reject(Error('Native lorebook operation timed out after 20 seconds.')),20000))
   ]);
   report.textContent='Saved '+(result.name||name)+' · '+(result.entries||0)+' entries. Available in native World Info.';
  }catch(error){report.textContent='Save failed: '+error.message;fail(error)}
  finally{button.disabled=false;button.textContent='Save reusable lorebook'}
};$('lore-native-load').onclick=async()=>{try{view=await send('lore-load-native',{name:$('lore-native-name').value});render()}catch(e){fail(e)}};
 $('lore-save').onclick=async()=>{try{const k=$('lore-condition-key').value;let value=$('lore-condition-value').value;if(value==='true'||value==='false')value=value==='true';else if(value.trim()!==''&&Number.isFinite(Number(value)))value=Number(value);const entry={id:$('lore-id').value||crypto.randomUUID(),label:$('lore-title').value,text:$('lore-text').value,keywords:$('lore-keywords').value.split(',').map(x=>x.trim()).filter(Boolean),visibility:$('lore-hidden').checked?'hidden':'player',condition:k?{key:k,field:$('lore-condition-field').value.trim()||undefined,op:$('lore-condition-op').value,value}:null};if(!entry.text.trim())throw Error('Enter lore text.');view=await send('metadata',{lore:[...view.session.lore.filter(e=>e.id!==entry.id),entry]});fillLore({});render()}catch(e){fail(e)}};
 $('lore-preview').onclick=async()=>{try{view=await request('/story/get',{id:view.session.id,query:$('lore-test').value});render()}catch(e){fail(e)}};
 $('inspector-refresh').onclick=async()=>{try{const result=await send('inspect');$('inspector-meta').textContent=result?JSON.stringify({...result,prompt:undefined},null,2):'Generate a reply first.';$('inspector-prompt').textContent=result?.prompt||''}catch(e){fail(e)}};
 for(const b of document.querySelectorAll('[data-generate-kind]'))b.onclick=()=>send('generate',{kind:b.dataset.generateKind,instruction:$('story-direction').value,amount:Number($('story-time-amount').value),unit:$('story-time-unit').value}).catch(fail);
 window.HeroStoryPanel={send,history,render,get view(){return view}};
 const baseTab=tab;tab=function(name){baseTab(name);if(view)render();if(['history','trackers','lore','inspector'].includes(name)){parent.postMessage({type:'hero-section-ready',section:name},location.origin.replace(':8001',':8000'));if(name==='history')history().catch(fail);}};
})();
