"use strict";

const {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync
} = require("node:fs");
const { createHash, randomBytes } = require("node:crypto");
const { basename, dirname, isAbsolute, join, relative, resolve } = require("node:path");
const { TextDecoder } = require("node:util");

const DEFAULT_MAX_FILES = 100_000;
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024 * 1024;
const BOOTSTRAP_USER_DATA_FILE = "Local State";
const BOOTSTRAP_USER_DATA_MAX_BYTES = 4 * 1024;
const MIGRATION_RECEIPT_FILE = "aieyra-workspace-identity-migration.json";
const MIGRATION_RECEIPT_MAX_BYTES = 2 * 1024 * 1024;
const STAGING_PREFIX = ".aieyra-workspace-user-data-migration-";
const MIGRATION_SCHEMA_VERSION = 2;
const RECOVERY_DIRECTORY_NAME = "Aieyra Workspace Recovery";
const MAX_RECORDED_CONFLICTS = 512;
const MAX_MANAGED_RECEIPT_FILES = 10_000;

// Electron/Chromium owns these paths while the application is running. They
// are caches, browser profile state, or lock journals rather than Workspace
// data. Reading them during post-activation migration can return EBUSY on
// Windows, and copying them would also resurrect stale browser state. Account
// cookies are migrated through Electron sessions separately.
const VOLATILE_CHROMIUM_DIRECTORY_NAMES = new Set([
  "blob_storage",
  "cache",
  "code cache",
  "crashpad",
  "dawngraphitecache",
  "dawnwebgpucache",
  "dips",
  "dictionaries",
  "gpu cache",
  "gpucache",
  "grshadercache",
  "indexeddb",
  "local storage",
  "network",
  "partitions",
  "service worker",
  "session storage",
  "shadercache",
  "shared dictionary",
  "sharedstorage",
  "storage",
  "webstorage",
  "file system",
  "logs"
]);
const VOLATILE_CHROMIUM_FILE_NAMES = new Set([
  "dips",
  "dips-shm",
  "dips-wal",
  "local state",
  "preferences",
  "secure preferences",
  "devtoolsactiveport",
  "first run",
  "singletonlock",
  "singletoncookie",
  "singletonsock",
  "sharedstorage",
  "sharedstorage-shm",
  "sharedstorage-wal",
  "current",
  "lock",
  "lockfile",
  "log",
  "log.old"
]);

class IdentityDataMigrationError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "IdentityDataMigrationError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, details = undefined) {
  throw new IdentityDataMigrationError(code, message, details);
}

function samePath(left, right) {
  const a = resolve(left);
  const b = resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function safeRelativePath(root, target) {
  const value = relative(resolve(root), resolve(target)).split("\\").join("/");
  if (!value || value === "." || value === ".." || value.startsWith("../../..") || value.startsWith("/")) {
    fail("AIEYRA_IDENTITY_MIGRATION_PATH_INVALID", "Identity migration path escaped its owned root.");
  }
  return value;
}

function compareUtf16(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isVolatileChromiumPath(relativePath, entryKind = "file") {
  const normalized = String(relativePath || "")
    .replaceAll("\\", "/")
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.toLowerCase());
  if (!normalized.length) return false;
  // `data/` and `workspace/` are Workspace-owned business trees. A user
  // artifact or cache may legitimately be named `lock`, `current`, `log`, or
  // `cache`, so Chromium filename heuristics must never filter those roots.
  if (["data", "workspace"].includes(normalized[0])) return false;
  const directorySegments = entryKind === "directory" ? normalized : normalized.slice(0, -1);
  if (directorySegments.some((segment) => VOLATILE_CHROMIUM_DIRECTORY_NAMES.has(segment))) return true;
  if (entryKind === "directory") return false;
  const basename = normalized.at(-1);
  if (VOLATILE_CHROMIUM_FILE_NAMES.has(basename)) return true;
  // Chromium creates versioned MANIFEST/Singleton files in profile roots.
  return /^manifest(?:-[0-9]+)?$/.test(basename) || /^singleton(?:lock|cookie|socket)$/.test(basename);
}

function isWorkspaceMigrationCachePath(relativePath) {
  const normalized = String(relativePath || "")
    .replaceAll("\\", "/")
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.toLowerCase());
  return normalized.length >= 2 && normalized[0] === "data" && normalized[1] === "updates";
}

function shouldSkipIdentityMigrationPath(relativePath, options = {}, entryKind = "file") {
  return isWorkspaceMigrationCachePath(relativePath)
    || (options.skipVolatileChromiumState === true && isVolatileChromiumPath(relativePath, entryKind));
}

function filesystemEntryKind(value) {
  for (const [method, kind] of [
    ["isSymbolicLink", "symbolic-link"],
    ["isDirectory", "directory"],
    ["isFile", "file"],
    ["isBlockDevice", "block-device"],
    ["isCharacterDevice", "character-device"],
    ["isFIFO", "fifo"],
    ["isSocket", "socket"]
  ]) {
    if (typeof value?.[method] === "function" && value[method]()) return kind;
  }
  return "unknown";
}

