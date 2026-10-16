// New WTracker field editor; no legacy operation/proposal UI.
(()=>{
 const $=id=>document.getElementById(id),key=d=>d.owner+':'+d.id;
 let current,send,refresh;
 const fail=e=>{$('story-error').textContent=e.message||String(e)};
 const button=(text,fn)=>{const b=document.createElement('button');b.textContent=text;b.onclick=async()=>{b.disabled=true;try{await fn()}catch(e){fail(e)}finally{b.disabled=false}};return b};
 const label=(name,input)=>{const l=document.createElement('label');l.textContent=name;l.append(input);return l};
 const input=(value,type='text')=>{const i=document.createElement(type==='textarea'?'textarea':'input');if(type!=='textarea')i.type=type;i.value=value??'';return i};
 function editor(value){
  const wrap=document.createElement('div');wrap.className='wtracker-value-editor';let get;
  if(Array.isArray(value)){
   const items=structuredClone(value),rows=document.createElement('div');let children=[];
   const draw=()=>{rows.replaceChildren();children=items.map((v,i)=>{const child=editor(v),row=document.createElement('div');row.className='card';row.append(child,button('Remove entry',()=>{items.splice(i,1);draw()}));rows.append(row);return child})};draw();
   wrap.append(rows,button('Add entry',()=>{const text=prompt('New entry (text or JSON object)');if(text===null)return;let v=text;try{v=JSON.parse(text)}catch{}items.push(v);draw()}));get=()=>children.map(c=>c.read());
  }else if(value!==null&&typeof value==='object'){
   const children=Object.entries(value).map(([k,v])=>{const child=editor(v);wrap.append(label(k,child));return [k,child]});get=()=>Object.fromEntries(children.map(([k,c])=>[k,c.read()]));
  }else if(typeof value==='boolean'){
   const i=document.createElement('input');i.type='checkbox';i.checked=value;wrap.append(i);get=()=>i.checked;
  }else if(typeof value==='number'){
   const i=input(value,'number');i.step='any';wrap.append(i);get=()=>{if(!i.value.trim()||!Number.isFinite(Number(i.value)))throw Error('Enter a finite number.');return Number(i.value)};
  }else if(value===null){
   const i=input('null','textarea');i.setAttribute('aria-label','Value as JSON');wrap.append(i);get=()=>JSON.parse(i.value);
  }else{
   const i=input(value,'textarea');i.rows=3;wrap.append(i);get=()=>i.value;
  }
  wrap.read=get;return wrap;
 }
 function render(view,dispatch,rerender){
  current=view;send=dispatch;refresh=rerender;
  $('wtracker-notice').textContent=view.session.trackerNotice||'';
  const job=view.session.lastAnalysis;
  $('wtracker-status').textContent=job?.partial?'Update failed: '+(job.error||job.errors?.join('; '))+' — previous snapshot retained. Use Update current scene to retry.':job?'Snapshot saved '+new Date(job.at).toLocaleTimeString()+' · '+job.changes+' changed fields':'Ready. A scene snapshot is generated after a completed character reply.';
  $('wtracker-log').textContent=JSON.stringify({engine:view.session.trackerEngine,lastJob:job||null,failures:view.session.failures||[]},null,2);
  const owner=$('wtracker-owner'),chosen=owner.value;owner.replaceChildren(...Object.entries(view.owners).map(([name,id])=>new Option(name.replace(/\.png$/,''),'character:'+id)));owner.value=[...owner.options].some(o=>o.value===chosen)?chosen:'character:'+view.session.characterId;
  const presets=$('wtracker-presets');presets.replaceChildren();
  for(const [name,defs]of view.templates){presets.append(button('Add '+name,async()=>{const selected=owner.value||'character:'+view.session.characterId,missing=defs.filter(d=>!current.session.definitions.some(existing=>existing.id===d.id&&existing.owner===selected));if(!missing.length)throw Error('These fields already exist.');current=await send('definitions',{definitions:missing.map(d=>({...d,owner:selected}))});refresh()}));}
  const values=$('wtracker-values');values.replaceChildren();
  for(const d of view.session.definitions){if(d.visibility==='hidden'&&!$('wtracker-hidden').checked)continue;
   const node=document.createElement('article');node.className='card';const title=document.createElement('h3');title.textContent=d.label;const description=document.createElement('p');description.textContent=d.description;
   const value=editor(view.context.state[key(d)]??d.initialValue);node.append(title,description,value,button('Save value',async()=>{const source=current.messages.at(-1);if(!source)throw Error('Start this chat first.');current=await send('patch',{patch:[{key:key(d),value:value.read(),sourceMessageId:source.extra.heroMessageId}]});refresh()}));
   const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Field settings';details.append(summary);
   const name=input(d.label),desc=input(d.description,'textarea'),instructions=input(d.instructions,'textarea'),rules=input(d.changeRules,'textarea'),enabled=document.createElement('input'),hidden=document.createElement('input'),manual=document.createElement('input');
   enabled.type=hidden.type=manual.type='checkbox';enabled.checked=d.enabled!==false;hidden.checked=d.visibility==='hidden';manual.checked=d.updateMode==='manual';
   details.append(label('Label',name),label('Track / update rules',desc),label('Additional limits',rules),label('Story consequences',instructions),label('Enabled',enabled),label('Hidden',hidden),label('Manual updates only',manual),button('Save settings',async()=>{current=await send('definition-edit',{key:key(d),updates:{label:name.value,description:desc.value,changeRules:rules.value,instructions:instructions.value,enabled:enabled.checked,visibility:hidden.checked?'hidden':'player',updateMode:manual.checked?'manual':'automatic'}});refresh()}),button('Delete field',async()=>{current=await send('definition-delete',{key:key(d)});refresh()}));
   node.append(details);values.append(node);
  }
 }
 $('wtracker-hidden').onchange=()=>refresh?.();
 $('wtracker-update').onclick=async()=>{const b=$('wtracker-update');b.disabled=true;$('wtracker-status').textContent='Generating a complete scene snapshot…';try{current=await send('analyze',{recheck:true});refresh()}catch(e){fail(e);$('wtracker-status').textContent=e.message}finally{b.disabled=false}};
 $('wtracker-type').onchange=()=>{$('wtracker-initial').value=JSON.stringify({text:'Unknown',number:0,boolean:false,list:[],clock:'--:--',record:{summary:'Unknown'}}[$('wtracker-type').value],null,2)};
 $('wtracker-add').onclick=async()=>{try{current=await send('definitions',{definitions:[{id:$('wtracker-id').value.trim(),owner:$('wtracker-owner').value,label:$('wtracker-label').value.trim(),type:$('wtracker-type').value,initialValue:JSON.parse($('wtracker-initial').value),description:$('wtracker-description').value,instructions:$('wtracker-instructions').value,updateMode:'automatic'}]});refresh()}catch(e){fail(e)}};
 $('wtracker-design').onclick=async()=>{const b=$('wtracker-design');b.disabled=true;try{const result=await send('helper',{kind:'trackers',brief:$('wtracker-brief').value,context:JSON.stringify({character:current.session.profile,existing:current.session.definitions.map(d=>d.label)})});const drafts=$('wtracker-drafts');drafts.replaceChildren();for(const draft of result.trackers){const node=document.createElement('article');node.className='card';const text=input(JSON.stringify(draft,null,2),'textarea');text.rows=10;node.append(text,button('Add field',async()=>{current=await send('definitions',{definitions:[{...JSON.parse(text.value),owner:$('wtracker-owner').value}]});node.remove();refresh()}));drafts.append(node)}}catch(e){fail(e)}finally{b.disabled=false}};
 window.HeroWTrackerRender=render;
})();
