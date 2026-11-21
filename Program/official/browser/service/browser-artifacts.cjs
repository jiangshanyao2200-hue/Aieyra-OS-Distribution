'use strict';
// A host-authorized HTML file gets a directory-scoped web origin. Ordinary
// browser/tool URLs never grant access to a local path.
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),crypto=require('node:crypto');
const LIMIT=32*1024*1024;
const MIME={'.html':'text/html; charset=utf-8','.htm':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.txt':'text/plain; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.wasm':'application/wasm','.mp3':'audio/mpeg','.mp4':'video/mp4','.webm':'video/webm'};
async function artifactSource(file){
 if(typeof file!=='string'||!path.isAbsolute(file))throw Error('本地产物路径无效');
 const canonical=await fsp.realpath(file),info=await fsp.stat(canonical);
 if(!info.isFile()||!['.html','.htm'].includes(path.extname(canonical).toLowerCase()))throw Error('需要可读取的HTML文件');
 const directory=path.dirname(canonical),identity=process.platform==='win32'?directory.toLowerCase():directory;
 const hash=crypto.createHash('sha256').update(identity).digest('hex').slice(0,36),origin='https://'+hash+'.artifact.aieyra.invalid';
 return {directory,profile:'artifact-'+hash,origin,url:origin+'/'+encodeURIComponent(path.basename(canonical)),label:'本地文件 · '+path.basename(directory).slice(0,60)};
}
function createArtifactHandler(source){
 const root=source.directory,origin=source.origin;
 return async request=>{
  let handle;
  try{
   const url=new URL(request.url);
   if(url.origin!==origin||url.username||url.password||!['GET','HEAD'].includes(request.method))return new Response('',{status:403});
   // Decode each component once; encoded separators, drive names, streams,
   // junctions and symlinks cannot turn a package resource into another file.
   const pieces=url.pathname.slice(1).split('/').map(decodeURIComponent);
   if(pieces.some(p=>!p||p==='.'||p==='..'||/[\\/:\x00-\x1f\x7f]/.test(p)||/[. ]$/.test(p)))return new Response('',{status:403});
   let target=root;
   for(const piece of pieces){target=path.join(target,piece);if((await fsp.lstat(target)).isSymbolicLink())return new Response('',{status:403});}
   const real=await fsp.realpath(target),relative=path.relative(root,real);
   if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))return new Response('',{status:403});
   handle=await fsp.open(real,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
   const info=await handle.stat(),now=await fsp.stat(target);
   if(!info.isFile()||info.size>LIMIT||info.ino!==now.ino||info.dev!==now.dev||await fsp.realpath(target)!==real)return new Response('',{status:403});
   const headers={'content-type':MIME[path.extname(real).toLowerCase()]||'application/octet-stream','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer',
    'content-security-policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'"};
   if(request.method==='HEAD')return new Response(null,{headers:{...headers,'content-length':String(info.size)}});
   const buffer=Buffer.alloc(Math.min(info.size+1,LIMIT+1));let size=0;
   while(size<buffer.length){const read=await handle.read(buffer,size,buffer.length-size,null);if(!read.bytesRead)break;size+=read.bytesRead;}
   if(size>LIMIT)return new Response('',{status:413});
   return new Response(buffer.subarray(0,size),{headers});
  }catch(error){return new Response('',{status:['ENOENT','ENOTDIR'].includes(error.code)?404:403});}
  finally{await handle?.close();}
 };
}
function createArtifactOrigins(sessionFor){
 const bound=new Map();
 async function authorize(file){
  const source=await artifactSource(file);
  if(!bound.has(source.profile)){
   const ses=sessionFor(source.profile),handler=createArtifactHandler(source);
   ses.protocol.handle('https',handler);
   ses.webRequest.onBeforeRequest((details,callback)=>{let allowed=false;try{allowed=new URL(details.url).origin===source.origin;}catch{}callback({cancel:!allowed});});
   bound.set(source.profile,{...source,session:ses});
  }
  return source;
 }
 return {authorize,source:profile=>bound.get(profile),close(){for(const {session:ses}of bound.values()){ses.protocol.unhandle('https');ses.webRequest.onBeforeRequest(null);}bound.clear();}};
}
module.exports={artifactSource,createArtifactHandler,createArtifactOrigins};