function classifyInventoryEntry(entry, info, relativePath = "") {
  const direntKind = filesystemEntryKind(entry);
  const lstatKind = filesystemEntryKind(info);
  const details = { relativePath, direntKind, lstatKind };
  if (direntKind === "symbolic-link" || lstatKind === "symbolic-link") {
    fail("AIEYRA_IDENTITY_MIGRATION_LINK_REJECTED", "Identity migration source contains a link or junction.", details);
  }
  // Windows can report a transient Dirent UNKNOWN while lstat already has the
  // authoritative type. Keep rejecting actual special entries, but do not turn
  // that harmless enumeration race into a failed application startup.
  if (lstatKind === "directory" || lstatKind === "file") return lstatKind;
  fail("AIEYRA_IDENTITY_MIGRATION_ENTRY_UNSAFE", "Identity migration source contains an unsupported entry.", details);
}

function sha256File(filePath) {
  const descriptor = openSync(filePath, "r");
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
    return hash.digest("hex");
  } finally {
    closeSync(descriptor);
  }
}

function managedReceiptTarget(currentRoot, value) {
  const relativePath = String(value || "").replaceAll("\\", "/");
  if (!relativePath || isAbsolute(relativePath)) return null;
  const root = resolve(currentRoot);
  const target = resolve(root, relativePath);
  const relation = relative(root, target).replaceAll("\\", "/");
  if (!relation || relation === ".." || relation.startsWith("../../..") || isAbsolute(relation)) return null;
  return target;
}

function fsyncFile(filePath) {
  // Windows requires a writable handle for FlushFileBuffers/fsync.
  const descriptor = openSync(filePath, "r+");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function inventoryTree(rootPath, options = {}) {
  const root = resolve(rootPath);
  const rootInfo = lstatSync(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    fail("AIEYRA_IDENTITY_MIGRATION_ROOT_UNSAFE", "Identity migration root is not a plain directory.");
  }
  const maxFiles = Math.max(1, Number(options.maxFiles) || DEFAULT_MAX_FILES);
  const maxBytes = Math.max(1, Number(options.maxBytes) || DEFAULT_MAX_BYTES);
  const hashFiles = options.hashFiles !== false;
  const directories = [];
  const files = [];
  let byteLength = 0;
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    const entries = readdirSync(current, { withFileTypes: true }).sort((a, b) => compareUtf16(a.name, b.name));
    for (const entry of entries) {
      const target = join(current, entry.name);
      const relativePath = safeRelativePath(root, target);
      const info = lstatSync(target);
      const entryKind = classifyInventoryEntry(entry, info, relativePath);
      if (shouldSkipIdentityMigrationPath(relativePath, options, entryKind)) continue;
      if (entryKind === "directory") {
        directories.push(relativePath);
        pending.push(target);
        continue;
      }
      files.push({
        relativePath,
        byteLength: info.size,
        ...(hashFiles ? { sha256: sha256File(target) } : {})
      });
      byteLength += info.size;
      if (files.length > maxFiles) fail("AIEYRA_IDENTITY_MIGRATION_FILE_BUDGET", "Identity migration source contains too many files.");
      if (byteLength > maxBytes) fail("AIEYRA_IDENTITY_MIGRATION_BYTE_BUDGET", "Identity migration source exceeds the byte budget.");
    }
  }
  directories.sort();
  files.sort((a, b) => compareUtf16(a.relativePath, b.relativePath));
  return { directories, files, fileCount: files.length, byteLength };
}

function inventoryIdentity(inventory) {
  return createHash("sha256").update(JSON.stringify(inventory)).digest("hex");
}

function dataTotalsWithoutReceipt(inventory) {
  const receiptKey = pathKey(MIGRATION_RECEIPT_FILE);
  const files = Array.isArray(inventory?.files) ? inventory.files : [];
  const dataFiles = files.filter((file) => pathKey(file?.relativePath) !== receiptKey);
  return {
    fileCount: dataFiles.length,
    byteLength: dataFiles.reduce((sum, file) => sum + Math.max(0, Number(file?.byteLength) || 0), 0)
  };
}

/**
 * Inspect a retired display-spelling root without reading or changing its
 * contents. A Chromium bootstrap shell is safe to leave in place; anything
 * beyond the single bounded Local State file is a recovery conflict.
 */
