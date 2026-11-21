// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: fs; PROTOCOL; MODULES; LINE_LIMIT; CAPTURE_BYTES; moduleId; registryDirectory; recordFile; validRecord; readRecord; alive; removeIfStale; lineReader; publish; connect
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/modules/registry.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// 独立模块注册表：<配置目录>/runtime/modules/<id>.json + 令牌鉴权的本机 JSON 行通道。
// 文件只是线索；连通并鉴权成功才算模块在线，崩溃残留不会让 OS 误隐藏标签。
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto');
const {EventEmitter}=require('node:events');
const {atomicWriteJson}=require('../json-storage.cjs');

const PROTOCOL='aieyra-module/1';
const MODULES=Object.freeze(['os','link']);
const LINE_LIMIT=64*1024;
const CAPTURE_BYTES=8*1024*1024;

function moduleId(id){if(!MODULES.includes(id))throw Error('未知模块：'+String(id));return id;}
function registryDirectory(configDir){
 if(typeof configDir!=='string'||!path.isAbsolute(configDir))throw Error('模块注册表目录必须为绝对路径');
 return path.join(require('../../../../Contracts/storage/paths.cjs').root(path.resolve(configDir),'runtime'),'modules');
}
function recordFile(configDir,id){return path.join(registryDirectory(configDir),moduleId(id)+'.json');}

function validRecord(value,id){
 return !!value&&typeof value==='object'&&value.protocol===PROTOCOL&&value.id===id&&Number.isSafeInteger(value.pid)&&value.pid>0
  &&Number.isInteger(value.port)&&value.port>0&&value.port<65536&&/^[a-f0-9]{64}$/.test(value.token||'')&&typeof value.started_at==='string';
}
function readRecord(configDir,id){
 const file=recordFile(configDir,id);
 let raw;try{raw=fs.readFileSync(file,'utf8');}catch(error){if(error.code==='ENOENT')return null;throw error;}
 if(raw.length>8192)return {invalid:true,raw};
 let value;try{value=JSON.parse(raw);}catch{return {invalid:true,raw};}
 return validRecord(value,id)?{record:value,raw}:{invalid:true,raw};
}
function alive(pid){try{process.kill(pid,0);return true;}catch(error){return error.code==='EPERM';}}
// 只在内容未变且原进程已不存在时删除，不结束任何进程。
function removeIfStale(configDir,id,raw,pid){
 if(pid&&alive(pid))return false;
 const file=recordFile(configDir,id);
 try{if(fs.readFileSync(file,'utf8')!==raw)return false;fs.unlinkSync(file);return true;}catch{return false;}
}

function lineReader(onLine,onOverflow,limit=LINE_LIMIT){
 let buffer='';
 return chunk=>{
  buffer+=String(chunk);
  if(buffer.length>limit&&!buffer.includes('\n')){buffer='';onOverflow();return;}
  let at;
  while((at=buffer.indexOf('\n'))>=0){
   const line=buffer.slice(0,at);buffer=buffer.slice(at+1);
   if(line.length>limit){buffer='';onOverflow();return;}
   if(!line.trim())continue;
   let value;try{value=JSON.parse(line);}catch{onOverflow();return;}
   onLine(value);
  }
 };
}

