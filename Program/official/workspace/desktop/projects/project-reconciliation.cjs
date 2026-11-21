"use strict";

// Managed-project reconciliation deliberately lives below Electron.  The
// scanner is read-only and the transaction manager only accepts scanner
// snapshots, so a renderer descriptor can never become a write authority.
const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomBytes } = require("node:crypto");
const { atomicWriteJson, commitStage, inspectJson, stageBytes } = require("../core/json-storage.cjs");

const PROJECT_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,179}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MANIFEST_MAX_BYTES = 4 * 1024 * 1024;
const SESSION_MAX_BYTES = 64 * 1024 * 1024;
const SCAN_MAX_DIRECTORIES = 256;
const PROJECT_TREE_MAX_ENTRIES = 100_000;
const MIGRATION_DIRECTORY = "project-migration-transactions";
const JOURNAL_FORMAT = "iiimage-project-migration";
const RECEIPT_FORMAT = "iiimage-project-migration-receipt";
const JOURNAL_VERSION = 1;
const KNOWN_KINDS = new Set(["image", "writing", "data", "finance"]);

class ProjectReconciliationError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "ProjectReconciliationError";
    this.code = code;
  }
}

function fail(code, message, cause) {
  return new ProjectReconciliationError(code, message, cause);
}

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function comparablePath(value) {
  const resolved = path.resolve(String(value || ""));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function samePath(left, right) {
  return comparablePath(left) === comparablePath(right);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function shortText(value, fallback) {
  const text = typeof value === "string" ? value.trim().replace(/[\u0000-\u001f\u007f]/g, " ") : "";
  return (text || fallback).slice(0, 160);
}

function safeExistingDirectory(input, label) {
  const target = path.resolve(input);
  let info;
  try { info = fs.lstatSync(target); } catch (error) { throw fail("AIEYRA_PROJECT_RECONCILIATION_PATH_UNSAFE", `${label}不存在或不可访问。`, error); }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw fail("AIEYRA_PROJECT_RECONCILIATION_PATH_UNSAFE", `${label}不是可信普通目录。`);
  }
  const realPath = fs.realpathSync(target);
  return { path: target, realPath };
}

function safeDirectoryChild(parent, child, label) {
  const expected = path.join(parent.path, child);
  const info = fs.lstatSync(expected);
  if (!info.isDirectory() || info.isSymbolicLink()) throw fail("AIEYRA_PROJECT_RECONCILIATION_PATH_UNSAFE", `${label}不是可信实体目录。`);
  const realPath = fs.realpathSync(expected);
  if (comparablePath(path.dirname(realPath)) !== comparablePath(parent.realPath)) {
    throw fail("AIEYRA_PROJECT_RECONCILIATION_PATH_UNSAFE", `${label} realpath 越出 managed root。`);
  }
  return { path: expected, realPath, info };
}

function safeFile(filePath, expectedParentRealPath, maxBytes, label) {
  let info;
  try { info = fs.lstatSync(filePath); } catch (error) { throw fail("AIEYRA_PROJECT_RECONCILIATION_FILE_INVALID", `${label}缺失。`, error); }
  if (!info.isFile() || info.isSymbolicLink() || Number(info.nlink) !== 1 || info.size < 1 || info.size > maxBytes) {
    throw fail("AIEYRA_PROJECT_RECONCILIATION_FILE_INVALID", `${label}不是可信普通文件或大小无效。`);
  }
  const realPath = fs.realpathSync(filePath);
  if (comparablePath(path.dirname(realPath)) !== comparablePath(expectedParentRealPath)) {
    throw fail("AIEYRA_PROJECT_RECONCILIATION_PATH_UNSAFE", `${label} realpath 越出预期目录。`);
  }
  const raw = fs.readFileSync(filePath);
  if (raw.length !== info.size) throw fail("AIEYRA_PROJECT_RECONCILIATION_TOCTOU", `${label}读取时大小发生变化。`);
  return { path: filePath, realPath, raw, sha256: hash(raw), byteLength: raw.length };
}

function parseJsonFile(filePath, expectedParentRealPath, maxBytes, label) {
  const snapshot = safeFile(filePath, expectedParentRealPath, maxBytes, label);
  let value;
  try { value = JSON.parse(snapshot.raw.toString("utf8")); } catch (error) { throw fail("AIEYRA_PROJECT_RECONCILIATION_CORRUPT", `${label}不是有效 JSON。`, error); }
  if (!isPlainObject(value)) throw fail("AIEYRA_PROJECT_RECONCILIATION_CORRUPT", `${label}根对象无效。`);
  return { ...snapshot, value };
}

function isRealPathInside(child, parent) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

// The root scan deliberately does not recurse into unknown project roots for
// discovery.  Once a first-level directory is being assessed, this bounded
// metadata walk proves there is no hidden link/reparse/hardlink in the owned
// tree before advertising its aggregate size to UI or migration code.
function projectTreeSummary(rootEntry) {
  let fileCount = 0;
  let byteLength = 0;
  let entryCount = 0;
  const stack = [rootEntry.path];
  while (stack.length) {
    const directory = stack.pop();
    const directoryInfo = fs.lstatSync(directory);
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
      throw fail("AIEYRA_PROJECT_RECONCILIATION_PATH_UNSAFE", "项目树包含符号链接、junction 或非目录实体。");
    }
    const realDirectory = fs.realpathSync(directory);
    if (!isRealPathInside(realDirectory, rootEntry.realPath)) {
      throw fail("AIEYRA_PROJECT_RECONCILIATION_PATH_UNSAFE", "项目树目录 realpath 越出项目根目录。");
    }
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      entryCount += 1;
      if (entryCount > PROJECT_TREE_MAX_ENTRIES) throw fail("AIEYRA_PROJECT_RECONCILIATION_SCAN_LIMIT", "项目目录文件数量超过安全上限。");
      const filePath = path.join(directory, entry.name);
      const info = fs.lstatSync(filePath);
      if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) {
        throw fail("AIEYRA_PROJECT_RECONCILIATION_PATH_UNSAFE", "项目树包含不受支持的链接或特殊实体。");
      }
      const realPath = fs.realpathSync(filePath);
      if (!isRealPathInside(realPath, rootEntry.realPath)) {
        throw fail("AIEYRA_PROJECT_RECONCILIATION_PATH_UNSAFE", "项目树文件 realpath 越出项目根目录。");
      }
      if (info.isDirectory()) {
        stack.push(filePath);
      } else {
        if (Number(info.nlink) !== 1) throw fail("AIEYRA_PROJECT_RECONCILIATION_FILE_INVALID", "项目树包含硬链接文件。");
        fileCount += 1;
        byteLength += Math.max(0, Number(info.size) || 0);
      }
    }
  }
  return { fileCount, byteLength };
}

