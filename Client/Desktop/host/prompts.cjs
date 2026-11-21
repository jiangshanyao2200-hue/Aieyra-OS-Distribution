// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: fs; path; crypto; cfg; titles; createPromptEditor
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/prompts.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isUtf8 } = require('node:buffer');
const cfg = require('../src/config.cjs');
const titles = { self: '人格与沟通', work: '执行与工作', boundary: '安全与边界', thinking: '思考方式' };

// Host chooses the exact directory used by the core; renderer chooses only a layer.
function createPromptEditor(directory, defaults) {
  const dir = path.resolve(directory);
  const resources=require('../src/resources.cjs');
  const defaultFile=layer=>defaults===undefined?resources.promptPath('Matrix/默认/'+layer.file):path.join(path.resolve(defaults),layer.file);
  const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
  const within = (root, target) => { const r = path.relative(root, target); return r === '' || !r.startsWith('..' + path.sep) && r !== '..' && !path.isAbsolute(r); };
  function protectDefaults(){
    const dirs=new Set(cfg.PROMPT_FILES.map(layer=>path.dirname(defaultFile(layer))));
    if(defaults===undefined){
      dirs.add(path.join(resources.root(),'Prompt/Matrix/默认'));
      for(const layer of cfg.PROMPT_FILES)dirs.add(path.dirname(path.join(resources.root(),resources.promptIndex().lookup('Matrix/默认/'+layer.file).path)));
    }
    for(const defaultDir of dirs)if(within(defaultDir,dir)||fs.existsSync(dir)&&fs.existsSync(defaultDir)&&within(fs.realpathSync(defaultDir),fs.realpathSync(dir)))throw Error('官方默认目录不能作为个人提示词目录');
  }
  protectDefaults();
  const resolve = (id) => {
    protectDefaults();
    const layer = cfg.PROMPT_FILES.find((value) => value.id === id);
    if (!layer) throw Error('未知提示词层');
    const file = path.join(dir, layer.file);
    try { if (fs.lstatSync(file).isSymbolicLink()) throw Error('请直接编辑链接目标；界面不会替换提示词链接'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    return { ...layer, title: titles[id], file };
  };
  function read(id) {
    const layer = resolve(id);
    let bytes = Buffer.alloc(0), exists = false;
    try {
      const stat = fs.statSync(layer.file);
      if (!stat.isFile() || stat.size > 256 * 1024) throw Error('提示词必须是最多 256 KiB 的普通 UTF-8 文件');
      bytes = fs.readFileSync(layer.file); exists = true;
      if (bytes.length > 256 * 1024 || !isUtf8(bytes)) throw Error('提示词过大或不是 UTF-8');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const original = readDefault(id);
    let undoVersion = null;
    if (!exists) {
      try {
        const meta = layer.file + '.restore.json', stat = fs.lstatSync(meta);
        if (stat.isFile() && !stat.isSymbolicLink() && stat.size < 2048) {
          const prior = JSON.parse(fs.readFileSync(meta, 'utf8'));
          if (/^[a-f0-9]{64}$/.test(prior.undoVersion || '')) undoVersion = prior.undoVersion;
        }
      } catch { /* 回退元数据不影响实际提示词读取；恢复时仍校验备份。 */ }
    }
    return { id, title: layer.title, text: exists ? bytes.toString('utf8') : original.text, version: exists ? hash(bytes) : 'missing', exists, source: exists ? 'custom' : original.exists ? 'default' : 'missing', defaultText: original.text, defaultVersion: original.version, defaultAvailable: original.exists, undoVersion };
  }
  function readDefault(id) {
    const layer = cfg.PROMPT_FILES.find(value => value.id === id);
    if (!layer) throw Error('未知提示词层');
    const file = defaultFile(layer);
    let bytes;
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024) throw Error('官方默认提示词资源无效');
      bytes = fs.readFileSync(file);
      if (bytes.length > 256 * 1024 || !isUtf8(bytes)) throw Error('官方默认提示词不是有效 UTF-8 资源');
    } catch (e) { if (e.code === 'ENOENT') return { text: '', version: 'missing', exists: false }; throw e; }
    return { text: bytes.toString('utf8'), version: hash(bytes), exists: true };
  }
  function backup(file, current) {
    if (!current.exists) return;
    const target = file + '.backup.' + current.version;
    if (!fs.existsSync(target)) fs.copyFileSync(file, target, fs.constants.COPYFILE_EXCL);
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024 || hash(fs.readFileSync(target)) !== current.version) throw Error('备份校验失败，原提示词未替换');
  }
  function write(file, text) {
    const temp = file + '.tmp.' + crypto.randomUUID();
    try { const fd = fs.openSync(temp, 'wx', 0o600); try { fs.writeFileSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } fs.renameSync(temp, file); }
    finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  }
  function validate(p) {
    if (p.directory !== dir || typeof p.version !== 'string') throw Error('提示词目录或内容已变化，请重新读取');
    return resolve(p.id).file;
  }
  const editor = {
    list: () => ({ ok: true, dir, layers: Object.keys(titles).map(read) }),
    restoreAll(p) {
      if(p.directory!==dir||p.confirmed!==true||!Array.isArray(p.layers)||p.layers.length!==4)throw Error('请确认四类提示词全部恢复默认');
      const current=Object.keys(titles).map(read),seen=new Set();
      for(const layer of current){const expected=p.layers.find(x=>x.id===layer.id);if(!expected||seen.has(expected.id)||expected.version!==layer.version||expected.defaultVersion!==layer.defaultVersion||!layer.defaultAvailable)throw Error('提示词或默认版本已变化，请重新读取');seen.add(expected.id);}
      // 固定顺序持有全部层锁；CAS和全部备份通过后再执行，写入异常时回滚。
      const lock=(i,run)=>i===current.length?run():cfg.withWriteLock(resolve(current[i].id).file,current[i].version,()=>lock(i+1,run));
      return lock(0,()=>{
        const changed=[];
        for(const layer of current){if(readDefault(layer.id).version!==layer.defaultVersion)throw Error('默认版本已变化，请重新读取');backup(resolve(layer.id).file,layer);}
        try{
          for(const layer of current){if(!layer.exists)continue;const file=resolve(layer.id).file;write(file+'.restore.json',JSON.stringify({undoVersion:layer.version,defaultVersion:layer.defaultVersion}));fs.unlinkSync(file);changed.push(layer);}
        }catch(error){
          const failed=[];for(const layer of changed){try{write(resolve(layer.id).file,layer.text);}catch{failed.push(layer.id);}}
          if(failed.length)throw Error('恢复未完成，已保留全部备份；需从备份恢复：'+failed.join('、'));
          throw error;
        }
        return {ok:true,dir,layers:Object.keys(titles).map(read)};
      });
    },
    save(p) {
      if (p.directory !== dir || typeof p.text !== 'string' || Buffer.byteLength(p.text) > 256 * 1024 || typeof p.version !== 'string') throw Error('提示词目录或内容已变化，请重新读取');
      const { file } = resolve(p.id);
      return cfg.withWriteLock(file, p.version, () => {
        const current = read(p.id);
        if (current.text === p.text) return { ok: true, layer: current };
        backup(file, current);
        write(file, p.text);
        return { ok: true, layer: read(p.id) };
      });
    },
    saveForTransaction(p) {
      const before=read(p.id),result=editor.save(p);
      return {result,rollback(){
        if(before.version===result.layer.version&&before.exists===result.layer.exists)return {ok:true,layer:read(p.id)};
        if(before.exists)return editor.save({...p,text:before.text,version:result.layer.version});
        const file=validate({...p,version:result.layer.version});
        return cfg.withWriteLock(file,result.layer.version,()=>{
          fs.unlinkSync(file);
          return {ok:true,layer:read(p.id)};
        });
      }};
    },
    restore(p) {
      const file = validate(p);
      return cfg.withWriteLock(file, p.version, () => {
        const original = readDefault(p.id), current = read(p.id);
        if (!original.exists || p.defaultVersion !== original.version) throw Error('默认版本已变化，请重新读取后恢复');
        backup(file, current);
        if (current.exists) {
          write(file + '.restore.json', JSON.stringify({undoVersion: current.version, defaultVersion: original.version}));
          fs.unlinkSync(file);
        }
        const layer = read(p.id);
        return { ok: true, layer, undoVersion: layer.undoVersion };
      });
    },
    undo(p) {
      const file = validate(p);
      if (!/^[a-f0-9]{64}$/.test(p.undoVersion || '')) throw Error('无效的恢复备份');
      return cfg.withWriteLock(file, p.version, () => {
        const target = file + '.backup.' + p.undoVersion;
        const stat = fs.lstatSync(target);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024) throw Error('恢复备份无效');
        const bytes = fs.readFileSync(target);
        if (hash(bytes) !== p.undoVersion) throw Error('恢复备份已变化');
        backup(file, read(p.id));
        write(file, bytes);
        return { ok: true, layer: read(p.id) };
      });
    },
  };
  return editor;
}
module.exports = { createPromptEditor };

