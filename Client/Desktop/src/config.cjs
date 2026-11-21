// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fs; path; crypto; spec; paths; KNOWN_KEYS; mtime; load; pickUnknown; save; saveUnlocked; saveUnlockedOwned; rememberKey; PROMPT_FILES; normalizePrompt; promptStatus
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/config.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// 配置读写：与 Go 端 Core/types.go 的 Load / Save 语义一致。
//
// 两个要点：
//   1. 原子写（先写临时文件再改名），避免写到一半被主程序读到半个文件。
//   2. 保留未知字段——主程序或手写配置里可能有本界面不认识的键，
//      保存时不能把它们抹掉。这就是 UI 只负责已知字段的原因。

'use strict';
const {version,withWriteLock,replaceConfigFile}=require('../../../Core/platform/config-file.cjs');


const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isUtf8 } = require('node:buffer');

const spec = require('./spec.cjs');
const paths = require('./paths.cjs');

/** 本界面负责的字段名集合。 */
const KNOWN_KEYS = new Set(Object.keys(spec.defaults()));

/** 读取文件修改时间；不存在返回 0。 */
function mtime(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * 读取配置。
 *
 * 文件不存在不算错误：返回出厂配置，让用户从零开始填。
 * 文件损坏会抛出，因为静默用默认值覆盖用户配置是更糟的结果。
 */
function load(configPath) {
  const file = configPath || paths.resolveConfigPath('');
  paths.profile(file);
  const base = spec.defaults();

  let raw = {};
  let exists = false;
  let revision = 'missing';
  if (fs.existsSync(file)) {
    exists = true;
    const text = fs.readFileSync(file, 'utf8');
    revision = crypto.createHash('sha256').update(text).digest('hex');
    try {
      raw = JSON.parse(text);
    } catch (err) {
      throw new Error('配置文件解析失败 ' + file + '：' + err.message + '。为避免覆盖原内容，已禁止保存。');
    }
  }

  // 默认值 → 磁盘值：磁盘上有什么用什么，缺的用默认补。
  const merged = { ...base, ...raw };
  // JSON 里可能有 null，统一当作"未设置"处理，避免污染数值字段。
  for (const k of Object.keys(merged)) {
    if (merged[k] === null) merged[k] = base[k];
  }
  spec.sanitize(merged);

  return {
    file,
    exists,
    version: revision,
    settings: merged,
    /** 磁盘上不属于本界面的字段，保存时原样保留。 */
    unknown: pickUnknown(raw),
    mtime: mtime(file),
  };
}

function pickUnknown(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw || {})) {
    if (!KNOWN_KEYS.has(k)) out[k] = v;
  }
  return out;
}

/**
 * 原子保存。
 *
 * 先与磁盘现状合并未知字段，再写临时文件、改名覆盖。
 * 这样即使主程序在 2 秒轮询的窗口里读到文件，也只会读到完整内容。
 */

function save(configPath, settings, expected) {
  const file = configPath || paths.resolveConfigPath('');
  paths.profile(file);
  const release=require('../../../Contracts/storage/profile.cjs').enter(file);
  try { return withWriteLock(file, expected, () => saveUnlocked(file, settings)); } finally { release(); }
}

function saveUnlocked(configPath, settings) {
  const file = configPath || paths.resolveConfigPath('');
  const release=require('../../../Contracts/storage/profile.cjs').enter(file);
  try { return saveUnlockedOwned(file, settings); } finally { release(); }
}

function saveUnlockedOwned(configPath, settings) {
  const file = configPath || paths.resolveConfigPath('');
  paths.profile(file);
  // 与 load 对称：先以出厂默认值为底，再盖调用方传来的值。
  // 否则残缺 payload（缺键）会直接丢键——今天渲染层恒发全量所以没爆，
  // 但任何未来调用方发残缺对象即造成配置键永久丢失（S2）。
  const s = spec.sanitize({ ...spec.defaults(), ...settings });

  let unknown = {}, previous = 'missing';
  if (fs.existsSync(file)) {
    let existing;
    try {
      const text = fs.readFileSync(file, 'utf8');
      previous = crypto.createHash('sha256').update(text).digest('hex');
      existing = JSON.parse(text);
    } catch (err) {
      throw new Error('配置文件解析失败 ' + file + '：' + err.message + '。为避免覆盖原内容，已禁止保存。');
    }
    unknown = pickUnknown(existing);
  }

  // 只落盘已知字段，避免把界面内部状态（如 __resolvedPromptDir）写进去。
  const out = {};
  for (const k of Object.keys(spec.defaults())) {
    if (Object.prototype.hasOwnProperty.call(s, k)) out[k] = s[k];
  }
  out.api_key_history = Array.isArray(s.api_key_history) ? s.api_key_history : [];
  const payload = { ...unknown, ...out };

  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  // Each save owns a new exclusive temporary file; stale files are never reused
  // or removed on another writer's behalf. Failure cleans only this save's file.
  const tmp = `${file}.tmp.${process.pid}.${crypto.randomUUID()}`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    replaceConfigFile(tmp, file, previous);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* 忽略 */ }
    throw err;
  }

  return { file, mtime: mtime(file), version:version(file), settings: spec.sanitize({ ...out }) };
}

