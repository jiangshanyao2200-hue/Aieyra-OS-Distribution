// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: path; table; extractArchive
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/managed-update-archive.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// Parse all paths before writing. Only ordinary, bounded ZIP32 files are used
// by our publisher; no native archive callback or platform path coercion.
const path=require('node:path'),zlib=require('node:zlib');
const {Transform}=require('node:stream'),{pipeline}=require('node:stream/promises');
const {diskFS:fs,safeName,requireSpace}=require('./managed-update-files.cjs');
const table=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
async function extractArchive(archive,destination,{validateName=safeName}={}){
 const fd=fs.openSync(archive,'r'),size=fs.fstatSync(fd).size,entries=[];
 const read=(offset,length)=>{if(offset<0||length<0||offset+length>size)throw Error('ZIP 范围无效');const b=Buffer.alloc(length);if(fs.readSync(fd,b,0,length,offset)!==length)throw Error('ZIP 已截断');return b;};
 try{
  const tail=read(Math.max(0,size-65557),Math.min(size,65557));let end=-1;
  for(let i=tail.length-22;i>=0;i--)if(tail.readUInt32LE(i)===0x06054b50&&i+22+tail.readUInt16LE(i+20)===tail.length){end=i;break;}
  if(end<0)throw Error('ZIP 目录缺失');const e=tail.subarray(end),count=e.readUInt16LE(10),length=e.readUInt32LE(12),offset=e.readUInt32LE(16);
  if(e.readUInt16LE(4)||e.readUInt16LE(6)||count!==e.readUInt16LE(8)||count>10000||length>8*1024*1024||offset+length>size-tail.length+end)throw Error('ZIP 目录不受支持');
  const directory=read(offset,length),seen=new Set();let cursor=0,total=0;
  for(let i=0;i<count;i++){
   if(cursor+46>directory.length||directory.readUInt32LE(cursor)!==0x02014b50)throw Error('ZIP 目录损坏');const c=directory.subarray(cursor),nameLength=c.readUInt16LE(28),extra=c.readUInt16LE(30),comment=c.readUInt16LE(32),flags=c.readUInt16LE(8),method=c.readUInt16LE(10),compressed=c.readUInt32LE(20),uncompressed=c.readUInt32LE(24),at=c.readUInt32LE(42),attributes=c.readUInt32LE(38);
   cursor+=46+nameLength+extra+comment;if(cursor>directory.length)throw Error('ZIP 目录已截断');const name=c.subarray(46,46+nameLength).toString('utf8'),isDirectory=name.endsWith('/'),check=isDirectory?name+'__directory__':name;
    validateName(check);if(flags&1||![0,8].includes(method)||c.readUInt16LE(34)||(attributes>>>16&0o170000)===0o120000||uncompressed>1024**3||compressed===0xffffffff||at===0xffffffff)throw Error('ZIP 条目不受支持');
   const normalized=name.replace(/\/$/,'').toLowerCase();if(seen.has(normalized))throw Error('ZIP 路径重复');seen.add(normalized);
   total+=uncompressed;if(total>2**31)throw Error('ZIP 解压大小超限');
   const local=read(at,30);if(local.readUInt32LE(0)!==0x04034b50||local.readUInt16LE(6)!==flags||local.readUInt16LE(8)!==method)throw Error('ZIP 本地头冲突');
   const localName=read(at+30,local.readUInt16LE(26)).toString('utf8');if(localName!==name)throw Error('ZIP 路径冲突');const dataOffset=at+30+local.readUInt16LE(26)+local.readUInt16LE(28);if(dataOffset+compressed>offset)throw Error('ZIP 数据越界');
   entries.push({name,isDirectory,method,compressed,uncompressed,dataOffset,crc:c.readUInt32LE(16)});
  }
  if(cursor!==directory.length)throw Error('ZIP 目录有多余数据');
  const files=new Set(entries.filter(e=>!e.isDirectory).map(e=>e.name.toLowerCase()));for(const entry of entries){const parts=entry.name.replace(/\/$/,'').toLowerCase().split('/');while(parts.length>1){parts.pop();if(files.has(parts.join('/')))throw Error('ZIP 文件目录冲突');}}
 }finally{fs.closeSync(fd);}
  if(fs.existsSync(destination))throw Error('解压目录已存在');requireSpace(path.dirname(destination),entries.reduce((sum,entry)=>sum+entry.uncompressed,0));fs.mkdirSync(path.dirname(destination),{recursive:true});fs.mkdirSync(destination);
 try{for(const entry of entries){const target=path.join(destination,...entry.name.split('/'));if(entry.isDirectory){fs.mkdirSync(target,{recursive:true});continue;}fs.mkdirSync(path.dirname(target),{recursive:true});let count=0,crc=0xffffffff;
  const meter=new Transform({transform(chunk,_encoding,done){count+=chunk.length;if(count>entry.uncompressed)return done(Error('ZIP 文件大小超限'));for(const byte of chunk)crc=table[(crc^byte)&255]^(crc>>>8);done(null,chunk);}});
  if(!entry.compressed){if(entry.uncompressed||entry.crc)throw Error('ZIP 空文件校验失败');fs.writeFileSync(target,'',{flag:'wx'});continue;}
  const source=fs.createReadStream(archive,{start:entry.dataOffset,end:entry.dataOffset+entry.compressed-1});const stages=[source];if(entry.method===8)stages.push(zlib.createInflateRaw());stages.push(meter,fs.createWriteStream(target,{flags:'wx',mode:0o600}));await pipeline(...stages);
  if(count!==entry.uncompressed||((crc^0xffffffff)>>>0)!==entry.crc)throw Error('ZIP 内容校验失败');
 }return entries.filter(e=>!e.isDirectory).map(e=>e.name);
 }catch(error){fs.rmSync(destination,{recursive:true,force:true});throw error;}
}
module.exports={extractArchive};
