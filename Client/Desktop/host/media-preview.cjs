// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: mediaType; previewAttachmentMedia
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/media-preview.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// Only a verified immutable attachment buffer reaches Chromium's decoder.
// Recognition is not a promise that a codec or a damaged stream will decode.
function mediaType(data){
 const text=(start,end)=>data.subarray(start,end).toString('ascii');
 if(data.length>=44&&text(0,4)==='RIFF'&&text(8,12)==='WAVE'){
  if(data.readUInt32LE(4)+8!==data.length)throw Error('WAV 长度不完整');
  let format=false,payload=false;
  for(let offset=12;offset<data.length;){
   if(offset+8>data.length)throw Error('WAV 区块不完整');
   const size=data.readUInt32LE(offset+4),end=offset+8+size;
   if(end>data.length)throw Error('WAV 区块不完整');
   if(text(offset,offset+4)==='fmt '){if(size<16)throw Error('WAV 格式无效');format=true;}
   if(text(offset,offset+4)==='data'&&size>0)payload=true;
   offset=end+(size&1);
  }
  if(format&&payload)return 'audio/wav';
 }
 // Parse the bounded EBML header, including its declared DocType. Matroska
 // and a renamed arbitrary binary cannot select an HTML or file handler.
 const vint=(offset,id=false)=>{
  if(offset>=data.length)throw Error('WebM 标头不完整');
  const first=data[offset];let length=1,mask=128;
  while(length<=8&&!(first&mask)){length++;mask>>=1;}
  if(length>8||offset+length>data.length)throw Error('WebM 标头无效');
  let value=id?first:first&(mask-1);
  for(let i=1;i<length;i++)value=value*256+data[offset+i];
  if(!Number.isSafeInteger(value))throw Error('WebM 标头过大');
  return {value,next:offset+length};
 };
 if(data.length>16&&data.readUInt32BE(0)===0x1a45dfa3){
  const size=vint(4),end=size.next+size.value;if(end>data.length||size.value>4096)throw Error('WebM 标头过大或不完整');
  let webm=false,offset=size.next;
  while(offset<end){const id=vint(offset,true),n=vint(id.next),last=n.next+n.value;if(last>end)throw Error('WebM 标头不完整');if(id.value===0x4282)webm=text(n.next,last)==='webm';offset=last;}
  if(webm&&end+4<data.length&&data.readUInt32BE(end)===0x18538067)return 'video/webm';
 }
 if(data.length>24&&text(4,8)==='ftyp'){
  let offset=0,brand='',movie=false,payload=false;
  while(offset<data.length){
   if(offset+8>data.length)throw Error('MP4 区块不完整');
   let size=data.readUInt32BE(offset),header=8;
   if(size===1){if(offset+16>data.length)throw Error('MP4 区块不完整');const n=data.readBigUInt64BE(offset+8);if(n>BigInt(data.length))throw Error('MP4 区块过大');size=Number(n);header=16;}
   if(size===0)size=data.length-offset;
   if(size<header||offset+size>data.length)throw Error('MP4 区块不完整');
   const kind=text(offset+4,offset+8);
   if(kind==='ftyp'){if(size<header+8)throw Error('MP4 格式无效');brand=text(offset+header,offset+header+4);}
   if(kind==='moov')movie=size>header;if(kind==='mdat')payload=size>header;
   offset+=size;
  }
  if(movie&&payload&&/^(?:isom|iso[2-9]|mp4[12]|avc1|dash|M4[AV] )$/.test(brand))return brand==='M4A '?'audio/mp4':'video/mp4';
 }
 throw Error('暂不支持预览此文件；可预览 WAV、WebM 或 MP4，文件仍保留在附件中。');
}
async function previewAttachmentMedia(store,attachment){
 if(attachment?.kind!=='file')throw Error('请选择音频或视频附件');
 const bytes=await store.readVerified(attachment),mime=mediaType(bytes);
 return {ok:true,mime,bytes,name:attachment.name};
}
module.exports={mediaType,previewAttachmentMedia};
