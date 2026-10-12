// Independent managed image worker: model changes do not restart the text model.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const CATALOG=[
 {name:'DreamShaper 8 · recommended · 2.13 GB',file:'DreamShaper_8_pruned.safetensors',repo:'Lykon/DreamShaper',hash:'879db523c30d3b9017143d56705015e15a2cb5628762c11d086fed9538abd7fd',size:2130000000,steps:24,cfg:7,width:512,height:768,sampler:'DPM++ 2M Karras'},
 {name:'DreamShaper XL Turbo · higher detail · 6.94 GB',file:'DreamShaperXL_Turbo_dpmppSdeKarras_half_pruned_6.safetensors',repo:'Lykon/DreamShaper',hash:'676f0d60c8e860146d5e8a0d802599cadd04e7cadf85c283f189f41f01c9e359',size:6940000000,steps:8,cfg:2,width:768,height:1024,sampler:'DPM++ 2M Karras'}
];
function safeFile(dir,name){if(typeof name!=='string'||path.basename(name)!==name||!name.endsWith('.safetensors'))throw Error('Choose a complete SD 1.5 / SDXL .safetensors checkpoint.');const file=path.join(dir,name);if(fs.existsSync(file)&&path.dirname(fs.realpathSync(file))!==fs.realpathSync(dir))throw Error('Model path escapes image library.');return file}
async function verifyImage(file,hash='',expectedSize=0){
 const stat=fs.statSync(file);if(!stat.isFile()||stat.size<1024*1024)throw Error('Incomplete image checkpoint.');if(expectedSize&&stat.size!==expectedSize)throw Error('Image download size mismatch.');
 const fd=fs.openSync(file,'r');let header;try{const bytes=Buffer.alloc(8);fs.readSync(fd,bytes,0,8,0);const size=Number(bytes.readBigUInt64LE());if(size<2||size>64*1024*1024||size+8>=stat.size)throw Error('Invalid safetensors header.');const data=Buffer.alloc(size);fs.readSync(fd,data,0,size,8);header=JSON.parse(data.toString('utf8'));for(const [key,value]of Object.entries(header)){if(key==='__metadata__')continue;if(!Array.isArray(value.data_offsets)||value.data_offsets.length!==2||value.data_offsets.some(n=>!Number.isInteger(n)||n<0||n>stat.size-size-8))throw Error('Invalid tensor offsets.');}if(!Object.keys(header).some(x=>x!=='__metadata__'))throw Error('No tensors in checkpoint.');}finally{fs.closeSync(fd)}
 if(hash){const h=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))h.update(chunk);if(h.digest('hex')!==hash)throw Error('Image checkpoint SHA-256 mismatch.');}
}
function imageParameters(input={},defaults={}){
 const value={prompt:input.prompt,negative_prompt:input.negative_prompt??'',width:input.width??defaults.width??512,height:input.height??defaults.height??768,steps:input.steps??defaults.steps??24,cfg_scale:input.cfg_scale??defaults.cfg??7,seed:input.seed??-1,sampler_name:input.sampler_name??defaults.sampler??'DPM++ 2M Karras',batch_size:1,n_iter:1};
 if(typeof value.prompt!=='string'||!value.prompt.trim()||value.prompt.length>8000||typeof value.negative_prompt!=='string'||value.negative_prompt.length>8000)throw Error('Enter an image prompt (max 8000 characters).');
 for(const key of ['width','height'])if(!Number.isInteger(value[key])||value[key]<256||value[key]>1536||value[key]%64)throw Error('Image dimensions must be multiples of 64, between 256 and 1536.');
 if(!Number.isInteger(value.steps)||value.steps<1||value.steps>60||!Number.isFinite(value.cfg_scale)||value.cfg_scale<1||value.cfg_scale>20||!Number.isInteger(value.seed)||value.seed< -1||value.seed>2147483647)throw Error('Invalid steps, guidance or seed.');
 if(!['Euler a','Euler','DPM++ 2M Karras','LCM'].includes(value.sampler_name))throw Error('Choose a supported image sampler.');if(value.sampler_name==='DPM++ 2M Karras'){value.sampler_name='dpm++2m';value.scheduler='karras'}return value;
}
function createImages(root,{command,prefix=[],port=5002,fetchBackend=fetch,pollInterval=2000,readinessTimeout=600000}={}){
 const dir=path.join(root,'ImageModels'),outputs=path.join(root,'Images'),logs=path.join(root,'Logs');for(const d of [dir,outputs,logs])fs.mkdirSync(d,{recursive:true});
 const configFile=path.join(root,'images.json');let config=fs.existsSync(configFile)?JSON.parse(fs.readFileSync(configFile,'utf8')):{selected:'',custom:[]};
 let worker=null,ready=false,download=null,error='',state='No image model loaded',running='',busy=false,controller=null,loading=0,stopping=false,starting=false;
 const url='http://127.0.0.1:'+port,save=()=>fs.writeFileSync(configFile,JSON.stringify(config,null,2));
 const catalog=()=>[...CATALOG,...config.custom];
 function snapshot(){return {state,error,ready,running,busy,selected:config.selected,catalog:catalog(),installed:fs.readdirSync(dir).filter(x=>x.endsWith('.safetensors')),download:download&&{file:download.file,bytes:fs.existsSync(download.part)?fs.statSync(download.part).size:0,size:download.size,verifying:download.verifying}}}
 function stop(){controller?.abort();if(worker){stopping=true;if(process.platform==='win32')spawn('taskkill.exe',['/PID',String(worker.pid),'/T','/F'],{windowsHide:true});else worker.kill();}ready=false;}
 async function start(){
  if(starting)throw Error('Image model is already loading.');if(busy)throw Error('Finish image generation before switching models.');starting=true;
  try{
   if(worker){const old=worker;await new Promise(resolve=>{old.once('exit',resolve);stop()});}
   if(!config.selected)throw Error('Download or select an image model first.');const file=safeFile(dir,config.selected);await verifyImage(file);
   try{await fetchBackend(url+'/sdapi/v1/sd-models',{signal:AbortSignal.timeout(1500)});throw Error('Image engine port is occupied. Close the other server using port '+port+'.');}catch(e){if(e.message.includes('port is occupied'))throw e;}
   const executable=command||path.join(root,'KoboldCpp','koboldcpp.exe');if(!fs.existsSync(executable))throw Error('KoboldCpp is missing. Run setup to repair.');
   const hardware=fs.existsSync(path.join(root,'backend.json'))?JSON.parse(fs.readFileSync(path.join(root,'backend.json'),'utf8').replace(/^\uFEFF/,'')):{mode:'cpu'};
   const args=['--sdmodel',file,'--host','127.0.0.1','--port',String(port),'--skiplauncher','--sdoffloadcpu'];
   if(hardware.mode==='cpu')args.push('--sdmaingpu','CPU','--sdclipdevice','CPU','--sdvaedevice','CPU');else args.push(hardware.mode==='cuda'?'--usecuda':'--usevulkan');
   const fd=fs.openSync(path.join(logs,'image-engine.log'),'w');try{worker=spawn(executable,[...prefix,...args],{cwd:root,windowsHide:true,stdio:['ignore',fd,fd]})}finally{fs.closeSync(fd)}
   running=config.selected;loading=Date.now();ready=false;stopping=false;error='';state='Loading image model…';
   worker.on('error',e=>{error=e.message;state='Image worker failed';worker=null;ready=false});worker.on('exit',code=>{worker=null;ready=false;if(!stopping&&code){error='Image engine exited with code '+code+'. See Logs/image-engine.log.';state='Image engine failed'}else{state='Image engine stopped';error=''}running=''});
  }finally{starting=false}
 }
 async function downloadModel(model){
  if(download)throw Error('An image download is already running.');const file=safeFile(dir,model.local||model.file);
  if(fs.existsSync(file)){await verifyImage(file,model.hash);config.selected=path.basename(file);save();return snapshot()}
  const pending={file:model.file,part:file+'.part',size:0,hash:model.hash||'',process:null,verifying:false,cancelled:false};download=pending;error='';
  try{
   try{const r=await fetchBackend('https://huggingface.co/api/models/'+model.repo+'/tree/main?recursive=true',{signal:AbortSignal.timeout(15000)});if(r.ok){const files=await r.json(),entry=files.find(x=>x.path===model.file);if(entry){pending.size=Number(entry.size)||0;pending.hash||=entry.lfs?.oid||'';}}}catch{}
   const space=fs.statfsSync(dir),already=fs.existsSync(pending.part)?fs.statSync(pending.part).size:0;if(space.bavail*space.bsize<(pending.size||model.size||1e9)-already+150e6)throw Error('Not enough space for image model.');if(pending.cancelled)return;
   const curl=process.platform==='win32'?path.join(process.env.SystemRoot,'System32','curl.exe'):'curl',fd=fs.openSync(path.join(logs,'image-download.log'),'w');
   try{pending.process=spawn(curl,['--proto','=https','--proto-redir','=https','--fail','--location','--connect-timeout','30','--retry','3','--continue-at','-','--silent','--show-error','--output',pending.part,'https://huggingface.co/'+model.repo+'/resolve/main/'+model.file],{windowsHide:true,stdio:['ignore','ignore',fd]})}finally{fs.closeSync(fd)}
   pending.process.on('error',e=>{error=e.message;download=null});pending.process.on('exit',async code=>{try{if(pending.cancelled||code!==0){state=pending.cancelled?'Image download cancelled; click download to resume':'Image download failed; click download to resume';return;}pending.verifying=true;state='Verifying image checkpoint…';await verifyImage(pending.part,pending.hash,pending.size);fs.renameSync(pending.part,file);config.selected=path.basename(file);save();state='Image model downloaded. Click Load image model.';}catch(e){error=e.message;if(fs.existsSync(pending.part))fs.renameSync(pending.part,pending.part+'.corrupt-'+Date.now())}finally{download=null}});state='Downloading '+model.file;
  }catch(e){download=null;throw e}finally{if(pending.cancelled&&!pending.process)download=null}
  return snapshot();
 }
 async function generate(input){
  if(!ready)throw Error('Load an image model in Images first.');if(busy)throw Error('An image is already being generated.');const defaults=catalog().find(x=>(x.local||x.file)===running),params=imageParameters(input,defaults);busy=true;controller=new AbortController();state='Generating image…';
  try{const r=await fetchBackend(url+'/sdapi/v1/txt2img',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(params),signal:controller.signal});if(!r.ok)throw Error('Image engine HTTP '+r.status);const j=await r.json(),base64=j.images?.[0];if(typeof base64!=='string'||base64.length>40e6)throw Error('Image engine returned no valid image.');const bytes=Buffer.from(base64.replace(/^data:image\/\w+;base64,/,''),'base64');if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('Image engine did not return a PNG.');const name=Date.now()+'-'+crypto.randomBytes(6).toString('hex')+'.png';fs.writeFileSync(path.join(outputs,name),bytes);fs.writeFileSync(path.join(outputs,name+'.json'),JSON.stringify({model:running,...params,info:j.info},null,2));error='';return {url:'/images/output/'+name,model:running,info:j.info};}catch(e){error=e.name==='AbortError'?'Image generation cancelled':e.message;throw Error(error)}finally{controller=null;busy=false;state=ready?'Image engine ready':'Image engine stopped'}
 }
 async function action(route,data){
  if(route==='/images/generate')return generate(data);
  if(route==='/images/start')await start();
  else if(route==='/images/stop')stop();
  else if(route==='/images/select'){await verifyImage(safeFile(dir,data.name));config.selected=data.name;save();}
  else if(route==='/images/download'){const model=catalog()[data.index];if(!Number.isInteger(data.index)||!model)throw Error('Invalid image model.');return downloadModel(model);}
  else if(route==='/images/custom'){const u=new URL(data.url),m=/^\/([\w.-]+)\/([\w.-]+)\/resolve\/main\/([\w./-]+\.safetensors)$/.exec(u.pathname);if(u.protocol!=='https:'||u.hostname!=='huggingface.co'||u.search||u.hash||u.username||u.password||!m||u.pathname.includes('..'))throw Error('Use a public Hugging Face resolve/main .safetensors link.');let model={name:'Custom · '+path.basename(m[3]),repo:m[1]+'/'+m[2],file:m[3],local:m[1]+'_'+m[2]+'__'+path.basename(m[3])};model=config.custom.find(x=>x.local===model.local)||model;if(!config.custom.includes(model)){config.custom.push(model);save()}return downloadModel(model);}
  else if(route==='/images/cancel'){if(download?.verifying)throw Error('Verification is finishing.');if(download){download.cancelled=true;download.process?.kill()}controller?.abort();}
  else if(route==='/images/delete'){if(running===data.name)throw Error('Stop image engine before deleting its model.');fs.unlinkSync(safeFile(dir,data.name));if(config.selected===data.name){config.selected='';save()}}
  else throw Error('Unknown image action');return snapshot();
 }
 const timer=setInterval(async()=>{if(!worker||ready)return;try{if(Date.now()-loading>readinessTimeout){error='Image model loading timed out. See Logs/image-engine.log.';stop();return;}const r=await fetchBackend(url+'/sdapi/v1/sd-models',{signal:AbortSignal.timeout(1500)});if(r.ok){const list=await r.json();if(Array.isArray(list)&&list.some(x=>x.model_name&&x.model_name!=='inactive')){ready=true;state='Image engine ready'}}}catch{}},pollInterval);
 return {snapshot,action,outputs,close(){clearInterval(timer);download?.process?.kill();stop()}};
}
module.exports={CATALOG,safeFile,verifyImage,imageParameters,createImages};
