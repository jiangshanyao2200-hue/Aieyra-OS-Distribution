// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Core/platform/AGENTS.md | ring 0
// Chains: module-local; query impact before editing
// Regions: fs; version; withWriteLock; replaceConfigFile
// Impact: python -B scripts/code-atlas.py show Core/platform/config-file.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// Shared versioned file writes for host modules; no provider or UI dependency.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function version(file) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
  catch (e) { if (e.code === 'ENOENT') return 'missing'; throw e; }
}

// 所有 Desktop 写入者共用排他锁；版本比较必须在锁内，不能只在 RPC 入口检查。
// 异常退出遗留的锁宁可明确报错，也不凭超时删除可能仍属于慢进程的锁。
function withWriteLock(file, expected, write) {
  fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
  const lock = file + '.write-lock'; let fd;
  try { fd = fs.openSync(lock, 'wx', 0o600); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const err = Error('配置正在被另一写入者使用；如进程曾异常退出，请核实锁文件内的进程已退出后清理 ' + lock);
    err.code = 'config_busy'; throw err;
  }
  try {
    fs.writeFileSync(fd, JSON.stringify({pid: process.pid, created: new Date().toISOString()}));
    if (expected !== undefined && expected !== version(file)) {
      const err = Error('配置已变化，请重新读取后修改'); err.code = 'version_conflict'; throw err;
    }
    return write();
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}

// Call under withWriteLock. Keep the same staged bytes and committed file
// while Windows readers briefly deny replacement; recheck CAS on each retry.
function replaceConfigFile(tmp, file, expected) {
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (let attempt = 0; ; attempt++) {
    if (version(file) !== expected) {
      const err = Error('配置已变化，请重新读取后修改');
      err.code = 'version_conflict';
      throw err;
    }
    try { fs.renameSync(tmp, file); return; }
    catch (err) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(err.code) || attempt >= 4) throw err;
      Atomics.wait(pause, 0, 0, 20 * 2 ** attempt);
    }
  }
}

module.exports={version,withWriteLock,replaceConfigFile};
