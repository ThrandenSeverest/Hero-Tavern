// Loopback-only model library. All executable paths and arguments are controlled here.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { createPipeline, readSettings, saveSettings, validateSettings } = require('./ReplyPipeline.cjs');
const {createStoryStore}=require('./StoryStore.cjs');
const {createStoryAPI}=require('./StoryAPI.cjs');
const {createThinkingWorker}=require('./ThinkingWorker.cjs');
const {createImages}=require('./ImageService.cjs');
const {createComfyAdapter}=require('./ComfyAdapter.cjs');
const {createComfyRuntime}=require('./ComfyRuntime.cjs');
const {shutdown}=require('./EngineShutdown.cjs');
const {runtimeEnvironment}=require('./EngineRuntime.cjs');
const {readMemory,editMemory}=require('./ContextMemory.cjs');
const {engineFetch,errorDetails}=require('./EngineHTTP.cjs');
const {systemInfo,performancePreset}=require('./Performance.cjs');
const {createAutoTune}=require('./AutoTune.cjs');
const {createStudio}=require('./ImageStudio.cjs');
const {createAssistantWorkspace}=require('./AssistantWorkspace.cjs');
const {createDiskCare}=require('./DiskCare.cjs');
const {createImageGallery}=require('./ImageGallery.cjs');
const { filterReply } = require('./ReplyFilters.cjs');

