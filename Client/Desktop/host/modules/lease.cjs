// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: net; ACK; ownerEnvironment; openLease
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/modules/lease.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// 与 Core/internal/osowner/lease.go 同一协议：本机端口 + 64 位十六进制令牌，
// 鉴权后回 aieyra-os-owner/1。独立模块宿主用它持有 Control 与 Link CLI 的生命周期。
const net=require('node:net'),crypto=require('node:crypto');
const ACK='aieyra-os-owner/1\n';

function ownerEnvironment(base,port,token){
 const result={};
 for(const [key,value] of Object.entries(base||{}))if(!key.startsWith('AIEYRA_OS_OWNER_'))result[key]=value;
 return {...result,AIEYRA_OS_OWNER_PORT:String(port),AIEYRA_OS_OWNER_TOKEN:token};
}

function openLease({maxPeers=64,handshakeMs=3000}={}){
 return new Promise((resolve,reject)=>{
  const token=crypto.randomBytes(32).toString('hex'),expected=Buffer.from(token+'\n'),peers=new Set();
  let closed=false,listening=false,closing=null;
  const server=net.createServer(peer=>{
   peer.on('error',()=>{});
   if(closed||peers.size>=maxPeers){peer.destroy();return;}
   peers.add(peer);peer.once('close',()=>peers.delete(peer));
   let buffer=Buffer.alloc(0),authenticated=false;
   const timer=setTimeout(()=>{if(!authenticated)peer.destroy();},handshakeMs);
   peer.on('data',chunk=>{
    // 鉴权后的字节只用于保持连接，全部丢弃。
    if(authenticated)return;
    buffer=Buffer.concat([buffer,chunk]);
    const at=buffer.indexOf(10);
    if(at<0){if(buffer.length>=128)peer.destroy();return;}
    clearTimeout(timer);
    const line=buffer.subarray(0,at+1);
    if(line.length!==expected.length||!crypto.timingSafeEqual(line,expected)){peer.destroy();return;}
    authenticated=true;peer.write(ACK);
   });
  });
  server.on('error',error=>{if(!listening)reject(error);});
  server.listen(0,'127.0.0.1',()=>{
   listening=true;
   const port=server.address().port;
   function close(){
    if(closing)return closing;
    closed=true;
    closing=new Promise(done=>server.close(()=>done()));
    for(const peer of peers)peer.destroy();
    peers.clear();
    return closing;
   }
   resolve({port,token,env:base=>ownerEnvironment(base,port,token),close,peers:()=>peers.size});
  });
 });
}

module.exports={openLease,ownerEnvironment,ACK};
