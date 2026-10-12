// Engine process fixture with observable hidden-planning and streamed-reply behavior.
const http=require('node:http'),fs=require('node:fs');
const args=process.argv.slice(2),value=name=>args[args.indexOf(name)+1];
if(!args.includes('--skiplauncher')||!fs.existsSync(value(args.includes('--sdmodel')?'--sdmodel':'--model'))||value('--host')!=='127.0.0.1')process.exit(3);
console.log('Fixture model loaded: '+value('--model'));
let completions=0,planning=0,lastPrompt='';
http.createServer(async(req,res)=>{
 const json=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data))};
 if(req.url==='/sdapi/v1/sd-models')return json([{model_name:'fixture-image-model'}]);
 if(req.url==='/sdapi/v1/txt2img')return json({images:['iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB1kAAAAASUVORK5CYII='],info:'fixture'});
 if(req.url==='/api/extra/tokencount'){let raw='';for await(const chunk of req)raw+=chunk;return json({value:Math.ceil(JSON.parse(raw||'{}').prompt.length/4)});}
 if(req.url==='/api/v1/model')return json({result:'fixture-kobold-model'});
 if(req.url==='/v1/models')return json({data:[{id:'fixture-kobold-model'}]});
 if(req.url==='/props')return json({chat_template:'{{ messages }}'});
 if(req.url==='/api/extra/teststats')return json({completions,planning,lastPrompt});
 if(req.url==='/v1/completions'){
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw||'{}');completions++;lastPrompt=body.prompt;
  const isPlan=body.prompt.includes('[Private continuity outline]');if(isPlan)planning++;
  const structured=body.prompt.includes('state-analysis JSON')?JSON.stringify({changes:[]}):body.prompt.includes('Draft trackers for a character/story')?JSON.stringify({trackers:[{id:'courage',label:'Courage',type:'number',initialValue:40,min:0,max:100,updateMode:'approval',instructions:'Act according to courage.'}]}):body.prompt.includes('Draft lore for a character/story')?JSON.stringify({lore:[{id:'vault',label:'Vault',text:'A vault lies below the tavern.',keywords:['vault'],visibility:'player'}]}):null;const isAdventure=body.prompt.includes('Ilreon schema');const text=structured|| (isAdventure?JSON.stringify({phase:'resolve',narration:'Илреон оживает.',lines:[],patch:{},outcome:'Продолжение приключения.'}):isPlan?'OUTLINE_PRIVATE_FIXTURE':'<think>ANALYSIS_PRIVATE_FIXTURE</think>Fixture generation works.');
  if(body.stream){res.setHeader('Content-Type','text/event-stream');for(const part of [text.slice(0,4),text.slice(4,15),text.slice(15)])res.write('data: '+JSON.stringify({choices:[{text:part}]})+'\n\n');res.end('data: [DONE]\n\n');}
  else json({choices:[{text}],results:[{text}]});return;
 }
 json({results:[{text:'Fixture generation works.'}]});
}).listen(Number(value('--port')),value('--host'));
