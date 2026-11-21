"use strict";

const {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync
} = require("node:fs");
const { createHash, randomBytes } = require("node:crypto");
const path = require("node:path");
const { atomicWriteJson, inspectJson } = require("../core/json-storage.cjs");

const JOURNAL_FORMAT = "iiimage-project-import-transaction";
const JOURNAL_VERSION = 2;
const JOURNAL_DIRECTORY_NAME = "project-import-transactions";
const OWNERSHIP_MARKER_FORMAT = "iiimage-project-import-ownership";
const OWNERSHIP_MARKER_VERSION = 1;
const OWNERSHIP_MARKER_NAME = ".iiimage-import-ownership.json";
const JOURNAL_MAXIMUM_BYTES = 64 * 1024;
const OWNERSHIP_MARKER_MAXIMUM_BYTES = 64 * 1024;
const MANIFEST_MAXIMUM_BYTES = 4 * 1024 * 1024;
const JOURNAL_MAXIMUM_COUNT = 128;
const REMOVAL_TREE_MAXIMUM_ENTRIES = 100_000;
const TRANSACTION_ID_PATTERN = /^[1-9]\d*-[a-f0-9]{20}$/;
const JOURNAL_NAME_PATTERN = /^import-([1-9]\d*-[a-f0-9]{20})\.json$/;
const JOURNAL_TEMP_NAME_PATTERN = /^\.import-([1-9]\d*-[a-f0-9]{20})\.json\.[1-9]\d*\.[a-f0-9]{16}\.tmp$/;
const PROJECT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,179}$/;
const PROJECT_KIND_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._@-]{0,79}$/;
const OWNERSHIP_TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const JOURNAL_KEYS = Object.freeze([
  "format",
  "version",
  "state",
  "transactionId",
  "projectId",
  "projectKind",
  "ownershipToken",
  "ownershipMarkerSha256",
  "createdAt",
  "updatedAt",
  "stagingPath",
  "finalPath"
]);
const OWNERSHIP_MARKER_KEYS = Object.freeze([
  "format",
  "version",
  "transactionId",
  "projectId",
  "projectKind",
  "ownershipToken",
  "stagingPath",
  "finalPath"
]);

class ProjectImportTransactionError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "ProjectImportTransactionError";
    this.code = code;
    if (cause && !this.cause) this.cause = cause;
  }
}

function transactionFailure(code, message, cause) {
  return new ProjectImportTransactionError(code, message, cause);
}