function rendererDescriptor(value) {
  return Object.freeze({
    id: value.id,
    name: value.name,
    kind: value.kind,
    status: value.status,
    selectable: value.status === "recoverable",
    fileCount: value.fileCount,
    byteLength: value.byteLength,
    risk: Object.freeze([...value.risk])
  });
}

function descriptor(id, status, risk, options = {}) {
  return {
    id: shortText(id, "unknown"),
    name: shortText(options.name, shortText(id, "未命名项目")),
    kind: shortText(options.kind, "image"),
    status,
    fileCount: Math.max(0, Number(options.fileCount) || 0),
    byteLength: Math.max(0, Number(options.byteLength) || 0),
    risk: Array.isArray(risk) ? risk : [String(risk || "unknown")]
  };
}

function managedProjectList(projectList) {
  return Array.isArray(projectList?.projects) ? projectList.projects.filter((item) => isPlainObject(item) && !item.external) : [];
}

function listSnapshot(options) {
  if (options.projectListPath) {
    const listPath = path.resolve(options.projectListPath);
    const directory = safeExistingDirectory(path.dirname(listPath), "project-list 父目录");
    const file = parseJsonFile(listPath, directory.realPath, MANIFEST_MAX_BYTES, "project-list");
    if (!Array.isArray(file.value.projects)) throw fail("AIEYRA_PROJECT_RECONCILIATION_CORRUPT", "project-list.projects 必须是数组。");
    return { path: listPath, sha256: file.sha256, byteLength: file.byteLength, value: file.value };
  }
  if (!isPlainObject(options.projectList) || !Array.isArray(options.projectList.projects)) {
    throw fail("AIEYRA_PROJECT_RECONCILIATION_LIST_INVALID", "盘点需要 projectListPath 或合法 projectList。");
  }
  return { path: "", sha256: "", byteLength: 0, value: options.projectList };
}

function candidateFromDirectory(root, entryName, list) {
  const rootEntry = safeDirectoryChild(root, entryName, `项目目录 ${entryName}`);
  const tree = projectTreeSummary(rootEntry);
  const manifestDirectory = safeDirectoryChild(rootEntry, ".iiimage", `项目 ${entryName} 的 .iiimage`);
  const manifest = parseJsonFile(path.join(rootEntry.path, ".iiimage", "project.json"), manifestDirectory.realPath, MANIFEST_MAX_BYTES, "项目 manifest");
  const session = parseJsonFile(path.join(rootEntry.path, "session.json"), rootEntry.realPath, SESSION_MAX_BYTES, "项目 session");
  const project = manifest.value.project;
  if (manifest.value.format !== "iiimage-project" || ![1, 2].includes(Number(manifest.value.version)) || !isPlainObject(project)) {
    throw fail("AIEYRA_PROJECT_RECONCILIATION_CORRUPT", "项目 manifest 格式或 project identity 无效。");
  }
  const manifestId = typeof project.id === "string" ? project.id : "";
  const identityConflict = !PROJECT_ID.test(entryName) || !PROJECT_ID.test(manifestId) || manifestId !== entryName;
  const manifestKind = typeof project.kind === "string" ? project.kind.trim() : "";
  const sessionKind = typeof session.value.projectKind === "string" ? session.value.projectKind.trim() : "";
  if (manifestKind && sessionKind && manifestKind !== sessionKind) {
    throw fail("AIEYRA_PROJECT_RECONCILIATION_CONFLICT", "manifest 与 session project kind 不一致。");
  }
  const kind = manifestKind || sessionKind || "image";
  const name = shortText(project.name, entryName);
  const existing = managedProjectList(list.value).filter((item) => (
    String(item.id || "") === entryName ||
    (typeof item.path === "string" && samePath(item.path, rootEntry.path)) ||
    (typeof item.sessionPath === "string" && samePath(item.sessionPath, session.path))
  ));
  const exactRegistered = existing.length === 1 &&
    String(existing[0].id || "") === entryName &&
    samePath(existing[0].path, rootEntry.path) &&
    samePath(existing[0].sessionPath, session.path) &&
    String(existing[0].kind || "") === kind;
  const conflicts = identityConflict || (existing.length > 0 && !exactRegistered);
  const status = conflicts ? "conflict" : exactRegistered ? "registered" : KNOWN_KINDS.has(kind) ? "recoverable" : "unknown-kind";
  const risk = identityConflict ? ["directory-manifest-identity-conflict"] : conflicts ? ["project-list-identity-conflict"] : exactRegistered ? [] : KNOWN_KINDS.has(kind) ? [] : ["unknown-project-kind"];
  return {
    id: entryName,
    identityId: manifestId || entryName,
    name,
    kind,
    status,
    fileCount: tree.fileCount,
    byteLength: tree.byteLength,
    risk,
    snapshot: Object.freeze({
      id: entryName,
      name,
      kind,
      projectPath: rootEntry.path,
      projectRealPath: rootEntry.realPath,
      fileCount: tree.fileCount,
      byteLength: tree.byteLength,
      manifestPath: manifest.path,
      manifestRealPath: manifest.realPath,
      manifestSha256: manifest.sha256,
      manifestByteLength: manifest.byteLength,
      sessionPath: session.path,
      sessionRealPath: session.realPath,
      sessionSha256: session.sha256,
      sessionByteLength: session.byteLength,
      projectListPath: list.path,
      projectListSha256: list.sha256,
      projectListByteLength: list.byteLength
    })
  };
}