function inspectTransitionalUserDataRoot(options = {}) {
  const appDataRoot = resolve(String(options.appDataRoot || ""));
  const currentDirectoryName = String(options.currentDirectoryName || "").trim();
  const transitionalDirectoryName = String(options.transitionalDirectoryName || "").trim();
  if (!currentDirectoryName || !transitionalDirectoryName || currentDirectoryName === transitionalDirectoryName ||
    basename(currentDirectoryName) !== currentDirectoryName || basename(transitionalDirectoryName) !== transitionalDirectoryName ||
    basename(appDataRoot) === appDataRoot) {
    fail("AIEYRA_IDENTITY_TRANSITION_REQUEST_INVALID", "Transitional identity audit request is incomplete.");
  }
  const currentRoot = resolve(appDataRoot, currentDirectoryName);
  if (!samePath(dirname(currentRoot), appDataRoot)) {
    fail("AIEYRA_IDENTITY_TRANSITION_PATH_INVALID", "Current identity root is outside appData.");
  }
  const transitionalEntry = findDirectoryEntry(appDataRoot, transitionalDirectoryName);
  if (!transitionalEntry) {
    return {
      status: "absent",
      safeToIgnore: true,
      mutated: false,
      transitionalDirectoryName,
      requestedTransitionalDirectoryName: transitionalDirectoryName,
      currentDirectoryName,
      entryCount: 0,
      byteLength: 0
    };
  }
  const transitionalRoot = transitionalEntry.root;
  if (!samePath(dirname(transitionalRoot), appDataRoot)) {
    fail("AIEYRA_IDENTITY_TRANSITION_PATH_INVALID", "Transitional identity root is outside appData.");
  }
  let rootInfo;
  try {
    rootInfo = lstatSync(transitionalRoot);
  } catch {
    fail("AIEYRA_IDENTITY_TRANSITION_ROOT_UNREADABLE", "Transitional identity root could not be inspected.");
  }
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    fail("AIEYRA_IDENTITY_TRANSITION_ROOT_UNSAFE", "Transitional identity root is not a plain directory.");
  }
  let entries;
  try {
    entries = readdirSync(transitionalRoot, { withFileTypes: true }).sort((a, b) => compareUtf16(a.name, b.name));
  } catch {
    fail("AIEYRA_IDENTITY_TRANSITION_ROOT_UNREADABLE", "Transitional identity root could not be enumerated.");
  }
  if (!entries.length) {
    return {
      status: "empty",
      safeToIgnore: true,
      mutated: false,
      transitionalDirectoryName: transitionalEntry.directoryName,
      requestedTransitionalDirectoryName: transitionalDirectoryName,
      currentDirectoryName,
      entryCount: 0,
      byteLength: 0
    };
  }
  if (entries.length !== 1 || entries[0].name !== BOOTSTRAP_USER_DATA_FILE) {
    return {
      status: "nontrivial",
      safeToIgnore: false,
      mutated: false,
      transitionalDirectoryName: transitionalEntry.directoryName,
      requestedTransitionalDirectoryName: transitionalDirectoryName,
      currentDirectoryName,
      entryCount: entries.length,
      byteLength: 0
    };
  }
  const bootstrapPath = join(transitionalRoot, BOOTSTRAP_USER_DATA_FILE);
  let bootstrapInfo;
  try {
    bootstrapInfo = lstatSync(bootstrapPath);
  } catch {
    fail("AIEYRA_IDENTITY_TRANSITION_ROOT_UNREADABLE", "Transitional bootstrap state could not be inspected.");
  }
  if (!bootstrapInfo.isFile() || bootstrapInfo.isSymbolicLink() || bootstrapInfo.size < 1 || bootstrapInfo.size > BOOTSTRAP_USER_DATA_MAX_BYTES) {
    return {
      status: "nontrivial",
      safeToIgnore: false,
      mutated: false,
      transitionalDirectoryName: transitionalEntry.directoryName,
      requestedTransitionalDirectoryName: transitionalDirectoryName,
      currentDirectoryName,
      entryCount: 1,
      byteLength: Number(bootstrapInfo.size) || 0
    };
  }
  return {
    status: "bootstrap-only",
    safeToIgnore: true,
    mutated: false,
    transitionalDirectoryName: transitionalEntry.directoryName,
    requestedTransitionalDirectoryName: transitionalDirectoryName,
    currentDirectoryName,
    entryCount: 1,
    byteLength: bootstrapInfo.size
  };
}

function reconcileTransitionalUserDataRoot(options = {}) {
  const state = inspectTransitionalUserDataRoot(options);
  // A non-trivial transitional root is now a normal merge input.  Keep the
  // inspection result explicit for callers that want to surface the source,
  // but never stop the product before the automatic reconciliation pass.
  return {
    ...state,
    requiresMerge: state.status === "nontrivial"
  };
}

function assertSameInventory(expected, actual, code) {
  if (inventoryIdentity(expected) !== inventoryIdentity(actual)) {
    fail(code, "Identity migration source or staging bytes changed during verification.");
  }
}

function copyInventory(sourceRoot, stagingRoot, inventory) {
  mkdirSync(stagingRoot, { recursive: false });
  for (const relativePath of inventory.directories) mkdirSync(join(stagingRoot, relativePath), { recursive: true });
  for (const file of inventory.files) {
    const source = join(sourceRoot, file.relativePath);
    const target = join(stagingRoot, file.relativePath);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
    fsyncFile(target);
  }
}

function migrationReceiptBytes(receipt) {
  let serialized;
  try {
    serialized = JSON.stringify(receipt);
  } catch {
    fail("AIEYRA_IDENTITY_MIGRATION_RECEIPT_INVALID", "Identity migration receipt could not be serialized.");
  }
  return Buffer.from(`${serialized}\n`, "utf8");
}

function receiptCount(value, fallback) {
  return Number.isSafeInteger(value) && value >= fallback ? value : fallback;
}