function comparablePath(filePath) {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function samePath(left, right) {
  return comparablePath(left) === comparablePath(right);
}

function exactKeys(value, expectedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonicalJsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function ownershipMarkerValue(value) {
  return {
    format: OWNERSHIP_MARKER_FORMAT,
    version: OWNERSHIP_MARKER_VERSION,
    transactionId: value.transactionId,
    projectId: value.projectId,
    projectKind: value.projectKind,
    ownershipToken: value.ownershipToken,
    stagingPath: value.stagingPath,
    finalPath: value.finalPath
  };
}

function ownershipMarkerSha256(value) {
  return sha256Bytes(canonicalJsonBytes(ownershipMarkerValue(value)));
}

function canonicalTimestamp(value) {
  if (typeof value !== "string" || !value) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function canonicalAbsolutePath(value) {
  return typeof value === "string" && path.isAbsolute(value) && path.resolve(value) === value;
}

function trustedDirectory(directory, label) {
  if (!existsSync(directory)) return "";
  const info = lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw transactionFailure("AIEYRA_PROJECT_IMPORT_PATH_UNSAFE", `${label}包含符号链接、junction 或非目录实体。`);
  }
  return realpathSync(directory);
}

function ensureJournalDirectory(configDirInput) {
  const configDir = path.resolve(configDirInput);
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
  const realConfigDir = trustedDirectory(configDir, "项目导入事务配置目录");
  const journalDirectory = path.join(configDir, JOURNAL_DIRECTORY_NAME);
  if (existsSync(journalDirectory)) {
    const existingRealPath = trustedDirectory(journalDirectory, "项目导入事务 journal 目录");
    if (comparablePath(path.dirname(existingRealPath)) !== comparablePath(realConfigDir)) {
      throw transactionFailure("AIEYRA_PROJECT_IMPORT_PATH_UNSAFE", "项目导入事务 journal 目录 realpath 越过配置目录。");
    }
  } else {
    mkdirSync(journalDirectory, { recursive: false });
  }
  const realJournalDirectory = trustedDirectory(journalDirectory, "项目导入事务 journal 目录");
  if (comparablePath(path.dirname(realJournalDirectory)) !== comparablePath(realConfigDir)) {
    throw transactionFailure("AIEYRA_PROJECT_IMPORT_PATH_UNSAFE", "项目导入事务 journal 目录 realpath 越过配置目录。");
  }
  return realJournalDirectory;
}

function validateTransactionId(value) {
  const transactionId = String(value || "");
  if (!TRANSACTION_ID_PATTERN.test(transactionId)) {
    throw transactionFailure("AIEYRA_PROJECT_IMPORT_JOURNAL_INVALID", "项目导入事务 ID 无效。");
  }
  return transactionId;
}

function validateJournalValue(value, expectedTransactionId = "") {
  if (!exactKeys(value, JOURNAL_KEYS)) {
    throw transactionFailure("AIEYRA_PROJECT_IMPORT_JOURNAL_INVALID", "项目导入事务 journal 字段缺失或包含额外字段。");
  }
  if (value.format !== JOURNAL_FORMAT || value.version !== JOURNAL_VERSION) {
    throw transactionFailure("AIEYRA_PROJECT_IMPORT_JOURNAL_INVALID", "项目导入事务 journal 格式或版本无效。");
  }
  if (!["staging", "published", "finalizing"].includes(value.state)) {
    throw transactionFailure("AIEYRA_PROJECT_IMPORT_JOURNAL_INVALID", "项目导入事务 journal state 无效。");
  }
  const transactionId = validateTransactionId(value.transactionId);
  if (expectedTransactionId && transactionId !== expectedTransactionId) {
    throw transactionFailure("AIEYRA_PROJECT_IMPORT_JOURNAL_INVALID", "项目导入事务 journal 文件名与事务 ID 不匹配。");
  }
  if (typeof value.projectId !== "string" || !PROJECT_ID_PATTERN.test(value.projectId)) {
    throw transactionFailure("AIEYRA_PROJECT_IMPORT_JOURNAL_INVALID", "项目导入事务 projectId 无效。");
  }
  if (typeof value.projectKind !== "string" || !PROJECT_KIND_PATTERN.test(value.projectKind)) {
    throw transactionFailure("AIEYRA_PROJECT_IMPORT_JOURNAL_INVALID", "项目导入事务 projectKind 无效。");
  }
  if (typeof value.ownershipToken !== "string" || !OWNERSHIP_TOKEN_PATTERN.test(value.ownershipToken)) {
    throw transactionFailure("AIEYRA_PROJECT_IMPORT_JOURNAL_INVALID", "项目导入事务 ownership token 无效。");
  }
  if (typeof value.ownershipMarkerSha256 !== "string" || !SHA256_PATTERN.test(value.ownershipMarkerSha256)) {
    throw transactionFailure("AIEYRA_PROJECT_IMPORT_JOURNAL_INVALID", "项目导入事务 ownership marker SHA-256 无效。");
  }
  if (!canonicalTimestamp(value.createdAt) || !canonicalTimestamp(value.updatedAt)) {
    throw transactionFailure("AIEYRA_PROJECT_IMPORT_JOURNAL_INVALID", "项目导入事务时间戳无效。");
  }
  if (!canonicalAbsolutePath(value.stagingPath) || !canonicalAbsolutePath(value.finalPath)) {
    throw transactionFailure("AIEYRA_PROJECT_IMPORT_JOURNAL_INVALID", "项目导入事务路径不是规范绝对路径。");
  }
  const parentPath = path.dirname(value.finalPath);
  if (
    value.finalPath === parentPath ||
    path.dirname(value.stagingPath) !== parentPath ||
    path.basename(value.stagingPath) !== `.iiimage-import-${transactionId}` ||
    !path.basename(value.finalPath) ||
    path.basename(value.finalPath).startsWith(".iiimage-import-") ||
    samePath(value.stagingPath, value.finalPath)
  ) {
    throw transactionFailure("AIEYRA_PROJECT_IMPORT_JOURNAL_INVALID", "项目导入事务 staging/final 路径身份无效。");
  }
  if (ownershipMarkerSha256(value) !== value.ownershipMarkerSha256) {
    throw transactionFailure("AIEYRA_PROJECT_IMPORT_JOURNAL_INVALID", "项目导入事务 ownership marker digest 与事务身份不一致。");
  }
  const realParentPath = trustedDirectory(parentPath, "项目导入目标父目录");
  if (!realParentPath && (existsSync(value.stagingPath) || existsSync(value.finalPath))) {
    throw transactionFailure("AIEYRA_PROJECT_IMPORT_PATH_UNSAFE", "项目导入事务目标存在但父目录缺失。");
  }
  const validated = { ...value };
  Object.defineProperties(validated, {
    parentPath: { value: parentPath, enumerable: false },
    realParentPath: { value: realParentPath, enumerable: false }
  });
  return Object.freeze(validated);
}

function inspectOwnedDirectory(directory, parentPath, realParentPath, label) {
  if (!existsSync(directory)) return { exists: false, path: directory };
  if (!realParentPath) throw transactionFailure("AIEYRA_PROJECT_IMPORT_PATH_UNSAFE", `${label}缺少可信父目录。`);
  const info = lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || path.dirname(directory) !== parentPath) {
    throw transactionFailure("AIEYRA_PROJECT_IMPORT_PATH_UNSAFE", `${label}不是目标父目录下的可信实体目录。`);
  }
  const realDirectory = realpathSync(directory);
  if (comparablePath(path.dirname(realDirectory)) !== comparablePath(realParentPath)) {
    throw transactionFailure("AIEYRA_PROJECT_IMPORT_PATH_UNSAFE", `${label} realpath 越过目标父目录。`);
  }
  return { exists: true, path: directory, realPath: realDirectory };
}

function inspectOwnershipMarker(directoryInfo, transaction, label, options = {}) {
  if (!directoryInfo.exists) {
    if (options.allowMissing === true) return { exists: false, path: path.join(directoryInfo.path, OWNERSHIP_MARKER_NAME) };
    throw transactionFailure("AIEYRA_PROJECT_IMPORT_OWNERSHIP_MISSING", `${label}缺少事务 ownership marker。`);
  }
  const markerPath = path.join(directoryInfo.path, OWNERSHIP_MARKER_NAME);
  if (!existsSync(markerPath)) {
    if (options.allowMissing === true) return { exists: false, path: markerPath };
    throw transactionFailure("AIEYRA_PROJECT_IMPORT_OWNERSHIP_MISSING", `${label}缺少事务 ownership marker。`);
  }
  const info = lstatSync(markerPath);
  if (!info.isFile() || info.isSymbolicLink() || Number(info.nlink) !== 1 || info.size < 1 || info.size > OWNERSHIP_MARKER_MAXIMUM_BYTES) {
    throw transactionFailure("AIEYRA_PROJECT_IMPORT_OWNERSHIP_INVALID", `${label} ownership marker 不是可信普通文件或大小无效。`);
  }
  const realMarkerPath = realpathSync(markerPath);
  if (comparablePath(path.dirname(realMarkerPath)) !== comparablePath(directoryInfo.realPath)) {
    throw transactionFailure("AIEYRA_PROJECT_IMPORT_OWNERSHIP_INVALID", `${label} ownership marker realpath 越过事务目录。`);
  }
  const bytes = readFileSync(markerPath);
  const digest = sha256Bytes(bytes);
  if (digest !== transaction.ownershipMarkerSha256) {
    throw transactionFailure("AIEYRA_PROJECT_IMPORT_OWNERSHIP_MISMATCH", `${label} ownership marker SHA-256 与 journal 不匹配。`);
  }
  let marker;
  try {
    marker = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw transactionFailure("AIEYRA_PROJECT_IMPORT_OWNERSHIP_INVALID", `${label} ownership marker 不是有效 JSON。`, error);
  }
  const expected = ownershipMarkerValue(transaction);
  if (!exactKeys(marker, OWNERSHIP_MARKER_KEYS) || !canonicalJsonBytes(expected).equals(bytes)) {
    throw transactionFailure("AIEYRA_PROJECT_IMPORT_OWNERSHIP_MISMATCH", `${label} ownership marker 身份字段与 journal 不匹配。`);
  }
  return Object.freeze({ exists: true, path: markerPath, realPath: realMarkerPath, sha256: digest });
}

function removeOwnershipMarker(directoryInfo, transaction, label) {
  const marker = inspectOwnershipMarker(directoryInfo, transaction, label);
  rmSync(marker.path, { force: false });
  if (existsSync(marker.path)) {
    throw transactionFailure("AIEYRA_PROJECT_IMPORT_OWNERSHIP_INVALID", `${label} ownership marker 清理失败。`);
  }
}

function inspectRemovalTree(directoryInfo, label) {
  if (!directoryInfo.exists) return;
  const root = directoryInfo.realPath;
  const pending = [directoryInfo.path];
  let visited = 0;
  while (pending.length) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      visited += 1;
      if (visited > REMOVAL_TREE_MAXIMUM_ENTRIES) {
        throw transactionFailure("AIEYRA_PROJECT_IMPORT_PATH_UNSAFE", `${label}文件数量超过安全恢复上限。`);
      }
      const candidate = path.join(current, entry.name);
      const info = lstatSync(candidate);
      if (info.isSymbolicLink()) {
        throw transactionFailure("AIEYRA_PROJECT_IMPORT_PATH_UNSAFE", `${label}包含符号链接或 junction。`);
      }
      if (info.isDirectory()) {
        const realCandidate = realpathSync(candidate);
        const relation = path.relative(root, realCandidate);
        if (relation === "" || path.isAbsolute(relation) || relation === ".." || relation.startsWith(`..${path.sep}`)) {
          throw transactionFailure("AIEYRA_PROJECT_IMPORT_PATH_UNSAFE", `${label}子目录 realpath 越过事务目录。`);
        }
        pending.push(candidate);
      } else if (!info.isFile()) {
        throw transactionFailure("AIEYRA_PROJECT_IMPORT_PATH_UNSAFE", `${label}包含不受支持的文件实体。`);
      }
    }
  }
}