/**
 * Read-only managed-root inventory. `candidates` is renderer-safe; the
 * caller must retain `internalCandidates` in main-process memory only.
 */
function assessManagedProjects(options = {}) {
  const { isArchivedProject } = require("./project-lifecycle.cjs");
  const root = safeExistingDirectory(options.projectsDir, "managed projects 目录");
  const list = listSnapshot(options);
  const entries = fs.readdirSync(root.path, { withFileTypes: true });
  const directoryEntries = entries.filter((entry) => entry.isDirectory() || entry.isSymbolicLink()).sort((a, b) => a.name.localeCompare(b.name));
  const results = [];
  if (directoryEntries.length > Math.min(SCAN_MAX_DIRECTORIES, Number(options.maxDirectories) || SCAN_MAX_DIRECTORIES)) {
    throw fail("AIEYRA_PROJECT_RECONCILIATION_SCAN_LIMIT", "managed projects 一级目录数量超过安全上限。");
  }
  for (const entry of directoryEntries) {
    if (entry.name.startsWith(".aieyra-deleted-") || isArchivedProject(path.join(root.path, entry.name))) continue;
    if (entry.isSymbolicLink()) {
      results.push(descriptor(entry.name, "unsafe", ["symbolic-link-or-junction"], { name: entry.name }));
      continue;
    }
    try {
      results.push(candidateFromDirectory(root, entry.name, list));
    } catch (error) {
      const code = String(error?.code || "");
      const status = code.includes("PATH_UNSAFE") || code.includes("FILE_INVALID") ? "unsafe" : code.includes("CONFLICT") ? "conflict" : "corrupt";
      results.push(descriptor(entry.name, status, [code || "invalid-managed-project"], { name: entry.name }));
    }
  }
  // A duplicated manifest identity invalidates *every* directory claiming it;
  // do not leave the first directory selectable merely because it sorted first.
  const identityCounts = new Map();
  for (const item of results) {
    const identity = String(item.identityId || item.id || "");
    identityCounts.set(identity, (identityCounts.get(identity) || 0) + 1);
  }
  for (const item of results) {
    if ((identityCounts.get(String(item.identityId || item.id || "")) || 0) > 1) {
      item.status = "conflict";
      item.risk = [...new Set([...item.risk, "duplicate-project-identity"])];
      delete item.snapshot;
    }
  }
  // Index records which now point at no first-level managed directory are
  // visible as conflicts.  They are never candidates for automatic recovery.
  const seenIds = new Set(results.filter((item) => item.id).map((item) => item.id));
  for (const item of managedProjectList(list.value)) {
    const id = String(item.id || "");
    if (id && !seenIds.has(id)) results.push(descriptor(id, "conflict", ["project-list-missing-directory"], { name: item.name, kind: item.kind }));
  }
  const counts = Object.fromEntries(["registered", "recoverable", "unknown-kind", "conflict", "corrupt", "unsafe"].map((key) => [key, 0]));
  for (const item of results) counts[item.status] = (counts[item.status] || 0) + 1;
  const internalCandidates = results
    .filter((item) => item.status === "recoverable" && item.snapshot)
    .map((item) => item.snapshot);
  return Object.freeze({
    summary: Object.freeze({ ...counts, total: results.length }),
    candidates: Object.freeze(results.map(rendererDescriptor)),
    internalCandidates: Object.freeze(internalCandidates)
  });
}