function boundedMigrationReceipt(receipt) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    fail("AIEYRA_IDENTITY_MIGRATION_RECEIPT_INVALID", "Identity migration receipt is invalid.");
  }
  let bounded = {
    ...receipt,
    conflicts: Array.isArray(receipt.conflicts) ? [...receipt.conflicts] : [],
    quarantined: Array.isArray(receipt.quarantined) ? [...receipt.quarantined] : [],
    managedFiles: Array.isArray(receipt.managedFiles) ? [...receipt.managedFiles] : []
  };
  const totals = {
    conflicts: receiptCount(receipt.conflictCount, bounded.conflicts.length),
    quarantined: receiptCount(receipt.quarantinedCount, bounded.quarantined.length),
    managedFiles: receiptCount(receipt.managedFileCount, bounded.managedFiles.length)
  };
  bounded = {
    ...bounded,
    quarantinedCount: totals.quarantined,
    managedFileCount: totals.managedFiles,
    conflictsTruncated: receipt.conflictsTruncated === true || bounded.conflicts.length < totals.conflicts,
    quarantinedTruncated: receipt.quarantinedTruncated === true || bounded.quarantined.length < totals.quarantined,
    managedFilesTruncated: receipt.managedFilesTruncated === true || bounded.managedFiles.length < totals.managedFiles
  };

  // Preserve installer-authoritative summaries and keep as much optional
  // diagnostics/idempotence detail as the shared receipt budget permits.
  for (const [field, truncatedField] of [
    ["managedFiles", "managedFilesTruncated"],
    ["conflicts", "conflictsTruncated"],
    ["quarantined", "quarantinedTruncated"]
  ]) {
    if (migrationReceiptBytes(bounded).length <= MIGRATION_RECEIPT_MAX_BYTES) break;
    const entries = bounded[field];
    let low = 0;
    let high = entries.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      const candidate = { ...bounded, [field]: entries.slice(0, middle), [truncatedField]: true };
      if (migrationReceiptBytes(candidate).length <= MIGRATION_RECEIPT_MAX_BYTES) low = middle;
      else high = middle - 1;
    }
    bounded = { ...bounded, [field]: entries.slice(0, low), [truncatedField]: true };
  }
  if (migrationReceiptBytes(bounded).length > MIGRATION_RECEIPT_MAX_BYTES) {
    fail("AIEYRA_IDENTITY_MIGRATION_RECEIPT_TOO_LARGE", "Identity migration receipt exceeds its byte budget.");
  }
  return bounded;
}

function migrationReceiptTargetIdentity(target) {
  if (!existsSync(target)) return null;
  const info = lstatSync(target);
  if (!info.isFile() || info.isSymbolicLink()) {
    fail("AIEYRA_IDENTITY_MIGRATION_RECEIPT_UNSAFE", "Identity migration receipt target is not a plain file.");
  }
  return info;
}

function sameMigrationReceiptTarget(left, right) {
  return Boolean(left && right && ["dev", "ino", "mode", "size", "mtimeMs", "ctimeMs"].every((field) => left[field] === right[field]));
}

function writeMigrationReceipt(currentRoot, receipt) {
  const target = join(currentRoot, MIGRATION_RECEIPT_FILE);
  const temporary = `${target}.${randomBytes(8).toString("hex")}.tmp`;
  const existing = migrationReceiptTargetIdentity(target);
  const payload = migrationReceiptBytes(boundedMigrationReceipt(receipt));
  try {
    writeFileSync(temporary, payload, { flag: "wx" });
    fsyncFile(temporary);
    if (!existing) {
      if (existsSync(target)) fail("AIEYRA_IDENTITY_MIGRATION_RECEIPT_CHANGED", "Identity migration receipt target appeared while it was being written.");
      renameSync(temporary, target);
      return;
    }
    const current = migrationReceiptTargetIdentity(target);
    if (!sameMigrationReceiptTarget(existing, current)) {
      fail("AIEYRA_IDENTITY_MIGRATION_RECEIPT_CHANGED", "Identity migration receipt target changed while it was being written.");
    }
    const previous = `${target}.${randomBytes(8).toString("hex")}.previous`;
    try {
      renameSync(target, previous);
      renameSync(temporary, target);
    } catch (error) {
      if (!existsSync(target) && existsSync(previous)) {
        try { renameSync(previous, target); } catch { /* preserve the recovery copy */ }
      }
      throw error;
    }
    if (existsSync(previous)) rmSync(previous, { force: true });
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { force: true });
  }
}

function normalizedDirectoryName(value) {
  return String(value || "").trim().toLowerCase();
}

function appDataDirectoryEntries(appDataRoot) {
  try {
    return readdirSync(appDataRoot, { withFileTypes: true });
  } catch {
    fail("AIEYRA_IDENTITY_MIGRATION_ROOT_UNREADABLE", "Application data root could not be enumerated.");
  }
}

function findDirectoryEntry(appDataRoot, directoryName, options = {}) {
  const requested = String(directoryName || "").trim();
  if (!requested || basename(requested) !== requested) return null;
  const entries = appDataDirectoryEntries(appDataRoot);
  const matches = entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && (
    options.exact ? entry.name === requested : normalizedDirectoryName(entry.name) === normalizedDirectoryName(requested)
  ));
  if (matches.length > 1) {
    fail("AIEYRA_IDENTITY_AMBIGUOUS_ROOT", "Identity migration found more than one matching data root.", {
      directoryName: requested,
      matches: matches.map((entry) => entry.name)
    });
  }
  if (!matches.length) return null;
  const entry = matches[0];
  const root = resolve(appDataRoot, entry.name);
  const info = lstatSync(root);
  if (!info.isDirectory() || info.isSymbolicLink() || !samePath(dirname(root), appDataRoot)) {
    fail("AIEYRA_IDENTITY_MIGRATION_ROOT_UNSAFE", "Identity migration root is not a plain child directory.", {
      directoryName: entry.name
    });
  }
  return { directoryName: entry.name, requestedDirectoryName: requested, root };
}

/**
 * Detect only explicitly named legacy roots without reading their contents or
 * creating the current root. Case-only spellings of the current identity are
 * aliases on Windows and must never trigger pre-activation migration.
 */