function manifestMatchesTransaction(finalInfo, transaction) {
  if (!finalInfo.exists) return false;
  const metadataDirectory = path.join(finalInfo.path, ".iiimage");
  const metadataInfo = inspectOwnedDirectory(metadataDirectory, finalInfo.path, finalInfo.realPath, "导入项目 .iiimage 目录");
  if (!metadataInfo.exists) return false;
  const manifestPath = path.join(metadataDirectory, "project.json");
  if (!existsSync(manifestPath)) return false;
  const manifestInfo = lstatSync(manifestPath);
  if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink() || manifestInfo.size < 1 || manifestInfo.size > MANIFEST_MAXIMUM_BYTES) {
    throw transactionFailure("AIEYRA_PROJECT_IMPORT_MANIFEST_INVALID", "导入项目 manifest 不是可信普通文件或大小无效。");
  }
  const realManifestPath = realpathSync(manifestPath);
  if (comparablePath(path.dirname(realManifestPath)) !== comparablePath(metadataInfo.realPath)) {
    throw transactionFailure("AIEYRA_PROJECT_IMPORT_MANIFEST_INVALID", "导入项目 manifest realpath 越过 .iiimage 目录。");
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw transactionFailure("AIEYRA_PROJECT_IMPORT_MANIFEST_INVALID", "导入项目 manifest 不是有效 JSON。", error);
  }
  return (
    plainObject(manifest) &&
    manifest.format === "iiimage-project" &&
    manifest.version === 2 &&
    plainObject(manifest.project) &&
    typeof manifest.project.id === "string" &&
    typeof manifest.project.kind === "string" &&
    manifest.project.id === transaction.projectId &&
    manifest.project.kind === transaction.projectKind
  );
}

