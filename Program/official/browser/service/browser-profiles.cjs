'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const fields=['width','height','device_scale_factor','locale','timezone','user_agent'];
function proxyAddress(value=''){
 if(value==='')return '';
 if(typeof value!=='string'||! /^(?:https?|socks[45]):\/\/(?:\[[a-f0-9:]+\]|[a-z0-9.-]+):[0-9]{1,5}$/i.test(value))throw Error('请输入带端口的 HTTP、HTTPS 或 SOCKS 代理地址');
 const address=new URL(value),port=Number(value.slice(value.lastIndexOf(':')+1));
 if(port<1||port>65535)throw Error('代理端口必须为 1–65535');
 return address.protocol+'//'+address.hostname+':'+port;
}
function proxyConfig(value='',previous){
 if(!value)return {proxy:'',proxy_auth:null};
 let url;try{url=new URL(value);}catch{throw Error('代理地址无效');}
 if(!url.username&&!url.password){
  const proxy=proxyAddress(value);
  const same=proxy===previous?.proxy;
  return {proxy,proxy_auth:same?previous.proxy_auth:null,proxy_auth_encrypted:same?previous.proxy_auth_encrypted:undefined};
 }
 if(!['http:','https:','socks5:'].includes(url.protocol)||!url.username||url.search||url.hash||url.pathname&&url.pathname!=='/')throw Error('带认证的代理须使用 HTTP、HTTPS 或 SOCKS5');
 const defaults={'http:':'80','https:':'443','socks5:':'1080'};
 const proxy=proxyAddress(url.protocol+'//'+url.hostname+':'+(url.port||defaults[url.protocol]));
 const username=decodeURIComponent(url.username),password=decodeURIComponent(url.password);
 if(username.length>256||password.length>1024||/[\r\n\0]/.test(username+password))throw Error('代理凭据无效');
 if(url.protocol==='socks5:'&&(!password||Buffer.byteLength(username)>255||Buffer.byteLength(password)>255))throw Error('SOCKS5 用户名和密码各须为 1–255 字节');
 return {proxy,proxy_auth:{username,password},proxy_auth_encrypted:undefined};
}
function profileId(value='default'){
 if(typeof value!=='string'||!/^[a-zA-Z0-9_-]{1,48}$/.test(value)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(value))throw Error('Invalid profile id');
 return value.toLowerCase();
}
function fingerprint(a={},defaultUA){
 const width=a.width??1280,height=a.height??800,scale=a.device_scale_factor??1;
 if(!Number.isInteger(width)||width<480||width>3840||!Number.isInteger(height)||height<320||height>2160||!Number.isFinite(scale)||scale<1||scale>3)throw Error('Invalid viewport');
 const locale=a.locale||'zh-CN',timezone=a.timezone||'Asia/Shanghai';
 if(typeof locale!=='string'||typeof timezone!=='string')throw Error('Invalid locale or timezone');
 new Intl.DateTimeFormat(locale,{timeZone:timezone});
 const user_agent=a.user_agent||defaultUA;
 if(typeof user_agent!=='string'||!user_agent||user_agent.length>512||/[\r\n]/.test(user_agent))throw Error('Invalid user agent');
 return {width,height,device_scale_factor:scale,locale,timezone,user_agent};
}
function createProfiles(storage,defaultUA,safeStorage){
 const dir=path.join(storage,'profiles');
 const decodedAuth=new Map();
 const available=()=>safeStorage?.isEncryptionAvailable()&&safeStorage.getSelectedStorageBackend?.()!=='basic_text';
 function seal(auth){
  if(!auth)return undefined;
  if(!available())throw Error('系统安全存储不可用，无法保存代理认证');
  return safeStorage.encryptString(JSON.stringify(auth)).toString('base64');
 }
 function unseal(id,value){
  if(!value||!available()){decodedAuth.delete(id);return null;}
  const cached=decodedAuth.get(id);
  if(cached?.ciphertext===value)return cached.auth;
  let auth=null;
  try{auth=JSON.parse(safeStorage.decryptString(Buffer.from(value,'base64')));}catch{}
  decodedAuth.set(id,{ciphertext:value,auth});
  return auth;
 }
 function read(id){
  id=profileId(id);let names=[];try{names=fs.readdirSync(dir).filter(n=>n.toLowerCase()===id+'.json');}catch(e){if(e.code!=='ENOENT')throw e;}
  if(names.length>1)throw Error('Conflicting browser profile names; preserve and resolve the saved files');
  if(!names.length)return null;
  const raw=JSON.parse(fs.readFileSync(path.join(dir,names[0]),'utf8'));
  return {id,label:raw.label||(id==='default'?'默认身份':id),created_at:raw.created_at||null,fingerprint:fingerprint(raw.fingerprint||raw,defaultUA),proxy:proxyAddress(raw.proxy),proxy_auth:unseal(id,raw.proxy_auth_encrypted),proxy_auth_encrypted:raw.proxy_auth_encrypted,file:names[0]};
 }
 function save(row){
  fs.mkdirSync(dir,{recursive:true});const dest=path.join(dir,row.file||row.id+'.json'),tmp=dest+'.tmp-'+crypto.randomBytes(6).toString('hex');
  try{fs.writeFileSync(tmp,JSON.stringify({schema:1,id:row.id,label:row.label,created_at:row.created_at,fingerprint:row.fingerprint,proxy:row.proxy,proxy_auth_encrypted:row.proxy_auth_encrypted||seal(row.proxy_auth)},null,2)+'\n',{flag:'wx',mode:0o600});fs.renameSync(tmp,dest);}finally{fs.rmSync(tmp,{force:true});}
 }
 function ensure(value={}){
  const id=profileId(value.profile),old=read(id);
  if(old){const next=fingerprint({...old.fingerprint,...value},defaultUA);if(fields.some(k=>next[k]!==old.fingerprint[k]))throw Error('Saved identity is immutable; create a new profile for different fingerprint settings');return old;}
  const label=String(value.label||(id==='default'?'默认身份':id)).trim();if(!label||label.length>80)throw Error('Profile name must be 1..80 characters');
  const row={id,label,created_at:new Date().toISOString(),fingerprint:fingerprint(value,defaultUA),...proxyConfig(value.proxy)};save(row);return row;
 }
 function publicProfile({file,proxy_auth,proxy_auth_encrypted,...row}){return {...row,proxy_authenticated:!!(proxy_auth_encrypted||proxy_auth)};}
 function list(){let names=[];try{names=fs.readdirSync(dir).filter(n=>/^[a-zA-Z0-9_-]{1,48}\.json$/.test(n));}catch(e){if(e.code!=='ENOENT')throw e;}return [...new Set(names.map(n=>n.slice(0,-5).toLowerCase()))].map(id=>publicProfile(read(id)));}
 function update(id,{label,proxy,clear_proxy_auth=false}){
  const old=read(id);if(!old||id==='aieyra-account')throw Error('此身份不可编辑');
  if(typeof label!=='string'||!label.trim()||label.trim().length>80)throw Error('身份名称须为 1–80 个字符');
  const row={...old,label:label.trim(),...proxyConfig(proxy,old)};
  if(clear_proxy_auth){row.proxy_auth=null;row.proxy_auth_encrypted=undefined;}
  save(row);return row;
 }
 return {read,ensure,list,update,publicProfile,create(a={}){const id=profileId(a.profile||'identity-'+crypto.randomBytes(6).toString('hex'));if(read(id))throw Error('Profile already exists');return ensure({...a,profile:id});}};
}
module.exports={profileId,fingerprint,createProfiles,proxyAddress};
