// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: path; DEFAULT_MAX_JSON_BYTES; MAX_CONFIGURED_JSON_BYTES; SHA256_PATTERN; TRANSIENT_READ_RETRY_CODES; JsonStorageError; storageFailure; resolveFilePath; sha256Buffer; normalizeMaximumBytes; waitForTransientReadRetry; transientReadError; readDescriptorWithRetry; errorSummary; boundedDescriptorRead; inspectJson; normalizeBytes; invokeCheckpoint; stageBytes; stageJson; stagePaths; existingFileSnapshot; fsyncParentDirectoryBestEffort; commitStage; backupSnapshot; atomicWriteJson; atomicWriteBytesAsync
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/json-storage.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

"use strict";

const {
  closeSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  writeFileSync
} = require("node:fs");
const { createHash, randomBytes } = require("node:crypto");
const path = require("node:path");
const { TextDecoder } = require("node:util");

const DEFAULT_MAX_JSON_BYTES = 64 * 1024 * 1024;
const MAX_CONFIGURED_JSON_BYTES = 512 * 1024 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const TRANSIENT_READ_RETRY_CODES = new Set(["EBUSY", "EPERM", "EACCES", "ETXTBSY"]);

class JsonStorageError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "JsonStorageError";
    this.code = code;
  }
}

function storageFailure(code, message, cause) {
  return new JsonStorageError(code, message, { cause });
}

function resolveFilePath(value, label = "JSON 文件") {
  if (typeof value !== "string" || !value.trim()) {
    throw storageFailure("JSON_STORAGE_PATH_INVALID", `${label}路径不能为空。`);
  }
  return path.resolve(value);
}

function sha256Buffer(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return createHash("sha256").update(buffer).digest("hex");
}

function normalizeMaximumBytes(value) {
  if (value === undefined || value === null || value === "") return DEFAULT_MAX_JSON_BYTES;
  const parsed = Math.floor(Number(value));
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > MAX_CONFIGURED_JSON_BYTES) {
    throw storageFailure(
      "JSON_STORAGE_LIMIT_INVALID",
      `JSON 大小限制必须是 1 到 ${MAX_CONFIGURED_JSON_BYTES} 字节之间的安全整数。`
    );
  }
  return parsed;
}

function waitForTransientReadRetry(attempt) {
  // Chromium can release a profile journal a few milliseconds after the
  // license write completes. Keep the retry bounded and synchronous because
  // JSON storage is deliberately a synchronous, transaction-safe boundary.
  const delayMs = Math.min(160, 20 * (2 ** Math.max(0, attempt)));
  try {
    if (typeof Atomics?.wait === "function") {
      const signal = new Int32Array(new SharedArrayBuffer(4));
      Atomics.wait(signal, 0, 0, delayMs);
      return;
    }
  } catch {
    // Fall through to a tiny monotonic spin only on runtimes without wait.
  }
  const deadline = Date.now() + delayMs;
  while (Date.now() < deadline) { /* bounded fallback */ }
}

function transientReadError(error) {
  return TRANSIENT_READ_RETRY_CODES.has(String(error?.code || "").toUpperCase());
}

function readDescriptorWithRetry(filePath, descriptor, maximumBytes) {
  let current = descriptor;
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      if (current === null) current = openSync(filePath, "r");
      const descriptorInfo = fstatSync(current);
      if (!descriptorInfo.isFile()) {
        throw storageFailure("JSON_STORAGE_NOT_FILE", "JSON 路径不是普通文件。");
      }
      if (descriptorInfo.size > maximumBytes) {
        throw storageFailure("JSON_STORAGE_TOO_LARGE", `JSON 文件超过 ${maximumBytes} 字节限制。`);
      }
      return { descriptor: current, raw: boundedDescriptorRead(current, descriptorInfo.size, maximumBytes) };
    } catch (error) {
      lastError = error;
      if (current !== null) {
        try { closeSync(current); } catch {}
        current = null;
      }
      if (!transientReadError(error) || attempt >= 4) throw error;
      waitForTransientReadRetry(attempt);
    }
  }
  throw lastError || storageFailure("JSON_STORAGE_READ_FAILED", "JSON 文件读取失败。");
}

