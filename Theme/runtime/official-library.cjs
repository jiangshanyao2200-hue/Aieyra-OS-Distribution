// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Theme/runtime/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: fs; MEDIA_ROOT; BUILTIN_MEDIA; hash; MAX_IMAGE; CATALOGUE_TTL; clone; category; mediaDigest; describe; bytesOf; imageDecoder; publicCache; createOfficialLibrary
// Impact: python -B scripts/code-atlas.py show Theme/runtime/official-library.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// Public catalogue, bounded image cache and profile-owned rotation. The desktop
// supplies transport and image decoding; this service cannot execute packages.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {TARGETS,mediaValue,mediaPatch,ID,DIGEST,interval,selection}=require('./media-preferences.cjs');
const {BUILTIN_THEMES}=require('./library-builtins.mjs');
// 内置背景与头像（随程序分发）：未登录时是主题页和随机轮换的唯一来源；登录后改用官方图库，
// 已选中的内置图仍按 ID 可读，个人自定义图片不受影响。
const MEDIA_ROOT=path.join(__dirname,'../official/default/library');
const BUILTIN_MEDIA=require('../official/default/library/media.json').items;
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const MAX_IMAGE=20*1024*1024,CACHE_BYTES=128*1024*1024,MINUTE=60000,MAX_CATALOGUE_PAGES=512;
const CATALOGUE_TTL=15*MINUTE,STALE_TTL=24*60*MINUTE,DISPLAY_TTL=30*24*60*MINUTE;
const clone=value=>structuredClone(value);
function category(target){if(!TARGETS.includes(target))throw Error('未知图像设置对象');return target==='background'?'background':'avatar';}
function mediaDigest(item,variant){
 const route=item[variant==='preview'?'preview':'image'];if(!route)return null;
 const prefix='/api/v1/themes/items/'+item.id+'/'+variant+'?v=';
 if(typeof route!=='string'||!route.startsWith(prefix)||!DIGEST.test(route.slice(prefix.length)))throw Error('主题图片引用无效');
 return route.slice(prefix.length);
}
function describe(row){
 if(!row||!ID.test(row.id||'')||!DIGEST.test(row.digest||'')||!['background','avatar'].includes(row.category)||!['approved','pending'].includes(row.status))throw Error('主题目录格式无效');
 if(row.category==='background'&&(row.orientation!=='landscape'||row.width!==1920||row.height!==1080)||row.category==='avatar'&&(row.width!==512||row.height!==512))throw Error('主题图片尺寸不兼容');
 if(typeof row.title!=='string'||row.title.length>120||typeof row.author?.name!=='string'||row.author.name.length>80||!DIGEST.test(row.artifact?.sha256||'')||!Number.isSafeInteger(row.artifact?.size)||row.artifact.size<1||row.artifact.size>MAX_IMAGE||!String(row.artifact.name).endsWith('.png'))throw Error('主题资源信息无效');
 const item={id:row.id,digest:row.digest,category:row.category,orientation:row.orientation,width:row.width,height:row.height,title:row.title,author:{name:row.author.name},official:row.official===true,status:row.status,likes:Number.isSafeInteger(row.likes)&&row.likes>=0?row.likes:0,liked:row.liked===true,preview:row.preview||null,image:row.image,artifact:{...row.artifact}};
 mediaDigest(item,'preview');mediaDigest(item,'image');return item;
}
async function bytesOf(response,max,assertCurrent=()=>{}){
 if(!response.ok){await response.body?.cancel();throw Error(response.status===401?'请先登录 Aieyra 账号':'主题图片暂时不可用');}
 const length=Number(response.headers?.get('content-length')||0);if(length>max){await response.body?.cancel();throw Error('主题图片过大');}
 let size=0;const chunks=[];
 for await(const chunk of response.body){assertCurrent();size+=chunk.length;if(size>max)throw Error('主题图片过大');chunks.push(Buffer.from(chunk));}
 assertCurrent();if(!size)throw Error('主题图片为空');return Buffer.concat(chunks);
}
// Decode and re-encode every displayed image. No SVG, scripts or remote URLs
// reach profile fields; persisted source assets are verified original PNGs.
function imageDecoder(nativeImage){return (bytes,{category:kind,preview=false,variant='file',width:expectedWidth,height:expectedHeight}={})=>{
 const source=nativeImage.createFromBuffer(bytes);if(source.isEmpty())throw Error('无法读取主题图片');
 const {width,height}=source.getSize();if(width<1||height<1||width*height>32000000)throw Error('主题图片尺寸过大');
 if(variant==='file'&&(width!==expectedWidth||height!==expectedHeight))throw Error('主题图片实际尺寸与目录不一致');
 if(kind==='avatar'){
  const size=Math.min(width,height),square=source.crop({x:Math.floor((width-size)/2),y:Math.floor((height-size)/2),width:size,height:size});
  const side=variant==='file'?160:preview?256:512,data=square.resize({width:side,height:side,quality:'best'}).toPNG();
  if(data.length>(variant==='file'?130000:1500000))throw Error('头像过于复杂');return 'data:image/png;base64,'+data.toString('base64');
 }
 const ratio=Math.min(1,(preview?480:1920)/Math.max(width,height));
 const data=source.resize({width:Math.max(1,Math.round(width*ratio)),height:Math.max(1,Math.round(height*ratio)),quality:'best'}).toJPEG(82);
 if(data.length>2000000)throw Error('背景图片过于复杂');return 'data:image/jpeg;base64,'+data.toString('base64');
};}

