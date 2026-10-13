'use strict';
async function buildWriterContext(w,budget,count){
 const active=w.lore.filter(e=>e.enabled!==false&&(e.always||e.keys.some(k=>w.text.slice(-12000).toLowerCase().includes(k.toLowerCase()))));
 const prefix=['[Story memory]\n'+w.memory,...active.map(e=>'[Lore: '+e.title+']\n'+e.text),'[Author’s note]\n'+w.note].join('\n\n');
 const instruction=w.operation==='continue'?'Continue the manuscript seamlessly. Return only new prose, without repeating the existing text.':w.operation==='insert'?'Write prose filling the insertion point. Return only the inserted prose, keeping both surrounding passages intact.':'Rewrite only the selected passage according to the request: '+w.instruction;
 const start=w.start??w.text.length,end=w.end??start,selection=w.text.slice(start,end),suffix=w.operation==='continue'?'':w.text.slice(end,end+6000);
 const render=tail=>'<|im_start|>user\n'+prefix+'\n\n'+instruction+(selection?'\n[Selected passage]\n'+selection:'')+(suffix?'\n[Following passage]\n'+suffix:'')+'\n[Manuscript before insertion]\n'+tail+'<|im_end|>\n<|im_start|>assistant\n';
 if(await count(render(''))>budget)throw Error('Memory, note, lore or selection exceeds the available context. Shorten it or increase loaded context.');
 const source=w.text.slice(0,start);let low=0,high=source.length;
 while(low<high){const mid=Math.ceil((low+high)/2);if(await count(render(source.slice(-mid)))<=budget)low=mid;else high=mid-1;}
 const tail=low?source.slice(-low):'',prompt=render(tail);
 return {prompt,diagnostics:{activeLore:active.map(e=>e.title),omittedLore:w.lore.filter(e=>!active.includes(e)).map(e=>e.title),retainedCharacters:tail.length,omittedCharacters:source.length-tail.length,promptTokens:await count(prompt),budget}};
}
module.exports={buildWriterContext};
