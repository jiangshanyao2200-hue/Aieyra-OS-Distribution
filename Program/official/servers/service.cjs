'use strict';
// 服务器管理：基于 ssh2（MIT）。列表和指纹存本机，密码只用 safeStorage 加密落盘，从不交给模型。
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
// 探针只读 /proc，不装服务、不开端口、不要 root；status 和部署用的是同一段脚本。
const PROBE=String.raw`#!/bin/sh
# Aieyra OS probe: read-only system facts, no service, no port, no root.
clean(){ printf '%s' "$1" | tr -d '\000-\037"\\' | cut -c1-120; }
num(){ case "$1" in ''|*[!0-9.]*) printf 0;; *) printf '%s' "$1";; esac; }
mem(){ awk -v k="$1:" '$1==k{print $2; exit}' /proc/meminfo; }
c1=$(awk '/^cpu /{print $2+$3+$4+$5+$6+$7+$8+$9, $5+$6}' /proc/stat)
sleep 0.5
c2=$(awk '/^cpu /{print $2+$3+$4+$5+$6+$7+$8+$9, $5+$6}' /proc/stat)
cpu=$(printf '%s %s' "$c1" "$c2" | awk '{t=$3-$1; i=$4-$2; if(t>0) printf "%.1f",(t-i)*100/t; else print 0}')
root=$(df -Pk / 2>/dev/null | awk 'NR==2{print $2, $3}')
disks=$(df -Pk 2>/dev/null | awk 'NR>1 && $1 ~ /^\// && !seen[$1]++ {gsub(/["\\]/,"",$6); printf "%s{\"mount\":\"%s\",\"total_kb\":%s,\"used_kb\":%s}",(n++?",":""),$6,$2,$3}')
iface=$(awk '$2=="00000000"{print $1; exit}' /proc/net/route 2>/dev/null)
net=$(sed 's/^ *//; s/:/ /' /proc/net/dev | awk -v i="$iface" 'NR>2 && $1!="lo" && (i=="" || $1==i){r+=$2; t+=$10} END{printf "%.0f %.0f",r,t}')
io=$(awk '$3 ~ /^(sd[a-z]+|vd[a-z]+|xvd[a-z]+|nvme[0-9]+n[0-9]+)$/{r+=$6; w+=$10} END{printf "%.0f %.0f",r*512,w*512}' /proc/diskstats 2>/dev/null)
conns=$(cat /proc/net/tcp /proc/net/tcp6 2>/dev/null | awk '$4=="01"{n++} END{print n+0}')
procs=$(awk '{split($4,a,"/"); print a[2]}' /proc/loadavg)
top=$(ps -eo pid=,pcpu=,pmem=,comm= --sort=-pcpu 2>/dev/null | head -8 | awk '{gsub(/["\\]/,"",$4); printf "%s{\"pid\":%s,\"cpu\":%s,\"mem\":%s,\"name\":\"%s\"}",(n++?",":""),$1,$2,$3,$4}')
boxes=$(timeout 3 docker ps --format '{{.Names}}|{{.Status}}' 2>/dev/null | head -40 | awk -F'|' '{gsub(/["\\]/,""); printf "%s{\"name\":\"%s\",\"status\":\"%s\"}",(n++?",":""),$1,$2}')
os=$(awk -F= '$1=="PRETTY_NAME"{gsub(/"/,"",$2); print $2}' /etc/os-release 2>/dev/null)
model=$(awk -F': ' '/model name/{print $2; exit}' /proc/cpuinfo)
printf '{"cpu":%s,"cores":%s,"mem_total_kb":%s,"mem_avail_kb":%s,"mem_cached_kb":%s,"swap_total_kb":%s,"swap_free_kb":%s,"disk_total_kb":%s,"disk_used_kb":%s,"disks":[%s],"load":"%s","uptime_s":%s,"net_rx":%s,"net_tx":%s,"io_read":%s,"io_write":%s,"iface":"%s","conns":%s,"procs":%s,"top":[%s],"containers":[%s],"host":"%s","kernel":"%s","os":"%s","model":"%s"}\n' "$(num "$cpu")" "$(num "$(grep -c '^processor' /proc/cpuinfo)")" "$(num "$(mem MemTotal)")" "$(num "$(mem MemAvailable)")" "$(num "$(mem Cached)")" "$(num "$(mem SwapTotal)")" "$(num "$(mem SwapFree)")" "$(num "$(echo "$root" | cut -d' ' -f1)")" "$(num "$(echo "$root" | cut -d' ' -f2)")" "$disks" "$(cut -d' ' -f1-3 /proc/loadavg)" "$(num "$(cut -d' ' -f1 /proc/uptime)")" "$(num "$(echo "$net" | cut -d' ' -f1)")" "$(num "$(echo "$net" | cut -d' ' -f2)")" "$(num "$(echo "$io" | cut -d' ' -f1)")" "$(num "$(echo "$io" | cut -d' ' -f2)")" "$(clean "$iface")" "$(num "$conns")" "$(num "$procs")" "$top" "$boxes" "$(clean "$(hostname)")" "$(clean "$(uname -r)")" "$(clean "$os")" "$(clean "$model")"
`;
const PROBE_PATH='.aieyra/probe.sh',IDLE_MS=120000,IMAGE_MAX=3*1024*1024;
const text=(v,max,label)=>{if(typeof v!=='string'||!v.trim()||v.length>max||/[\x00-\x1f]/.test(v))throw Error(label+'无效');return v.trim();};
const CONNECT_ERRORS={ECONNREFUSED:'连接被拒绝：检查地址、端口和 SSH 服务',ETIMEDOUT:'连接超时：服务器没有响应',ENOTFOUND:'找不到这个地址',EHOSTUNREACH:'网络到不了这台服务器',ECONNRESET:'连接被对方断开'};
const connectError=e=>CONNECT_ERRORS[e.code]||String(e.message||e);
function parseSSHConfig(raw,base=os.homedir()){
 const rows=[];let block=null;
 for(const line of String(raw).split(/\r?\n/)){
  const m=/^\s*([A-Za-z]+)\s*[= ]\s*(.+?)\s*$/.exec(line);if(!m||line.trim().startsWith('#'))continue;
  const key=m[1].toLowerCase(),value=m[2].replace(/^"|"$/g,'');
  if(key==='host'){block={aliases:value.split(/\s+/).filter(a=>!/[*?!]/.test(a))};if(block.aliases.length)rows.push(block);continue;}
  if(key==='match'){block=null;continue;}
  if(block&&!(key in block))block[key]=value;
 }
 const expand=p=>p&&(p.startsWith('~')?path.join(base,p.slice(1)):p);
 return rows.flatMap(b=>b.aliases.map(alias=>({alias,host:b.hostname||alias,port:Number(b.port)||22,user:b.user||'',key_path:expand(b.identityfile)||'',proxy:!!b.proxyjump||!!b.proxycommand})));
}
function createServers({dataDir,safeStorage,Client=()=>{throw Error('SSH transport is unavailable in this host');},emit=()=>{},configFiles=()=>[path.join(os.homedir(),'.ssh','config')],now=Date.now}){
 const dir=require('../../../Contracts/storage/paths.cjs').root(dataDir,'servers'),file=path.join(dir,'servers.json'),secretFile=path.join(dir,'secrets.json');
 const read=(f,fallback)=>{try{return JSON.parse(fs.readFileSync(f,'utf8'));}catch{return fallback;}};
 const write=(f,value,raw=false)=>{fs.mkdirSync(dir,{recursive:true,mode:0o700});const tmp=f+'.'+crypto.randomUUID()+'.tmp';fs.writeFileSync(tmp,raw?value:JSON.stringify(value,null,1),{mode:0o600});fs.renameSync(tmp,f);};
 let state=read(file,{servers:[]}),closed=false,lifecycle=0;if(!Array.isArray(state.servers))state={servers:[]};
 const save=()=>write(file,state),live=new Map(),terminals=new Map(),openingShells=new Map(),samples=new Map();
 const assertCurrent=(ticket=lifecycle)=>{if(closed||ticket!==lifecycle)throw Error('服务器连接已关闭，请重新操作');};
 const assertServer=(s,ticket)=>{assertCurrent(ticket);if(!state.servers.includes(s))throw Error('服务器已移除');};
 const find=id=>{const s=state.servers.find(x=>x.id===id);if(!s)throw Error('服务器不存在');return s;};
 const imageFile=id=>path.join(dir,id+'.image'),vaultFile=path.join(dir,'vault.json');
 const image=id=>{try{return fs.readFileSync(imageFile(id),'utf8');}catch{return '';}};
 const pub=s=>({id:s.id,name:s.name,host:s.host,port:s.port,user:s.user,auth:s.auth,key_path:s.key_path||'',ssh_alias:s.ssh_alias||'',fingerprint:s.fingerprint||'',probe:!!s.probe,facts:s.facts||null,last:samples.get(s.id)||s.last||null,error:s.error||'',image:image(s.id)});
 // 每台服务器自己的图：只收真实图片，存成 data URL，页面的 CSP 只放行这种。
 function setImage(id,file){
  find(id);const bytes=fs.readFileSync(file);if(bytes.length>IMAGE_MAX)throw Error('图片太大，最多 3 MB');
  const kind=bytes[0]===0x89&&bytes[1]===0x50?'png':bytes[0]===0xff&&bytes[1]===0xd8?'jpeg':bytes.subarray(0,4).toString('latin1')==='RIFF'&&bytes.subarray(8,12).toString('latin1')==='WEBP'?'webp':'';
  if(!kind)throw Error('只支持 PNG、JPG 和 WebP');
  write(imageFile(id),'data:image/'+kind+';base64,'+bytes.toString('base64'),true);return {ok:true,image:image(id)};
 }
 // 裁切后的图由页面直接给 data URL；同样只收 PNG、JPG、WebP。
 function setImageData(id,data){
  find(id);const m=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(data||''));
  if(!m)throw Error('只支持 PNG、JPG 和 WebP');if(Buffer.byteLength(m[2],'base64')>IMAGE_MAX)throw Error('图片太大，最多 3 MB');
  write(imageFile(id),data,true);return {ok:true,image:image(id)};
 }
 function rename(id,name){const s=find(id);s.name=text(name,60,'名称');save();return {ok:true,server:pub(s)};}
 // 密码本：用户和 Agent 共用。标题、账号明文便于查找；密码和备注用系统加密（DPAPI）落盘。
 // Agent 只能读“允许 Agent 读取”的条目；它自己记下的默认允许。
 const sealed=value=>{if(!value)return '';if(!safeStorage?.isEncryptionAvailable())throw Error('系统加密不可用，不能保存到密码本');return safeStorage.encryptString(value).toString('base64');};
 const opened=value=>{if(!value)return '';if(!safeStorage?.isEncryptionAvailable())throw Error('系统加密不可用，无法读取密码本');return safeStorage.decryptString(Buffer.from(value,'base64'));};
 const vault={
  read(){const v=read(vaultFile,{entries:[]});return Array.isArray(v.entries)?v:{entries:[]};},
  entry(id){const e=vault.read().entries.find(x=>x.id===id);if(!e)throw Error('密码本里没有这一条');return e;},
  view:e=>({id:e.id,title:e.title,account:e.account||'',url:e.url||'',has_secret:!!e.secret,has_note:!!e.note,agent:!!e.agent,by:e.by||'user',updated:e.updated||e.created||0}),
  list(){return vault.read().entries.map(vault.view).sort((a,b)=>b.updated-a.updated);},
  reveal(id){const e=vault.entry(id);return {secret:opened(e.secret),note:opened(e.note)};},
  save(p,by){
   const all=vault.read(),at=now(),old=p.id?all.entries.find(x=>x.id===p.id):null;
   if(p.id&&!old)throw Error('密码本里没有这一条');
   if(by==='agent'&&old&&!old.agent)throw Error('这一条没有允许 Agent 修改');
   const title=text(p.title??old?.title,80,'标题'),opt=(v,max,label)=>{if(v===undefined||v===null||v==='')return '';if(typeof v!=='string'||v.length>max)throw Error(label+'无效');return v;};
   const row={id:old?.id||crypto.randomUUID(),title,account:opt(p.account??old?.account,200,'账号'),url:opt(p.url??old?.url,500,'地址'),
    secret:p.secret===undefined?old?.secret||'':sealed(opt(p.secret,4000,'密码')),note:p.note===undefined?old?.note||'':sealed(opt(p.note,8000,'备注')),
    agent:by==='agent'?true:p.agent===undefined?!!old?.agent:!!p.agent,by:old?.by||by,created:old?.created||at,updated:at};
   all.entries=[row,...all.entries.filter(x=>x.id!==row.id)].slice(0,500);write(vaultFile,all);return {ok:true,entry:vault.view(row)};
  },
  remove(id,by){const all=vault.read(),e=all.entries.find(x=>x.id===id);if(!e)throw Error('密码本里没有这一条');if(by==='agent'&&e.by!=='agent')throw Error('Agent 只能删除自己记下的条目');all.entries=all.entries.filter(x=>x.id!==id);write(vaultFile,all);return {ok:true};},
 };
 function secret(id,value){
  const all=read(secretFile,{});
  if(value===undefined){if(!all[id])return '';if(!safeStorage?.isEncryptionAvailable())throw Error('系统加密不可用，无法读取密码');return safeStorage.decryptString(Buffer.from(all[id],'base64'));}
  if(value===null){delete all[id];}
  else{if(!safeStorage?.isEncryptionAvailable())throw Error('系统加密不可用，不能保存密码；请改用密钥');all[id]=safeStorage.encryptString(value).toString('base64');}
  write(secretFile,all);
 }
 function rememberConnectionFailure(s,error){
  s.error=String(error.message||error);
  try{save();return error;}catch(saveError){return new AggregateError([error,saveError],s.error+'；连接状态保存失败，原资料已保留');}
 }
 function connectOptions(s,isCurrent=()=>true,fail=()=>{}){
  const options={host:s.host,port:s.port,username:s.user,readyTimeout:15000,keepaliveInterval:20000,keepaliveCountMax:3,hostHash:'sha256',
   // 第一次记住指纹；之后变了就拒绝，防中间人。
   hostVerifier:key=>{if(!isCurrent())return false;const value=typeof key==='string'?key:key.toString('hex');if(s.fingerprint&&s.fingerprint!==value){fail(rememberConnectionFailure(s,Error('服务器指纹变了，已拒绝连接；确认无误后移除再重新添加')));return false;}s.pendingFingerprint=value;return true;}};
  if(s.auth==='password')options.password=secret(s.id);
  else if(s.key_path){let key;try{key=fs.readFileSync(s.key_path);}catch{throw Error('读不到密钥文件：'+s.key_path);}options.privateKey=key;const phrase=secret(s.id);if(phrase)options.passphrase=phrase;}
  else if(process.env.SSH_AUTH_SOCK)options.agent=process.env.SSH_AUTH_SOCK;
  else if(process.platform==='win32')options.agent='pageant';
  return options;
 }
 function open(s){
  assertServer(s,lifecycle);
  const held=live.get(s.id);if(held){idle(s.id,held);return held.ready;}
  const client=Client(),ticket=lifecycle,entry={client,idle:null,reject:null};
  const fail=error=>{entry.reject?.(error);drop(s.id,entry);};
  entry.ready=new Promise((resolve,reject)=>{
   entry.reject=reject;
   client.once('ready',()=>{try{assertServer(s,ticket);if(live.get(s.id)!==entry)throw Error('服务器连接已关闭');if(s.pendingFingerprint&&!s.fingerprint)s.fingerprint=s.pendingFingerprint;delete s.pendingFingerprint;s.error='';save();resolve(client);}catch(e){fail(e);}});
   client.on('error',e=>{if(live.get(s.id)!==entry)return;fail(rememberConnectionFailure(s,Error(e.level==='client-authentication'?'认证失败，检查用户名、密钥或密码':connectError(e))));});
   client.once('close',()=>drop(s.id,entry));
  });
  live.set(s.id,entry);idle(s.id,entry);
  try{client.connect(connectOptions(s,()=>!closed&&ticket===lifecycle&&live.get(s.id)===entry&&state.servers.includes(s),fail));}catch(e){fail(e);}
  return entry.ready;
 }
 function idle(id,entry){clearTimeout(entry.idle);entry.idle=null;if(live.get(id)===entry&&![...terminals.values()].some(t=>t.server===id))entry.idle=setTimeout(()=>drop(id,entry),IDLE_MS);}
 function drop(id,entry=live.get(id)){if(!entry||live.get(id)!==entry)return;live.delete(id);clearTimeout(entry.idle);entry.reject?.(Error('服务器连接已关闭'));try{entry.client.end();}catch{}}
 const exec=(client,command,input,timeout=20000)=>new Promise((resolve,reject)=>{
  client.exec(command,(err,stream)=>{
   if(err)return reject(err);
   let out='',errOut='',settled=false,timer;
   const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(out);};
   timer=setTimeout(()=>{finish(Error('服务器响应超时'));try{stream.close();}catch{}},timeout);
   stream.on('data',d=>{if(out.length<1<<20)out+=d;});stream.stderr.on('data',d=>{if(errOut.length<1<<16)errOut+=d;});
   stream.on('error',finish);stream.stderr.on('error',finish);
   stream.on('close',(code,signal)=>{if(signal)finish(Error('服务器命令被信号 '+signal+' 中断，执行结果未确认'));else if(code===0)finish();else finish(Error(errOut.trim()||(Number.isInteger(code)?'命令退出码 '+code:'服务器命令未返回退出码，执行结果未确认')));});
   try{if(input!==undefined)stream.end(input);}catch(error){finish(error);try{stream.close();}catch{}}
  });
 });
 async function sample(s){
  const ticket=lifecycle,client=await open(s),before=samples.get(s.id);assertServer(s,ticket);
  const raw=await exec(client,s.probe?'sh ~/'+PROBE_PATH+' 2>/dev/null || sh -s':'sh -s',PROBE);
  assertServer(s,ticket);
  const v=JSON.parse(raw.trim().split('\n').pop());
  const at=now(),rate=(k)=>before?.at&&v[k]>=before[k]&&at>before.at?Math.round((v[k]-before[k])/((at-before.at)/1000)):null;
  const pct=(used,total)=>total?Math.round(used*1000/total)/10:null;
  const row={...v,at,rx_rate:rate('net_rx'),tx_rate:rate('net_tx'),read_rate:rate('io_read'),write_rate:rate('io_write'),mem_used_pct:pct(v.mem_total_kb-v.mem_avail_kb,v.mem_total_kb),swap_used_pct:pct(v.swap_total_kb-v.swap_free_kb,v.swap_total_kb),disk_used_pct:pct(v.disk_used_kb,v.disk_total_kb)};
  samples.set(s.id,row);s.last=row;s.facts={host:v.host,kernel:v.kernel,cores:v.cores,os:v.os,model:v.model};s.error='';save();
  return row;
 }
 function importable(){
  const seen=new Set(),rows=[];
  for(const f of configFiles()){let raw;try{raw=fs.readFileSync(f,'utf8');}catch{continue;}
   for(const row of parseSSHConfig(raw))if(!seen.has(row.alias)){seen.add(row.alias);rows.push({...row,source:f,added:state.servers.some(s=>s.ssh_alias===row.alias||s.host===row.host&&s.user===row.user)});}}
  return rows;
 }
 function add(p){
  let base={};
  if(p.ssh_alias){base=importable().find(r=>r.alias===p.ssh_alias);if(!base)throw Error('SSH 配置里没有这个别名：'+p.ssh_alias);if(base.proxy)throw Error('这个别名用了跳板机，暂不支持');}
  const host=text(p.host||base.host,255,'地址'),user=text(p.user||base.user,64,'用户名'),port=Number(p.port||base.port||22);
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('端口无效');
  if(!/^[A-Za-z0-9._:-]+$/.test(host)||host.startsWith('-')||!/^[A-Za-z0-9._-]+$/.test(user)||user.startsWith('-'))throw Error('地址或用户名含有不允许的字符');
  const key_path=typeof (p.key_path||base.key_path)==='string'?(p.key_path||base.key_path):'';
  let password=p.password||'';
  if(p.vault_id){const e=vault.entry(p.vault_id);if(!e.agent)throw Error('这一条密码没有允许 Agent 使用');password=opened(e.secret);if(!password)throw Error('这一条没有密码');}
  const auth=password?'password':key_path?'key':'agent';
  if(state.servers.some(s=>s.host===host&&s.user===user&&s.port===port))throw Error('这台服务器已经在列表里');
  const row={id:crypto.randomUUID(),name:text(p.name||p.ssh_alias||host,60,'名称'),host,port,user,auth,key_path,ssh_alias:p.ssh_alias||'',probe:false};
  if(password||p.passphrase)secret(row.id,password||p.passphrase);
  state.servers.push(row);save();return {ok:true,server:pub(row)};
 }
 async function remove(id){
  const ticket=lifecycle,s=find(id);for(const [key,t] of terminals)if(t.server===id)closeTerminal(key);
  for(const [cancel,server] of openingShells)if(server===id)cancel();
  let probeRemoved=false;if(s.probe)try{await exec(await open(s),'rm -f ~/'+PROBE_PATH);probeRemoved=true;}catch{}
  assertServer(s,ticket);
  drop(id);samples.delete(id);secret(id,null);fs.rmSync(imageFile(id),{force:true});state.servers=state.servers.filter(x=>x.id!==id);save();
  return {ok:true,probe_removed:probeRemoved};
 }
 async function probe(id){
  const ticket=lifecycle,s=find(id),client=await open(s);assertServer(s,ticket);
  await exec(client,'mkdir -p ~/.aieyra && cat > ~/'+PROBE_PATH+' && chmod 700 ~/'+PROBE_PATH,PROBE);
  assertServer(s,ticket);
  s.probe=true;save();
  return {ok:true,path:'~/'+PROBE_PATH,sample:await sample(s)};
 }
 function closeTerminal(key){const t=terminals.get(key);if(!t)return;terminals.delete(key);t.owner?.removeListener?.('destroyed',t.stop);try{t.stream.close();}catch{}const held=live.get(t.server);if(held)idle(t.server,held);}
 async function openTerminal(id,cols,rows,owner){
  const ticket=lifecycle,s=find(id),client=await open(s),key=crypto.randomUUID();assertServer(s,ticket);
  if(owner?.isDestroyed?.())throw Error('终端页面已关闭');
  const stream=await new Promise((resolve,reject)=>{
   let settled=false;
   const clear=()=>{openingShells.delete(cancel);owner?.removeListener?.('destroyed',ownerClosed);};
   const cancel=(reason='服务器连接已关闭')=>{if(settled)return;settled=true;clear();reject(Error(reason));};
   const ownerClosed=()=>cancel('终端页面已关闭');openingShells.set(cancel,id);owner?.once?.('destroyed',ownerClosed);
   const finish=(error,value)=>{if(settled){try{value?.close();}catch{}return;}settled=true;clear();error?reject(error):resolve(value);};
   try{client.shell({term:'xterm-256color',cols:cols||100,rows:rows||30},finish);}catch(error){finish(error);}
  });
  try{assertServer(s,ticket);if(owner?.isDestroyed?.())throw Error('终端页面已关闭');}catch(e){try{stream.close();}catch{}throw e;}
  const stop=()=>closeTerminal(key);terminals.set(key,{stream,server:id,owner,stop});owner?.once?.('destroyed',stop);
  const held=live.get(id);if(held)clearTimeout(held.idle);
  stream.on('data',d=>emit(owner,{type:'terminal',key,data:d.toString('utf8')}));
  stream.stderr?.on('data',d=>emit(owner,{type:'terminal',key,data:d.toString('utf8')}));
  stream.on('close',()=>{terminals.delete(key);owner?.removeListener?.('destroyed',stop);const held=live.get(id);if(held)idle(id,held);emit(owner,{type:'terminal_closed',key});});
  return {ok:true,key};
 }
 async function call(p={},owner){
  assertCurrent();
  switch(p.action){
   case 'list':return {ok:true,servers:state.servers.map(pub)};
   case 'importable':return {ok:true,items:importable()};
   case 'add':return add(p);
   case 'connect':{const ticket=lifecycle,s=find(p.id);await open(s);assertServer(s,ticket);return {ok:true,server:pub(s),sample:await sample(s)};}
   case 'status':{const ticket=lifecycle,s=find(p.id);try{return {ok:true,sample:await sample(s)};}catch(e){assertServer(s,ticket);s.error=String(e.message||e);save();return {ok:false,error:s.error};}}
   case 'probe':return probe(p.id);
   case 'remove':return remove(p.id);
   case 'image_set':return setImage(p.id,String(p.file||''));
   case 'image_data':return setImageData(p.id,p.data);
   case 'rename':return rename(p.id,p.name);
   case 'vault_list':return {ok:true,entries:vault.list()};
   case 'vault_reveal':return {ok:true,...vault.reveal(p.id)};
   case 'vault_save':return vault.save(p,'user');
   case 'vault_remove':return vault.remove(p.id,'user');
   case 'image_clear':find(p.id);fs.rmSync(imageFile(p.id),{force:true});return {ok:true,image:''};
   case 'terminal_open':return openTerminal(p.id,p.cols,p.rows,owner);
   case 'terminal_input':{const t=terminals.get(p.key);if(!t)throw Error('终端已关闭');t.stream.write(String(p.data||''));return {ok:true};}
   case 'terminal_resize':{const t=terminals.get(p.key);if(t)t.stream.setWindow(p.rows,p.cols,0,0);return {ok:true};}
   case 'terminal_close':closeTerminal(p.key);return {ok:true};
   default:throw Error('未知的 server 操作');
  }
 }
 // 模型能用的动作少一半：终端、密码都只给界面。
 function agentCall(p={}){
  assertCurrent();const ticket=lifecycle;
  if(['vault_list','vault_read','vault_save','vault_remove'].includes(p.action))return Promise.resolve().then(()=>{
   assertCurrent(ticket);
   if(p.action==='vault_list')return {ok:true,entries:vault.list()};
   if(p.action==='vault_read'){const e=vault.entry(p.id);if(!e.agent)throw Error('这一条没有允许 Agent 读取；需要的话请用户在密码本里打开“允许 Agent 读取”');return {ok:true,entry:vault.view(e),...vault.reveal(p.id)};}
   if(p.action==='vault_save'){const {agent:_,...rest}=p;return vault.save(rest,'agent');}
   return vault.remove(p.id,'agent');
  });
  if(!['list','add','connect','status','probe','remove','rename'].includes(p.action))throw Error('未知的 server 操作');
  if(p.action==='add'&&(p.password||p.passphrase))throw Error('不能直接传密码：先用 vault_save 记进密码本，再用 vault_id 引用');
  // 图片是给界面看的，不进模型上下文。
  const noImage=s=>{const {image:_,...rest}=s;return rest;};
  return call(p).then(r=>r?.servers?{...r,servers:r.servers.map(noImage)}:r?.server?{...r,server:noImage(r.server)}:r);
 }
 function suspend(){lifecycle++;for(const cancel of [...openingShells.keys()])cancel();for(const key of [...terminals.keys()])closeTerminal(key);for(const id of [...live.keys()])drop(id);}
 return {call,agentCall,summary:()=>state.servers.map(s=>s.name),suspend,close(){if(closed)return;closed=true;suspend();}};
}
module.exports={createServers,parseSSHConfig,PROBE};
