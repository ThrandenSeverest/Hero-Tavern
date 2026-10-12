// Local inference transport with explicit deadlines, no hidden fetch header timeout.
const http=require('node:http'),{Readable}=require('node:stream');
function engineFetch(input,options={}){const url=new URL(input);if(url.hostname!=='127.0.0.1'||url.protocol!=='http:')return fetch(input,options);return new Promise((resolve,reject)=>{
 const started=Date.now(),completion=/completions|txt2img/.test(url.pathname),timeoutMs=options.timeoutMs??(completion?1200000:10000);let response,settled=false;
 const notify=(stage,extra={})=>options.onEvent?.({stage,url:url.origin+url.pathname,elapsedMs:Date.now()-started,...extra});notify('request-start',{timeoutMs});
 const req=http.request(url,{method:options.method||'GET',headers:options.headers||{},agent:false},res=>{response=res;clearTimeout(connectTimer);notify('headers-received',{status:res.statusCode});settled=true;const stream=Readable.toWeb(res);resolve(new Response([204,205,304].includes(res.statusCode)?null:stream,{status:res.statusCode,headers:res.headers}));res.on('end',()=>{notify('response-complete');cleanup()});res.on('error',()=>cleanup());});
 const fail=(code,message,cause)=>{const e=new Error(message,{cause});e.code=code;e.endpoint=url.origin+url.pathname;e.elapsedMs=Date.now()-started;notify('request-error',{code,message});if(!settled)reject(e);req.destroy(e);response?.destroy(e);cleanup();};
 const deadline=setTimeout(()=>fail('ENGINE_DEADLINE',`Local engine exceeded the explicit ${Math.round(timeoutMs/1000)} second deadline.`),timeoutMs);const connectTimer=setTimeout(()=>fail('ENGINE_CONNECT_TIMEOUT','Local engine connection timed out.'),Math.min(5000,timeoutMs));
 function cleanup(){clearTimeout(deadline);clearTimeout(connectTimer);options.signal?.removeEventListener('abort',abort)}
 const abort=()=>fail('ENGINE_CANCELLED','Local engine request cancelled.',options.signal?.reason);options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted){abort();return;}
 req.on('socket',s=>s.once('connect',()=>{clearTimeout(connectTimer);notify('connected')}));req.on('error',e=>{notify('request-error',{code:e.code,message:e.message});if(!settled)reject(Object.assign(new Error('Could not complete local engine request: '+e.message,{cause:e}),{code:e.code,endpoint:url.origin+url.pathname,elapsedMs:Date.now()-started}));cleanup()});if(options.body)req.write(options.body);req.end();
 });}
function errorDetails(error){const causes=[];let e=error;for(let i=0;e&&i<8;i++,e=e.cause){causes.push({name:e.name,code:e.code||null,message:e.message||String(e),endpoint:e.endpoint});}return {message:error.message,code:causes.find(x=>x.code)?.code||'GENERATION_ERROR',causes};}
module.exports={engineFetch,errorDetails};