async function verifyModel(file, expectedSize = 0, expectedHash = '') {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size < 1024 * 1024) throw new Error('Model file is too small.');
    if (expectedSize && stat.size !== expectedSize) throw new Error('Incomplete model download.');
    const handle = fs.openSync(file, 'r');
    const header = Buffer.alloc(8);
    try { fs.readSync(handle, header, 0, 8, 0); } finally { fs.closeSync(handle); }
    if (header.toString('ascii', 0, 4) !== 'GGUF' || ![2, 3].includes(header.readUInt32LE(4))) throw new Error('Invalid GGUF model.');
    if (expectedHash) {
        const hash = crypto.createHash('sha256');
        for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
        if (hash.digest('hex') !== expectedHash.toLowerCase()) throw new Error('SHA-256 mismatch.');
    }
}
function resolveModel(models, name) {
    if (typeof name !== 'string' || path.basename(name) !== name || !name.endsWith('.gguf')) throw new Error('Invalid model name.');
    const file = path.join(models, name);
    if (fs.existsSync(file) && path.dirname(fs.realpathSync(file)) !== fs.realpathSync(models)) throw new Error('Model path escapes the Models folder.');
    return file;
}
function backendArguments(root, model, port = 5001) {
    const configPath = path.join(root, 'backend.json');
    const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '')) : { mode: 'cpu', gpuLayers: 0, contextSize: 4096 };
    if (!['cpu', 'cuda', 'vulkan'].includes(config.mode)) throw new Error('Choose CPU, CUDA or Vulkan in Hardware settings.');
    if (!Number.isInteger(config.contextSize) || config.contextSize < 512 || config.contextSize > 524288) throw new Error('Context size must be 512–524288.');
    if (!Number.isInteger(config.gpuLayers) || config.gpuLayers < -1 || config.gpuLayers > 999) throw new Error('Invalid GPU layer count.');
    const args = ['--singleinstance', '--model', model, '--contextsize', String(config.contextSize), '--host', '127.0.0.1', '--port', String(port), '--skiplauncher'];
    if (config.mode === 'cpu') args.push('--gpulayers', '0');
    else args.push(config.mode === 'cuda' ? '--usecuda' : '--usevulkan', '--gpulayers', String(config.gpuLayers));
    if(config.flashAttention===false)args.push('--noflashattention');else if(config.flashAttention===true)args.push('--flashattention');
    if(config.quantKV!==undefined){if(![0,1,2].includes(config.quantKV))throw Error('Choose F16, Q8 or Q4 KV cache.');args.push('--quantkv',String(config.quantKV));}
    for(const [key,flag]of [['threads','--threads'],['batchThreads','--blasthreads']])if(config[key]){if(!Number.isInteger(config[key])||config[key]<1||config[key]>256)throw Error('Invalid CPU thread count.');args.push(flag,String(config[key]));}
    if(config.batchSize!==undefined){if(![16,32,64,128,256,512,1024,2048,4096].includes(config.batchSize))throw Error('Unsupported prompt batch size.');args.push('--blasbatchsize',String(config.batchSize));}
    if(config.requestTimeoutSeconds!==undefined&&(!Number.isInteger(config.requestTimeoutSeconds)||config.requestTimeoutSeconds<30||config.requestTimeoutSeconds>7200))throw Error('Use a 30–7200 second request timeout.');
    return { config, args };
}
function logTail(file) {
    if (!fs.existsSync(file)) return '';
    const size = fs.statSync(file).size, length = Math.min(size, 12000);
    const fd = fs.openSync(file, 'r'), bytes = Buffer.alloc(length);
    try { fs.readSync(fd, bytes, 0, length, size - length); } finally { fs.closeSync(fd); }
    return bytes.toString('utf8').trim();
}
function createBridge(root, { port = 8001, autoStart = true, backendCommand, backendPrefix = [], backendPort = 5001, pollInterval = 2000, readinessTimeout = 600000, imageCommand, imagePrefix = [], imagePort = 5002, tavernPath, thinkingCommand, thinkingPrefix = [], thinkingPort = 5003 } = {}) {
    const models = path.join(root, 'Models');
    const logs = path.join(root, 'Logs');
    fs.mkdirSync(models, { recursive: true });
    fs.mkdirSync(logs, { recursive: true });
    const catalog = JSON.parse(fs.readFileSync(path.join(root, 'models.json'), 'utf8'));
    const token = crypto.randomBytes(32).toString('hex');
    let download = null, backend = null, state = 'No model selected', lastAttempt = '', backendReady = false, checking = false;
    let manager = null, starting = false, loadingSince = 0, runningModel = '', backendError = '', engineState = 'idle', stopIntent = '';
    const backendURL = 'http://127.0.0.1:' + backendPort;
    let generationState = 'idle', contextDiagnostics = null,imageJob=false,textPausedForImages=false,queuedInference=0,launchConfig=null,launchArgs=[];
    const {profileFor}=require('./ModelProfiles.cjs');let loadedContext=0;
    const story=createStoryStore(root,{tavernPath});
    const diskCare=createDiskCare(root);
    const imageGallery=createImageGallery(root);
    const thinking=createThinkingWorker(root,{command:thinkingCommand,prefix:thinkingPrefix,port:thinkingPort,resolveModel,verifyModel,pollInterval});
    const images=createImages(root,{command:imageCommand,prefix:imagePrefix,port:imagePort,pollInterval,readinessTimeout});
    const comfy=createComfyAdapter(root);
    const comfyRuntime=createComfyRuntime(root);
    const pipeline = createPipeline({root,backendURL,enforceContext:true,getModelProfile:()=>profileFor(root,runningModel||selected()),getContextSize:()=>loadedContext||backendArguments(root,'').config.contextSize,getPlanningBackend:()=>thinking.snapshot(),getStoryContext:(id,query)=>story.view(id,query).context,recordInspector:(id,value)=>story.inspector(id,value),setDiagnostics:value=>{contextDiagnostics=value},setState: value => { generationState = value; }});
    const storyAPI=createStoryAPI(story,pipeline,{ready:()=>backendReady});
    const selection = path.join(models, 'selected-model.txt');
    const selected = () => {
        if (!fs.existsSync(selection)) return '';
        const full = fs.readFileSync(selection, 'utf8').replace(/^\uFEFF/, '').trim();
        const name = path.basename(full);
        if (path.resolve(full) !== path.resolve(resolveModel(models, name))) throw new Error('Invalid selected model path.');
        return name;
    };
    const choose = async name => {
        const file = resolveModel(models, name);
        await verifyModel(file);
        fs.writeFileSync(selection, file, 'utf8');
        state = backend ? 'Model selected. Click Load model to switch the running AI.' : 'Model selected; starting AI…';
        if (!backend && autoStart) { lastAttempt = name; await runBackend(); }
    };
    const runBackend = async () => {
        if (backend || starting) return;
        starting = true;
        try {
        const name = selected();
        if (!name) throw new Error('Download or select a model first.');
        await verifyModel(resolveModel(models, name));
        // Do not start while another process owns KoboldCpp's port.
        try {
            await engineFetch(backendURL + '/api/v1/model', { signal: AbortSignal.timeout(1500) });
            throw new Error('Port 5001 is occupied. Close the other AI server first.');
        } catch (e) { if (e.message.startsWith('Port 5001')) throw e; }
        const executable = backendCommand || path.join(root, 'KoboldCpp', 'koboldcpp.exe');
        if (!fs.existsSync(executable)) throw new Error('KoboldCpp engine is missing. Run Hero Tavern setup to repair it.');
        const { args,config } = backendArguments(root, resolveModel(models, name), backendPort);
        launchConfig=config;launchArgs=args;loadedContext=config.contextSize;backendError = ''; stopIntent = ''; runningModel = name; engineState = 'loading'; loadingSince = Date.now();
        const out = fs.openSync(path.join(logs, 'koboldcpp.log'), 'w');
        const err = fs.openSync(path.join(logs, 'koboldcpp-error.log'), 'w');
        try {
            backend = spawn(executable, [...backendPrefix, ...args], { cwd: root, windowsHide: true, env:runtimeEnvironment(root,'text'), stdio: ['ignore', out, err] });
        } finally { fs.closeSync(out); fs.closeSync(err); }
        state = 'Loading AI model… The chat interface remains available.';
        backendReady = false;
        backend.on('error', e => { backendError = e.message; state = 'Could not start KoboldCpp: ' + e.message; engineState = 'error'; backend = null; });
        backend.on('exit', code => {
            backend = null; backendReady = false;
            if (stopIntent === 'stop' || stopIntent === 'image') { engineState = stopIntent === 'image' ? 'paused-for-image' : 'stopped'; backendError = ''; state = stopIntent === 'image' ? 'Text AI paused for image generation.' : 'AI stopped.'; }
            else if (stopIntent === 'timeout') { engineState = 'error'; state = backendError; }
            else {
                engineState = code ? 'error' : 'stopped';
                backendError = code ? (logTail(path.join(logs, 'koboldcpp-error.log')) || logTail(path.join(logs, 'koboldcpp.log')) || 'KoboldCpp exited with code ' + code) : '';
                state = code ? 'KoboldCpp failed to load. Open Diagnostics for the error.' : 'AI stopped.';
            }
        });
        } finally { starting = false; }
    };
    const stopBackend = (intent = 'stop') => {
        if (!backend) return;
        stopIntent = intent; backendReady=false; engineState=intent==='stop'?'stopping':'error'; state=intent==='stop'?'Stopping AI…':backendError; pipeline.abort();
        shutdown(backend,backendPort,{log:message=>{try{fs.appendFileSync(path.join(logs,'engine-shutdown.log'),new Date().toISOString()+' '+message+'\n')}catch{}}}).catch(()=>{});
    };
    const beginDownload = async index => {
        if (download) throw new Error('A download is already running.');
        if (manager) throw new Error('Close the advanced manager before downloading here.');
        if (!Number.isInteger(index) || !catalog[index]) throw new Error('Invalid model choice.');
        const model = catalog[index];
        const file = resolveModel(models, model.LocalFile || model.File);
        if (fs.existsSync(file)) { await verifyModel(file, 0, model.Hash); await choose(model.LocalFile || model.File); return; }
        const pending = { name: model.File, file, part: file + '.part', size: model.Size||0, process: null, hash: model.Hash || '', cancelled: false, verifying: false, bytes: 0 };
        download = pending; // Reserve before awaiting metadata: double clicks cannot start two downloads.
        try {
            try {
                const meta = await engineFetch('https://huggingface.co/api/models/' + model.Repo + '/tree/'+(model.Revision||'main')+'?recursive=true', { signal: AbortSignal.timeout(15000) });
                if (meta.ok) {
                    const files = await meta.json();
                    const entry = files.find(x => x.path === model.File);
                    if (entry) { pending.size = Number(entry.size) || 0; pending.hash ||= entry.lfs?.oid || ''; }
                }
            } catch {} // Default hash is pinned; metadata availability does not block it.
            const space = fs.statfsSync(models);
            const already = fs.existsSync(pending.part) ? fs.statSync(pending.part).size : 0;
            if (space.bavail * space.bsize < (pending.size || model.Size) - already + 150 * 1024 * 1024) throw new Error('Not enough free disk space.');
            if (pending.cancelled) { download = null; return; }
            const url = 'https://huggingface.co/' + model.Repo + '/resolve/'+(model.Revision||'main')+'/' + model.File;
            const curl = process.platform === 'win32' ? path.join(process.env.SystemRoot, 'System32', 'curl.exe') : 'curl';
            const errorFile = fs.openSync(path.join(logs, 'download-error.log'), 'w');
            try {
                pending.process = spawn(curl, ['--proto', '=https', '--proto-redir', '=https', '--fail', '--location', '--connect-timeout', '30', '--retry', '3', '--continue-at', '-', '--silent', '--show-error', '--output', pending.part, url], { windowsHide: true, stdio: ['ignore', 'ignore', errorFile] });
            } finally { fs.closeSync(errorFile); }
            pending.process.once('error', e => { state = e.message; if (download === pending) download = null; });
            pending.process.once('exit', async code => {
                if (pending.cancelled || code !== 0) { state = pending.cancelled ? 'Download cancelled. Click Download to resume.' : 'Download failed. Click Download to resume; see Logs/download-error.log.'; if (download === pending) download = null; return; }
                try {
                    state = 'Verifying model SHA-256…'; pending.verifying = true;
                    await verifyModel(pending.part, pending.size, pending.hash);
                    fs.renameSync(pending.part, file);
                    await choose(model.LocalFile || model.File);
                } catch (e) {
                    if (fs.existsSync(pending.part)) fs.renameSync(pending.part, pending.part + '.corrupt-' + Date.now());
                    state = e.message;
                } finally { if (download === pending) download = null; }
            });
            state = 'Downloading ' + model.File;
        } catch (e) { if (download === pending) download = null; throw e; }
    };
    const waitUntil=async(check,signal,limit=600000)=>{const end=Date.now()+limit;while(!check()){if(signal?.aborted)throw Error('Job cancelled.');if(Date.now()>end)throw Error('Engine readiness timed out. Check startup logs.');await new Promise(r=>setTimeout(r,100));}};
    const ensureText=async signal=>{
      if(backendReady)return;
      if(images.snapshot().busy)throw Error('Image generation is still active. Text will be restored when the image finishes.');
      if(images.snapshot().running&&studio.snapshot().settings.releaseGPU){
        await images.action('/images/stop',{});
        await waitUntil(()=>!images.snapshot().running,signal,30000);
      }
      if(!backend)await runBackend();
      await waitUntil(()=>{if(!backend&&!starting)throw Error(backendError||'Text engine exited while loading.');return backendReady;},signal);
    };
    const generateStudioImage=async(input,signal,releaseGPU,onReady,engine='auto',comfyCheckpoint='')=>{
      if(imageJob)throw Error('Another image job is active.');
      if(queuedInference)throw Error('A chat reply is starting. Generate the image after the reply finishes.');
      if(pipeline.runSnapshot()?.finished===undefined&&generationState!=='idle')throw Error('Finish or cancel text generation before generating an image.');
      let actualEngine='koboldcpp',mustStartComfy=false;
      const requiresComfy=(!!input.modelPack&&input.modelPack!=='sdxl')||!!input.workflowId||!!input.sourceName||!!input.lora?.length||(input.batch_size||1)>1||input.operation==='upscale'||input.operation==='img2img'||input.operation==='inpaint'||input.operation==='outpaint';
      if(engine==='koboldcpp'&&requiresComfy)throw Error('This operation needs ComfyUI. Set the image engine to Auto or ComfyUI; KoboldCpp remains text-to-image only.');
      if(engine!=='koboldcpp'||requiresComfy){
        const running=await comfy.available();
        const wantsComfy=engine==='comfyui'||requiresComfy||!!comfyCheckpoint;
        mustStartComfy=!running&&wantsComfy&&!!comfyRuntime.installed()&&process.platform==='win32';
        const canUse=running||mustStartComfy;
        if(canUse&&(comfyCheckpoint||input.workflowId||input.operation==='upscale'||(input.modelPack&&input.modelPack!=='sdxl')))actualEngine='comfyui';
        else if(engine==='comfyui'||requiresComfy)throw Error(canUse?'Choose a configured checkpoint or model pack in Image Studio.':'ComfyUI is unavailable. Install ComfyUI Portable in Image Studio or start your external service at 127.0.0.1:8188.');
      }
      if(requiresComfy&&actualEngine!=='comfyui')throw Error('LoRA, batches, upscaling and image editing require ComfyUI.');
      imageJob=true;
      const restoreText=!!backend||textPausedForImages,restorePlanner=thinking.snapshot().running;
      try{
        if(releaseGPU&&backend){
          lastAttempt=selected();stopBackend('image');
          await waitUntil(()=>!backend,signal,30000);
        }
        if(releaseGPU&&thinking.snapshot().running){
          thinking.stop();await waitUntil(()=>!thinking.snapshot().running,signal,30000);
        }
        if(actualEngine==='comfyui'){
          if(releaseGPU&&images.snapshot().running){await images.action('/images/stop',{});await waitUntil(()=>!images.snapshot().running,signal,30000);}
          // Start the CUDA runtime only after text/planning/image workers release GPU.
          if(mustStartComfy){
            onReady?.('comfyui-starting');
            await comfyRuntime.start();
            const deadline=Date.now()+120000;
            let connected=false;
            while(Date.now()<deadline){
              if(signal?.aborted)throw Error('Image generation cancelled while starting ComfyUI.');
              if(await comfy.available()){connected=true;break;}
              await new Promise(resolve=>setTimeout(resolve,1800));
            }
            if(!connected)throw Error('Managed ComfyUI failed to become ready. Inspect Logs/comfy-engine.log and CUDA driver compatibility.');
          }
          onReady?.('comfyui-generating');
          return await comfy.generate(input,{checkpoint:comfyCheckpoint,sourceName:input.sourceName,maskData:input.maskData,signal});
        }
        if(!images.snapshot().ready)await images.action('/images/start',{});
        await waitUntil(()=>{const s=images.snapshot();if(s.error)throw Error(s.error);return s.ready;},signal);
        onReady?.();
        const cancel=()=>images.action('/images/cancel',{}).catch(()=>{});
        signal?.addEventListener('abort',cancel,{once:true});
        try{return await images.action('/images/generate',input);}
        finally{signal?.removeEventListener('abort',cancel);}
      }finally{
        try{
          if(releaseGPU){
            try{
              if(actualEngine==='comfyui')await comfy.freeMemory({confirm:true});
              else await images.action('/images/stop',{});
              await waitUntil(()=>!images.snapshot().running,null,30000);
            }catch(e){backendError='Failed to unload image engine: '+e.message;}
            onReady?.('restoring-text');
            if(restoreText){
              try{await ensureText();}
              catch(e){backendError='Could not restore text model: '+e.message;}
            }
          }
          if(restorePlanner){
            try{await thinking.start();}
            catch(e){backendError='Planning model restore failed: '+e.message;}
          }
        }finally{
          textPausedForImages=false;
          imageJob=false;
        }
      }
    };
    const studio=createStudio(root,{pipeline,ensureText,generateImage:generateStudioImage,getImageState:()=>images.snapshot()});
    const assistant=createAssistantWorkspace(root,{backendURL,ensureText,getModelProfile:()=>profileFor(root,runningModel||selected()),modelName:()=>runningModel||selected(),contextSize:()=>loadedContext||backendArguments(root,'').config.contextSize,readGeneration:()=>readSettings(root)});
    const tuner=createAutoTune(root,{systemInfo,readGeneration:()=>readSettings(root),saveGeneration:value=>saveSettings(root,value),abort:()=>pipeline.abort(),stop:async()=>{lastAttempt=selected();stopBackend();if(images.snapshot().running)await images.action('/images/stop',{});await waitUntil(()=>!backend&&!images.snapshot().running,null,30000);},load:async(signal,limit)=>{await runBackend();await waitUntil(()=>{if(!backend&&!starting)throw Error(backendError||'Engine failed to load.');return backendReady;},signal,limit);},benchmark:async signal=>{const started=Date.now();const r=await pipeline.generate({prompt:'<|im_start|>user\n'+('A traveller enters an inn and remembers a blue cloak. '.repeat(120))+'\nWrite a brief vivid continuation with a new action.<|im_end|>\n<|im_start|>assistant\n',stream:false,seed:1234},signal,{mode:'utility'});return {...r,elapsedMs:Date.now()-started};}});
    const diagnosticEnvironment=async()=>({system:await systemInfo(),text:{running:!!backend,ready:backendReady,pausedForImage:imageJob||textPausedForImages,queuedReplies:queuedInference,model:runningModel,pid:backend?.pid,phase:generationState,configured:backendArguments(root,'').config,loaded:launchConfig,args:launchArgs,url:backendURL,error:backendError},image:images.snapshot(),comfy:comfy.snapshot(),comfyRuntime:comfyRuntime.status(),planner:thinking.snapshot(),pipeline:pipeline.runSnapshot(),context:contextDiagnostics,enginePerformance:backendReady?await engineFetch(backendURL+'/api/extra/perf',{timeoutMs:3000}).then(r=>r.json()).catch(e=>({error:e.message})):null,logs:{text:logTail(path.join(logs,'koboldcpp.log')),textError:logTail(path.join(logs,'koboldcpp-error.log')),image:logTail(path.join(logs,'image-engine.log'))}});
    const snapshot = () => {
        let active = ''; try { active = selected(); } catch (e) { state = e.message; }
        if (download && fs.existsSync(download.part)) download.bytes = fs.statSync(download.part).size;
        return { state, backendRunning: !!backend || starting, backendReady, selected: active,
            tuning:tuner.snapshot(),studio:studio.snapshot(),imageJob,assistant:assistant.snapshot(),pipeline:pipeline.runSnapshot(),profile:profileFor(root,active),loadedContext:backendReady?loadedContext:0,catalog, installed: fs.readdirSync(models).filter(x => x.endsWith('.gguf')),
            engineState, runningModel, backendError, apiURL: 'http://127.0.0.1:' + server.address().port + '/inference', engineURL: backendURL, generationState, contextDiagnostics, images:images.snapshot(),comfy:comfy.snapshot(),comfyRuntime:comfyRuntime.status(), thinking:thinking.snapshot(), generation: readSettings(root),
            hardware: backendArguments(root, '').config,
            download: download && { name: download.name, bytes: download.bytes, size: download.size, verifying: download.verifying } };
    };
    async function nativeImages(req,res){const reply=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};if(req.headers.origin){reply(403,{error:'Use the chat server for image API calls.'});return;}const endpoint=req.url.split('?')[0];try{const names=images.snapshot().installed;if(req.method==='GET'){if(endpoint.endsWith('/sd-models')){reply(200,names.map(name=>({title:name,model_name:name,filename:name})));return;}if(endpoint.endsWith('/samplers')){reply(200,['Euler','Euler a','DPM++ 2M Karras','DPM++ 2S ancestral Karras','LCM'].map(name=>({name,aliases:[],options:{}})));return;}if(endpoint.endsWith('/schedulers')){reply(200,[{name:'normal',label:'Normal'},{name:'karras',label:'Karras'}]);return;}if(endpoint.endsWith('/options')){reply(200,{sd_model_checkpoint:images.snapshot().selected});return;}if(endpoint.endsWith('/sd-vae')||endpoint.endsWith('/upscalers')||endpoint.endsWith('/latent-upscale-modes')){reply(200,[]);return;}if(endpoint.endsWith('/progress')){reply(200,{progress:studio.snapshot().busy?0.5:0,state:{job:studio.snapshot().phase}});return;}}
      let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>2000000)throw Error('Image request too large.');}const data=JSON.parse(raw||'{}');if(endpoint.endsWith('/interrupt')){studio.cancel();await images.action('/images/cancel',{});reply(200,{});return;}if(endpoint.endsWith('/options')){if(data.sd_model_checkpoint&&names.includes(data.sd_model_checkpoint))await images.action('/images/select',{name:data.sd_model_checkpoint});reply(200,{});return;}if(endpoint.endsWith('/txt2img')){const result=await studio.action('/studio/generate',data),bytes=fs.readFileSync(path.join(images.outputs,path.basename(result.url)));reply(200,{images:[bytes.toString('base64')],info:JSON.stringify(result),parameters:data});return;}reply(404,{error:'Unsupported image endpoint.'});}catch(e){reply(400,{error:e.message,failure:errorDetails(e)});}}
    const server = http.createServer(async (req, res) => {
        const host = req.headers.host;
        if (host !== '127.0.0.1:' + server.address().port) { res.writeHead(403); res.end('Invalid host'); return; }
        if(req.url==='/launcher/shutdown'&&req.method==='POST'){
           const secret=process.env.HERO_LAUNCHER_TOKEN;
           if(!secret||req.headers['x-hero-launch-token']!==secret){res.writeHead(403);res.end('Forbidden');return;}
           res.writeHead(202,{'Content-Type':'application/json'});res.end(JSON.stringify({stopping:true}));
           setImmediate(async()=>{
             try{
               studio.cancel();tuner.cancel();pipeline.abort();
               await comfy.cancel().catch(()=>{});
               if(images.snapshot().running)await images.action('/images/stop',{});
               if(thinking.snapshot().running)thinking.stop();
               stopBackend('stop');
               await waitUntil(()=>!backend&&!images.snapshot().running&&!thinking.snapshot().running,null,35000).catch(e=>fs.appendFileSync(path.join(logs,'engine-shutdown.log'),e.message+'\n'));
               server.close();
             }catch(e){try{fs.appendFileSync(path.join(logs,'engine-shutdown.log'),'Launcher shutdown: '+e.message+'\n')}catch{};server.close();}
           });return;
         }
         if(tuner.snapshot()?.status==='running'&&req.url==='/inference/v1/completions'){res.writeHead(409,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'Hardware tuning is running; wait or cancel it in Hardware.'}}));return;}
        if(req.url.startsWith('/inference/') && !req.url.includes('/api/extra/abort') && !req.headers.origin){
            const isReply=req.url==='/inference/v1/completions'&&req.method==='POST';
            if(isReply)queuedInference++;
            try{
                if(tuner.snapshot()?.status==='running')throw Error('Hardware calibration is running. Cancel it in Hardware to use chat.');
                if(imageJob)await waitUntil(()=>!imageJob,null,1200000);
                if(textPausedForImages)throw Error('Image model is loaded. Stop the image model before sending a chat message.');
                if(!backendReady)await ensureText();
                await pipeline.handle(req,res);
            }catch(e){
                if(!res.headersSent&&!res.destroyed){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:e.message}}));}
            }finally{if(isReply)queuedInference--;}
            return;
        }
        if (await pipeline.handle(req,res)) return;
        if(req.url.startsWith('/sdapi/v1/')){await nativeImages(req,res);return;}
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-ancestors http://127.0.0.1:8000 http://localhost:8000");
        const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
        if (req.method === 'GET' && req.url === '/') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(fs.readFileSync(path.join(root, 'ModelPanel.html'), 'utf8').replaceAll('__TOKEN__', token)); return;
        }
        const assets={'/assistant-panel.js':'AssistantPanel.js','/adventure':'Adventure.html','/adventure-adapter.js':'AdventureAdapter.js','/spells.json':'spells.json','/story-panel.js':'StoryPanel.js','/creator-panel.js':'CreatorPanel.js'};
        if(req.method==='GET'&&assets[req.url]){const file=assets[req.url];res.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?'text/javascript; charset=utf-8':'application/json'});res.end(fs.readFileSync(path.join(root,file),'utf8').replaceAll('__TOKEN__',token));return;}
        if(req.method==='GET'&&/^\/images\/output\/[0-9]+-[a-f0-9]+\.png$/.test(req.url)){if(['http://127.0.0.1:8000','http://localhost:8000'].includes(req.headers.origin)){res.setHeader('Access-Control-Allow-Origin',req.headers.origin);res.setHeader('Vary','Origin')}const file=path.join(images.outputs,path.basename(req.url));if(fs.existsSync(file)){res.writeHead(200,{'Content-Type':'image/png'});fs.createReadStream(file).pipe(res)}else{res.writeHead(404);res.end()}return;}
        if (req.headers['x-hero-token'] !== token) { json(403, { error: 'Invalid session token.' }); return; }
        if(req.method==='GET'&&req.url==='/assistant/status'){json(200,assistant.snapshot());return;}
        if(req.method==='GET'&&req.url==='/comfy/status'){json(200,{...comfy.snapshot(),...await comfy.catalog(),runtime:comfyRuntime.status()});return;}
         if(req.method==='GET'&&req.url==='/comfy/workflows'){json(200,{items:comfy.workflows.list()});return;}
         if(req.method==='GET'&&req.url==='/comfy/models'){json(200,{hub:comfy.models.snapshot(),packs:(await comfy.catalog()).packs||[]});return;}
         if(req.method==='GET'&&req.url==='/storage/report'){try{json(200,diskCare.report())}catch(e){json(400,{error:e.message})}return;}
        if(req.method==='GET'&&req.url.startsWith('/gallery/list')){try{const qs=new URL(req.url,'http://localhost').searchParams;json(200,imageGallery.list({search:qs.get('search')||'',favorites:qs.get('favorites')==='true',limit:Math.min(200,Math.max(1,Number(qs.get('limit'))||100))}))}catch(e){json(400,{error:e.message})}return;}
        if(req.method==='GET'&&req.url==='/studio/progress'){const st=studio.snapshot(),img=images.snapshot();let progress=null,step=null,totalSteps=null;
          const liveComfy=comfy.snapshot().active;
          if(img.busy){try{const response=await engineFetch('http://127.0.0.1:'+imagePort+'/sdapi/v1/progress',{timeoutMs:1200});if(response.ok){const p=await response.json();if(Number.isFinite(p.progress))progress=Math.max(0,Math.min(1,p.progress));step=p.state?.sampling_step??null;totalSteps=p.state?.sampling_steps??null;}}catch{}}
          json(200,{busy:st.busy,phase:liveComfy?.phase||st.phase,imageState:liveComfy?'ComfyUI':img.state,progress:liveComfy?liveComfy.progress:progress,step:liveComfy?.step??step,totalSteps:liveComfy?.totalSteps??totalSteps,etaMs:liveComfy?.etaMs??null,queueId:liveComfy?.id??null});return;}
        if (req.method === 'GET' && req.url === '/status') { try { json(200, snapshot()); } catch (e) { json(400, {error:e.message}); } return; }
        if (req.method === 'GET' && req.url === '/logs') { json(200, { output: logTail(path.join(logs, 'koboldcpp.log')), error: logTail(path.join(logs, 'koboldcpp-error.log')) }); return; }
        if (req.method !== 'POST' || req.headers.origin !== 'http://' + host) { json(403, { error: 'Invalid request origin.' }); return; }
        try {
            let body = ''; for await (const chunk of req) { body += chunk; if (body.length > (req.url.startsWith('/adventure/storage/')||req.url==='/story/import'?128000000:((req.url==='/studio/generate'||req.url==='/gallery/import')?39000000:2000000))) throw new Error('Request too large.'); }
            const data = JSON.parse(body || '{}');
            if(imageJob&&['/select','/start','/hardware','/performance/apply'].includes(req.url))throw Error('Wait for the image job to restore the text engine.');
            if(tuner.snapshot()?.status==='running'&&['/start','/select','/hardware','/performance/apply','/studio/generate','/studio/refine','/story/analyze','/task','/diagnostics/text','/diagnostics/image'].includes(req.url))throw Error('Wait for tuning to finish or cancel it.');if(req.url==='/performance/tune'){json(202,await tuner.start(data));return;}if(req.url==='/performance/tune-cancel'){tuner.cancel();json(200,tuner.snapshot());return;}
            if(req.url==='/comfy/runtime/configure'){json(200,comfyRuntime.configure(data));return;}
             if(req.url==='/comfy/runtime/start'){json(200,await comfyRuntime.start());return;}
             if(req.url==='/comfy/runtime/stop'){if(imageJob)throw Error('Image generation is active.');json(200,await comfyRuntime.stop());return;}
             if(req.url==='/comfy/runtime/install'){json(200,await comfyRuntime.installPortable(data));return;}
             if(req.url==='/comfy/runtime/install-cancel'){json(200,comfyRuntime.cancelInstall());return;}
             if(req.url==='/comfy/models/configure'){json(200,comfy.models.configure(data));return;}
             if(req.url==='/comfy/models/select'){if(imageJob)throw Error('Wait for the image to finish.');json(200,comfy.models.select(data));return;}
             if(req.url==='/comfy/models/download'){if(imageJob)throw Error('Stop active generation before downloading a new model pack.');json(200,await comfy.models.downloadPack(data));return;}
             if(req.url==='/comfy/models/cancel'){json(200,comfy.models.cancel());return;}
             if(req.url==='/comfy/workflow-import'){json(200,comfy.workflows.importWorkflow(data));return;}
             if(req.url==='/comfy/workflow-delete'){json(200,comfy.workflows.remove(data));return;}
             if(req.url==='/comfy/free'){json(200,await comfy.freeMemory(data));return;}
             if(req.url==='/comfy/cancel'){json(200,await comfy.cancel());return;}
             if(req.url==='/storage/cleanup'){if(imageJob)throw Error('Finish image generation before cleaning temporary data.');json(200,diskCare.cleanup(data));return;}
            if(req.url==='/storage/clean-runtime'){if(backend||starting||images.snapshot().running||thinking.snapshot().running||imageJob)throw Error('Stop text, image and planning AI engines before cleaning their extraction caches.');json(200,diskCare.cleanRuntime({confirm:data.confirm,enginesStopped:true}));return;}
             if(req.url==='/storage/clean-npm'){if(imageJob)throw Error('Finish image generation before clearing cache.');json(200,diskCare.clearNpmCache(data));return;}
            if(req.url==='/gallery/import'){json(200,imageGallery.importPNG(data));return;}
             if(req.url==='/gallery/favorite'){json(200,imageGallery.favorite(data));return;}
            if(req.url==='/gallery/delete'){json(200,imageGallery.remove(data));return;}
            if(req.url.startsWith('/studio/')){json(200,await studio.action(req.url,data));return;}
            if(req.url==='/performance/system'){json(200,await diagnosticEnvironment());return;}
            if(req.url==='/performance/apply'){const preset=performancePreset(data.preset,await systemInfo());if(data.contextSize!==undefined)preset.contextSize=data.contextSize;lastAttempt=selected();stopBackend();await waitUntil(()=>!backend,null,30000);const configFile=path.join(root,'backend.json'),before=fs.existsSync(configFile)?fs.readFileSync(configFile):null;fs.writeFileSync(configFile,JSON.stringify(preset));try{backendArguments(root,'');}catch(e){if(before)fs.writeFileSync(configFile,before);throw e;}const gen=readSettings(root),isQwen=profileFor(root,selected()).Family?.includes('Qwen');saveSettings(root,{...gen,temperature:isQwen?0.7:0.8,top_p:isQwen?0.8:0.95,min_p:isQwen?0:0.05,top_k:20,maxReplyTokens:768,memoryTokens:384,recentMessages:24,thinkingMode:'off'});await runBackend();json(200,{preset,environment:await diagnosticEnvironment()});return;}
            if(req.url.startsWith('/story/')){const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort()});json(200,await storyAPI.action(req.url,data,controller.signal));return;}
            if(req.url==='/diagnostics/check'){const probe=async(url)=>{try{const r=await engineFetch(url,{signal:AbortSignal.timeout(3000)});return {ok:r.ok,status:r.status,detail:await r.json()};}catch(e){return {ok:false,error:e.message}}};json(200,{environment:await diagnosticEnvironment(),at:new Date().toISOString(),text:await probe(backendURL+'/api/v1/model'),image:await probe('http://127.0.0.1:'+imagePort+'/sdapi/v1/sd-models'),model:runningModel,profile:profileFor(root,runningModel),contextSize:loadedContext,thinking:thinking.snapshot(),generation:readSettings(root),context:contextDiagnostics});return;}
            if(req.url==='/diagnostics/text'||req.url==='/diagnostics/image'){
                const started=Date.now();let report;try{if(req.url.endsWith('/text')){if(imageJob)await waitUntil(()=>!imageJob,null,1200000);if(!selected())throw Error('Load a text model in Models first.');if(!backendReady)await ensureText();if(typeof data.prompt!=='string'||!data.prompt.trim()||data.prompt.length>60000)throw Error('Enter a test prompt (up to 60000 characters).');const turns=Math.max(0,Math.min(100,Math.floor(Number(data.historyTurns)||0))),messages=Array.from({length:turns},(_,i)=>({role:i%2?'assistant':'user',text:'Diagnostic history turn '+i+': '+('A traveller promised a blue cloak beside the old inn. '.repeat(25))}));messages.push({role:'user',text:data.prompt});const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort()});const result=await pipeline.generate({prompt:'<|im_start|>system\nThis is an isolated local diagnostic, not an event in any saved story.<|im_end|>\n<|im_start|>user\n'+data.prompt+'<|im_end|>\n<|im_start|>assistant\n',hero_context:{id:'diagnostics-'+crypto.randomUUID(),messages,generationType:'normal'},stream:false},controller.signal);report={ok:true,type:'text',model:runningModel,template:profileFor(root,runningModel).Template,usage:result.usage,context:contextDiagnostics,text:result.choices[0].text};}else{const image=await studio.action('/studio/generate',{prompt:data.prompt||'A quiet fantasy tavern, detailed illustration.',negative_prompt:'blurry, low quality',width:data.width||512,height:data.height||512,steps:data.steps||20,seed:12345});report={ok:true,type:'image',model:images.snapshot().running,...image};}}catch(e){report={ok:false,type:req.url.endsWith('/text')?'text':'image',error:e.message,failure:errorDetails(e),failedStage:pipeline.runSnapshot()?.failedStage,suggestion:e.code==='ENGINE_DEADLINE'?'Engine exceeded configured request timeout. Check CUDA/offload, prompt length and logs.':e.code==='ECONNREFUSED'?'Engine stopped or crashed; inspect the included startup/error logs.':'Inspect failure causes, engine state and logs below.'};}report.environment=await diagnosticEnvironment();report.elapsedMs=Date.now()-started;if(report.usage)report.endToEndTokensPerSecond=Number((report.usage.completion_tokens/(report.elapsedMs/1000||1)).toFixed(2));report.at=new Date().toISOString();const folder=path.join(root,'Diagnostics');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'latest-'+report.type+'.json'),JSON.stringify(report,null,2));json(200,report);return;
            }
            if(req.url==='/generation/abort'){pipeline.abort();await Promise.allSettled([backendURL,thinking.snapshot().url].map(url=>engineFetch(url+'/api/extra/abort',{method:'POST',signal:AbortSignal.timeout(2000)})));json(200,{stopped:true});return;}
            if(req.url==='/thinking/configure'){json(200,await thinking.configure(data));return;}
            if(req.url==='/thinking/start'){json(200,await thinking.start());return;}
            if(req.url==='/thinking/stop'){thinking.stop();json(200,thinking.snapshot());return;}
            if(req.url==='/images/cancel'){studio.cancel();await comfy.cancel();await images.action('/images/cancel',{});json(200,{cancelRequested:true,studio:studio.snapshot(),comfy:comfy.snapshot()});return;}
             if(req.url==='/images/start'&&studio.snapshot().settings.releaseGPU&&backend){textPausedForImages=true;lastAttempt=selected();stopBackend('image');await waitUntil(()=>!backend,null,30000);}if(req.url==='/images/generate'){json(200,await studio.action('/studio/generate',data));return;}if(req.url.startsWith('/images/')){const result=await images.action(req.url,data);if(req.url==='/images/stop'&&textPausedForImages){await waitUntil(()=>!images.snapshot().running,null,30000);textPausedForImages=false;await ensureText();}json(200,result);return;}
            if(req.url==='/memory/get'){json(200,readMemory(root,data.id));return;}
            if(req.url==='/memory/save'){json(200,editMemory(root,data.id,data));return;}
            if(req.url==='/task'){
                if(!backendReady)throw Error('Load a text model in Models first.');
                if(!['adventure','character','summary'].includes(data.mode)||typeof data.prompt!=='string')throw Error('Invalid task.');
                const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort()});
                const prompt='<|im_start|>user\n'+data.prompt+'<|im_end|>\n<|im_start|>assistant\n';
                const structured=data.mode==='adventure'&&/\bJSON\b|Return\s*\{/i.test(data.prompt);const result=await pipeline.generate({prompt,stream:false,stop:['<|im_end|>','<|endoftext|>']},controller.signal,{mode:structured?'adventure-json':data.mode});json(200,{text:result.choices[0].text});return;
            }
            if(req.url==='/adventure/storage/get'||req.url==='/adventure/storage/set'){
                if(typeof data.key!=='string'||data.key.length>200)throw Error('Invalid save slot.');
                const dir=path.join(root,'AdventureSaves');fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,crypto.createHash('sha256').update(data.key).digest('hex')+'.json');
                if(req.url.endsWith('/get')){json(200,{value:fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null});return;}
                fs.writeFileSync(file+'.tmp',JSON.stringify(data.value));fs.renameSync(file+'.tmp',file);json(200,{saved:true});return;
            }
            if (req.url === '/download') await beginDownload(data.index);
            else if (req.url === '/custom') {
                const url = new URL(data.url);
                const match = /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/resolve\/main\/([A-Za-z0-9_./-]+\.gguf)$/.exec(url.pathname);
                if (url.protocol !== 'https:' || url.hostname !== 'huggingface.co' || url.username || url.password || url.search || url.hash || !match || url.pathname.includes('..')) throw new Error('Use a public HTTPS Hugging Face direct GGUF link.');
                const repo = match[1] + '/' + match[2], remote = match[3];
                const index = catalog.push({ Label: 'Custom: ' + path.basename(remote), Repo: repo, File: remote, LocalFile: match[1] + '_' + match[2] + '__' + path.basename(remote), Size: 0, License: 'See model card' }) - 1;
                await beginDownload(index);
            } else if (req.url === '/delete') {
                if (backend && runningModel === data.name) throw new Error('Stop AI before deleting the loaded model.');
                const file = resolveModel(models, data.name);
                if (data.name === selected()) fs.unlinkSync(selection);
                fs.unlinkSync(file); state = 'Model deleted.';
            }
            else if (req.url === '/cancel') {
                if (download?.verifying) throw new Error('Verification is finishing; please wait.');
                if (download) { download.cancelled = true; download.process?.kill(); }
            } else if (req.url === '/select') await choose(data.name);
            else if (req.url === '/start') {
                if (backend && runningModel !== selected()) {
                    const old = backend; const done = new Promise(resolve => old.once('exit', resolve)); stopBackend(); await done;
                }
                lastAttempt = selected(); await runBackend();
            }
            else if (req.url === '/stop') { lastAttempt = selected(); stopBackend(); }
            else if(req.url==='/model-profile'){if(!['chatml','mistral-v3','mistral-v7'].includes(data.Template))throw Error('Unsupported prompt format.');const name=selected();if(!name)throw Error('Select a model.');const file=path.join(root,'model-profiles.json'),saved=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};saved[name]={Template:data.Template};fs.writeFileSync(file,JSON.stringify(saved));}
            else if (req.url === '/generation') { saveSettings(root,data); }
            else if (req.url === '/filter-preview') { json(200,{text:filterReply(data.text||'',data.settings?validateSettings(data.settings):readSettings(root))}); return; }
            else if (req.url === '/hardware') {
                if (backend || starting) throw new Error('Stop AI before changing hardware settings.');
                const current = fs.existsSync(path.join(root, 'backend.json')) ? fs.readFileSync(path.join(root, 'backend.json')) : null;
                try { fs.writeFileSync(path.join(root, 'backend.json'), JSON.stringify(data)); backendArguments(root, ''); }
                catch (e) { if (current) fs.writeFileSync(path.join(root, 'backend.json'), current); else fs.unlinkSync(path.join(root, 'backend.json')); throw e; }
                state = 'Hardware settings saved. Load your model to apply them.';
            }
            else if (req.url === '/advanced') {
                if (download) throw new Error('Finish or cancel the browser download first.');
                if (!manager) {
                    manager = spawn('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'ModelManager.ps1')], { windowsHide: false, stdio: 'ignore' });
                    manager.on('exit', () => { manager = null; }); manager.on('error', () => { manager = null; });
                }
            } else { json(404, { error: 'Unknown action.' }); return; }
            json(200, snapshot());
        } catch (e) { json(400, { error: e.message }); }
    });
    const timer = setInterval(async () => {
        if (checking || !autoStart) return; checking = true;
        try {
            const name = selected();
            if (!backend && name && name !== lastAttempt) { lastAttempt = name; await runBackend(); }
            if (backend && !backendReady && !stopIntent) {
                if (Date.now() - loadingSince > readinessTimeout) { backendError = 'Model loading timed out. Lower context or choose CPU in Hardware settings.'; state = backendError; stopBackend('timeout'); return; }
                const checkedBackend=backend;
                const result = await engineFetch(backendURL + '/api/v1/model', { signal: AbortSignal.timeout(1500) });
                if (result.ok && backend===checkedBackend && !stopIntent) { const data = await result.json(); if (data.result && data.result !== 'ReadOnly') { backendReady = true; engineState = 'ready'; state = 'AI ready. Hero Tavern is connecting your chat automatically.'; } }
            }
        } catch (e) { if (!backend) { state = e.message; backendError = e.message; engineState = 'error'; } } finally { checking = false; }
    }, pollInterval);
    server.on('close', () => { comfyRuntime.stop().catch(()=>{});comfy.models.cancel();comfyRuntime.cancelInstall();comfy.cancel().catch(()=>{});studio.cancel();assistant.cancel(); tuner.close(); clearInterval(timer); pipeline.abort(); images.close(); thinking.close(); download?.process?.kill(); stopBackend(); manager?.kill(); });
    // Calibration must be user-initiated: an automatic first-launch calibration can repeatedly kill the chat worker.
    server.listen(port, '127.0.0.1');
    return server;
}
module.exports = { createBridge, verifyModel, resolveModel, backendArguments };
if (require.main === module) {
    const server = createBridge(process.argv[2] || __dirname);
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit()));
}
