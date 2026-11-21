// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: fs; resources; createRuntimePromptEditor
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/runtime-prompts.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{isUtf8}=require('node:buffer');
const {withWriteLock,version}=require('../src/config.cjs');
const resources=require('../src/resources.cjs');
function createRuntimePromptEditor(root){
  const base=path.resolve(root),digest=b=>crypto.createHash('sha256').update(b).digest('hex');
  function catalog(){
    const index=resources.promptIndex(root);
    return index.names().filter(file=>!index.lookup(file).readOnly).map(file=>({file}));
  }
  function safe(root,target,missing=false){
    const relative=path.relative(root,target);
    if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('提示词位置无效');
    let current=path.parse(root).root;for(const part of path.relative(current,target).split(path.sep)){current=path.join(current,part);try{if(fs.lstatSync(current).isSymbolicLink())throw Error('请直接编辑链接目标');}catch(e){if(missing&&e.code==='ENOENT')continue;throw e;}}
    if(missing&&!fs.existsSync(target))return target;
    const real=fs.realpathSync(target),actual=path.relative(fs.realpathSync(root),real);
    if(actual.startsWith('..')||path.isAbsolute(actual)||fs.lstatSync(target).isSymbolicLink())throw Error('请直接编辑链接目标');
    return target;
  }
  function resolve(file,write=false){
    if(typeof file!=='string'||!catalog().some(r=>r.file===file))throw Error('请选择提示词目录中登记的文件');
    const privateRoot=resources.runtimeOverrideRoot(base);
    const target=write?path.join(privateRoot,resources.promptIndex(base).lookup(file).path):resources.promptPath(file,base);
    const privateFile=target.startsWith(privateRoot+path.sep);
    const profile=require('../../../Contracts/storage/profile.cjs').active();
    const legacyPrivate=profile?.unified&&target.startsWith(profile.overrides+path.sep);
    return safe(privateFile?privateRoot:legacyPrivate?profile.overrides:base,target,write);
  }
  function read(file){
    const target=resolve(file),stat=fs.statSync(target);
    if(!stat.isFile()||stat.size>256*1024)throw Error('提示词须为最多 256 KiB 的普通 UTF-8 文件');
    const bytes=fs.readFileSync(target);if(!isUtf8(bytes)||bytes.length>256*1024)throw Error('提示词不是有效 UTF-8');
    return {ok:true,file,path:target,text:bytes.toString('utf8'),version:digest(Buffer.concat([Buffer.from(target+'\0'),bytes])),content_version:digest(bytes)};
  }
  const editor={call(p={}){
    if(p.action==='list'||!p.action)return {ok:true,root:base,files:catalog()};
    if(p.action==='read')return read(p.file);
    if(p.action!=='save'||typeof p.text!=='string'||Buffer.byteLength(p.text)>256*1024||typeof p.version!=='string')throw Error('提示词操作或内容无效');
    const target=resolve(p.file,true);
    const before=read(p.file);
    if(before.version!==p.version)throw Error('提示词或位置已变化，请重新读取；当前编辑仍保留');
    if(before.text===p.text)return before;
    fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});resolve(p.file,true);
    return withWriteLock(target,version(target),()=>{
      const current=read(p.file);if(current.path!==before.path||current.version!==p.version||resolve(p.file,true)!==target)throw Error('提示词或位置已变化，请重新读取；当前编辑仍保留');
      const backup=target+'.backup.'+current.content_version;
      if(!fs.existsSync(backup))fs.copyFileSync(current.path,backup,fs.constants.COPYFILE_EXCL);
      const st=fs.lstatSync(backup);if(!st.isFile()||st.isSymbolicLink()||st.size>256*1024||digest(fs.readFileSync(backup))!==current.content_version)throw Error('提示词备份校验失败');
      const tmp=target+'.tmp.'+crypto.randomUUID();let fd;
      try{fd=fs.openSync(tmp,'wx',0o600);fs.writeFileSync(fd,p.text);fs.fsyncSync(fd);fs.closeSync(fd);fd=null;fs.renameSync(tmp,target);}
      finally{if(fd!=null)fs.closeSync(fd);if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
      return read(p.file);
    });
  },saveForTransaction(p){
    const before=read(p.file),result=editor.call(p);
    return {result,rollback(){
      if(before.version===result.version)return read(p.file);
      if(before.path===result.path)return editor.call({...p,text:before.text,version:result.version});
      // A failed multi-store save must resume the original default/legacy
      // lookup, rather than pinning its former bytes as a private override.
      const target=resolve(p.file,true);
      return withWriteLock(target,result.content_version,()=>{
        const current=read(p.file);
        if(target!==result.path||current.version!==result.version)throw Error('提示词已变化，不能覆盖后来的编辑');
        fs.unlinkSync(target);
        return read(p.file);
      });
    }};
  }};
  return editor;
}
module.exports={createRuntimePromptEditor};
