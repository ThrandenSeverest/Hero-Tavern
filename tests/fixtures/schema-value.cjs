// Deterministic schema-valid answers for browser plumbing tests, independent
// of prompt examples. This does not simulate extraction quality.
module.exports=function value(s){
 if(s.example!==undefined)return s.example;
 if(s.enum)return s.enum[0];
 const type=Array.isArray(s.type)?s.type[0]:s.type;
 if(type==='object')return Object.fromEntries(Object.entries(s.properties||{}).map(([k,v])=>[k,value(v)]));
 if(type==='array')return [];
 if(type==='number'||type==='integer')return s.minimum??0;
 if(type==='boolean')return false;
 if(type==='null')return null;
 return s.pattern?.includes('--:--')?'--:--':'Unknown';
};
