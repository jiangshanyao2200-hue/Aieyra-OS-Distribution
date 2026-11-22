// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: path; regularSize; downloadArtifact
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/managed-update-download.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';

const path = require('node:path');
const {diskFS: fs, fileHash, requireSpace} = require('./managed-update-files.cjs');

function regularSize(file) {
  const stat = fs.lstatSync(file, {throwIfNoEntry: false});
  if (!stat) return 0;
  if (!stat.isFile() || stat.nlink !== 1) throw Error('下载缓存必须是普通文件');
  return stat.size;
}

async function downloadArtifact(artifact, dest, request, active, progress) {
  if (!artifact || !/^[a-zA-Z0-9._-]{1,180}$/.test(artifact.name) || !/^[a-f0-9]{64}$/.test(artifact.sha256) ||
      !Number.isSafeInteger(artifact.size) || artifact.size < 1 || artifact.size > 2**31) throw Error('下载清单无效');
  const {size, sha256} = artifact;
  if (regularSize(dest) === size && fileHash(dest) === sha256) return;
  const temp = dest + '.' + sha256 + '.part';
  let received = regularSize(temp);
  if (received === size && fileHash(temp) === sha256) {
    active();
    fs.renameSync(temp, dest);
    return;
  }
  if (received >= size) { fs.unlinkSync(temp); received = 0; }
  const etag = '"' + sha256 + '"';
  requireSpace(path.dirname(dest), size - received);
  const response = await request(received ? {range: 'bytes=' + received + '-', 'if-range': etag} : {});
  const headers = response.headers;
  try {
    active();
    if (response.status === 206) {
      if (!received || headers.get('etag') !== etag || headers.get('content-range') !==
          'bytes ' + received + '-' + (size - 1) + '/' + size) throw Error('续传范围与签名文件不一致');
    } else if (response.status === 200) {
      received = 0;
    } else {
      throw Error('官网下载失败（' + response.status + '）');
    }
    if ((headers.has('content-length') && headers.get('content-length') !== String(size - received)) ||
        (headers.has('etag') && headers.get('etag') !== etag)) throw Error('下载响应与签名文件不一致');
    const fd = fs.openSync(temp, received ? 'a' : 'w', 0o600);
    try {
      progress(received, size);
      for await (const chunk of response.body) {
        active();
        if (received + chunk.length > size) throw Error('下载超过签名大小');
        for (let at = 0; at < chunk.length;) at += fs.writeSync(fd,chunk,at,chunk.length-at);
        received += chunk.length;
        progress(received, size);
      }
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
  } finally { await response.body?.cancel().catch(()=>{}); }
  active();
  if (received !== size) throw Error('下载中断，重试将继续下载');
  if (fileHash(temp) !== sha256) {
    fs.unlinkSync(temp);
    throw Object.assign(Error('下载摘要不一致'), {code:'artifact_digest'});
  }
  fs.renameSync(temp,dest);
}

module.exports = {downloadArtifact};