function hasKnownLegacyDataRoot(options = {}) {
  const appDataRoot = resolve(String(options.appDataRoot || ""));
  const currentDirectoryName = String(options.currentDirectoryName || "").trim();
  const legacyDirectoryNames = [...new Set(
    (options.legacyDirectoryNames || []).map((value) => String(value || "").trim()).filter(Boolean)
  )];
  if (!currentDirectoryName || basename(appDataRoot) === appDataRoot) {
    fail("AIEYRA_IDENTITY_MIGRATION_REQUEST_INVALID", "Identity migration probe request is incomplete.");
  }
  const currentRoot = resolve(appDataRoot, currentDirectoryName);
  if (!samePath(dirname(currentRoot), appDataRoot)) {
    fail("AIEYRA_IDENTITY_MIGRATION_PATH_INVALID", "Current identity root is outside appData.");
  }
  for (const directoryName of legacyDirectoryNames) {
    if (basename(directoryName) !== directoryName || [".", ".."].includes(directoryName)) {
      fail("AIEYRA_IDENTITY_MIGRATION_REQUEST_INVALID", "Legacy identity directory name is invalid.");
    }
    if (normalizedDirectoryName(directoryName) === normalizedDirectoryName(currentDirectoryName)) continue;
    const legacy = findDirectoryEntry(appDataRoot, directoryName);
    if (legacy && !samePath(legacy.root, currentRoot)) return true;
  }
  return false;
}

function rootFastSummary(root, options = {}) {
  const info = lstatSync(root);
  const inventory = inventoryTree(root, { ...options, hashFiles: false });
  return {
    fileCount: inventory.fileCount,
    byteLength: inventory.byteLength,
    rootMtimeMs: Number(info.mtimeMs) || 0
  };
}

