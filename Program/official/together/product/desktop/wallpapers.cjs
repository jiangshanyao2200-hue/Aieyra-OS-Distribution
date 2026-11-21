/* @file-map:start
文件: link/desktop/wallpapers.cjs
位置: 二环·桌面能力 | Electron生命周期、权限边界、本机服务、云账号与可诊断桌面模块。
约束: renderer通过preload白名单进入主进程，禁止开放任意IPC；启动失败先持久取证；关闭须收束服务租约和诊断
下游: 无已解析的项目内静态导入
上游: AIDEBUG/wallpaper-cache.test.cjs, link/desktop/main.cjs
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: AIDEBUG/wallpaper-cache.test.cjs
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  officialURL | function
  WallpaperCache | class
  WallpaperCache.constructor | method
  WallpaperCache.save | method
  WallpaperCache.catalog | method
  WallpaperCache.cached | method
  WallpaperCache.image | method
  WallpaperCache.prune | method
  WallpaperCache.state | method
  WallpaperCache.random | method
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
'use strict';
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const CATALOG_MS=6*60*60*1000,RETRY_MS=5*60*1000,MAX_IMAGE=16*1024*1024;
/* @chain-region officialURL | calls: URL, some, url.pathname.startsWith */ function officialURL(value){
 try{const url=new URL(value,'https://os.aieyra.cn');return url.origin==='https://os.aieyra.cn'&&['/api/v1/themes/items/','/backgrounds/'].some(p=>url.pathname.startsWith(p))?url.href:null;}catch{return null;}
}
// A single desktop cache owns downloads and the random rotation clock across launches.
/* @chain-region WallpaperCache */ class WallpaperCache{
 /* @chain-region WallpaperCache.constructor | calls: Object.assign, Map, path.join, fs.statSync, JSON.parse, fs.readFileSync, filter, Array.isArray … */ constructor({directory,fetchImpl=globalThis.fetch,now=Date.now}={}){
  Object.assign(this,{directory,fetchImpl,now});this.index={items:[],images:[],current:null};this.downloads=new Map();
  try{const file=path.join(directory,'index.json');if(fs.statSync(file).size<200000){const saved=JSON.parse(fs.readFileSync(file,'utf8'));this.index={...this.index,...saved};}}catch{}
  this.index.items=(Array.isArray(this.index.items)?this.index.items:[]).filter(v=>officialURL(v.url));
  this.index.images=(Array.isArray(this.index.images)?this.index.images:[]).filter(v=>officialURL(v.url)&&/^[a-f0-9]{64}\.img$/.test(v.file)&&/^image\/(jpeg|png|webp|avif)$/.test(v.mime));
 }
 /* @chain-region WallpaperCache.save | calls: fs.mkdirSync, path.join, fs.writeFileSync, JSON.stringify, fs.renameSync */ save(){
  fs.mkdirSync(this.directory,{recursive:true});const file=path.join(this.directory,'index.json'),temp=file+'.tmp';
  fs.writeFileSync(temp,JSON.stringify(this.index));fs.renameSync(temp,file);
 }
 /* @chain-region WallpaperCache.catalog | calls: now, toString, crypto.randomBytes, save, fetchImpl, AbortSignal.timeout, Error, response.json … */ async catalog(){
  if(this.catalogFlight)return this.catalogFlight;
  if(this.index.items.length&&this.now()<this.index.catalogAt+CATALOG_MS||this.now()<this.index.catalogRetryAt)return this.index.items;
  this.catalogFlight=(async()=>{
   this.index.catalogRetryAt=this.now()+RETRY_MS;this.index.seed=crypto.randomBytes(12).toString('hex');this.save();
   try{
    const response=await this.fetchImpl('https://os.aieyra.cn/api/v1/themes/scenes?seed='+this.index.seed,{headers:{accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw Error('catalog_unavailable');const data=await response.json();
    const items=(Array.isArray(data.items)?data.items:[]).slice(0,20).flatMap(v=>{const url=officialURL(v.desktopUrl);return url?[{id:v.id,url}]:[];});
    if(!items.length)throw Error('empty_catalog');this.index.items=items;this.index.catalogAt=this.now();this.index.catalogRetryAt=0;this.save();
   }catch{/* The disk cache and retry clock survive an offline restart. */}
   return this.index.items;
  })();
  try{return await this.catalogFlight;}finally{this.catalogFlight=null;}
 }
 /* @chain-region WallpaperCache.cached | calls: index.images.find, fs.readFileSync, path.join, now, bytes.toString */ cached(url){
  const entry=this.index.images.find(v=>v.url===url);if(!entry)return null;
  try{const bytes=fs.readFileSync(path.join(this.directory,entry.file));if(!bytes.length||bytes.length>MAX_IMAGE)return null;entry.usedAt=this.now();return 'data:'+entry.mime+';base64,'+bytes.toString('base64');}catch{return null;}
 }
 /* @chain-region WallpaperCache.image | calls: officialURL, Error, cached, downloads.has, downloads.get, now, fetchImpl, AbortSignal.timeout … */ async image(value){
  const url=officialURL(value);if(!url)throw Error('invalid_wallpaper');
  const cached=this.cached(url);if(cached)return cached;
  if(this.downloads.has(url))return this.downloads.get(url);
  if(this.now()<this.index.imageRetryAt)throw Error('wallpaper_retry_later');
  const download=(async()=>{
   try{
    const response=await this.fetchImpl(url,{headers:{accept:'image/avif,image/webp,image/*'},redirect:'error',signal:AbortSignal.timeout(12000)});
    const mime=(response.headers.get('content-type')||'').split(';')[0];
    if(!response.ok||!/^image\/(jpeg|png|webp|avif)$/.test(mime)||Number(response.headers.get('content-length'))>MAX_IMAGE)throw Error('wallpaper_unavailable');
    const bytes=Buffer.from(await response.arrayBuffer());if(!bytes.length||bytes.length>MAX_IMAGE)throw Error('wallpaper_size');
    const file=crypto.createHash('sha256').update(url).digest('hex')+'.img';fs.mkdirSync(this.directory,{recursive:true});
    fs.writeFileSync(path.join(this.directory,file),bytes);
    this.index.images=this.index.images.filter(v=>v.url!==url);this.index.images.push({url,file,mime,bytes:bytes.length,usedAt:this.now()});
    this.index.imageRetryAt=0;this.prune();this.save();return 'data:'+mime+';base64,'+bytes.toString('base64');
   }catch(error){this.index.imageRetryAt=this.now()+RETRY_MS;this.save();throw error;}
  })();this.downloads.set(url,download);
  try{return await download;}finally{this.downloads.delete(url);}
 }
 /* @chain-region WallpaperCache.prune | calls: images.sort, images.filter, fs.unlinkSync, path.join */ prune(){
  const images=this.index.images;images.sort((a,b)=>b.usedAt-a.usedAt);let bytes=0;
  this.index.images=images.filter((entry,i)=>{bytes+=entry.bytes;const keep=i<24&&bytes<=64*1024*1024||entry.url===this.index.current?.url;if(!keep)try{fs.unlinkSync(path.join(this.directory,entry.file));}catch{}return keep;});
 }
 /* @chain-region WallpaperCache.state | calls: Math.min, Math.max, Number, officialURL, image, now, random */ async state({mode='random',url='',minutes=10,force=false}={}){
  const interval=Math.min(1440,Math.max(1,Number(minutes)||10))*60000;
  if(mode==='fixed'){const source=officialURL(url);return {url:source,data:await this.image(source),changedAt:this.now(),nextAt:null};}
  if(!this.randomFlight){this.randomFlight=this.random(interval,!!force);}
  const flight=this.randomFlight;
  let result;try{result=await flight;}finally{if(this.randomFlight===flight)this.randomFlight=null;}
  return {...result,nextAt:Math.max(result.changedAt+interval,this.index.imageRetryAt||0,this.index.catalogRetryAt||0)};
 }
 /* @chain-region WallpaperCache.random | calls: cached, now, catalog, items.filter, Math.floor, Math.random, image, save */ async random(interval,force){
  const current=this.index.current,cached=current&&this.cached(current.url);
  const restored=cached||current?.url==='local:fallback';
  if(restored&&!force&&this.now()<current.changedAt+interval)return {...current,data:cached||null};
  if(restored&&this.now()<this.index.imageRetryAt)return {...current,data:cached||null};
  const items=await this.catalog(),candidates=items.filter(v=>v.url!==current?.url),deck=candidates.length?candidates:items;
  const chosen=deck[Math.floor(Math.random()*deck.length)];
  if(chosen)try{
   const data=await this.image(chosen.url),changedAt=this.now();this.index.current={url:chosen.url,changedAt};this.save();return {...this.index.current,data};
  }catch{}
  if(restored)return {...current,data:cached||null};
  // The renderer uses its bundled image; no remote image fallback fan-out.
  this.index.current={url:'local:fallback',changedAt:this.now()};this.save();return {...this.index.current,data:null};
 }
}
module.exports={WallpaperCache,officialURL,CATALOG_MS,RETRY_MS};