function errorSummary(error, fallbackCode) {
  return {
    code: typeof error?.code === "string" && error.code ? error.code : fallbackCode,
    message: error instanceof Error ? error.message : String(error || "未知错误")
  };
}

function boundedDescriptorRead(descriptor, initialSize, maximumBytes) {
  const ceiling = maximumBytes + 1;
  let capacity = Math.min(ceiling, Math.max(64 * 1024, Math.max(0, Number(initialSize) || 0) + 1));
  let output = Buffer.allocUnsafe(capacity);
  let offset = 0;

  while (offset < ceiling) {
    if (offset === output.length) {
      const nextCapacity = Math.min(ceiling, Math.max(offset + 64 * 1024, output.length * 2));
      if (nextCapacity <= output.length) break;
      const expanded = Buffer.allocUnsafe(nextCapacity);
      output.copy(expanded, 0, 0, offset);
      output = expanded;
    }
    const bytesRead = readSync(descriptor, output, offset, output.length - offset, null);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }

  if (offset > maximumBytes) {
    throw storageFailure("JSON_STORAGE_TOO_LARGE", `JSON 文件超过 ${maximumBytes} 字节限制。`);
  }
  return output.subarray(0, offset);
}

function inspectJson(filePath, options = {}) {
  const resolvedPath = resolveFilePath(filePath);
  const maximumBytes = normalizeMaximumBytes(options.maxBytes);
  let descriptor = null;
  let raw = null;

  try {
    let pathInfo;
    try {
      pathInfo = lstatSync(resolvedPath);
    } catch (error) {
      if (error?.code === "ENOENT") {
        return {
          status: "missing",
          path: resolvedPath,
          exists: false,
          raw: null,
          sha256: "",
          byteLength: 0
        };
      }
      return {
        status: "invalid",
        path: resolvedPath,
        exists: false,
        raw: null,
        sha256: "",
        byteLength: 0,
        error: errorSummary(error, "JSON_STORAGE_STAT_FAILED")
      };
    }

    if (pathInfo.isSymbolicLink() || !pathInfo.isFile()) {
      const error = storageFailure(
        pathInfo.isSymbolicLink() ? "JSON_STORAGE_SYMLINK_REJECTED" : "JSON_STORAGE_NOT_FILE",
        pathInfo.isSymbolicLink() ? "JSON 文件不能是符号链接。" : "JSON 路径不是普通文件。"
      );
      return {
        status: "invalid",
        path: resolvedPath,
        exists: true,
        raw: null,
        sha256: "",
        byteLength: Number(pathInfo.size || 0),
        error: errorSummary(error, error.code)
      };
    }
    if (pathInfo.size > maximumBytes) {
      const error = storageFailure("JSON_STORAGE_TOO_LARGE", `JSON 文件超过 ${maximumBytes} 字节限制。`);
      return {
        status: "invalid",
        path: resolvedPath,
        exists: true,
        raw: null,
        sha256: "",
        byteLength: Number(pathInfo.size || 0),
        error: errorSummary(error, error.code)
      };
    }

    const readResult = readDescriptorWithRetry(resolvedPath, null, maximumBytes);
    descriptor = readResult.descriptor;
    raw = readResult.raw;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        status: "missing",
        path: resolvedPath,
        exists: false,
        raw: null,
        sha256: "",
        byteLength: 0
      };
    }
    return {
      status: "invalid",
      path: resolvedPath,
      exists: true,
      raw,
      sha256: raw ? sha256Buffer(raw) : "",
      byteLength: raw ? raw.length : 0,
      error: errorSummary(error, "JSON_STORAGE_READ_FAILED")
    };
  } finally {
    if (descriptor !== null) {
      try { closeSync(descriptor); } catch {}
    }
  }

  const snapshot = {
    path: resolvedPath,
    exists: true,
    raw,
    sha256: sha256Buffer(raw),
    byteLength: raw.length
  };

  let parsed;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      ...snapshot,
      status: "corrupt",
      error: errorSummary(error, "JSON_STORAGE_PARSE_FAILED")
    };
  }

  if (typeof options.validate === "function") {
    try {
      if (options.validate(parsed) === false) {
        throw storageFailure("JSON_STORAGE_SCHEMA_INVALID", "JSON 内容未通过结构校验。");
      }
    } catch (error) {
      return {
        ...snapshot,
        status: "invalid",
        value: parsed,
        error: errorSummary(error, "JSON_STORAGE_SCHEMA_INVALID")
      };
    }
  }

  return { ...snapshot, status: "valid", value: parsed };
}

