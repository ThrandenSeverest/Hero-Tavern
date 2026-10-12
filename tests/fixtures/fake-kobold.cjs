// Engine process fixture with observable hidden-planning and streamed-reply behavior.
const http=require('node:http'),fs=require('node:fs');
const args=process.argv.slice(2),value=name=>args[args.indexOf(name)+1];
if(!args.includes('--skiplauncher')||!fs.existsSync(value('--model'))||value('--host')!=='127.0.0.1')process.exit(3);
console.log('Fixture model loaded: '+value('--model'));
let completions=0,planning=0;
http.createServer(async(req,res)=>{
 const json=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data))};
 if(req.url==='/api/v1/model')return json({result:'fixture-kobold-model'});
 if(req.url==='/v1/models')return json({data:[{id:'fixture-kobold-model'}]});
 if(req.url==='/props')return json({chat_template:'{{ messages }}'});
 if(req.url==='/api/extra/teststats')return json({completions,planning});
 if(req.url==='/v1/completions'){
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw||'{}');completions++;
  const isPlan=body.prompt.includes('[Private continuity outline]');if(isPlan)planning++;
  const text=isPlan?'OUTLINE_PRIVATE_FIXTURE':'<think>ANALYSIS_PRIVATE_FIXTURE</think>Fixture generation works.';
  if(body.stream){res.setHeader('Content-Type','text/event-stream');for(const part of [text.slice(0,4),text.slice(4,15),text.slice(15)])res.write('data: '+JSON.stringify({choices:[{text:part}]})+'\n\n');res.end('data: [DONE]\n\n');}
  else json({choices:[{text}],results:[{text}]});return;
 }
 json({results:[{text:'Fixture generation works.'}]});
}).listen(Number(value('--port')),value('--host'));