// Only public, already validated metadata and decoded display images enter this
// optional cache. The source comes from the native transport, never the renderer.
function publicCache(directory,source,now){
 let origin='';try{const url=new URL(source);if(['https:','http:'].includes(url.protocol)&&!url.username&&!url.password)origin=url.origin;}catch{}
 const root=directory&&origin?path.join(directory,'public-'+hash(origin).slice(0,24)):null;
 function safe(dir){for(let part=path.resolve(dir);;part=path.dirname(part)){const s=fs.lstatSync(part);if(!s.isDirectory()||s.isSymbolicLink())throw Error('主题缓存目录不能经过链接');if(path.dirname(part)===part)break;}}
 function read(name,max){
  if(!root)return null;
  try{safe(root);const file=path.join(root,name),s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>max)return null;const value=JSON.parse(fs.readFileSync(file,'utf8'));if(value.version!==1||value.source!==origin||!Number.isSafeInteger(value.savedAt)||value.savedAt>now()+MINUTE)return null;return value;}catch{return null;}
 }
 function trim(){
  if(!directory)return;
  try{
   safe(directory);const rows=[];
   const collect=(dir,name,kind)=>{try{const file=path.join(dir,name),s=fs.lstatSync(file);if(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1)rows.push({file,kind,size:s.size,time:s.mtimeMs});}catch{}};
   for(const name of fs.readdirSync(directory)){
    if(/^[a-f0-9]{64}\.png$/.test(name))collect(directory,name,'original');
    else if(/^public-[a-f0-9]{24}$/.test(name)){
     const dir=path.join(directory,name),s=fs.lstatSync(dir);if(!s.isDirectory()||s.isSymbolicLink())continue;
     for(const file of fs.readdirSync(dir))if(/^catalogue-[a-f0-9-]+\.json$/.test(file))collect(dir,file,'catalogue');else if(/^display-[a-f0-9]{64}-(avatar|background)-(image|preview)\.json$/.test(file))collect(dir,file,'display');
    }
   }
   const counts={original:0,display:0,catalogue:0},limits={original:64,display:96,catalogue:64};let total=0;
   for(const row of rows.sort((a,b)=>b.time-a.time))if(counts[row.kind]<limits[row.kind]&&total+row.size<=CACHE_BYTES){counts[row.kind]++;total+=row.size;}else try{fs.unlinkSync(row.file);}catch{}
  }catch{/* An optional cache cannot prevent public browsing. */}
 }
 function write(name,value){
  if(!root)return;let temp;
  try{fs.mkdirSync(root,{recursive:true,mode:0o700});safe(root);const file=path.join(root,name);temp=file+'.'+crypto.randomUUID()+'.tmp';fs.writeFileSync(temp,JSON.stringify({version:1,source:origin,savedAt:now(),...value}),{flag:'wx',mode:0o600});fs.renameSync(temp,file);trim();}catch{}
  finally{if(temp)try{fs.unlinkSync(temp);}catch{}}
 }
 const catalogueName=(scope,group,cursor)=>'catalogue-'+scope.slice(0,16)+'-'+group.slice(0,16)+'-'+hash(cursor).slice(0,32)+'.json';
 return {
  trim,
  invalidate(scope,group){if(!root||!scope)return;try{safe(root);const prefix='catalogue-'+scope.slice(0,16)+'-'+(group?group.slice(0,16)+'-':'');for(const name of fs.readdirSync(root))if(name.startsWith(prefix)&&/^catalogue-[a-f0-9-]+\.json$/.test(name)){const file=path.join(root,name),s=fs.lstatSync(file);if(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1)fs.unlinkSync(file);}}catch{}},
  catalogue(scope,group,cursor){
   if(!scope)return null;
   const row=read(catalogueName(scope,group,cursor),128*1024);if(!row||row.scope!==scope||row.group!==group||row.cursor!==hash(cursor)||now()-row.savedAt>STALE_TTL)return null;
   try{if(!Array.isArray(row.items)||row.items.length>24||row.nextCursor!=null&&(typeof row.nextCursor!=='string'||row.nextCursor.length>512))return null;return {value:{ok:true,items:row.items.map(describe),nextCursor:row.nextCursor||null},expires:row.savedAt+CATALOGUE_TTL,savedAt:row.savedAt};}catch{return null;}
  },
  saveCatalogue(scope,group,cursor,value){if(scope)write(catalogueName(scope,group,cursor),{scope,group,cursor:hash(cursor),items:value.items.map(item=>({...item,artifact:{name:item.artifact.name,sha256:item.artifact.sha256,size:item.artifact.size}})),nextCursor:value.nextCursor});},
  display(digest,category,variant){const row=read('display-'+digest+'-'+category+'-'+variant+'.json',2800000+4096);if(!row||row.digest!==digest||row.category!==category||row.variant!==variant||now()-row.savedAt>DISPLAY_TTL||typeof row.src!=='string'||row.src.length>2800000||!/^data:image\/(png|jpeg);base64,/.test(row.src)||hash(row.src)!==row.checksum)return null;return row.src;},
  saveDisplay(digest,category,variant,src){write('display-'+digest+'-'+category+'-'+variant+'.json',{digest,category,variant,src,checksum:hash(src)});},
 };
}
function createOfficialLibrary({client,profile,contactMedia=null,directory,decode,now=Date.now,random=Math.random,setTimer=setTimeout,clearTimer=clearTimeout,active=()=>true,changed=()=>{}}){
 let closed=false,epoch=0,timer=null,ticking=false,clockStarted=false,contactDue=0,initializing=null;
 const lists=new Map(),records=new Map(),pictures=new Map(),pending=new Map(),pools=new Map(),rounds=new Map(),failures=new Map();
 const disk=publicCache(directory,client.themeOrigin,now),accountScope=()=>{const status=client.status();if(!status?.signedIn)return hash(JSON.stringify(['anonymous']));const id=status.user?.id;return typeof id==='string'&&id.trim()||Number.isSafeInteger(id)?hash(JSON.stringify(['account',String(id)])):null;};
 let catalogueRevision=0;
 let controller=new AbortController(),roundsLoaded=false,roundStorage=true;
 const alive=stamp=>{if(closed||stamp!==epoch)throw Error('主题请求已过期，请重新选择');};
 const once=(key,fn)=>{if(pending.has(key))return pending.get(key);const value=Promise.resolve().then(fn).finally(()=>{if(pending.get(key)===value)pending.delete(key);});pending.set(key,value);return value;};
 const trim=(map,max)=>{while(map.size>max)map.delete(map.keys().next().value);};
 const stopAccount=client.subscribe?.(()=>{epoch++;controller.abort();controller=new AbortController();lists.clear();records.clear();pools.clear();failures.clear();});
 const builtinRecords=new Map([
  ...BUILTIN_THEMES.map(item=>[item.id,{...item,digest:hash(JSON.stringify(item)),official:true,author:{name:'Aieyra OS'},status:'approved',local:true}]),
  ...BUILTIN_MEDIA.map(({file,sha256,size,...item})=>[item.id,{...item,digest:sha256,summary:'内置 · 未登录时可用',official:true,author:{name:'Aieyra OS'},status:'approved',bundled:true}]),
 ]);
 const bundledFiles=new Map(BUILTIN_MEDIA.map(item=>[item.id,item])),signedIn=()=>!!client.status()?.signedIn;
 const votesFile=directory&&path.join(directory,'builtin-likes.json');
 const roundsFile=directory&&path.join(directory,'random-rounds.json');
 function loadRounds(){
  if(roundsLoaded)return;roundsLoaded=true;if(!roundsFile)return;
  try{
   const stat=fs.lstatSync(roundsFile);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>4*1024*1024)throw Error('invalid rounds');
   const value=JSON.parse(fs.readFileSync(roundsFile,'utf8'));if(value.version!==1||!value.rounds||typeof value.rounds!=='object'||Array.isArray(value.rounds))throw Error('invalid rounds');
   const loaded=[];
   for(const kind of ['avatar','background'])if(value.rounds[kind]){
    const row=value.rounds[kind];if(!Array.isArray(row.remaining)||!Array.isArray(row.used)||row.remaining.length+row.used.length>MAX_CATALOGUE_PAGES*24||typeof row.last!=='string'||row.last&&!ID.test(row.last))throw Error('invalid rounds');
    const ids=[...row.remaining,...row.used];if(ids.some(id=>typeof id!=='string'||!ID.test(id))||new Set(ids).size!==ids.length)throw Error('invalid rounds');
    loaded.push([kind,{remaining:row.remaining,used:new Set(row.used),last:row.last}]);
   }
   for(const [kind,row]of loaded)rounds.set(kind,row);
  }catch(error){if(error.code!=='ENOENT')roundStorage=false;}
 }
 function saveRounds(){
  if(!roundsFile||!roundStorage)return;
  let temp;
  try{
   fs.mkdirSync(directory,{recursive:true,mode:0o700});
   for(let part=path.resolve(directory);;part=path.dirname(part)){if(fs.lstatSync(part).isSymbolicLink())throw Error('invalid cache directory');if(path.dirname(part)===part)break;}
   temp=roundsFile+'.'+crypto.randomUUID()+'.tmp';
   const value={version:1,rounds:Object.fromEntries([...rounds].map(([kind,row])=>[kind,{remaining:row.remaining,used:[...row.used],last:row.last}]))};
   fs.writeFileSync(temp,JSON.stringify(value),{flag:'wx',mode:0o600});fs.renameSync(temp,roundsFile);
  }catch{/* Randomness remains available if its optional cache cannot be written. */}
  finally{if(temp)try{fs.unlinkSync(temp);}catch{}}
 }
 function shuffled(ids){
  const result=[...ids];for(let i=result.length-1;i>0;i--){const value=Math.max(0,Math.min(1-Number.EPSILON,Number(random())||0)),j=Math.floor(value*(i+1));[result[i],result[j]]=[result[j],result[i]];}return result;
 }
 function refreshRound(kind,items){
  loadRounds();const ids=new Set(items.map(item=>item.id)),old=rounds.get(kind)||{remaining:[],used:new Set(),last:''};
  const remaining=old.remaining.filter(id=>ids.has(id)),used=new Set([...old.used].filter(id=>ids.has(id))),known=new Set([...remaining,...used]);
  const added=[...ids].filter(id=>!known.has(id));
  rounds.set(kind,{remaining:added.length?shuffled([...remaining,...added]):remaining,used,last:old.last});
 }
 function draw(kind,items,prior){
  const row=rounds.get(kind),all=items.map(item=>item.id);
  if(!row.remaining.length){row.remaining=shuffled(all);row.used.clear();}
  const find=()=>{let i=row.remaining.length-1;while(i>=0&&(row.remaining[i]===prior||row.remaining[i]===row.last))i--;return i;};
  let index=find();
  if(index<0&&row.remaining.length<all.length){
   // A manually selected image can be the only unused entry. Start the next
   // round with it still available, while avoiding another immediate display.
   row.remaining=shuffled(all);row.used.clear();index=find();
  }
  if(index<0)index=row.remaining.findLastIndex(id=>id!==prior);
  if(index<0)index=row.remaining.length-1;
  const id=row.remaining[index];row.remaining[index]=row.remaining.at(-1);row.remaining.pop();row.used.add(id);row.last=id;
  return items.find(item=>item.id===id);
 }
 function builtinVotes(){
  if(!votesFile)return [];
  try{
   const stat=fs.lstatSync(votesFile);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>65536)throw Error('invalid votes');
   const value=JSON.parse(fs.readFileSync(votesFile,'utf8'));
   if(value.version!==1||!Array.isArray(value.liked)||value.liked.length>512||value.liked.some(id=>typeof id!=='string'||!ID.test(id)))throw Error('invalid votes');
   return value.liked;
  }catch(error){if(error.code==='ENOENT')return [];throw Error('本机点赞记录暂不可用，原记录已保留');}
 }
 function builtinItem(id,expected){
  const item=builtinRecords.get(id);if(!item)return null;
  if(expected&&expected!==item.digest)throw Error('预览已更新，请重新载入');
  const liked=builtinVotes().includes(id);return {...item,liked,likes:liked?1:0};
 }
 function builtinList(p){
  if(!['recommended','hot','latest','pending'].includes(p.sort||'recommended')||typeof (p.q||'')!=='string'||(p.q||'').length>120||p.cursor)throw Error('主题筛选无效');
  const query=(p.q||'').trim().toLowerCase(),votes=new Set(builtinVotes());
  let items=[...builtinRecords.values()].filter(item=>item.category===p.category&&(item.title+' '+item.author.name).toLowerCase().includes(query)).map(item=>({...item,liked:votes.has(item.id),likes:votes.has(item.id)?1:0}));
  if(p.sort==='pending')items=[];
  else if(p.sort==='hot'||p.sort==='recommended')items.sort((a,b)=>b.likes-a.likes);
  else if(p.sort==='latest')items.reverse();
  return {ok:true,items,nextCursor:null};
 }
 function likeBuiltin(p){
  const item=builtinItem(p.id,p.digest);if(!item)return null;
  if(!DIGEST.test(p.digest||'')||typeof p.liked!=='boolean')throw Error('点赞参数无效');
  if(!votesFile)throw Error('本机点赞暂不可保存');
  const votes=new Set(builtinVotes());if(p.liked)votes.add(p.id);else votes.delete(p.id);
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  for(let part=path.resolve(directory);;part=path.dirname(part)){if(fs.lstatSync(part).isSymbolicLink())throw Error('主题缓存目录不能经过链接');if(path.dirname(part)===part)break;}
  const temp=votesFile+'.'+crypto.randomUUID()+'.tmp';
  try{fs.writeFileSync(temp,JSON.stringify({version:1,liked:[...votes]}),{flag:'wx',mode:0o600});fs.renameSync(temp,votesFile);}finally{try{fs.unlinkSync(temp);}catch{}}
  return {ok:true,item:{...item,liked:p.liked,likes:p.liked?1:0}};
 }
 function fileFor(digest){if(!DIGEST.test(digest))throw Error('图片摘要无效');return path.join(directory,digest+'.png');}
 function cached(digest){
  if(!directory)return null;const file=fileFor(digest);
  try{const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.size>MAX_IMAGE)return null;const bytes=fs.readFileSync(file);if(hash(bytes)!==digest)return null;return bytes;}catch{return null;}
 }
 function persist(digest,bytes){
  if(!directory)return;fs.mkdirSync(directory,{recursive:true,mode:0o700});
  for(let part=path.resolve(directory);;part=path.dirname(part)){if(fs.lstatSync(part).isSymbolicLink())throw Error('主题缓存目录不能经过链接');if(path.dirname(part)===part)break;}
  const file=fileFor(digest),temp=file+'.'+crypto.randomUUID()+'.tmp';
  try{fs.writeFileSync(temp,bytes,{flag:'wx',mode:0o600});fs.renameSync(temp,file);}finally{try{fs.unlinkSync(temp);}catch{}}
  disk.trim();
 }
 async function list(p){
  if(!['background','avatar','ui','halo'].includes(p.category)||p.sort!=null&&typeof p.sort!=='string'||!['recommended','hot','latest','pending'].includes(p.sort||'recommended')||p.q!=null&&(typeof p.q!=='string'||p.q.length>120)||p.cursor!=null&&(typeof p.cursor!=='string'||p.cursor.length>512)||p.refresh!=null&&typeof p.refresh!=='boolean')throw Error('主题筛选无效');
  if(['ui','halo'].includes(p.category)||!signedIn())return builtinList(p);
  const request={action:'list',category:p.category,sort:p.sort||'recommended',q:p.q||'',cursor:p.cursor||''},key=JSON.stringify(request),stamp=epoch,scope=accountScope(),group=hash(JSON.stringify([request.category,request.sort,request.q]));
  const old=lists.get(key)||disk.catalogue(scope,group,request.cursor);
  if(p.refresh===true&&!request.cursor&&!pending.has('list:'+stamp+':'+key)){catalogueRevision++;lists.clear();pools.clear();}
  const revision=catalogueRevision;
  const remember=(row,stale=false)=>{for(const item of row.value.items)records.set(item.id,{item,expires:now()+MINUTE});trim(records,400);lists.set(key,row);trim(lists,64);return {...clone(row.value),...(stale?{stale:true}:{})};};
  if(p.refresh!==true&&old&&old.expires>now())return remember(old);
  const failure=failures.get(key);if(failure&&failure.until>now()){if(p.refresh!==true&&old&&now()-(old.savedAt??old.expires-CATALOGUE_TTL)<=STALE_TTL)return remember(old,true);throw failure.error;}
  return clone(await once('list:'+stamp+':'+key,async()=>{
   alive(stamp);
   try{
    const raw=await client.themeRequest({...request,signal:controller.signal});alive(stamp);if(revision!==catalogueRevision)throw Error('主题目录已刷新，请重新载入');
    if(!Array.isArray(raw.items)||raw.items.length>24||raw.nextCursor!=null&&(typeof raw.nextCursor!=='string'||raw.nextCursor.length>512))throw Error('主题分页无效');
    const value={ok:true,items:raw.items.map(describe),nextCursor:raw.nextCursor||null};failures.delete(key);
    if(p.refresh===true&&!request.cursor)disk.invalidate(scope,group);
    disk.saveCatalogue(scope,group,request.cursor,value);
    return remember({value,expires:now()+CATALOGUE_TTL,savedAt:now()});
   }catch(error){
    alive(stamp);if(revision!==catalogueRevision)throw error;
    failures.set(key,{error,until:now()+Math.max(5000,Math.min(86400000,Number(error.retryAfterMs)||0))});trim(failures,64);
    if(p.refresh!==true&&old&&now()-(old.savedAt??old.expires-CATALOGUE_TTL)<=STALE_TTL)return remember(old,true);throw error;
   }
  }));
 }
 async function read(id,expected,{fresh=false}={}){
  const builtin=builtinItem(id,expected);if(builtin)return builtin;
  if(!ID.test(id||''))throw Error('主题 ID 无效');const old=records.get(id),stamp=epoch;
  const item=!fresh&&old&&old.expires>now()?old.item:await once('read:'+stamp+':'+id,async()=>{alive(stamp);const result=describe((await client.themeRequest({action:'read',id,signal:controller.signal})).item);alive(stamp);records.set(id,{item:result,expires:now()+MINUTE});trim(records,400);return result;});
  if(expected&&item.digest!==expected)throw Error('图片已更新，请重新选择');return clone(item);
 }
 async function image(item,variant){
  if(item.local)throw Error('内置预览不提供图片下载');
  if(item.bundled)return bundledImage(item,variant);
  const original=variant==='file',digest=original?item.artifact.sha256:mediaDigest(item,variant);if(!digest)throw Error('暂无预览');
  const key=[digest,item.category,variant].join(':'),stamp=epoch;
  if(pictures.has(key)){const value=pictures.get(key);pictures.delete(key);pictures.set(key,value);return value;}
  if(!original){const value=disk.display(digest,item.category,variant);if(value)return value;}
  return once('image:'+stamp+':'+key,async()=>{
   alive(stamp);
   let bytes=original?cached(digest):null;
   if(!bytes){
    const {response,assertCurrent}=await client.themeMedia({id:item.id,variant,digest,signal:controller.signal});
    bytes=await bytesOf(response,MAX_IMAGE,()=>{alive(stamp);assertCurrent();});alive(stamp);
    if(hash(bytes)!==digest||original&&(bytes.length!==item.artifact.size||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'))throw Error('主题图片校验失败');
   }
   const value=await decode(bytes,{category:item.category,preview:variant==='preview',variant,width:item.width,height:item.height});alive(stamp);
   if(typeof value!=='string'||!/^data:image\/(png|jpeg);base64,/.test(value)||value.length>2800000)throw Error('主题图片转换无效');
   if(original)persist(digest,bytes);else disk.saveDisplay(digest,item.category,variant,value);pictures.set(key,value);
   let total=0;for(const [k,v]of [...pictures].reverse()){total+=v.length;if(total>32*1024*1024)pictures.delete(k);}trim(pictures,96);return value;
  });
 }
 async function bundledImage(item,variant){
  const entry=bundledFiles.get(item.id),key=['bundled',item.id,variant].join(':');if(!entry)throw Error('内置图片不存在');
  if(pictures.has(key))return pictures.get(key);
  const bytes=fs.readFileSync(path.join(MEDIA_ROOT,...entry.file.split('/')));
  if(bytes.length!==entry.size||hash(bytes)!==entry.sha256)throw Error('内置图片校验失败');
  const value=await decode(bytes,{category:item.category,preview:variant==='preview',variant,width:item.width,height:item.height});
  if(typeof value!=='string'||!/^data:image\/(png|jpeg);base64,/.test(value)||value.length>2800000)throw Error('主题图片转换无效');
  pictures.set(key,value);trim(pictures,96);return value;
 }
 async function pool(kind){
  if(!signedIn()){const items=[...builtinRecords.values()].filter(item=>item.bundled&&item.category===kind);refreshRound(kind,items);return items;}
  const old=pools.get(kind),stamp=epoch;if(old&&old.expires>now())return old.items;
  return once('pool:'+stamp+':'+kind,async()=>{
   const rows=new Map(),seen=new Set();let cursor='';
   for(let n=0;n<MAX_CATALOGUE_PAGES;n++){
    alive(stamp);
    // Latest is independent of changing like counts. Read metadata once for
    // the entire round; images remain lazy and the catalogue is shared.
    const page=await list({category:kind,sort:'latest',cursor});alive(stamp);
    for(const item of page.items){if(item.category!==kind)throw Error('主题目录分类无效');if(item.status==='approved')rows.set(item.id,item);}
    cursor=page.nextCursor;
    if(!cursor){
     const items=[...rows.values()];if(!items.length)throw Error('暂时没有可用主题');
     refreshRound(kind,items);pools.set(kind,{items,expires:now()+15*MINUTE});return items;
    }
    if(seen.has(cursor))throw Error('主题分页重复');seen.add(cursor);
   }
   throw Error('主题目录分页过多，请稍后重试');
  });
 }
 async function prepare(p){
  const stamp=epoch;
  return clone(await once('prepare:'+stamp+':'+JSON.stringify([p.target,p.mode,p.id,p.digest,p.exclude_id,p.intervalSeconds]),()=>{alive(stamp);return prepareImage(p);}));
 }
 async function prepareImage(p){
  const kind=category(p.target),seconds=interval(p.intervalSeconds),stamp=epoch;
  let item;
  if(p.mode==='random'){
   const all=await pool(kind);alive(stamp);
   const prior=p.exclude_id||profile.read().mediaRotation?.[p.target]?.id,picked=draw(kind,all,prior);
   item=await read(picked.id,picked.digest,{fresh:true});
  }else item=await read(p.id,p.digest,{fresh:true});
  if(item.category!==kind||item.status!=='approved')throw Error('请选择已采纳的对应主题');
  const value=await image(item,'file');alive(stamp);
  if(p.mode==='random')saveRounds();
  return {ok:true,item,value,rotation:selection({mode:p.mode==='random'?'random':'theme',intervalSeconds:seconds,nextAt:now()+seconds*1000,id:item.id,digest:item.digest})};
 }
 function commit(target,value,rotation,current){
  const mediaRotation={...current.mediaRotation,[target]:rotation};
  const saved=profile.update({...mediaPatch(target,value),mediaRotation},current.version);changed(saved);return saved;
 }
 async function initialize(){
  if(initializing)return initializing;
  initializing=(async()=>{
   const current=profile.read();if(current.warning||current.version!=='missing')return current;
   const patch={},mediaRotation={...current.mediaRotation};
   for(const target of TARGETS){
    if(closed)return profile.read();
    const pref=current.mediaRotation?.[target];
    if(mediaValue(current,target)||pref?.mode!=='random')continue;
    const kind=category(target),all=[...builtinRecords.values()].filter(item=>item.bundled&&item.category===kind);
    refreshRound(kind,all);const item=draw(kind,all,pref.id),value=await image(item,'file');
    if(closed)return profile.read();
    const imagePatch=mediaPatch(target,value);
    if(imagePatch.roles)patch.roles={...patch.roles,...imagePatch.roles};else Object.assign(patch,imagePatch);
    mediaRotation[target]=selection({...pref,id:item.id,digest:item.digest,nextAt:now()+pref.intervalSeconds*1000});
   }
   if(!Object.keys(patch).length)return current;
   if(profile.read().version!==current.version)return profile.read();
   const saved=(profile.initializeMedia||profile.update).call(profile,{...patch,mediaRotation},current.version);
   saveRounds();changed(saved);return saved;
  })();
  try{return await initializing;}finally{initializing=null;}
 }
 const signature=(current,target)=>JSON.stringify([mediaValue(current,target),current.mediaRotation?.[target]||null]);
 async function rotateContacts(){
  if(!contactMedia||typeof contactMedia.list!=='function'||typeof contactMedia.update!=='function'||now()<contactDue)return;
  const stamp=epoch;let rows;contactDue=now()+MINUTE;
  try{const result=await contactMedia.list();alive(stamp);rows=Array.isArray(result)?result:result?.contacts;if(!Array.isArray(rows))return;}catch{return;}
  let attempts=0;
  for(const row of rows){
   if(closed||!active()||stamp!==epoch)break;
   if(row?.builtin||typeof row?.id!=='string'||!row.id||!Number.isSafeInteger(row.avatar_revision)||row.avatar_revision<0)continue;
   let pref;try{pref=selection(row.avatar_rotation);}catch{continue;}
   if(pref.mode!=='random')continue;
   if(pref.nextAt>now()){contactDue=Math.min(contactDue,pref.nextAt);continue;}
   // At most eight serial rotations per tick. Reserve through Core's avatar
   // CAS before any network work; only that reservation may receive the result.
   if(attempts++>=8){contactDue=now();break;}
   try{
    const deadline={...pref,nextAt:now()+Math.max(pref.intervalSeconds,300)*1000};
    const response=await contactMedia.update(row.id,{avatar_rotation:deadline,avatar_expected_revision:row.avatar_revision});alive(stamp);
    const reserved=response?.contact||response;
    if(response?.ok===false||!Number.isSafeInteger(reserved?.avatar_revision)||reserved.avatar_revision<=row.avatar_revision||!active())continue;
    contactDue=Math.min(contactDue,deadline.nextAt);
    const result=await prepare({target:'avatar',mode:'random',exclude_id:pref.id,intervalSeconds:pref.intervalSeconds});alive(stamp);if(!active())continue;
    await contactMedia.update(row.id,{avatar:result.value,avatar_rotation:result.rotation,avatar_expected_revision:reserved.avatar_revision});alive(stamp);
   }catch{/* A new edit, removal or failed request keeps the old image. */}
  }
 }
 async function apply(p){
  const current=profile.read(),stamp=epoch;if(current.warning)throw Error(current.warning);
  if(typeof p.expected_version!=='string'||p.expected_version!==current.version)throw Error('设置已变化，请重新选择');
  const result=await prepare(p);alive(stamp);
  const saved=commit(p.target,result.value,result.rotation,current);schedule();return {...result,profile:saved};
 }
 async function tick(){
  if(closed||ticking||!active())return;ticking=true;
  try{for(const target of TARGETS){
   if(closed||!active())break;const current=profile.read(),pref=current.mediaRotation?.[target];
   if(current.warning||pref?.mode!=='random'||pref.nextAt>now())continue;
   // Persist an attempt reservation before networking. Multiple hosts/restarts
   // share the profile CAS; a failed attempt keeps the image and backs off.
   let reserved;try{reserved=commit(target,mediaValue(current,target),{...pref,nextAt:now()+Math.max(pref.intervalSeconds,300)*1000},current);}catch{continue;}
   const expected=signature(reserved,target),stamp=epoch;
   try{
    const result=await prepare({target,mode:'random',intervalSeconds:pref.intervalSeconds});alive(stamp);
    const latest=profile.read();if(!active()||signature(latest,target)!==expected)continue;
    commit(target,result.value,result.rotation,latest);
   }catch{/* Keep the existing image and the persisted retry deadline. */}
  }await rotateContacts();}finally{ticking=false;schedule();}
 }
 function schedule(){
  if(timer!==null)clearTimer(timer);timer=null;if(closed||!clockStarted)return;
  const current=profile.read(),due=TARGETS.map(k=>current.mediaRotation?.[k]).filter(v=>v?.mode==='random').map(v=>v.nextAt-now());
  if(contactMedia)due.push(contactDue-now());
  const delay=active()&&due.length?Math.max(1000,Math.min(MINUTE,...due)):MINUTE;
  timer=setTimer(()=>{timer=null;void tick().finally(()=>{if(!ticking)schedule();});},delay);timer?.unref?.();
 }
 async function call(p={}){
  if(closed)throw Error('主题服务已关闭');
  if(p.action==='status')return {ok:true,account:client.status(),profile:profile.read()};
  if(p.action==='list')return list(p);
  if(p.action==='read')return {ok:true,item:await read(p.id,p.digest)};
  if(p.action==='image'){if(!['preview','image'].includes(p.variant))throw Error('预览类型无效');return {ok:true,src:await image(await read(p.id,p.digest),p.variant)};}
  if(p.action==='prepare')return prepare(p);
  if(p.action==='apply')return apply(p);
  if(p.action==='like'){
   const builtin=likeBuiltin(p);if(builtin)return builtin;
   const stamp=epoch;const item=describe((await client.themeRequest({action:'like',id:p.id,digest:p.digest,liked:p.liked,signal:controller.signal})).item);alive(stamp);
   catalogueRevision++;lists.clear();pools.clear();disk.invalidate(accountScope());records.set(item.id,{item,expires:now()+MINUTE});return {ok:true,item};
  }
  throw Error('未知主题操作');
 }
 return {call,tick,initialize,start(){if(!clockStarted){clockStarted=true;schedule();}},close(){if(closed)return;closed=true;epoch++;controller.abort();decode.close?.();if(timer!==null)clearTimer(timer);timer=null;stopAccount?.();lists.clear();records.clear();pictures.clear();pools.clear();rounds.clear();failures.clear();}};
}
module.exports={createOfficialLibrary,imageDecoder,describe,bytesOf};