function safeMigrationDirectory(configDir) {
  const config = path.resolve(configDir);
  if (!fs.existsSync(config)) fs.mkdirSync(config, { recursive: true });
  const trustedConfig = safeExistingDirectory(config, "迁移配置目录");
  const directory = path.join(trustedConfig.path, MIGRATION_DIRECTORY);
  if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: false });
  const trustedDirectory = safeExistingDirectory(directory, "迁移事务目录");
  if (comparablePath(path.dirname(trustedDirectory.realPath)) !== comparablePath(trustedConfig.realPath)) {
    throw fail("AIEYRA_PROJECT_RECONCILIATION_PATH_UNSAFE", "迁移事务目录 realpath 越出配置目录。");
  }
  return { config: trustedConfig, directory: trustedDirectory };
}

function transactionId() {
  return `${Date.now()}-${randomBytes(10).toString("hex")}`;
}

function transactionPaths(directory, id) {
  return {
    journal: path.join(directory.path, `migration-${id}.json`),
    receipt: path.join(directory.path, `migration-${id}.receipt.json`),
    manifestPre: path.join(directory.path, `migration-${id}.manifest.pre.json`),
    sessionPre: path.join(directory.path, `migration-${id}.session.pre.json`),
    projectListPre: path.join(directory.path, `migration-${id}.project-list.pre.json`)
  };
}

