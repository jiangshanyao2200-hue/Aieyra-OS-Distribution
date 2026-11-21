// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: createDeskPark
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/desk-park.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const {restoreModuleBounds}=require('./module-window.cjs');
// 桌面模式：程序窗口最小化时缩到左上角，不进任务栏；悬停查看有效画面或明确标注的缓存。
// 只管窗口的收起和恢复，窗口和页面的生命周期仍归各自的宿主。
function createDeskPark({active=()=>false,owner,motion=()=>true,notify=()=>{},captureTimeoutMs=1500}){
 const parked=new Map(),shots=new Map(),watched=new Map(),animations=new WeakMap();
 const alive=host=>host&&!host.isDestroyed();
 const cancelMotion=host=>animations.get(host)?.();
 function unwatch(key){const row=watched.get(key);if(!row)return;row.host.removeListener?.('closed',row.closed);watched.delete(key);}
 function watch(key,host){
  if(watched.get(key)?.host===host)return;
  const previous=watched.get(key);if(previous){cancelMotion(previous.host);unwatch(key);shots.delete(key);}
  const row={host,closed:()=>{if(watched.get(key)!==row)return;cancelMotion(host);parked.delete(key);shots.delete(key);unwatch(key);}};
  watched.set(key,row);host.once('closed',row.closed);
 }
 const area=()=>{const b=owner().getContentBounds();return {x:b.x+16,y:b.y+12,width:220,height:138};};
 function fly(host,from,to,fade,bounds,done){
  cancelMotion(host);
  if(!motion()){done();return;}
  const minimum=host.getMinimumSize();host.setMinimumSize(100,60);
  const started=Date.now(),ms=170,ease=t=>1-(1-t)**3;
  const stop=()=>{clearInterval(timer);if(animations.get(host)===stop)animations.delete(host);if(alive(host)){host.setMinimumSize(...minimum);restoreModuleBounds(host,bounds);host.setOpacity(1);}};
  const timer=setInterval(()=>{
   if(!alive(host)){stop();return;}
   const t=Math.min(1,(Date.now()-started)/ms),k=ease(t);
   host.setBounds(Object.fromEntries(['x','y','width','height'].map(n=>[n,Math.round(from[n]+(to[n]-from[n])*k)])));
   host.setOpacity(fade?1-k:k);
   if(t>=1){stop();done();}
  },16);
  animations.set(host,stop);
 }
 function take(key,host,{hide=()=>host.hide(),instant=false,beforeHide=null}={}){
  if(!alive(host)||parked.has(key))return false;
  cancelMotion(host);watch(key,host);
  const bounds=host.isMaximized()?host.getNormalBounds():host.getBounds(),row={host,bounds,maximized:host.isMaximized()};
  parked.set(key,row);
  const commit=()=>{if(!alive(host)||parked.get(key)!==row)return;hide();host.setOpacity(1);restoreModuleBounds(host,bounds);notify(key);};
  const finish=()=>{if(!alive(host)||parked.get(key)!==row)return;if(beforeHide)void Promise.resolve().then(()=>{if(alive(host)&&parked.get(key)===row)return beforeHide();}).catch(()=>{}).then(commit);else commit();};
  if(instant||row.maximized)finish();else fly(host,bounds,area(),true,bounds,finish);
  notify(key);return true;
 }
 function restore(key){
  const row=parked.get(key);if(!row)return false;
  parked.delete(key);
  cancelMotion(row.host);
  if(!alive(row.host))return false;
  const {host,bounds,maximized}=row;
  if(maximized||!motion()){restoreModuleBounds(host,bounds);host.setOpacity(1);if(maximized)host.maximize();notify(key);return true;}
  host.setOpacity(0);host.setBounds(area());
  fly(host,area(),bounds,false,bounds,()=>{if(!alive(host))return;host.setOpacity(1);});
  notify(key);return true;
 }
 // Some native child pages stop producing frames when their window hides.
 // Keep only the same page's last frame, with a bounded wait and no retry pileup.
 async function preview(key,contents,{identity='',isCurrent=()=>true,cached=false,ready}={}){
  const empty=()=>({ok:true,available:false,url:'',parked:parked.has(key)});
  if(!contents||contents.isDestroyed()){shots.delete(key);return empty();}
  const location=contents.getURL?.()||'';let frame=shots.get(key);
  if(!frame||frame.contents!==contents||frame.location!==location||frame.identity!==identity){frame={contents,location,identity,url:'',sequence:0};shots.set(key,frame);}
  // Reading a cache while its first frame is still being captured must not
  // supersede the writer. Source/identity changes still replace the frame.
  const sequence=cached?frame.sequence:++frame.sequence;
  const current=()=>shots.get(key)===frame&&frame.sequence===sequence&&!contents.isDestroyed()&&(contents.getURL?.()||'')===location&&isCurrent();
  let fresh=false,timer;
  try{
   if(cached)return current()?{ok:true,available:!!frame.url,url:frame.url,width:frame.width,height:frame.height,stale:!!frame.url,parked:parked.has(key)}:empty();
   if(!frame.pending){const pending=Promise.resolve(ready).then(()=>contents.capturePage(undefined,{stayHidden:true,stayAwake:true}));frame.pending=pending;void pending.then(()=>{if(frame.pending===pending)frame.pending=null;},()=>{if(frame.pending===pending)frame.pending=null;});}
   const image=await Promise.race([frame.pending,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),captureTimeoutMs);})]);
   if(current()&&image&&!image.isEmpty()){const {width,height}=image.getSize();if(width>=16&&height>=16){const small=width>920?image.resize({width:920,quality:'good'}):image;frame.url='data:image/jpeg;base64,'+small.toJPEG(80).toString('base64');frame.width=width;frame.height=height;fresh=true;}}
  }catch{}finally{clearTimeout(timer);}
  if(!current())return empty();
  return {ok:true,available:!!frame.url,url:frame.url,width:frame.width,height:frame.height,stale:!!frame.url&&!fresh,parked:parked.has(key)};
 }
 return {take,restore,preview,parked:key=>parked.has(key),active,restoreAll(){for(const key of [...parked.keys()])restore(key);},forget(key){const row=watched.get(key);if(row)cancelMotion(row.host);unwatch(key);parked.delete(key);shots.delete(key);}};
}
module.exports={createDeskPark};
