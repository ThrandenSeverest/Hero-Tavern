'use strict';
// Conservative, language-independent detection: long passages copied from recent
// manuscript are a stalled continuation, but short natural echoes remain valid.
function normalized(text){return String(text||'').replace(/<think>[\s\S]*?<\/think>/gi,'').replace(/[“”‘’]/g,'"').replace(/\s+/g,' ').trim().toLowerCase();}
function writerRepetitionIssue(candidate,manuscript){
 const proposed=normalized(candidate),recent=normalized(String(manuscript||'').slice(-6500));
 if(proposed.length<110||recent.length<140)return '';
 const beginning=proposed.slice(0,Math.min(170,proposed.length));
 if(beginning.length>=110&&recent.includes(beginning))return 'The new passage copies a recent manuscript opening.';
 const sentences=proposed.match(/[^.!?。！？]+[.!?。！？]+/g)||[];
 const repeated=sentences.filter(s=>s.trim().length>=75&&recent.includes(s.trim()));
 if(repeated.length>=2&&repeated.join(' ').length>proposed.length*.4)return 'The generated passage repeats multiple established sentences.';
 const words=proposed.split(/\s+/),prior=recent.split(/\s+/);
 if(words.length>=35&&prior.length>=35){
  const first=words.slice(0,Math.min(35,words.length)).join(' ');
  if(first.length>=130&&recent.includes(first))return 'The generated passage replays the last manuscript events.';
 }
 return '';
}
module.exports={writerRepetitionIssue};