function normalizeBytes(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (typeof value === "string") return Buffer.from(value, "utf8");
  throw storageFailure("JSON_STORAGE_BYTES_INVALID", "待写入内容必须是 Buffer、Uint8Array 或字符串。");
}

function invokeCheckpoint(checkpoint, name, detail) {
  if (typeof checkpoint === "function") checkpoint(name, detail);
}

function stageBytes(targetPath, value, options = {}) {
  const resolvedTarget = resolveFilePath(targetPath, "目标文件");
  const directory = path.dirname(resolvedTarget);
  const bytes = normalizeBytes(value);
  const mode = Number.isInteger(options.mode) ? options.mode : 0o600;
  mkdirSync(directory, { recursive: true });

  let descriptor = null;
  let tempPath = "";
  try {
    for (let attempt = 0; attempt < 16; attempt += 1) {
      tempPath = path.join(
        directory,
        `.${path.basename(resolvedTarget)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`
      );
      try {
        descriptor = openSync(tempPath, "wx", mode);
        break;
      } catch (error) {
        if (error?.code !== "EEXIST" || attempt === 15) throw error;
      }
    }
    if (descriptor === null) {
      throw storageFailure("JSON_STORAGE_STAGE_CREATE_FAILED", "无法创建唯一的 JSON 临时文件。");
    }
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    invokeCheckpoint(options.checkpoint, "stage-after-fsync", { targetPath: resolvedTarget, tempPath });
    closeSync(descriptor);
    descriptor = null;
    return Object.freeze({
      targetPath: resolvedTarget,
      tempPath,
      byteLength: bytes.length,
      sha256: sha256Buffer(bytes)
    });
  } catch (error) {
    if (descriptor !== null) {
      try { closeSync(descriptor); } catch {}
    }
    if (tempPath) {
      try { rmSync(tempPath, { force: true }); } catch {}
    }
    if (error instanceof JsonStorageError) throw error;
    throw storageFailure("JSON_STORAGE_STAGE_FAILED", "暂存 JSON 文件失败。", error);
  }
}

function stageJson(targetPath, value, options = {}) {
  let serialized;
  try {
    const spacing = options.space === undefined ? 2 : options.space;
    serialized = JSON.stringify(value, null, spacing);
  } catch (error) {
    throw storageFailure("JSON_STORAGE_SERIALIZE_FAILED", "JSON 内容无法序列化。", error);
  }
  if (serialized === undefined) {
    throw storageFailure("JSON_STORAGE_SERIALIZE_FAILED", "JSON 内容无法序列化。");
  }
  const text = options.trailingNewline === false ? serialized : `${serialized}\n`;
  return stageBytes(targetPath, Buffer.from(text, "utf8"), options);
}

