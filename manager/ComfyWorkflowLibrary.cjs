'use strict';
// User-selected local ComfyUI API workflows, useful for Z-Image / Flux / Qwen multi-component models.
// API graph JSON only: UI workflow exports must first be saved in ComfyUI's API format.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ALLOWED=new Set([
 'CheckpointLoaderSimple','UNETLoader','VAELoader','CLIPLoader','DualCLIPLoader','TripleCLIPLoader','CLIPTextEncode','CLIPTextEncodeFlux',
 'EmptyLatentImage','EmptySD3LatentImage','EmptyFlux2LatentImage','CLIPSetLastLayer','FluxGuidance','ModelSamplingFlux','ModelSamplingSD3','ModelSamplingDiscrete','ConditioningZeroOut',
 'ConditioningCombine','ConditioningSetArea','ConditioningSetMask','LoraLoader','LoraLoaderModelOnly','LoraLoaderModelOnlyAdvanced',
 'KSampler','KSamplerAdvanced','KSamplerSelect','SamplerCustom','SamplerCustomAdvanced','BasicScheduler','CFGGuider','RandomNoise','VAEDecode',
 'VAEEncode','VAEEncodeForInpaint','SaveImage','PreviewImage','ImageScale','ImageScaleBy','LoadImage','LoadImageMask','ImageCompositeMasked',
 'ImagePadForOutpaint','ControlNetLoader','ControlNetApplyAdvanced','InstructPixToPixConditioning','DifferentialDiffusion',
 'ReferenceLatent','ReferenceLatentMultiple','ConditioningAverage','ImageBatch','Flux2Scheduler','Flux2ModelSampling'
]);
const DANGEROUS=/(?:shell|command|execute|python|script|terminal|eval|download|http|request|webhook|api.?call|exec|file.?write|file.?delete)/i;
function sanitize(graph,{allowCustomNodes=false}={}){
 if(!graph||typeof graph!=='object'||Array.isArray(graph))throw Error('Export a ComfyUI API workflow JSON object.');
 const keys=Object.keys(graph);
 if(!keys.length||keys.length>180)throw Error('ComfyUI workflow must contain 1–180 nodes.');
 let outputNode=null;const custom=new Set();
 for(const id of keys){
  if(!/^[1-9]\d{0,9}$/.test(id))throw Error('Expected numeric API node IDs. Export in API format, not ComfyUI UI format.');
  const entry=graph[id];
  if(!entry||typeof entry!=='object'||!entry.inputs||typeof entry.inputs!=='object'||Array.isArray(entry.inputs)||typeof entry.class_type!=='string'||!/^[-\w]{2,100}$/.test(entry.class_type))throw Error('Invalid API node '+id+'.');
  if(DANGEROUS.test(entry.class_type))throw Error('Potentially unsafe workflow node: '+entry.class_type);
  if(!ALLOWED.has(entry.class_type))custom.add(entry.class_type);
  if(entry.class_type==='SaveImage')outputNode=id;
 }
 if(!outputNode)throw Error('A ComfyUI SaveImage node must be present to collect output into Hero Tavern.');
 if(custom.size&&!allowCustomNodes)throw Error('Workflow uses custom/unlisted nodes: '+[...custom].join(', ')+'. Import with explicit custom-node permission only after reviewing their source.');
 const raw=JSON.stringify(graph);
 if(raw.length>220000)throw Error('Workflow API JSON must be below 220 KB.');
 if(/(?:https?:\/\/|file:\/\/|\\\\\\\\|[a-z]:\\)/i.test(raw))throw Error('Imported workflows must not contain external URLs or absolute file paths.');
 return {graph:JSON.parse(raw),outputNode,customNodes:[...custom]};
}
function apply(graph,params={}){
 const result=JSON.parse(JSON.stringify(graph));
 const seed=Number.isInteger(params.seed)&&params.seed>=0?params.seed:crypto.randomInt(0,2147483647);
 const values={
  '{{prompt}}':String(params.prompt||'').slice(0,12000),
  '{{positive}}':String(params.prompt||'').slice(0,12000),
  '{{negative}}':String(params.negative_prompt||'').slice(0,12000),
  '{{seed}}':seed,'{{steps}}':Number(params.steps)||20,
  '{{width}}':Number(params.width)||1024,'{{height}}':Number(params.height)||1024,
  '{{guidance}}':Number(params.cfg_scale)||5,'{{source}}':String(params.sourceImage||''),'{{mask}}':String(params.maskImage||'')
 };
 const transform=v=>{
  if(typeof v==='string'){
   if(Object.prototype.hasOwnProperty.call(values,v))return values[v];
   return v.replace(/\{\{(prompt|positive|negative)\}\}/g,(a)=>String(values[a]));
  }
  if(Array.isArray(v))return v.map(transform);
  if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,transform(x)]));
  return v;
 };
 for(const item of Object.values(result))item.inputs=transform(item.inputs);
 return {graph:result,seed};
}
function createWorkflowLibrary(root){
 const dir=path.join(root,'ImageWorkflows');fs.mkdirSync(dir,{recursive:true});
 function fileFor(id){if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid workflow ID.');return path.join(dir,id+'.json')}
 function importWorkflow({name,workflow,confirm=false,allowCustomNodes=false}={}){
  if(confirm!==true)throw Error('Confirm importing a reviewed local ComfyUI API workflow.');
  if(typeof name!=='string'||!name.trim()||name.length>90)throw Error('Name this workflow (1–90 characters).');
  const payload=typeof workflow==='string'?JSON.parse(workflow):workflow;
  const validated=sanitize(payload,{allowCustomNodes});
  const id=crypto.randomUUID(),file=fileFor(id);
  fs.writeFileSync(file,JSON.stringify({id,name:name.trim(),graph:validated.graph,createdAt:new Date().toISOString(),customNodes:validated.customNodes},null,2),{flag:'wx'});
  return {id,name:name.trim(),nodes:Object.keys(validated.graph).length,customNodes:validated.customNodes};
 }
 function get(id){
  const file=fileFor(id);if(!fs.existsSync(file)||fs.lstatSync(file).isSymbolicLink())throw Error('Workflow was not found.');
  const item=JSON.parse(fs.readFileSync(file,'utf8'));if(item.id!==id)throw Error('Invalid workflow metadata.');
  return item;
 }
 function list(){
  const items=[];
  for(const file of fs.readdirSync(dir).filter(n=>/^[a-f0-9-]{36}\.json$/.test(n)).slice(0,150)){
   try{const item=get(file.slice(0,-5));items.push({id:item.id,name:item.name,nodes:Object.keys(item.graph).length,customNodes:item.customNodes,createdAt:item.createdAt})}catch{}
  }
  return items.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 }
 function remove({id,confirm=false}={}){
  if(confirm!==true)throw Error('Confirm deleting the saved workflow. Generated images remain untouched.');
  const file=fileFor(id);get(id);fs.unlinkSync(file);return {deleted:true,id};
 }
 function build(id,params){
  const item=get(id),approved=sanitize(item.graph,{allowCustomNodes:!!item.customNodes?.length});
  const compiled=apply(approved.graph,params);
  return {graph:compiled.graph,saveId:approved.outputNode,seed:compiled.seed,batch:1,mode:'custom',workflowId:id,workflowName:item.name};
 }
 return {importWorkflow,list,get,remove,build};
}
module.exports={createWorkflowLibrary,sanitize,apply};
