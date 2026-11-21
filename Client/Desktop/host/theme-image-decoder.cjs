// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: crypto; MAX_PIXELS; webpSize; render; createThemeImageDecoder
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/theme-image-decoder.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// nativeImage only decodes PNG/JPEG. Public catalogue WebP uses a private,
// networkless Chromium raster surface, then the same native re-encoder.
const crypto=require('node:crypto');
const {imageDecoder}=require('../../../Theme/runtime/official-library.cjs');
const MAX_PIXELS=32000000,MAX_BYTES=20*1024*1024;
function webpSize(bytes){
 if(bytes.length<20||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WEBP'||bytes.readUInt32LE(4)+8!==bytes.length)throw Error('WebP 图片格式无效');
 let canvas,frame;
 for(let offset=12;offset<bytes.length;){
  if(offset+8>bytes.length)throw Error('WebP 图片不完整');
  const type=bytes.toString('ascii',offset,offset+4),size=bytes.readUInt32LE(offset+4),start=offset+8,end=start+size;
  if(end+(size&1)>bytes.length)throw Error('WebP 图片不完整');
  if(type==='ANIM'||type==='ANMF')throw Error('主题预览仅支持静态图片');
  if(type==='VP8X'){
   if(canvas||size!==10||bytes[start]&2)throw Error('主题预览仅支持静态 WebP');
   canvas={width:1+bytes.readUIntLE(start+4,3),height:1+bytes.readUIntLE(start+7,3)};
  }else if(type==='VP8 '){
   if(frame||size<10||bytes.toString('hex',start+3,start+6)!=='9d012a')throw Error('WebP 图片格式无效');
   frame={width:bytes.readUInt16LE(start+6)&0x3fff,height:bytes.readUInt16LE(start+8)&0x3fff};
  }else if(type==='VP8L'){
   if(frame||size<5||bytes[start]!==0x2f||bytes[start+4]>>5)throw Error('WebP 图片格式无效');
   frame={width:1+bytes[start+1]+((bytes[start+2]&63)<<8),height:1+(bytes[start+2]>>6)+(bytes[start+3]<<2)+((bytes[start+4]&15)<<10)};
  }
  offset=end+(size&1);
 }
 if(!frame||canvas&&(canvas.width!==frame.width||canvas.height!==frame.height))throw Error('WebP 图片尺寸无效');
 const {width,height}=canvas||frame;
 if(width<1||height<1||width>16384||height>16384||width*height>MAX_PIXELS)throw Error('主题图片尺寸过大');
 return {width,height};
}
function render({src,category,preview}){
 return new Promise((resolve,reject)=>{
  const image=new Image();
  image.onerror=()=>reject(Error('无法读取主题图片'));
  image.onload=()=>{
   try{
    const width=image.naturalWidth,height=image.naturalHeight;
    if(!width||!height||width>16384||height>16384||width*height>32000000)throw Error('主题图片尺寸过大');
    const canvas=document.createElement('canvas');
    const side=category==='avatar'?(preview?256:512):(preview?480:1920);
    if(category==='avatar'){
     canvas.width=canvas.height=side;
     const size=Math.min(width,height);canvas.getContext('2d').drawImage(image,Math.floor((width-size)/2),Math.floor((height-size)/2),size,size,0,0,side,side);
    }else{
     const ratio=Math.min(1,side/Math.max(width,height));canvas.width=Math.max(1,Math.round(width*ratio));canvas.height=Math.max(1,Math.round(height*ratio));
     canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
    }
    resolve(canvas.toDataURL('image/png'));canvas.width=canvas.height=0;
   }catch(error){reject(error);}
  };
  image.src=src;
 });
}
function createThemeImageDecoder({nativeImage,BrowserWindow,session}){
 const encode=imageDecoder(nativeImage);let worker=null,ready=null,partition=null,closed=false,idle=null,queued=0,queuedBytes=0,chain=Promise.resolve();
 const dispose=()=>{clearTimeout(idle);idle=null;const old=worker;worker=null;ready=null;if(old&&!old.isDestroyed())old.destroy();};
 function surface(){
  if(closed)throw Error('主题服务已关闭');
  if(ready)return ready;
  if(!partition){
   partition=session.fromPartition('theme-raster-'+crypto.randomUUID());
   partition.setPermissionRequestHandler((_contents,_permission,done)=>done(false));partition.setPermissionCheckHandler(()=>false);
   partition.webRequest.onBeforeRequest((request,done)=>done({cancel:!request.url.startsWith('data:')}));
   partition.on('will-download',event=>event.preventDefault());
  }
  const win=new BrowserWindow({show:false,focusable:false,skipTaskbar:true,width:32,height:32,webPreferences:{session:partition,sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,devTools:false,offscreen:true,backgroundThrottling:false,spellcheck:false}});
  worker=win;win.aieyraThemeRaster=true;win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',event=>event.preventDefault());
  win.on('closed',()=>{if(worker===win){worker=null;ready=null;}});
  ready=win.loadURL('data:text/html,'+encodeURIComponent('<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; base-uri \'none\'; form-action \'none\'">')).then(()=>win);
  return ready;
 }
 async function raster(bytes,options){
  let timeout;
  try{
   return await Promise.race([
    (async()=>{const win=await surface();if(closed)throw Error('主题服务已关闭');const src='data:image/webp;base64,'+bytes.toString('base64');
     const png=await win.webContents.executeJavaScript('('+render.toString()+')('+JSON.stringify({src,category:options.category,preview:options.preview===true})+')');
     if(closed)throw Error('主题服务已关闭');
     if(typeof png!=='string'||!png.startsWith('data:image/png;base64,')||png.length>16*1024*1024)throw Error('主题图片转换无效');
     return encode(Buffer.from(png.slice(22),'base64'),options);
    })(),
    new Promise((_,reject)=>{timeout=setTimeout(()=>{dispose();reject(Error('主题图片处理超时，请重试'));},10000);})
   ]);
  }catch(error){dispose();throw error;}
  finally{clearTimeout(timeout);}
 }
 const decode=async(bytes,options={})=>{
  if(closed)throw Error('主题服务已关闭');
  if(bytes.length>MAX_BYTES)throw Error('主题图片过大');
  if(bytes.toString('ascii',0,4)!=='RIFF')return encode(bytes,options);
  webpSize(bytes);
  if(options.variant==='file')throw Error('主题原图必须为 PNG');
  if(queued>=8||queuedBytes+bytes.length>40*1024*1024)throw Error('图片正在处理，请稍后重试');
  queued++;queuedBytes+=bytes.length;clearTimeout(idle);
  const next=chain.then(()=>{if(closed)throw Error('主题服务已关闭');return raster(bytes,options);});chain=next.catch(()=>{});
  try{return await next;}
  finally{queued--;queuedBytes-=bytes.length;if(!closed&&!queued){idle=setTimeout(dispose,1000);idle.unref?.();}}
 };
 decode.close=()=>{closed=true;dispose();};return decode;
}
module.exports={createThemeImageDecoder,webpSize};
