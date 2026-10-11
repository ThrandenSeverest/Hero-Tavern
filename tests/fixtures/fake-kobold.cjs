// Small process fixture: validates CLI forwarding and models KoboldCpp readiness.
const http=require('node:http'),fs=require('node:fs');
const args=process.argv.slice(2),value=name=>args[args.indexOf(name)+1];
if(!args.includes('--skiplauncher')||!fs.existsSync(value('--model'))||value('--host')!=='127.0.0.1')process.exit(3);
console.log('Fixture model loaded: '+value('--model'));
http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url==='/api/v1/model'?{result:'fixture-kobold-model'}:req.url==='/v1/models'?{data:[{id:'fixture-kobold-model'}]}:req.url==='/props'?{chat_template:'{{ messages }}'}:{choices:[{text:'Fixture generation works.'}],results:[{text:'Fixture generation works.'}]}))}).listen(Number(value('--port')),value('--host'));