function registrationForTransaction(projectList, transaction) {
  const projects = Array.isArray(projectList?.projects) ? projectList.projects : [];
  const exact = projects.filter((project) => (
    project?.id === transaction.projectId &&
    project?.kind === transaction.projectKind &&
    typeof project.path === "string" &&
    typeof project.sessionPath === "string" &&
    samePath(project.path, transaction.finalPath) &&
    samePath(project.sessionPath, path.join(transaction.finalPath, "session.json"))
  ));
  const conflicts = projects.filter((project) => (
    project?.id === transaction.projectId ||
    (typeof project?.path === "string" && samePath(project.path, transaction.finalPath))
  ));
  if (exact.length > 1 || (conflicts.length && exact.length !== conflicts.length)) {
    throw transactionFailure("AIEYRA_PROJECT_IMPORT_REGISTRATION_CONFLICT", "项目列表包含与导入事务冲突的项目身份。");
  }
  return exact.length === 1;
}

function journalPathFor(directory, transactionId) {
  return path.join(directory, `import-${validateTransactionId(transactionId)}.json`);
}

function readJournalFile(journalPath, transactionId) {
  if (!existsSync(journalPath)) {
    throw transactionFailure("AIEYRA_PROJECT_IMPORT_JOURNAL_MISSING", "项目导入事务 journal 不存在。");
  }
  const info = lstatSync(journalPath);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > JOURNAL_MAXIMUM_BYTES) {
    throw transactionFailure("AIEYRA_PROJECT_IMPORT_JOURNAL_INVALID", "项目导入事务 journal 不是可信普通文件或大小无效。");
  }
  let value;
  try {
    value = JSON.parse(readFileSync(journalPath, "utf8"));
  } catch (error) {
    throw transactionFailure("AIEYRA_PROJECT_IMPORT_JOURNAL_INVALID", "项目导入事务 journal 不是有效 JSON。", error);
  }
  return validateJournalValue(value, transactionId);
}

function scanJournalDirectory(configDir) {
  const directory = ensureJournalDirectory(configDir);
  const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
  if (entries.length > JOURNAL_MAXIMUM_COUNT * 2) {
    throw transactionFailure("AIEYRA_PROJECT_IMPORT_JOURNAL_INVALID", "项目导入事务 journal 目录条目过多。");
  }
  const journals = [];
  const temporaryFiles = [];
  const transactionIds = new Set();
  for (const entry of entries) {
    const candidate = path.join(directory, entry.name);
    const journalMatch = JOURNAL_NAME_PATTERN.exec(entry.name);
    const temporaryMatch = JOURNAL_TEMP_NAME_PATTERN.exec(entry.name);
    if (!journalMatch && !temporaryMatch) {
      throw transactionFailure("AIEYRA_PROJECT_IMPORT_JOURNAL_INVALID", `项目导入事务目录包含未识别条目：${entry.name}`);
    }
    const info = lstatSync(candidate);
    if (!info.isFile() || info.isSymbolicLink() || info.size > JOURNAL_MAXIMUM_BYTES) {
      throw transactionFailure("AIEYRA_PROJECT_IMPORT_JOURNAL_INVALID", `项目导入事务条目不是可信普通文件：${entry.name}`);
    }
    if (temporaryMatch) {
      temporaryFiles.push(candidate);
      continue;
    }
    const transactionId = journalMatch[1];
    if (transactionIds.has(transactionId)) {
      throw transactionFailure("AIEYRA_PROJECT_IMPORT_JOURNAL_INVALID", "项目导入事务 ID 重复。");
    }
    transactionIds.add(transactionId);
    journals.push({
      path: candidate,
      value: readJournalFile(candidate, transactionId)
    });
  }
  if (journals.length > JOURNAL_MAXIMUM_COUNT) {
    throw transactionFailure("AIEYRA_PROJECT_IMPORT_JOURNAL_INVALID", "项目导入事务 journal 数量超过恢复上限。");
  }
  return { directory, journals, temporaryFiles };
}