function readMigrationReceipt(currentRoot) {
  const target = join(currentRoot, MIGRATION_RECEIPT_FILE);
  if (!existsSync(target)) return null;
  try {
    const before = lstatSync(target);
    if (!before.isFile() || before.isSymbolicLink() || before.size < 2 || before.size > MIGRATION_RECEIPT_MAX_BYTES) return null;
    const bytes = readFileSync(target);
    const after = lstatSync(target);
    if (!after.isFile() || after.isSymbolicLink() || bytes.length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) return null;
    // The producer never emits a BOM. Keep both runtime and installer consumers
    // on the same fail-closed byte contract instead of silently normalizing it.
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function pathKey(relativePath) {
  const normalized = String(relativePath || "").split("\\").join("/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function emptyInventory() {
  return { directories: [], files: [], fileCount: 0, byteLength: 0 };
}

function inventoryFileMap(inventory) {
  return new Map((inventory?.files || []).map((file) => [pathKey(file.relativePath), file]));
}

function sourceSummary(source, inventory, hashFiles) {
  const info = lstatSync(source.root);
  return {
    directoryName: source.directoryName,
    requestedDirectoryName: source.requestedDirectoryName || source.directoryName,
    fileCount: inventory.fileCount,
    byteLength: inventory.byteLength,
    rootMtimeMs: Number(info.mtimeMs) || 0,
    ...(hashFiles ? { treeSha256: inventoryIdentity(inventory) } : {})
  };
}

function sourceSummaryMatches(root, expected, options = {}) {
  if (!expected || !existsSync(root)) return false;
  const actual = rootFastSummary(root, options);
  if (actual.fileCount !== Number(expected.fileCount)
    || actual.byteLength !== Number(expected.byteLength)
    || actual.rootMtimeMs !== Number(expected.rootMtimeMs)) return false;
  // The cheap summary is only a first filter. A source can be edited without
  // changing its size or parent directory mtime, so a receipt fast path still
  // verifies the recorded content digest before skipping reconciliation.
  if (expected.treeSha256) {
    const verified = inventoryTree(root, options);
    return inventoryIdentity(verified) === expected.treeSha256;
  }
  return true;
}

function safeRecoveryName(value) {
  const cleaned = String(value || "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.slice(0, 80) || "unknown-root";
}

function ensurePlainChildDirectory(parentRoot, directoryName, code) {
  const parent = resolve(parentRoot);
  const target = resolve(parent, directoryName);
  if (!samePath(dirname(target), parent)) {
    fail(code, "Identity recovery path escaped its owned parent.");
  }
  if (!existsSync(target)) mkdirSync(target, { recursive: true });
  const info = lstatSync(target);
  if (!info.isDirectory() || info.isSymbolicLink() || !samePath(dirname(target), parent)) {
    fail(code, "Identity recovery directory is not a plain child directory.", { directoryName });
  }
  return target;
}

function managedFilesMatchReceipt(currentRoot, receipt, options = {}) {
  if (
    receipt?.managedFilesTruncated || !Array.isArray(receipt?.managedFiles) ||
    !Number.isSafeInteger(receipt?.managedFileCount) || receipt.managedFileCount !== receipt.managedFiles.length
  ) return false;
  for (const file of receipt.managedFiles) {
    if (shouldSkipIdentityMigrationPath(file?.relativePath, options, "file")) continue;
    const target = managedReceiptTarget(currentRoot, file?.relativePath);
    if (!target || !/^[a-f0-9]{64}$/i.test(String(file?.sha256 || ""))) return false;
    if (!existsSync(target)) return false;
    let info;
    try { info = lstatSync(target); } catch { return false; }
    if (!info.isFile() || info.isSymbolicLink() || Number(info.size) !== Number(file.byteLength)) return false;
    try {
      if (sha256File(target) !== String(file.sha256).toLowerCase()) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function copySelectedFiles(selected, stagingRoot) {
  mkdirSync(stagingRoot, { recursive: false });
  const copied = [];
  for (const item of selected) {
    const source = join(item.sourceRoot, item.file.relativePath);
    const target = join(stagingRoot, item.file.relativePath);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
    fsyncFile(target);
    copied.push({ ...item, stagedPath: target });
  }
  return copied;
}

function verifySelectedFiles(copied) {
  for (const item of copied) {
    const actual = lstatSync(item.stagedPath);
    if (!actual.isFile() || actual.isSymbolicLink() || actual.size !== item.file.byteLength || sha256File(item.stagedPath) !== item.file.sha256) {
      fail("AIEYRA_IDENTITY_STAGING_MISMATCH", "Identity migration staging bytes changed during verification.", {
        relativePath: item.file.relativePath
      });
    }
  }
}

function removePublishedFiles(published) {
  for (const target of [...published].reverse()) {
    try {
      if (existsSync(target) && lstatSync(target).isFile()) unlinkSync(target);
    } catch { /* Best-effort rollback; the journal remains for recovery. */ }
  }
}

function quarantineUnknownIdentityRoots(options = {}) {
  const appDataRoot = resolve(String(options.appDataRoot || ""));
  const knownNames = new Set((options.knownDirectoryNames || []).map(normalizedDirectoryName));
  const entries = appDataDirectoryEntries(appDataRoot);
  const candidates = entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink()
    && !knownNames.has(normalizedDirectoryName(entry.name))
    && !entry.name.startsWith(STAGING_PREFIX)
    && normalizedDirectoryName(entry.name) !== normalizedDirectoryName(RECOVERY_DIRECTORY_NAME)
    && /aieyra|iiimage|workspace/i.test(entry.name));
  if (!candidates.length) return [];
  const recoveryRoot = ensurePlainChildDirectory(appDataRoot, RECOVERY_DIRECTORY_NAME, "AIEYRA_IDENTITY_RECOVERY_ROOT_UNSAFE");
  const results = [];
  for (const entry of candidates) {
    const sourceRoot = resolve(appDataRoot, entry.name);
    const sourceInventory = inventoryTree(sourceRoot, options);
    const targetName = safeRecoveryName(entry.name);
    const targetBase = resolve(recoveryRoot, targetName);
    if (!samePath(dirname(targetBase), recoveryRoot)) fail("AIEYRA_IDENTITY_RECOVERY_PATH_INVALID", "Identity recovery target escaped its recovery root.");
    const existingInfo = existsSync(targetBase) ? lstatSync(targetBase) : null;
    if (existingInfo && (!existingInfo.isDirectory() || existingInfo.isSymbolicLink())) {
      fail("AIEYRA_IDENTITY_RECOVERY_TARGET_UNSAFE", "Identity recovery target is not a plain directory.", { directoryName: targetName });
    }
    const existing = existingInfo ? inventoryTree(targetBase, options) : null;
    if (existing && inventoryIdentity(existing) === inventoryIdentity(sourceInventory)) {
      results.push({ directoryName: entry.name, status: "already-quarantined", treeSha256: inventoryIdentity(sourceInventory) });
      continue;
    }
    const target = existing ? resolve(recoveryRoot, `${targetName}-${randomBytes(4).toString("hex")}`) : targetBase;
    const staging = resolve(recoveryRoot, `${STAGING_PREFIX}${randomBytes(8).toString("hex")}`);
    if (!samePath(dirname(target), recoveryRoot) || !samePath(dirname(staging), recoveryRoot)) {
      fail("AIEYRA_IDENTITY_RECOVERY_PATH_INVALID", "Identity recovery staging escaped its recovery root.");
    }
    try {
      copyInventory(sourceRoot, staging, sourceInventory);
      const staged = inventoryTree(staging, options);
      assertSameInventory(sourceInventory, staged, "AIEYRA_IDENTITY_QUARANTINE_MISMATCH");
      renameSync(staging, target);
      results.push({ directoryName: entry.name, status: "quarantined", targetDirectoryName: basename(target), treeSha256: inventoryIdentity(sourceInventory) });
    } catch (error) {
      if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
      throw error;
    }
  }
  return results;
}

function reconcileIdentityDataRoots(options = {}) {
  const appDataRoot = resolve(String(options.appDataRoot || ""));
  const currentDirectoryName = String(options.currentDirectoryName || "").trim();
  const legacyDirectoryNames = [...new Set((options.legacyDirectoryNames || []).map((value) => String(value || "").trim()).filter(Boolean))];
  const transitionalDirectoryNames = [...new Set((options.transitionalDirectoryNames || []).map((value) => String(value || "").trim()).filter(Boolean))];
  if (!currentDirectoryName || basename(appDataRoot) === appDataRoot) {
    fail("AIEYRA_IDENTITY_MIGRATION_REQUEST_INVALID", "Identity migration request is incomplete.");
  }
  const canonicalRoot = resolve(appDataRoot, currentDirectoryName);
  if (!samePath(dirname(canonicalRoot), appDataRoot)) {
    fail("AIEYRA_IDENTITY_MIGRATION_PATH_INVALID", "Current identity root is outside appData.");
  }
  const exactCurrent = findDirectoryEntry(appDataRoot, currentDirectoryName, { exact: true });
  const currentAlias = exactCurrent ? null : findDirectoryEntry(appDataRoot, currentDirectoryName);
  const current = exactCurrent || currentAlias;
  const sourceRoots = [];
  const seenRoots = new Set();
  const addSource = (source, reason) => {
    if (!source || (current && samePath(source.root, current.root))) return;
    const key = process.platform === "win32" ? source.root.toLowerCase() : source.root;
    if (seenRoots.has(key)) return;
    seenRoots.add(key);
    sourceRoots.push({ ...source, reason });
  };
  // A case-only legacy spelling is the active base when the canonical folder
  // is not present. It must not be treated as a conflict.
  for (const directoryName of transitionalDirectoryNames) addSource(findDirectoryEntry(appDataRoot, directoryName), "transitional");
  for (const directoryName of legacyDirectoryNames) addSource(findDirectoryEntry(appDataRoot, directoryName), "legacy");
  const currentRoot = current?.root || canonicalRoot;
  const currentExists = Boolean(current);
  if (!currentExists && !sourceRoots.length) {
    const quarantined = options.quarantineUnknownRoots === false ? [] : quarantineUnknownIdentityRoots({
      ...options,
      appDataRoot,
      knownDirectoryNames: [currentDirectoryName, ...transitionalDirectoryNames, ...legacyDirectoryNames, RECOVERY_DIRECTORY_NAME]
    });
    return {
      status: quarantined.length ? "quarantined-only" : "no-legacy-root",
      migrated: false,
      currentDirectoryName,
      currentRootSpelling: null,
      sourceCount: 0,
      quarantined
    };
  }

  const existingReceipt = currentExists ? readMigrationReceipt(currentRoot) : null;
  if (existingReceipt?.schemaVersion >= MIGRATION_SCHEMA_VERSION && existingReceipt.status === "reconciled") {
    const receiptSources = Array.isArray(existingReceipt.sources) ? existingReceipt.sources : [];
    const summariesMatch = Array.isArray(existingReceipt.sources) && receiptSources.every((summary) => {
      const source = [...sourceRoots].find((item) => item.directoryName === summary.directoryName);
      return source && sourceSummaryMatches(source.root, summary, options);
    });
    if (summariesMatch
      && receiptSources.length === sourceRoots.length
      && Number(existingReceipt.sourceCount || 0) === sourceRoots.length
      && managedFilesMatchReceipt(currentRoot, existingReceipt, options)) {
      if (existingReceipt.currentRootSpelling !== current.directoryName) {
        writeMigrationReceipt(currentRoot, {
          ...existingReceipt,
          currentRootSpelling: current.directoryName,
          spellingNormalizedAt: new Date().toISOString()
        });
      }
      return {
        status: "already-reconciled",
        migrated: false,
        currentDirectoryName,
        currentRootSpelling: current?.directoryName || currentDirectoryName,
        sourceCount: sourceRoots.length,
        conflictCount: Number(existingReceipt.conflictCount || 0),
        quarantined: existingReceipt.quarantined || []
      };
    }
  }

  const currentInventory = currentExists ? inventoryTree(currentRoot, options) : emptyInventory();
  const currentFiles = inventoryFileMap(currentInventory);
  const sourceInventories = sourceRoots.map((source) => ({ source, inventory: inventoryTree(source.root, options) }));
  const selected = [];
  const conflicts = [];
  const planned = new Map(currentFiles);
  for (const { source, inventory } of sourceInventories) {
    for (const file of inventory.files) {
      if (pathKey(file.relativePath) === pathKey(MIGRATION_RECEIPT_FILE)) continue;
      const key = pathKey(file.relativePath);
      const kept = planned.get(key);
      if (kept) {
        conflicts.push({
          relativePath: file.relativePath,
          keptFrom: kept.__sourceDirectoryName || current?.directoryName || currentDirectoryName,
          skippedFrom: source.directoryName,
          kind: kept.sha256 === file.sha256 ? "same-bytes" : "current-or-earlier-wins"
        });
        continue;
      }
      planned.set(key, { ...file, __sourceDirectoryName: source.directoryName });
      selected.push({ sourceRoot: source.root, sourceDirectoryName: source.directoryName, file });
    }
  }

  const token = randomBytes(12).toString("hex");
  const stagingRoot = resolve(appDataRoot, `${STAGING_PREFIX}${token}`);
  if (!samePath(dirname(stagingRoot), appDataRoot) || existsSync(stagingRoot)) {
    fail("AIEYRA_IDENTITY_MIGRATION_STAGING_UNSAFE", "Identity migration staging path is unavailable.");
  }
  let copied = [];
  const published = [];
  let createdCurrentRoot = false;
  const managedPublished = [];
  try {
    if (!currentExists) {
      copied = copySelectedFiles(selected, stagingRoot);
      verifySelectedFiles(copied);
      if (typeof options.afterCopy === "function") options.afterCopy({ stagingRoot, sourceRoots });
      for (const { source, inventory } of sourceInventories) {
        assertSameInventory(inventory, inventoryTree(source.root, options), "AIEYRA_IDENTITY_SOURCE_CHANGED");
      }
      renameSync(stagingRoot, currentRoot);
      createdCurrentRoot = true;
      managedPublished.push(...selected.map((item) => item.file));
    } else if (selected.length) {
      copied = copySelectedFiles(selected, stagingRoot);
      verifySelectedFiles(copied);
      if (typeof options.afterCopy === "function") options.afterCopy({ stagingRoot, sourceRoots });
      for (const { source, inventory } of sourceInventories) {
        assertSameInventory(inventory, inventoryTree(source.root, options), "AIEYRA_IDENTITY_SOURCE_CHANGED");
      }
      for (const item of copied) {
        const target = join(currentRoot, item.file.relativePath);
        if (existsSync(target)) {
          // A file may have appeared while the staging pass was running. The
          // current root still wins; discard this staged copy and continue.
          conflicts.push({ relativePath: item.file.relativePath, keptFrom: current?.directoryName || currentDirectoryName, skippedFrom: item.sourceDirectoryName, kind: "appeared-during-publish" });
          continue;
        }
        mkdirSync(dirname(target), { recursive: true });
        renameSync(item.stagedPath, target);
        published.push(target);
        managedPublished.push(item.file);
      }
    }
    const summaries = sourceInventories.map(({ source, inventory }) => sourceSummary(source, inventory, true));
    const limitedConflicts = conflicts.slice(0, MAX_RECORDED_CONFLICTS);
    const quarantine = options.quarantineUnknownRoots === false ? [] : quarantineUnknownIdentityRoots({
      ...options,
      appDataRoot,
      knownDirectoryNames: [currentDirectoryName, ...transitionalDirectoryNames, ...legacyDirectoryNames, RECOVERY_DIRECTORY_NAME]
    });
    const managedCandidates = new Map();
    for (const file of managedPublished) managedCandidates.set(pathKey(file.relativePath), file);
    for (const { inventory } of sourceInventories) {
      for (const file of inventory.files) {
        if (pathKey(file.relativePath) === pathKey(MIGRATION_RECEIPT_FILE)) continue;
        const currentFile = currentFiles.get(pathKey(file.relativePath));
        if (currentFile && currentFile.sha256 === file.sha256) managedCandidates.set(pathKey(file.relativePath), file);
      }
    }
    const managedFiles = [...managedCandidates.values()];
    // In the merge-into-existing case files have been atomically moved out of
    // staging one by one. Remove the now-empty transaction directory only
    // after every source and receipt check has succeeded.
    if (existsSync(stagingRoot)) rmSync(stagingRoot, { recursive: true, force: true });
    const publishedTotals = dataTotalsWithoutReceipt(inventoryTree(currentRoot, options));
    writeMigrationReceipt(currentRoot, {
      schemaVersion: MIGRATION_SCHEMA_VERSION,
      status: "reconciled",
      currentDirectoryName,
      currentRootSpelling: current?.directoryName || currentDirectoryName,
      currentRootWasExisting: currentExists,
      sourceCount: sourceRoots.length,
      sources: summaries,
      fileCount: publishedTotals.fileCount,
      byteLength: publishedTotals.byteLength,
      conflictCount: conflicts.length,
      conflicts: limitedConflicts,
      conflictsTruncated: conflicts.length > limitedConflicts.length,
      managedFileCount: managedFiles.length,
      managedFiles: managedFiles.slice(0, MAX_MANAGED_RECEIPT_FILES).map((file) => ({
        relativePath: file.relativePath,
        byteLength: file.byteLength,
        sha256: file.sha256
      })),
      managedFilesTruncated: managedFiles.length > MAX_MANAGED_RECEIPT_FILES,
      quarantinedCount: quarantine.length,
      quarantined: quarantine,
      quarantinedTruncated: false,
      legacyRootsRetained: true,
      migratedAt: new Date().toISOString()
    });
    return {
      status: currentExists && !selected.length ? "reconciled" : "migrated",
      migrated: Boolean(selected.length || !currentExists),
      currentDirectoryName,
      currentRootSpelling: current?.directoryName || currentDirectoryName,
      sourceCount: sourceRoots.length,
      fileCount: publishedTotals.fileCount,
      byteLength: publishedTotals.byteLength,
      conflictCount: conflicts.length,
      quarantined: quarantine,
      legacyRootsRetained: true
    };
  } catch (error) {
    if (published.length) removePublishedFiles(published);
    if (createdCurrentRoot && existsSync(currentRoot)) rmSync(currentRoot, { recursive: true, force: true });
    if (existsSync(stagingRoot)) rmSync(stagingRoot, { recursive: true, force: true });
    throw error;
  }
}

// Backward-compatible entry point used by older maintenance scripts. The new
// behavior is deliberately merge-first and idempotent; callers that only pass
// one legacy root receive the same useful fields plus conflict accounting.
function migrateLegacyUserDataRoot(options = {}) {
  return reconcileIdentityDataRoots(options);
}

module.exports = {
  BOOTSTRAP_USER_DATA_FILE,
  BOOTSTRAP_USER_DATA_MAX_BYTES,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_FILES,
  IdentityDataMigrationError,
  MIGRATION_SCHEMA_VERSION,
  MIGRATION_RECEIPT_FILE,
  MIGRATION_RECEIPT_MAX_BYTES,
  RECOVERY_DIRECTORY_NAME,
  STAGING_PREFIX,
  boundedMigrationReceipt,
  classifyInventoryEntry,
  hasKnownLegacyDataRoot,
  inspectTransitionalUserDataRoot,
  isVolatileChromiumPath,
  isWorkspaceMigrationCachePath,
  inventoryIdentity,
  inventoryTree,
  migrateLegacyUserDataRoot,
  reconcileIdentityDataRoots,
  reconcileTransitionalUserDataRoot,
  writeMigrationReceipt
};
