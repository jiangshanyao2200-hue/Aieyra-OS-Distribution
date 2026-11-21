// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: http; crypto; fs; path; paths; cfg; sessions; startServer
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/terminal-server.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// 仅服务本次启动的 Terminal：回环地址、随机能力路径、同源校验、静态文件白名单。
const http=require('node:http');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {createService}=require('./service.cjs');
const paths=require('./paths.cjs');
const cfg=require('./config.cjs');
const sessions=require('./sessions.cjs');

async function startServer(configFile) {
 const secret=crypto.randomBytes(32).toString('hex');
 const prefix='/'+secret+'/';
 const service=createService(configFile);
 const root=path.resolve(__dirname,'..');
 const files=new Map([
  ['renderer/index.html','text/html; charset=utf-8'],['renderer/renderer.js','text/javascript; charset=utf-8'],
  ['renderer/terminal-bridge.js','text/javascript; charset=utf-8'],['renderer/styles.css','text/css; charset=utf-8'],
  ['assets/config.svg','image/svg+xml'],
 ]);
 let origin='';
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  const reject=(code,text)=>{res.writeHead(code);res.end(text);};
  if(req.headers.host!==origin.slice(7)||req.headers.origin&&req.headers.origin!==origin||req.headers['sec-fetch-site']==='cross-site')return reject(403,'Forbidden');
  if(!req.url.startsWith(prefix))return reject(404,'Not found');
  const route=req.url.slice(prefix.length);
  try {
   if(req.method==='GET'&&files.has(route)){
    res.setHeader('Content-Type',files.get(route));res.end(fs.readFileSync(path.join(root,route)));return;
   }
   if(req.method!=='POST'||route!=='rpc')return reject(404,'Not found');
   if(!String(req.headers['content-type']||'').startsWith('application/json'))return reject(415,'JSON required');
   let body='',size=0;
   for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)return reject(413,'Too large');body+=chunk;}
   const {method,payload}=JSON.parse(body);
   let result;
   if(method==='session:list')result={ok:true,sessions:await sessions.list(configFile)};
   else if(method==='session:restore')result=await sessions.restore(configFile,payload);
   else {
    const abort=new AbortController();const disconnected=()=>{if(!res.writableEnded)abort.abort();};
    if(method==='agent:browser'||method==='agent:computer')res.once('close',disconnected);
    try{result=method==='config:stamp'?{mtime:cfg.mtime(configFile),language:cfg.load(configFile).settings.language||'zh-CN'}:await service.call(method,payload,abort.signal);}
    finally{res.removeListener('close',disconnected);}
   }
   res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(result));
  }catch(err){res.statusCode=400;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:false,errors:[String(err.message)]}));}
 });
 server.once('close',()=>service.close());
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 origin='http://127.0.0.1:'+server.address().port;
 return {server,url:origin+prefix+'renderer/index.html',rpc:origin+prefix+'rpc'};
}
module.exports={startServer};

if(require.main===module){
 const index=process.argv.indexOf('--config');
 const configFile=paths.resolveConfigPath(index>=0?process.argv[index+1]:'');
 require('../../../Contracts/storage/profile.cjs').use(configFile);
 startServer(configFile).then(({url,server})=>{
  process.stdout.write(JSON.stringify({url})+'\n');
  // 启动器关闭输入管道时同步退出，不留下后台服务。
  process.stdin.resume();process.stdin.once('end',()=>{
   server.close(()=>process.exit(0));
   // The owner has gone. An incomplete request or abandoned keep-alive must
   // not retain the service beyond the parent's shutdown deadline.
   server.closeAllConnections();
  });
 }).catch(()=>{process.stderr.write('Terminal 配置服务启动失败\n');process.exitCode=1;});
}