function recoveryPlan(transaction, projectList) {
  const staging = inspectOwnedDirectory(transaction.stagingPath, transaction.parentPath, transaction.realParentPath, "项目导入 staging");
  const final = inspectOwnedDirectory(transaction.finalPath, transaction.parentPath, transaction.realParentPath, "项目导入 final");
  const registered = registrationForTransaction(projectList, transaction);
  if (staging.exists && final.exists) {
    throw transactionFailure("AIEYRA_PROJECT_IMPORT_PATH_UNSAFE", "项目导入 staging 与 final 同时存在，ownership 身份不唯一。");
  }
  if (registered) {
    if (!final.exists || !manifestMatchesTransaction(final, transaction)) {
      throw transactionFailure("AIEYRA_PROJECT_IMPORT_MANIFEST_MISMATCH", "已注册导入事务的 final manifest 身份不匹配。");
    }
    const marker = inspectOwnershipMarker(final, transaction, "已注册项目导入 final", { allowMissing: transaction.state === "finalizing" });
    if (!marker.exists && transaction.state !== "finalizing") {
      throw transactionFailure("AIEYRA_PROJECT_IMPORT_OWNERSHIP_MISSING", "已注册 final 缺少 ownership marker，且 journal 尚未进入 finalizing。" );
    }
    return { transaction, staging, final, marker, registered, removeStaging: false, removeFinal: false, removeFinalMarker: marker.exists };
  }
  if (!staging.exists && !final.exists) {
    throw transactionFailure("AIEYRA_PROJECT_IMPORT_OWNERSHIP_MISSING", "未注册导入事务没有可验证 ownership marker 的 staging 或 final，已停止清理。" );
  }
  if (transaction.state === "published" && !final.exists) {
    throw transactionFailure("AIEYRA_PROJECT_IMPORT_OWNERSHIP_MISMATCH", "published 导入事务缺少带 ownership marker 的 final。" );
  }
  if (transaction.state === "finalizing") {
    throw transactionFailure("AIEYRA_PROJECT_IMPORT_NOT_REGISTERED", "finalizing 导入事务未获项目列表精确授权，已停止清理。" );
  }
  let marker = null;
  if (staging.exists) {
    marker = inspectOwnershipMarker(staging, transaction, "未注册项目导入 staging");
    inspectRemovalTree(staging, "项目导入 staging");
  }
  if (final.exists) {
    marker = inspectOwnershipMarker(final, transaction, "未注册项目导入 final");
    inspectRemovalTree(final, "项目导入 final");
    if (!manifestMatchesTransaction(final, transaction)) {
      throw transactionFailure("AIEYRA_PROJECT_IMPORT_MANIFEST_MISMATCH", "未注册导入事务的 final manifest 身份不匹配，已停止删除。");
    }
  }
  return { transaction, staging, final, marker, registered, removeStaging: staging.exists, removeFinal: final.exists, removeFinalMarker: false };
}

function applyRecoveryPlan(plan, journalPath) {
  const currentJournal = readJournalFile(journalPath, plan.transaction.transactionId);
  if (JSON.stringify(currentJournal) !== JSON.stringify(plan.transaction)) {
    throw transactionFailure("AIEYRA_PROJECT_IMPORT_JOURNAL_INVALID", "恢复前项目导入事务 journal 内容发生变化。");
  }
  const currentStaging = inspectOwnedDirectory(
    plan.transaction.stagingPath,
    plan.transaction.parentPath,
    plan.transaction.realParentPath,
    "项目导入 staging"
  );
  const currentFinal = inspectOwnedDirectory(
    plan.transaction.finalPath,
    plan.transaction.parentPath,
    plan.transaction.realParentPath,
    "项目导入 final"
  );
  if (currentStaging.exists !== plan.staging.exists || currentFinal.exists !== plan.final.exists) {
    throw transactionFailure("AIEYRA_PROJECT_IMPORT_PATH_UNSAFE", "恢复前项目导入 staging/final 存在状态发生变化。");
  }
  if (plan.registered && (!currentFinal.exists || !manifestMatchesTransaction(currentFinal, plan.transaction))) {
    throw transactionFailure("AIEYRA_PROJECT_IMPORT_MANIFEST_MISMATCH", "恢复前已注册 final manifest 身份发生变化。");
  }
  if (plan.removeStaging) {
    inspectOwnershipMarker(currentStaging, plan.transaction, "删除前项目导入 staging");
    inspectRemovalTree(currentStaging, "项目导入 staging");
    inspectOwnershipMarker(currentStaging, plan.transaction, "删除前项目导入 staging");
    rmSync(currentStaging.path, { recursive: true, force: true });
  }
  if (plan.removeFinal) {
    inspectOwnershipMarker(currentFinal, plan.transaction, "删除前项目导入 final");
    inspectRemovalTree(currentFinal, "项目导入 final");
    if (!manifestMatchesTransaction(currentFinal, plan.transaction)) {
      throw transactionFailure("AIEYRA_PROJECT_IMPORT_MANIFEST_MISMATCH", "删除前 final manifest 身份发生变化，已停止删除。");
    }
    inspectOwnershipMarker(currentFinal, plan.transaction, "删除前项目导入 final");
    rmSync(currentFinal.path, { recursive: true, force: true });
  }
  if (plan.removeFinalMarker) {
    if (!manifestMatchesTransaction(currentFinal, plan.transaction)) {
      throw transactionFailure("AIEYRA_PROJECT_IMPORT_MANIFEST_MISMATCH", "清理 marker 前已注册 final manifest 身份发生变化。");
    }
    removeOwnershipMarker(currentFinal, plan.transaction, "已注册项目导入 final");
  } else if (plan.registered && plan.transaction.state === "finalizing") {
    const marker = inspectOwnershipMarker(currentFinal, plan.transaction, "已注册项目导入 final", { allowMissing: true });
    if (marker.exists) {
      throw transactionFailure("AIEYRA_PROJECT_IMPORT_OWNERSHIP_MISMATCH", "finalizing 恢复计划中的 marker 存在状态发生变化。" );
    }
  }
  const journalInfo = lstatSync(journalPath);
  if (!journalInfo.isFile() || journalInfo.isSymbolicLink()) {
    throw transactionFailure("AIEYRA_PROJECT_IMPORT_JOURNAL_INVALID", "清理前项目导入事务 journal 身份发生变化。");
  }
  rmSync(journalPath, { force: true });
}