/** 把新 Key 记入历史（最近 8 个去重）。与 Go 端 RememberKey 一致。 */
function rememberKey(settings, key) {
  const k = String(key || '').trim();
  if (!k || k.length > 512) return settings.api_key_history || [];
  const hist = Array.isArray(settings.api_key_history) ? settings.api_key_history.slice() : [];
  // 过滤空串/超长脏数据/非字符串，再截断到 8 条（G4：超大数组可直接落盘）。
  const clean = hist.filter((x) => typeof x === 'string' && x.trim() !== '' && x.length <= 512);
  const next = [k, ...clean.filter((x) => x !== k)].slice(0, 8);
  return next;
}

/**
 * 提示词各层状态。与 Go 端 Core/prompt.go 的文件名和顺序一致。
 *
 * 这里**只读不写**：不创建目录、不创建缺失的层、更不改动已有文件。
 * 提示词是用户的创作，程序永远没有理由去动它——Go 端也一样
 * （prompt.go 只 Stat/ReadFile，全文没有 MkdirAll）。
 * 早先版本里有个 ensurePromptDir 会建三个空文件，它既没人调用，又和这条
 * 约定相冲，已经删掉；缺层就在界面上如实显示为空层。
 */
const PROMPT_FILES = [
  { id: 'self', file: '自我.txt', title: '人格与沟通' },
  { id: 'work', file: '工作.txt', title: '执行与工作' },
  { id: 'boundary', file: '边界.txt', title: '安全与边界' },
  { id: 'thinking', file: '思考方式.txt', title: '思考方式' },
];

/** 去掉文件头的 <!-- --> 说明块并整理空白。与 Go 端 NormalizePrompt 一致。 */
function normalizePrompt(raw) {
  let s = String(raw).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  while (s.startsWith('<!--')) {
    const end = s.indexOf('-->');
    if (end < 0) break;
    s = s.slice(end + 3).trim();
  }
  return s;
}

/** 读取提示词各层的装载情况。 */
function promptStatus(explicitDir, defaultsDir) {
  const dir = paths.resolvePromptDir(explicitDir);
  const read = file => {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 256 * 1024) throw Error('提示词必须是最多 256 KiB 的普通 UTF-8 文件');
    const bytes = fs.readFileSync(file);
    if (bytes.length > 256 * 1024 || !isUtf8(bytes)) throw Error('提示词过大或不是 UTF-8');
    return bytes.toString('utf8');
  };
  const layers = PROMPT_FILES.map((l) => {
    let file = path.join(dir, l.file), source = 'custom';
    let body = '';
    let error = '';
    try {
      let raw;
      try { raw = read(file); }
      catch (err) {
        if (err.code !== 'ENOENT') throw err;
        file = defaultsDir === undefined ? require('./resources.cjs').promptPath('Matrix/默认/'+l.file) : path.join(defaultsDir, l.file); source = 'default';
        raw = read(file);
      }
      body = normalizePrompt(raw);
    } catch (err) {
      // 只有 ENOENT 算“缺失”；权限等错误必须区分显示（G10），
      // 否则用户会去补文件而不是修权限。
      if (err && err.code !== 'ENOENT') error = '读取失败：' + (err.message || err.code);
      if (err?.code === 'ENOENT') source = 'missing';
    }
    return { ...l, path: file, source, empty: body.trim() === '', chars: [...body].length, body, error };
  });
  const filled = layers.filter((l) => !l.empty);
  const text = filled.map((l) => `## ${l.title}\n\n${l.body}`).join('\n\n');
  return { dir, layers, text, chars: [...text].length };
}

module.exports = {
  KNOWN_KEYS,
  PROMPT_FILES,
  load,
  save,
  version,
  withWriteLock,
  mtime,
  rememberKey,
  promptStatus,
  normalizePrompt,
};