// 模块侧：发布在线记录并接受 OS 的请求。handlers 返回值会作为 result。
function publish({id,configDir,version='',handlers={},pid=process.pid,now=()=>new Date().toISOString()}){
 moduleId(id);
 const token=crypto.randomBytes(32).toString('hex'),expected=Buffer.from(token),peers=new Set();
 let closed=false,record=null,raw='';
 return new Promise((resolve,reject)=>{
  const server=net.createServer(peer=>{
   peer.setEncoding('utf8');peer.on('error',()=>{});
   if(closed||peers.size>=16){peer.destroy();return;}
   let authenticated=false;
   const timer=setTimeout(()=>{if(!authenticated)peer.destroy();},3000);
   const send=value=>{if(!peer.destroyed)peer.write(JSON.stringify(value)+'\n');};
   peer.on('data',lineReader(async message=>{
    if(!authenticated){
     const offered=Buffer.from(typeof message?.token==='string'?message.token:'');
     if(message?.type!=='hello'||offered.length!==expected.length||!crypto.timingSafeEqual(offered,expected)){peer.destroy();return;}
     authenticated=true;clearTimeout(timer);peers.add(peer);peer.once('close',()=>peers.delete(peer));
     send({type:'welcome',protocol:PROTOCOL,module:id,pid,version});return;
    }
    if(message?.type!=='request'||typeof message.id!=='string'||typeof message.method!=='string')return;
    const handler=message.method==='ping'?()=>({module:id,pid,version}):Object.hasOwn(handlers,message.method)?handlers[message.method]:null;
    if(!handler){send({type:'response',id:message.id,ok:false,error:'模块不支持此操作'});return;}
    try{send({type:'response',id:message.id,ok:true,result:await handler(message.params||{})});}
    catch(error){send({type:'response',id:message.id,ok:false,error:String(error?.message||error)});}
   },()=>peer.destroy()));
  });
  server.once('error',reject);
  server.listen(0,'127.0.0.1',()=>{
   record={protocol:PROTOCOL,id,pid,port:server.address().port,token,version,started_at:now()};
   try{
    fs.mkdirSync(registryDirectory(configDir),{recursive:true});
    atomicWriteJson(recordFile(configDir,id),record);
    raw=fs.readFileSync(recordFile(configDir,id),'utf8');
   }catch(error){server.close();reject(error);return;}
   function broadcast(name,payload={}){for(const peer of peers)if(!peer.destroyed)peer.write(JSON.stringify({type:'event',name,payload})+'\n');}
   function close(){
    if(closed)return Promise.resolve();closed=true;
    try{if(fs.readFileSync(recordFile(configDir,id),'utf8')===raw)fs.unlinkSync(recordFile(configDir,id));}catch{}
    for(const peer of peers)peer.destroy();
    return new Promise(done=>server.close(()=>done()));
   }
   resolve({record:{...record,token:undefined},broadcast,close});
  });
 });
}

// OS 侧（或另一个模块）：连接在线模块。不在线返回 null；顺带清理已确认的崩溃残留。
function connect(configDir,id,{timeout=1500,allowCapture=false}={}){
 let found;try{found=readRecord(configDir,id);}catch{return Promise.resolve(null);}
 if(!found)return Promise.resolve(null);
 if(found.invalid){removeIfStale(configDir,id,found.raw,0);return Promise.resolve(null);}
 const {record,raw}=found;
 return new Promise(resolve=>{
  const events=new EventEmitter(),pending=new Map();
  let settled=false,welcome=null,closed=false;
  const socket=net.connect(record.port,'127.0.0.1');socket.setEncoding('utf8');
  const timer=setTimeout(()=>fail(),timeout);
  function fail(){if(settled)return;settled=true;clearTimeout(timer);socket.destroy();removeIfStale(configDir,id,raw,record.pid);resolve(null);}
  socket.on('error',fail);
  socket.on('close',()=>{
   if(!settled){fail();return;}
   closed=true;
   for(const row of pending.values()){clearTimeout(row.timer);row.reject(Error('模块连接已断开'));}
   pending.clear();events.emit('close');
  });
  socket.on('connect',()=>socket.write(JSON.stringify({type:'hello',token:record.token})+'\n'));
  socket.on('data',lineReader(message=>{
   if(!welcome){
    if(message?.type!=='welcome'||message.module!==id||message.pid!==record.pid){fail();return;}
    welcome=message;settled=true;clearTimeout(timer);
    resolve({
     info:{id,pid:record.pid,version:message.version||'',started_at:record.started_at},
     request(method,params={},{timeout:limit=15000}={}){
      if(closed)return Promise.reject(Error('模块连接已断开'));
      const requestId=crypto.randomUUID();
      return new Promise((ok,no)=>{
       const row={resolve:ok,reject:no,timer:setTimeout(()=>{pending.delete(requestId);no(Error('模块没有及时响应'));},limit)};
       pending.set(requestId,row);socket.write(JSON.stringify({type:'request',id:requestId,method,params})+'\n');
      });
     },
     on:(name,fn)=>{events.on(name,fn);return ()=>events.off(name,fn);},
     closed:()=>closed,
     close(){socket.end();socket.destroy();},
    });
    return;
   }
   if(message?.type==='response'&&pending.has(message.id)){
    const row=pending.get(message.id);pending.delete(message.id);clearTimeout(row.timer);
    message.ok?row.resolve(message.result):row.reject(Error(String(message.error||'模块操作失败')));
   }else if(message?.type==='event'&&typeof message.name==='string')events.emit('event',message.name,message.payload);
  // Public avatar projections can contain a validated PNG up to 180KB.
  // Requests retain the 64KB limit; replies have a separate bounded allowance.
  },()=>socket.destroy(),allowCapture?Math.ceil(CAPTURE_BYTES/3)*4+8192:256*1024));
 });
}

module.exports={PROTOCOL,MODULES,CAPTURE_BYTES,registryDirectory,recordFile,readRecord,publish,connect};