function safeRelative(configRealPath, absolutePath) {
  const relative = path.relative(configRealPath, absolutePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw fail("AIEYRA_PROJECT_RECONCILIATION_PATH_UNSAFE", "事务目标不在配置目录中。");
  return relative.split(path.sep).join("/");
}

function readCurrentSnapshot(filePath, parentRealPath, maxBytes, label) {
  const file = safeFile(filePath, parentRealPath, maxBytes, label);
  return Object.freeze({ path: file.path, sha256: file.sha256, byteLength: file.byteLength, raw: file.raw });
}

function expectSnapshot(filePath, parentRealPath, expected, maxBytes, label) {
  const current = readCurrentSnapshot(filePath, parentRealPath, maxBytes, label);
  if (current.sha256 !== expected.sha256 || (expected.byteLength !== undefined && current.byteLength !== expected.byteLength)) {
    throw fail("AIEYRA_PROJECT_RECONCILIATION_TOCTOU", `${label}在确认后发生变化。`);
  }
  return current;
}

function writeExactNew(filePath, bytes) {
  const staged = stageBytes(filePath, bytes);
  return commitStage(staged, { expectedInputSha256: null });
}

function replaceExactBytes(filePath, bytes, expectedInputSha256) {
  const staged = stageBytes(filePath, bytes);
  return commitStage(staged, { expectedInputSha256 });
}

function journalFile(directory, filePath, label) {
  return parseJsonFile(filePath, directory.realPath, 2 * 1024 * 1024, label);
}

function validateJournal(value) {
  if (!isPlainObject(value) || value.format !== JOURNAL_FORMAT || value.version !== JOURNAL_VERSION ||
      !["prepared", "committed", "rollingback", "rolledback"].includes(value.state) ||
      typeof value.transactionId !== "string" || !/^\d+-[a-f0-9]{20}$/.test(value.transactionId) ||
      !isPlainObject(value.project) || !PROJECT_ID.test(value.project.id) || !KNOWN_KINDS.has(value.project.kind) ||
      !Array.isArray(value.files) || value.files.length !== 3) {
    throw fail("AIEYRA_PROJECT_RECONCILIATION_JOURNAL_INVALID", "迁移 journal 格式无效。");
  }
  const required = new Set(["session", "manifest", "project-list"]);
  for (const file of value.files) {
    if (!isPlainObject(file) || !required.delete(file.key) || typeof file.relativePath !== "string" ||
        !isPlainObject(file.pre) || !isPlainObject(file.post) || !SHA256.test(file.pre.sha256 || "") ||
        !SHA256.test(file.post.sha256 || "") || !Number.isSafeInteger(file.pre.byteLength) || file.pre.byteLength < 1 ||
        !Number.isSafeInteger(file.post.byteLength) || file.post.byteLength < 1 || typeof file.preBackup !== "string") {
      throw fail("AIEYRA_PROJECT_RECONCILIATION_JOURNAL_INVALID", "迁移 journal 文件记录无效。");
    }
  }
  if (required.size) throw fail("AIEYRA_PROJECT_RECONCILIATION_JOURNAL_INVALID", "迁移 journal 缺少目标文件。");
  return value;
}

function receiptFor(journal) {
  return {
    format: RECEIPT_FORMAT,
    version: JOURNAL_VERSION,
    state: "committed",
    transactionId: journal.transactionId,
    project: journal.project,
    createdAt: journal.createdAt,
    committedAt: new Date().toISOString(),
    files: journal.files.map((file) => ({
      key: file.key,
      relativePath: file.relativePath,
      pre: { sha256: file.pre.sha256, byteLength: file.pre.byteLength },
      post: { sha256: file.post.sha256, byteLength: file.post.byteLength }
    }))
  };
}


function createProjectMigrationTransactionManager(options = {}) {
  const configDir = path.resolve(options.configDir || "");
  const projectsDir = path.resolve(options.projectsDir || path.join(configDir, "projects"));
  const projectListPath = path.resolve(options.projectListPath || path.join(configDir, "project-list.json"));
  if (!configDir || !options.configDir) throw fail("AIEYRA_PROJECT_RECONCILIATION_OPTIONS_INVALID", "迁移事务需要 configDir。");

  function context() {
    const config = safeMigrationDirectory(configDir);
    const projects = safeExistingDirectory(projectsDir, "managed projects 目录");
    const listParent = safeExistingDirectory(path.dirname(projectListPath), "project-list 父目录");
    if (comparablePath(listParent.realPath) !== comparablePath(config.config.realPath)) {
      throw fail("AIEYRA_PROJECT_RECONCILIATION_PATH_UNSAFE", "project-list 必须位于同一配置根目录。");
    }
    return { ...config, projects, listParent };
  }

  function resolveJournal(ctx, id) {
    if (typeof id !== "string" || !/^\d+-[a-f0-9]{20}$/.test(id)) throw fail("AIEYRA_PROJECT_RECONCILIATION_JOURNAL_INVALID", "迁移事务 ID 无效。");
    const paths = transactionPaths(ctx.directory, id);
    const journal = journalFile(ctx.directory, paths.journal, "迁移 journal");
    const value = validateJournal(journal.value);
    if (value.transactionId !== id) throw fail("AIEYRA_PROJECT_RECONCILIATION_JOURNAL_INVALID", "journal ID 与文件名不匹配。");
    return { paths, snapshot: journal, value };
  }

  function targetFor(ctx, journal, file) {
    const resolved = file.key === "project-list" ? projectListPath : file.key === "session" ?
      path.join(ctx.projects.path, journal.project.id, "session.json") :
      path.join(ctx.projects.path, journal.project.id, ".iiimage", "project.json");
    const expectedRelative = file.relativePath.startsWith("@projects/")
      ? `@projects/${safeRelative(ctx.projects.realPath, resolved)}`
      : safeRelative(ctx.config.realPath, resolved);
    if (file.relativePath !== expectedRelative) throw fail("AIEYRA_PROJECT_RECONCILIATION_JOURNAL_INVALID", "journal 相对路径与事务身份不一致。");
    const parent = safeExistingDirectory(path.dirname(resolved), `迁移 ${file.key} 父目录`);
    return { path: resolved, parentRealPath: parent.realPath, maxBytes: file.key === "session" ? SESSION_MAX_BYTES : MANIFEST_MAX_BYTES };
  }

  function backupBytes(ctx, transactionPath, file) {
    const backupPath = path.join(ctx.directory.path, file.preBackup);
    if (path.basename(backupPath) !== file.preBackup || !file.preBackup.endsWith(".pre.json")) {
      throw fail("AIEYRA_PROJECT_RECONCILIATION_JOURNAL_INVALID", "pre-image 备份路径无效。");
    }
    const backup = safeFile(backupPath, ctx.directory.realPath, file.pre.byteLength, `迁移 ${file.key} pre-image`);
    if (backup.sha256 !== file.pre.sha256 || backup.byteLength !== file.pre.byteLength) {
      throw fail("AIEYRA_PROJECT_RECONCILIATION_JOURNAL_INVALID", "pre-image 备份 SHA-256 不匹配。");
    }
    return backup.raw;
  }

  function currentState(ctx, journal) {
    const states = [];
    for (const file of journal.files) {
      const target = targetFor(ctx, journal, file);
      const current = readCurrentSnapshot(target.path, target.parentRealPath, target.maxBytes, `迁移 ${file.key}`);
      const state = current.sha256 === file.pre.sha256 && current.byteLength === file.pre.byteLength ? "pre" :
        current.sha256 === file.post.sha256 && current.byteLength === file.post.byteLength ? "post" : "unknown";
      states.push({ file, target, current, state });
    }
    return states;
  }

  function transition(ctx, resolved, state) {
    const next = { ...resolved.value, state };
    const receipt = atomicWriteJson(resolved.paths.journal, next, { expectedInputSha256: resolved.snapshot.sha256 });
    return { ...resolved, snapshot: { ...resolved.snapshot, sha256: receipt.outputSha256 }, value: next };
  }

  function ensureReceipt(ctx, resolved) {
    const receiptPath = resolved.paths.receipt;
    if (fs.existsSync(receiptPath)) {
      const receipt = journalFile(ctx.directory, receiptPath, "迁移 receipt");
      if (receipt.value?.format !== RECEIPT_FORMAT || receipt.value?.transactionId !== resolved.value.transactionId || receipt.value?.state !== "committed") {
        throw fail("AIEYRA_PROJECT_RECONCILIATION_RECEIPT_INVALID", "迁移 receipt 与 journal 不一致。");
      }
      return receipt.value;
    }
    const value = receiptFor(resolved.value);
    atomicWriteJson(receiptPath, value, { expectedInputSha256: null });
    return value;
  }

  function migrate(candidate, migrationOptions = {}) {
    const ctx = context();
    if (!candidate || candidate.status === "unknown-kind" || !PROJECT_ID.test(String(candidate.id || "")) || !KNOWN_KINDS.has(candidate.kind)) {
      throw fail("AIEYRA_PROJECT_RECONCILIATION_CANDIDATE_INVALID", "只能迁移可信的 recoverable candidate。");
    }
    const projectDir = safeDirectoryChild(ctx.projects, candidate.id, `候选项目 ${candidate.id}`);
    if (!samePath(candidate.projectPath, projectDir.path) || !samePath(candidate.projectRealPath, projectDir.realPath) || candidate.projectListPath !== projectListPath) {
      throw fail("AIEYRA_PROJECT_RECONCILIATION_TOCTOU", "候选项目身份或 project-list 路径已变化。");
    }
    const metadata = safeDirectoryChild(projectDir, ".iiimage", "候选项目 .iiimage");
    const manifest = expectSnapshot(path.join(projectDir.path, ".iiimage", "project.json"), metadata.realPath, { sha256: candidate.manifestSha256, byteLength: candidate.manifestByteLength }, MANIFEST_MAX_BYTES, "候选 manifest");
    const session = expectSnapshot(path.join(projectDir.path, "session.json"), projectDir.realPath, { sha256: candidate.sessionSha256, byteLength: candidate.sessionByteLength }, SESSION_MAX_BYTES, "候选 session");
    const list = expectSnapshot(projectListPath, ctx.listParent.realPath, { sha256: candidate.projectListSha256, byteLength: candidate.projectListByteLength }, MANIFEST_MAX_BYTES, "project-list");
    if (candidate.projectListSha256 !== list.sha256) throw fail("AIEYRA_PROJECT_RECONCILIATION_TOCTOU", "project-list revision 已变化。");
    let manifestValue, sessionValue, listValue;
    try { manifestValue = JSON.parse(manifest.raw.toString("utf8")); sessionValue = JSON.parse(session.raw.toString("utf8")); listValue = JSON.parse(list.raw.toString("utf8")); } catch (error) { throw fail("AIEYRA_PROJECT_RECONCILIATION_CORRUPT", "确认后的 JSON 解析失败。", error); }
    if (!isPlainObject(manifestValue) || !isPlainObject(manifestValue.project) || manifestValue.project.id !== candidate.id || !isPlainObject(sessionValue) || !isPlainObject(listValue) || !Array.isArray(listValue.projects)) {
      throw fail("AIEYRA_PROJECT_RECONCILIATION_TOCTOU", "候选 JSON identity 在确认后失效。");
    }
    const conflicting = managedProjectList(listValue).some((item) => String(item.id || "") === candidate.id ||
      (typeof item.path === "string" && samePath(item.path, projectDir.path)) ||
      (typeof item.sessionPath === "string" && samePath(item.sessionPath, session.path)));
    if (conflicting) throw fail("AIEYRA_PROJECT_RECONCILIATION_CONFLICT", "project-list 已存在冲突项目身份。");
    const now = typeof migrationOptions.now === "string" && Number.isFinite(Date.parse(migrationOptions.now)) ? migrationOptions.now : new Date().toISOString();
    const targetProjectSchemaVersion = Number.isSafeInteger(migrationOptions.targetProjectSchemaVersion) && migrationOptions.targetProjectSchemaVersion > 0
      ? migrationOptions.targetProjectSchemaVersion : 4;
    const targetSessionSchemaVersion = Number.isSafeInteger(migrationOptions.targetSessionSchemaVersion) && migrationOptions.targetSessionSchemaVersion > 0
      ? migrationOptions.targetSessionSchemaVersion : 3;
    const record = { schemaVersion: targetProjectSchemaVersion, id: candidate.id, name: shortText(candidate.name, candidate.id), kind: candidate.kind, path: projectDir.path, sessionPath: session.path, createdAt: manifestValue.project.createdAt || now, updatedAt: now, external: false };
    const postSession = { ...sessionValue, schemaVersion: targetSessionSchemaVersion, projectKind: candidate.kind };
    const postManifest = {
      ...manifestValue,
      format: "iiimage-project",
      version: 2,
      updatedAt: now,
      project: { ...manifestValue.project, schemaVersion: targetProjectSchemaVersion, id: candidate.id, name: record.name, kind: candidate.kind, createdAt: record.createdAt, updatedAt: now }
    };
    const postList = { ...listValue, projects: [...listValue.projects, record] };
    const id = transactionId();
    const paths = transactionPaths(ctx.directory, id);
    const files = [
      { key: "session", target: session, post: postSession, preBackup: path.basename(paths.sessionPre) },
      { key: "manifest", target: manifest, post: postManifest, preBackup: path.basename(paths.manifestPre) },
      { key: "project-list", target: list, post: postList, preBackup: path.basename(paths.projectListPre) }
    ].map((file) => ({
      key: file.key,
      relativePath: file.key !== "project-list" && path.relative(ctx.config.realPath, file.target.path).startsWith("..")
        ? `@projects/${safeRelative(ctx.projects.realPath, file.target.path)}`
        : file.key !== "project-list" && path.isAbsolute(path.relative(ctx.config.realPath, file.target.path))
          ? `@projects/${safeRelative(ctx.projects.realPath, file.target.path)}`
          : safeRelative(ctx.config.realPath, file.target.path),
      pre: { sha256: file.target.sha256, byteLength: file.target.byteLength },
      post: { sha256: hash(canonicalBytes(file.post)), byteLength: canonicalBytes(file.post).length },
      preBackup: file.preBackup
    }));
    for (const file of files) {
      const source = file.key === "session" ? session : file.key === "manifest" ? manifest : list;
      writeExactNew(path.join(ctx.directory.path, file.preBackup), source.raw);
    }
    const journal = { format: JOURNAL_FORMAT, version: JOURNAL_VERSION, state: "prepared", transactionId: id, project: { id: candidate.id, kind: candidate.kind }, createdAt: now, files };
    atomicWriteJson(paths.journal, journal, { expectedInputSha256: null });
    if (typeof migrationOptions.checkpoint === "function") migrationOptions.checkpoint("after-journal", { transactionId: id });
    const ordered = [["session", postSession], ["manifest", postManifest], ["project-list", postList]];
    for (const [key, value] of ordered) {
      const file = files.find((item) => item.key === key);
      const target = targetFor(ctx, journal, file);
      // Recheck trusted parent and exact pre image at every commit boundary.
      expectSnapshot(target.path, target.parentRealPath, file.pre, target.maxBytes, `迁移 ${key}`);
      atomicWriteJson(target.path, value, { expectedInputSha256: file.pre.sha256 });
      if (typeof migrationOptions.checkpoint === "function") migrationOptions.checkpoint(`after-${key}`, { transactionId: id });
    }
    const resolved = resolveJournal(ctx, id);
    const committed = transition(ctx, resolved, "committed");
    if (typeof migrationOptions.checkpoint === "function") migrationOptions.checkpoint("after-commit-before-receipt", { transactionId: id });
    const receipt = ensureReceipt(ctx, committed);
    return Object.freeze({ transactionId: id, record: Object.freeze(record), receipt: Object.freeze(receipt) });
  }

  function recover() {
    const ctx = context();
    const names = fs.readdirSync(ctx.directory.path).filter((name) => /^migration-\d+-[a-f0-9]{20}\.json$/.test(name)).sort();
    const resolvedJournals = names.map((name) => {
      const id = /^migration-(\d+-[a-f0-9]{20})\.json$/.exec(name)[1];
      return resolveJournal(ctx, id);
    });
    const targetOwners = new Map();
    for (const resolved of resolvedJournals) {
      if (!["prepared", "rollingback"].includes(resolved.value.state)) continue;
      for (const file of resolved.value.files) {
        const target = targetFor(ctx, resolved.value, file);
        const key = comparablePath(target.path);
        if (targetOwners.has(key)) {
          throw fail("AIEYRA_PROJECT_RECONCILIATION_JOURNAL_INVALID", "多个未完成迁移事务声明了同一目标文件，已拒绝自动恢复。");
        }
        targetOwners.set(key, resolved.value.transactionId);
      }
    }

    // Resolve every recovery plan and validate every required pre-image before
    // modifying any target. A later malformed journal must never turn an
    // earlier transaction into a partial recovery side effect.
    const plans = resolvedJournals.map((resolved) => {
      const id = resolved.value.transactionId;
      if (resolved.value.state === "rolledback") return { kind: "skip", id, resolved };
      if (resolved.value.state === "committed") {
        for (const file of resolved.value.files) backupBytes(ctx, resolved.paths, file);
        return { kind: "committed", id, resolved, receiptWasMissing: !fs.existsSync(resolved.paths.receipt) };
      }
      const states = currentState(ctx, resolved.value);
      if (states.some((item) => item.state === "unknown")) {
        const label = resolved.value.state === "rollingback" ? "回滚事务" : "事务";
        throw fail("AIEYRA_PROJECT_RECONCILIATION_RECOVERY_REFUSED", `${label} ${id} 包含未知 SHA，已拒绝恢复。`);
      }
      for (const item of states) backupBytes(ctx, resolved.paths, item.file);
      if (resolved.value.state === "rollingback") return { kind: "restore", id, resolved, states };
      return states.every((item) => item.state === "post")
        ? { kind: "finish-commit", id, resolved, states }
        : { kind: "restore", id, resolved, states };
    });

    const actions = [];
    for (const plan of plans) {
      let { resolved } = plan;
      const { id } = plan;
      if (plan.kind === "skip") continue;
      if (plan.kind === "committed") {
        ensureReceipt(ctx, resolved);
        if (plan.receiptWasMissing) actions.push({ transactionId: id, action: "receipt-restored" });
        continue;
      }
      if (plan.kind === "restore") {
        for (const item of [...plan.states].reverse()) {
          if (item.state === "post") {
            const raw = backupBytes(ctx, resolved.paths, item.file);
            replaceExactBytes(item.target.path, raw, item.file.post.sha256);
          }
        }
        transition(ctx, resolved, "rolledback");
        actions.push({ transactionId: id, action: "restored-pre-image" });
        continue;
      }
      if (plan.kind === "finish-commit") {
        resolved = transition(ctx, resolved, "committed");
        ensureReceipt(ctx, resolved);
        actions.push({ transactionId: id, action: "committed" });
      }
    }
    return Object.freeze({ recovered: actions.length > 0, actions: Object.freeze(actions) });
  }

  function rollback(id, rollbackOptions = {}) {
    const ctx = context();
    let resolved = resolveJournal(ctx, id);
    if (resolved.value.state !== "committed") throw fail("AIEYRA_PROJECT_RECONCILIATION_ROLLBACK_REFUSED", "只能回滚已完成迁移事务。");
    const states = currentState(ctx, resolved.value);
    if (!states.every((item) => item.state === "post")) {
      throw fail("AIEYRA_PROJECT_RECONCILIATION_ROLLBACK_REFUSED", "迁移后文件已被修改，拒绝覆盖用户的新内容。");
    }
    for (const item of states) backupBytes(ctx, resolved.paths, item.file);
    resolved = transition(ctx, resolved, "rollingback");
    if (typeof rollbackOptions.checkpoint === "function") rollbackOptions.checkpoint("after-rollback-journal", { transactionId: id });
    for (const item of [...states].reverse()) {
      const raw = backupBytes(ctx, resolved.paths, item.file);
      replaceExactBytes(item.target.path, raw, item.file.post.sha256);
      if (typeof rollbackOptions.checkpoint === "function") rollbackOptions.checkpoint(`after-rollback-${item.file.key}`, { transactionId: id });
    }
    resolved = transition(ctx, resolved, "rolledback");
    return Object.freeze({ transactionId: id, rolledBack: true, state: resolved.value.state });
  }

  function readReceipt(id) {
    const ctx = context();
    const paths = transactionPaths(ctx.directory, id);
    const receipt = journalFile(ctx.directory, paths.receipt, "迁移 receipt");
    if (receipt.value?.format !== RECEIPT_FORMAT || receipt.value?.transactionId !== id) throw fail("AIEYRA_PROJECT_RECONCILIATION_RECEIPT_INVALID", "迁移 receipt 无效。");
    return Object.freeze(receipt.value);
  }

  // Main-process only API.  Do not bridge this receipt (which intentionally
  // contains relative target names and SHA values) directly to Renderer.
  function listReceipts() {
    // Listing is used by a normal, read-only assessment.  It must not create
    // an empty transaction directory merely because no migration ever ran.
    const uncreatedDirectory = path.join(configDir, MIGRATION_DIRECTORY);
    if (!fs.existsSync(uncreatedDirectory)) return Object.freeze([]);
    const ctx = context();
    const names = fs.readdirSync(ctx.directory.path)
      .filter((name) => /^migration-\d+-[a-f0-9]{20}\.receipt\.json$/.test(name))
      .sort();
    return Object.freeze(names.map((name) => {
      const id = /^migration-(\d+-[a-f0-9]{20})\.receipt\.json$/.exec(name)[1];
      const receipt = readReceipt(id);
      let rollbackAvailable = false;
      try {
        const resolved = resolveJournal(ctx, id);
        rollbackAvailable = resolved.value.state === "committed" && currentState(ctx, resolved.value).every((item) => item.state === "post");
      } catch {
        rollbackAvailable = false;
      }
      return Object.freeze({ transactionId: id, receipt, rollbackAvailable });
    }));
  }

  // A batch is intentionally a sequence of independent transactions.  The
  // next item is freshly assessed after the previous project-list commit, so
  // its project-list SHA snapshot cannot go stale.  A failure stops later
  // items and leaves already receipted successes untouched.
  function migrateMany(candidates, migrationOptions = {}) {
    if (!Array.isArray(candidates) || !candidates.length || candidates.length > 20) {
      throw fail("AIEYRA_PROJECT_RECONCILIATION_BATCH_INVALID", "一次确认只能迁移 1 到 20 个候选项目。");
    }
    const originals = candidates.map((item) => item && typeof item === "object" ? item : null);
    const ids = originals.map((item) => String(item?.id || ""));
    if (originals.some((item) => !item || !PROJECT_ID.test(item.id) || !item.projectRealPath || !SHA256.test(item.manifestSha256 || "") || !SHA256.test(item.sessionSha256 || "")) || new Set(ids).size !== ids.length) {
      throw fail("AIEYRA_PROJECT_RECONCILIATION_BATCH_INVALID", "批量迁移必须使用未暴露给 Renderer 的原始候选快照，且候选 ID 不得重复。");
    }
    const results = [];
    for (const original of [...originals].sort((left, right) => left.id.localeCompare(right.id))) {
      const id = original.id;
      const assessed = assessManagedProjects({ projectsDir, projectListPath });
      const current = assessed.internalCandidates.find((item) => item.id === id);
      if (!current || current.kind !== original.kind || !samePath(current.projectRealPath, original.projectRealPath) ||
          current.manifestSha256 !== original.manifestSha256 || current.manifestByteLength !== original.manifestByteLength ||
          current.sessionSha256 !== original.sessionSha256 || current.sessionByteLength !== original.sessionByteLength) {
        throw fail("AIEYRA_PROJECT_RECONCILIATION_BATCH_STOPPED", `候选项目 ${id} 在确认后发生替换、内容变化或不再可恢复，已停止后续迁移。`);
      }
      results.push(migrate(current, migrationOptions));
    }
    return Object.freeze(results);
  }

  return Object.freeze({
    directory: () => context().directory.path,
    migrate,
    migrateMany,
    recover,
    rollback,
    readReceipt,
    listReceipts
  });
}

module.exports = {
  JOURNAL_FORMAT,
  JOURNAL_VERSION,
  MIGRATION_DIRECTORY,
  ProjectReconciliationError,
  assessManagedProjects,
  createProjectMigrationTransactionManager
};
