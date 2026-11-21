/* @file-map:start
文件: link/desktop/aidebug-images.cjs
位置: 二环·桌面能力 | Electron生命周期、权限边界、本机服务、云账号与可诊断桌面模块。
约束: renderer通过preload白名单进入主进程，禁止开放任意IPC；启动失败先持久取证；关闭须收束服务租约和诊断
下游: 无已解析的项目内静态导入
上游: AIDEBUG/network-probe.test.cjs, link/desktop/aidebug-live.cjs
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: AIDEBUG/network-probe.test.cjs
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  chunk | function
  png | function
  overlayBitmap | function
  ImageWriter | class
  ImageWriter.constructor | method
  ImageWriter.fail | method
  ImageWriter.write | method
  ImageWriter.close | method
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
'use strict';
// PNG compression runs off Electron's UI thread, including large filmstrip sheets.
const {Worker,isMainThread,parentPort}=require('node:worker_threads');
const fs=require('node:fs'),zlib=require('node:zlib');
const table=Uint32Array.from({length:256},(_,i)=>{for(let n=0;n<8;n++)i=i&1?0xedb88320^(i>>>1):i>>>1;return i>>>0;});
/* @chain-region chunk | calls: Buffer.from, Buffer.concat, Buffer.alloc, result.writeUInt32BE, body.copy */ function chunk(name,data){
 const type=Buffer.from(name),body=Buffer.concat([type,data]),result=Buffer.alloc(body.length+8);result.writeUInt32BE(data.length);body.copy(result,4);
 let crc=0xffffffff;for(const byte of body)crc=table[(crc^byte)&255]^(crc>>>8);result.writeUInt32BE((crc^0xffffffff)>>>0,result.length-4);return result;
}
/* @chain-region png | calls: Number.isInteger, Error, Buffer.alloc, header.writeUInt32BE, Buffer.concat, Buffer.from, chunk, zlib.deflateSync */ function png(bitmap,width,height){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||bitmap.length!==width*height*4)throw Error('invalid_bitmap');
 const stride=width*4,scan=Buffer.alloc((stride+1)*height);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const from=(y*width+x)*4,to=y*(stride+1)+1+x*4;
  scan[to]=bitmap[from+2];scan[to+1]=bitmap[from+1];scan[to+2]=bitmap[from];scan[to+3]=bitmap[from+3];
 }
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(scan,{level:3})),chunk('IEND',Buffer.alloc(0))]);
}
// Electron bitmap channels are premultiplied BGRA on Windows. Preserve the
// shell wallpaper when a transparent native child view is composited for review.
/* @chain-region overlayBitmap | calls: Math.min, Math.round */ function overlayBitmap(base,baseWidth,baseHeight,child,bounds){
 for(let y=0;y<bounds.height;y++){
  const by=y+bounds.y;if(by<0||by>=baseHeight)continue;
  for(let x=0;x<bounds.width;x++){
   const bx=x+bounds.x;if(bx<0||bx>=baseWidth)continue;
   const from=(y*bounds.width+x)*4,to=(by*baseWidth+bx)*4,alpha=child[from+3],remaining=1-alpha/255;
   if(!alpha)continue;
   for(let c=0;c<3;c++)base[to+c]=Math.min(255,Math.round(child[from+c]+base[to+c]*remaining));
   base[to+3]=Math.min(255,Math.round(alpha+base[to+3]*remaining));
  }
 }
 return base;
}
/* @chain-region ImageWriter */ class ImageWriter{
 /* @chain-region ImageWriter.constructor | calls: Worker, Map, worker.on, pending.get, pending.delete, clearTimeout, item.reject, Error … */ constructor(){this.worker=new Worker(__filename);this.serial=0;this.pending=new Map();
  this.worker.on('message',value=>{const item=this.pending.get(value.id);if(!item)return;this.pending.delete(value.id);clearTimeout(item.timer);value.error?item.reject(Error(value.error)):item.resolve(value.file);});
  this.worker.on('error',error=>this.fail(error));this.worker.on('exit',code=>{if(this.pending.size)this.fail(Error('image_worker_exited: '+code));});
 }
 /* @chain-region ImageWriter.fail | calls: pending.values, clearTimeout, item.reject, pending.clear */ fail(error){for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(error);}this.pending.clear();}
 /* @chain-region ImageWriter.write | calls: image.getSize, image.toBitmap, Promise, setTimeout, pending.delete, reject, Error, pending.set … */ write(image,file){
  const {width,height}=image.getSize(),bitmap=image.toBitmap({scaleFactor:1}),id=++this.serial;
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('image_write_timeout'));},20000);this.pending.set(id,{resolve,reject,timer});this.worker.postMessage({id,width,height,bitmap,file});});
 }
 /* @chain-region ImageWriter.close | calls: fail, Error, worker.terminate */ async close(){this.fail(Error('image_writer_closed'));await this.worker.terminate();}
}
if(!isMainThread)parentPort.on('message',value=>{try{fs.writeFileSync(value.file,png(value.bitmap,value.width,value.height));parentPort.postMessage({id:value.id,file:value.file});}catch(error){parentPort.postMessage({id:value.id,error:error.message});}});
module.exports={ImageWriter,png,overlayBitmap};
