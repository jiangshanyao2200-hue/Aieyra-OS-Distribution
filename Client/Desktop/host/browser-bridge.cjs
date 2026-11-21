// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: http; startBrowserBridge
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/browser-bridge.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const http=require('node:http'),crypto=require('node:crypto');
async function startBrowserBridge(browser){
 const secret=crypto.randomBytes(32).toString('hex'),pending=new Set();let authority='',closed=false;
 const server=http.createServer(async(req,res)=>{
  res.setHeader('cache-control','no-store');res.setHeader('content-type','application/json');
  if(req.headers.host!==authority||req.headers.origin||req.headers['sec-fetch-site']||req.url!=='/'+secret||req.method!=='POST'){res.writeHead(403);res.end('{"ok":false}');return;}
  const controller=new AbortController();pending.add(controller);
  const abort=()=>{if(!res.writableEnded)controller.abort();};res.on('close',abort);req.on('aborted',abort);
  const timer=setTimeout(()=>controller.abort(),45000);timer.unref();
  try{let size=0,parts=[];for await(const chunk of req){size+=chunk.length;if(size>1<<20)throw Error('Browser request too large');parts.push(chunk);}
   const p=JSON.parse(Buffer.concat(parts));if(!p||typeof p.owner!=='string'||!p.owner||p.owner.length>256||!p.arguments||typeof p.arguments!=='object'||Array.isArray(p.arguments))throw Error('Invalid browser request');
   const result=await browser.execute(p.owner,p.arguments,controller.signal);if(!res.destroyed)res.end(JSON.stringify(result));
  }catch(e){if(!res.destroyed)res.end(JSON.stringify({ok:false,error:String(e.message)}));}
  finally{clearTimeout(timer);pending.delete(controller);res.removeListener('close',abort);req.removeListener('aborted',abort);}
 });server.requestTimeout=50000;server.headersTimeout=10000;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});authority='127.0.0.1:'+server.address().port;
 let closing;
 return {url:'http://'+authority+'/'+secret,close(){if(closed)return closing;closed=true;for(const controller of pending)controller.abort();server.close();server.closeAllConnections();closing=browser.close();return closing;}};
}
module.exports={startBrowserBridge};