function stagePaths(stage) {
  if (!stage || typeof stage !== "object") {
    throw storageFailure("JSON_STORAGE_STAGE_INVALID", "暂存记录无效。");
  }
  const targetPath = resolveFilePath(stage.targetPath, "暂存目标");
  const tempPath = resolveFilePath(stage.tempPath, "暂存文件");
  const expectedPrefix = `.${path.basename(targetPath)}.`;
  if (
    path.dirname(targetPath) !== path.dirname(tempPath) ||
    !path.basename(tempPath).startsWith(expectedPrefix) ||
    !path.basename(tempPath).endsWith(".tmp")
  ) {
    throw storageFailure("JSON_STORAGE_STAGE_INVALID", "暂存文件不在目标文件的同一目录内。");
  }
  if (!SHA256_PATTERN.test(String(stage.sha256 || "").toLowerCase())) {
    throw storageFailure("JSON_STORAGE_STAGE_INVALID", "暂存记录缺少有效 SHA-256。");
  }
  return { targetPath, tempPath };
}

function existingFileSnapshot(filePath) {
  try {
    const info = lstatSync(filePath);
    if (info.isSymbolicLink() || !info.isFile()) {
      throw storageFailure(
        info.isSymbolicLink() ? "JSON_STORAGE_SYMLINK_REJECTED" : "JSON_STORAGE_NOT_FILE",
        info.isSymbolicLink() ? "目标文件不能是符号链接。" : "目标路径不是普通文件。"
      );
    }
    const raw = readFileSync(filePath);
    return { exists: true, raw, sha256: sha256Buffer(raw), byteLength: raw.length };
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false, raw: null, sha256: "", byteLength: 0 };
    throw error;
  }
}

function fsyncParentDirectoryBestEffort(filePath) {
  let descriptor = null;
  try {
    descriptor = openSync(path.dirname(filePath), "r");
    fsyncSync(descriptor);
  } catch {
    // Windows and some filesystems do not allow opening/fsyncing a directory.
    // The staged file itself is already fsynced, so directory durability is a
    // best-effort enhancement rather than a reason to report a false failure.
  } finally {
    if (descriptor !== null) {
      try { closeSync(descriptor); } catch {}
    }
  }
}

function commitStage(stage, options = {}) {
  const { targetPath, tempPath } = stagePaths(stage);
  let renamed = false;
  try {
    const tempInfo = lstatSync(tempPath);
    if (tempInfo.isSymbolicLink() || !tempInfo.isFile()) {
      throw storageFailure("JSON_STORAGE_STAGE_INVALID", "暂存路径不是安全的普通文件。");
    }
    if (Number(stage.byteLength) !== tempInfo.size) {
      throw storageFailure("JSON_STORAGE_STAGE_CHANGED", "暂存文件大小在提交前发生变化。");
    }
    const tempBytes = readFileSync(tempPath);
    const stagedSha256 = sha256Buffer(tempBytes);
    if (stagedSha256 !== String(stage.sha256).toLowerCase()) {
      throw storageFailure("JSON_STORAGE_STAGE_CHANGED", "暂存文件 SHA-256 在提交前发生变化。");
    }

    const before = existingFileSnapshot(targetPath);
    if (Object.prototype.hasOwnProperty.call(options, "expectedInputSha256")) {
      const expected = options.expectedInputSha256;
      if (expected === null || expected === "") {
        if (before.exists) {
          throw storageFailure("JSON_STORAGE_CAS_MISMATCH", "目标文件已存在，CAS 提交已拒绝。" );
        }
      } else {
        const normalizedExpected = String(expected || "").trim().toLowerCase();
        if (!SHA256_PATTERN.test(normalizedExpected)) {
          throw storageFailure("JSON_STORAGE_CAS_INVALID", "expectedInputSha256 必须是 SHA-256 或 null。" );
        }
        if (!before.exists || before.sha256 !== normalizedExpected) {
          throw storageFailure("JSON_STORAGE_CAS_MISMATCH", "目标文件已变化，CAS 提交已拒绝。" );
        }
      }
    }

    invokeCheckpoint(options.checkpoint, "commit-before-rename", {
      targetPath,
      tempPath,
      inputSha256: before.sha256,
      outputSha256: stagedSha256
    });
    renameSync(tempPath, targetPath);
    renamed = true;
    fsyncParentDirectoryBestEffort(targetPath);
    return {
      targetPath,
      inputSha256: before.sha256,
      outputSha256: stagedSha256,
      byteLength: tempBytes.length,
      created: !before.exists
    };
  } catch (error) {
    if (!renamed) {
      try { rmSync(tempPath, { force: true }); } catch {}
    }
    if (error instanceof JsonStorageError) throw error;
    throw storageFailure("JSON_STORAGE_COMMIT_FAILED", "提交 JSON 暂存文件失败。", error);
  }
}