function createProjectImportTransactionManager(options = {}) {
  const configDir = path.resolve(options.configDir || "");
  if (!options.configDir || configDir === path.parse(configDir).root) {
    throw transactionFailure("AIEYRA_PROJECT_IMPORT_CONFIG_INVALID", "项目导入事务需要受控 config 目录。");
  }

  function begin(value, beginOptions = {}) {
    const directory = ensureJournalDirectory(configDir);
    const now = new Date().toISOString();
    const identity = {
      format: JOURNAL_FORMAT,
      version: JOURNAL_VERSION,
      state: "staging",
      transactionId: value?.transactionId,
      projectId: value?.projectId,
      projectKind: value?.projectKind,
      ownershipToken: randomBytes(32).toString("hex"),
      createdAt: now,
      updatedAt: now,
      stagingPath: path.resolve(String(value?.stagingPath || "")),
      finalPath: path.resolve(String(value?.finalPath || ""))
    };
    const transaction = validateJournalValue({
      ...identity,
      ownershipMarkerSha256: ownershipMarkerSha256(identity)
    });
    const journalPath = journalPathFor(directory, transaction.transactionId);
    if (existsSync(journalPath)) {
      throw transactionFailure("AIEYRA_PROJECT_IMPORT_JOURNAL_EXISTS", "项目导入事务 journal 已存在。");
    }
    if (existsSync(transaction.stagingPath) || existsSync(transaction.finalPath)) {
      throw transactionFailure("AIEYRA_PROJECT_IMPORT_PATH_UNSAFE", "项目导入事务 begin 前 staging 或 final 已存在。" );
    }
    mkdirSync(transaction.stagingPath, { recursive: false });
    let markerCreated = false;
    try {
      const staging = inspectOwnedDirectory(transaction.stagingPath, transaction.parentPath, transaction.realParentPath, "项目导入 staging");
      const markerPath = path.join(staging.path, OWNERSHIP_MARKER_NAME);
      const markerReceipt = atomicWriteJson(markerPath, ownershipMarkerValue(transaction), { expectedInputSha256: null });
      if (markerReceipt.outputSha256 !== transaction.ownershipMarkerSha256) {
        throw transactionFailure("AIEYRA_PROJECT_IMPORT_OWNERSHIP_MISMATCH", "项目导入 ownership marker 写入 digest 不一致。" );
      }
      markerCreated = true;
      inspectOwnershipMarker(staging, transaction, "项目导入 staging");

      // No filesystem offers an atomic commit spanning this project parent and
      // the central config directory. A hard crash at this checkpoint may
      // leave a marker-owned orphan staging directory without a journal. It is
      // intentionally not auto-discovered or deleted: leakage is safer than
      // converting an unindexed directory into deletion authority.
      if (typeof beginOptions.checkpoint === "function") {
        beginOptions.checkpoint("after-ownership-marker-before-journal", { transactionId: transaction.transactionId });
      }

      if (existsSync(transaction.finalPath)) {
        throw transactionFailure("AIEYRA_PROJECT_IMPORT_PATH_UNSAFE", "写入 journal 前项目导入 final 被占用。" );
      }
      inspectOwnershipMarker(
        inspectOwnedDirectory(transaction.stagingPath, transaction.parentPath, transaction.realParentPath, "项目导入 staging"),
        transaction,
        "写入 journal 前项目导入 staging"
      );
      atomicWriteJson(journalPath, transaction, { expectedInputSha256: null });
      return transaction;
    } catch (error) {
      if (error?.aieyraProjectImportHardCrash === true) throw error;
      if (existsSync(journalPath)) {
        // A committed journal makes the transaction recoverable. Never delete
        // its tree from this ambiguous error path.
        readJournalFile(journalPath, transaction.transactionId);
        throw error;
      }
      if (markerCreated && existsSync(transaction.stagingPath)) {
        const staging = inspectOwnedDirectory(transaction.stagingPath, transaction.parentPath, transaction.realParentPath, "项目导入 staging");
        inspectOwnershipMarker(staging, transaction, "begin 回滚项目导入 staging");
        inspectRemovalTree(staging, "begin 回滚项目导入 staging");
        inspectOwnershipMarker(staging, transaction, "begin 回滚项目导入 staging");
        rmSync(staging.path, { recursive: true, force: true });
      }
      throw error;
    }
  }

  function read(transactionId) {
    const directory = ensureJournalDirectory(configDir);
    return readJournalFile(journalPathFor(directory, transactionId), validateTransactionId(transactionId));
  }

  function transitionJournalState(transactionId, expectedState, nextState) {
    const directory = ensureJournalDirectory(configDir);
    const id = validateTransactionId(transactionId);
    const journalPath = journalPathFor(directory, id);
    const current = readJournalFile(journalPath, id);
    if (current.state !== expectedState) {
      throw transactionFailure("AIEYRA_PROJECT_IMPORT_JOURNAL_INVALID", `项目导入事务只能从 ${expectedState} 进入 ${nextState}。`);
    }
    const next = validateJournalValue({ ...current, state: nextState, updatedAt: new Date().toISOString() }, id);
    const snapshot = inspectJson(journalPath);
    if (snapshot.status !== "valid" || !snapshot.sha256) {
      throw transactionFailure("AIEYRA_PROJECT_IMPORT_JOURNAL_INVALID", "项目导入事务 journal 更新前状态无效。");
    }
    const snapshotValue = validateJournalValue(snapshot.value, id);
    if (JSON.stringify(snapshotValue) !== JSON.stringify(current)) {
      throw transactionFailure("AIEYRA_PROJECT_IMPORT_JOURNAL_INVALID", "项目导入事务 journal 更新前内容发生变化。");
    }
    atomicWriteJson(journalPath, next, { expectedInputSha256: snapshot.sha256 });
    return next;
  }

  function verifyOwnership(transactionId, expectedLocation) {
    const transaction = read(transactionId);
    const staging = inspectOwnedDirectory(transaction.stagingPath, transaction.parentPath, transaction.realParentPath, "项目导入 staging");
    const final = inspectOwnedDirectory(transaction.finalPath, transaction.parentPath, transaction.realParentPath, "项目导入 final");
    if (expectedLocation === "staging") {
      if (!staging.exists || final.exists) {
        throw transactionFailure("AIEYRA_PROJECT_IMPORT_OWNERSHIP_MISMATCH", "项目导入 ownership 校验要求仅 staging 存在。" );
      }
      return inspectOwnershipMarker(staging, transaction, "项目导入 staging");
    }
    if (expectedLocation === "final") {
      if (staging.exists || !final.exists) {
        throw transactionFailure("AIEYRA_PROJECT_IMPORT_OWNERSHIP_MISMATCH", "项目导入 ownership 校验要求仅 final 存在。" );
      }
      return inspectOwnershipMarker(final, transaction, "项目导入 final");
    }
    throw transactionFailure("AIEYRA_PROJECT_IMPORT_OWNERSHIP_INVALID", "项目导入 ownership 校验位置无效。" );
  }

  function markPublished(transactionId) {
    const transaction = read(transactionId);
    if (transaction.state !== "staging") {
      throw transactionFailure("AIEYRA_PROJECT_IMPORT_JOURNAL_INVALID", "项目导入事务不能重复标记 published。");
    }
    verifyOwnership(transactionId, "final");
    const final = inspectOwnedDirectory(transaction.finalPath, transaction.parentPath, transaction.realParentPath, "项目导入 final");
    if (!manifestMatchesTransaction(final, transaction)) {
      throw transactionFailure("AIEYRA_PROJECT_IMPORT_MANIFEST_MISMATCH", "标记 published 前 final manifest 身份不匹配。" );
    }
    verifyOwnership(transactionId, "final");
    return transitionJournalState(transactionId, "staging", "published");
  }

  function finalize(transactionId, record, projectList, finalizeOptions = {}) {
    const directory = ensureJournalDirectory(configDir);
    const id = validateTransactionId(transactionId);
    const journalPath = journalPathFor(directory, id);
    const transaction = readJournalFile(journalPath, id);
    if (transaction.state !== "published") {
      throw transactionFailure("AIEYRA_PROJECT_IMPORT_JOURNAL_INVALID", "只有 published 导入事务才能完成注册并清理 journal。");
    }
    if (
      record?.id !== transaction.projectId ||
      record?.kind !== transaction.projectKind ||
      typeof record?.path !== "string" ||
      typeof record?.sessionPath !== "string" ||
      !samePath(record.path, transaction.finalPath) ||
      !samePath(record.sessionPath, path.join(transaction.finalPath, "session.json"))
    ) {
      throw transactionFailure("AIEYRA_PROJECT_IMPORT_REGISTRATION_CONFLICT", "完成导入事务时项目记录身份不匹配。");
    }
    const final = inspectOwnedDirectory(transaction.finalPath, transaction.parentPath, transaction.realParentPath, "项目导入 final");
    if (!final.exists || !manifestMatchesTransaction(final, transaction)) {
      throw transactionFailure("AIEYRA_PROJECT_IMPORT_MANIFEST_MISMATCH", "完成导入事务时 final manifest 身份不匹配。");
    }
    inspectOwnershipMarker(final, transaction, "完成导入事务 final");
    if (finalizeOptions.requireRegistration !== false && !registrationForTransaction(projectList, transaction)) {
      throw transactionFailure("AIEYRA_PROJECT_IMPORT_NOT_REGISTERED", "项目列表尚未权威注册导入项目，不能清理事务 journal。");
    }
    const staging = inspectOwnedDirectory(transaction.stagingPath, transaction.parentPath, transaction.realParentPath, "项目导入 staging");
    if (staging.exists) {
      throw transactionFailure("AIEYRA_PROJECT_IMPORT_PATH_UNSAFE", "完成导入事务时 staging 与 final 同时存在。" );
    }
    const temporaryFiles = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const match = JOURNAL_TEMP_NAME_PATTERN.exec(entry.name);
      if (match?.[1] === id) {
        const candidate = path.join(directory, entry.name);
        const info = lstatSync(candidate);
        if (!info.isFile() || info.isSymbolicLink()) {
          throw transactionFailure("AIEYRA_PROJECT_IMPORT_JOURNAL_INVALID", "项目导入事务临时文件身份无效。");
        }
        temporaryFiles.push(candidate);
      }
    }
    transitionJournalState(id, "published", "finalizing");
    const finalizingTransaction = readJournalFile(journalPath, id);
    const currentFinal = inspectOwnedDirectory(
      finalizingTransaction.finalPath,
      finalizingTransaction.parentPath,
      finalizingTransaction.realParentPath,
      "完成导入事务 final"
    );
    if (!currentFinal.exists || !manifestMatchesTransaction(currentFinal, finalizingTransaction)) {
      throw transactionFailure("AIEYRA_PROJECT_IMPORT_MANIFEST_MISMATCH", "清理 ownership marker 前 final manifest 身份发生变化。" );
    }
    removeOwnershipMarker(currentFinal, finalizingTransaction, "完成导入事务 final");
    if (typeof finalizeOptions.checkpoint === "function") {
      finalizeOptions.checkpoint("after-finalize-marker-removal", { transactionId: id });
    }
    for (const temporaryFile of temporaryFiles) rmSync(temporaryFile, { force: true });
    const journalInfo = lstatSync(journalPath);
    if (!journalInfo.isFile() || journalInfo.isSymbolicLink()) {
      throw transactionFailure("AIEYRA_PROJECT_IMPORT_JOURNAL_INVALID", "完成注册前项目导入事务 journal 身份发生变化。");
    }
    rmSync(journalPath, { force: true });
    return { transactionId: id, finalPath: transaction.finalPath };
  }

  function rollback(transactionId) {
    const directory = ensureJournalDirectory(configDir);
    const id = validateTransactionId(transactionId);
    const journalPath = journalPathFor(directory, id);
    const transaction = readJournalFile(journalPath, id);
    const plan = recoveryPlan(transaction, { projects: [] });
    applyRecoveryPlan(plan, journalPath);
    return { transactionId: id, rolledBack: true };
  }

  function recover(projectList = { projects: [] }) {
    const scanned = scanJournalDirectory(configDir);
    const targetOwners = new Map();
    for (const journal of scanned.journals) {
      for (const target of [journal.value.stagingPath, journal.value.finalPath]) {
        const key = comparablePath(target);
        if (targetOwners.has(key)) {
          throw transactionFailure("AIEYRA_PROJECT_IMPORT_JOURNAL_INVALID", "多个项目导入事务声明了同一 staging/final 路径。");
        }
        targetOwners.set(key, journal.value.transactionId);
      }
    }
    const plans = scanned.journals.map((journal) => ({ journal, plan: recoveryPlan(journal.value, projectList) }));
    const actions = [];
    for (const { journal, plan } of plans) {
      applyRecoveryPlan(plan, journal.path);
      actions.push({
        transactionId: plan.transaction.transactionId,
        action: plan.registered ? "preserved-registered" : "rolled-back-unregistered"
      });
    }
    for (const temporaryFile of scanned.temporaryFiles) {
      const info = lstatSync(temporaryFile);
      if (!info.isFile() || info.isSymbolicLink()) {
        throw transactionFailure("AIEYRA_PROJECT_IMPORT_JOURNAL_INVALID", "项目导入事务临时文件身份发生变化。");
      }
      rmSync(temporaryFile, { force: true });
    }
    return { recovered: actions.length > 0 || scanned.temporaryFiles.length > 0, actions };
  }

  return Object.freeze({
    begin,
    directory: () => ensureJournalDirectory(configDir),
    finalize,
    journalPath: (transactionId) => journalPathFor(ensureJournalDirectory(configDir), transactionId),
    markPublished,
    read,
    recover,
    rollback,
    verifyOwnership
  });
}

module.exports = {
  JOURNAL_DIRECTORY_NAME,
  JOURNAL_FORMAT,
  JOURNAL_VERSION,
  OWNERSHIP_MARKER_FORMAT,
  OWNERSHIP_MARKER_NAME,
  OWNERSHIP_MARKER_VERSION,
  ProjectImportTransactionError,
  createProjectImportTransactionManager
};