function backupSnapshot(snapshot, backupPath, options = {}) {
  if (!snapshot || typeof snapshot !== "object" || !snapshot.exists || !Buffer.isBuffer(snapshot.raw)) {
    throw storageFailure("JSON_STORAGE_SNAPSHOT_INVALID", "只有包含原始字节的现存文件快照才能备份。" );
  }
  const sourcePath = resolveFilePath(snapshot.path, "快照源文件");
  const resolvedBackup = resolveFilePath(backupPath, "备份文件");
  if (sourcePath === resolvedBackup) {
    throw storageFailure("JSON_STORAGE_BACKUP_PATH_INVALID", "备份路径不能覆盖源文件。" );
  }
  const snapshotSha256 = sha256Buffer(snapshot.raw);
  if (snapshotSha256 !== String(snapshot.sha256 || "").toLowerCase()) {
    throw storageFailure("JSON_STORAGE_SNAPSHOT_CHANGED", "快照原始字节与记录的 SHA-256 不一致。" );
  }

  const staged = stageBytes(resolvedBackup, snapshot.raw, options);
  const committed = commitStage(staged, {
    expectedInputSha256: null,
    checkpoint: options.checkpoint
  });
  const backupBytes = readFileSync(resolvedBackup);
  const backupSha256 = sha256Buffer(backupBytes);
  if (backupSha256 !== snapshotSha256 || backupBytes.length !== snapshot.raw.length) {
    throw storageFailure("JSON_STORAGE_BACKUP_VERIFY_FAILED", "备份文件写入后 SHA-256 校验失败。" );
  }
  return {
    sourcePath,
    backupPath: resolvedBackup,
    sha256: backupSha256,
    byteLength: backupBytes.length,
    created: committed.created
  };
}

function atomicWriteJson(targetPath, value, options = {}) {
  const staged = stageJson(targetPath, value, options);
  const commitOptions = { checkpoint: options.checkpoint };
  if (Object.prototype.hasOwnProperty.call(options, "expectedInputSha256")) {
    commitOptions.expectedInputSha256 = options.expectedInputSha256;
  }
  return commitStage(staged, commitOptions);
}

// Async background jobs must wait for durable replacement without blocking the
// UI. Windows readers/antivirus can briefly deny rename; retry that operation
// only, never remove the committed file or repeat the producing request.
async function atomicWriteBytesAsync(targetPath, bytes, options = {}) {
  const storage = options.storage || require("node:fs/promises");
  const target = resolveFilePath(targetPath);
  await storage.mkdir(path.dirname(target), { recursive: true });
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`);
  try {
    await storage.writeFile(temp, normalizeBytes(bytes), { flag: "wx", mode: 0o600 });
    const handle = await storage.open(temp, "r+");
    try { await handle.sync(); } finally { await handle.close(); }
    for (let attempt = 0; ; attempt++) {
      try { await storage.rename(temp, target); break; }
      catch (error) {
        if (!transientReadError(error) || attempt >= 4) throw error;
        await new Promise(resolve => setTimeout(resolve, Math.min(160, 20 * 2 ** attempt)));
      }
    }
  } catch (error) {
    try { await storage.rm(temp, { force: true }); } catch {}
    throw error;
  }
}

module.exports = {
  DEFAULT_MAX_JSON_BYTES,
  JsonStorageError,
  atomicWriteJson,
  atomicWriteBytesAsync,
  backupSnapshot,
  commitStage,
  inspectJson,
  sha256Buffer,
  stageBytes,
  stageJson
};
