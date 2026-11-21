"use strict";
const { createHash } = require("node:crypto");
const { lstatSync, readFileSync } = require("node:fs");
const path = require("node:path");
const { Worker } = require("node:worker_threads");

const PDF_IMPORT_MAX_BYTES = 64 * 1024 * 1024;
const PDF_TIMEOUT_MS = 15_000;
const PDF_PARSER_VERSION = "pdfjs-dist-6.2.108+iiimage-pdf-v1";
const PDF_WORKER_RESOURCE_LIMITS = Object.freeze({
  maxOldGenerationSizeMb: 192,
  maxYoungGenerationSizeMb: 32,
  codeRangeSizeMb: 32
});
let activePdfParse = false;
const pendingPdfParses = [];
let reusablePdfWorker = null;
let pdfWorkerCreatedCount = 0;
let pdfWorkerRetiredCount = 0;
let pdfWorkerShutdownRequested = false;
class WritingPdfError extends Error { constructor(code, message) { super(message); this.name = "WritingPdfError"; this.code = code; } }
function fail(code, message) { throw new WritingPdfError(code, message); }
function sha256Buffer(buffer) { return createHash("sha256").update(buffer).digest("hex"); }
function assertPdfPathHasNoSymlink(filePath) {
  const resolved = path.resolve(String(filePath || ""));
  const parsed = path.parse(resolved); let cursor = parsed.root;
  for (const segment of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    const info = lstatSync(cursor);
    if (info.isSymbolicLink()) fail("WRITING_PDF_SOURCE_INVALID", "PDF 导入路径不能包含符号链接或 junction。");
  }
  return resolved;
}
function strictXref(bytes) {
  const ascii = Buffer.from(bytes).toString("binary"); const match = ascii.match(/startxref\s+(\d+)\s+%%EOF\s*$/);
  if (!match) return false; const offset = Number(match[1]);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= bytes.length) return false;
  if (ascii.slice(offset, offset + 5) === "xref\n" || ascii.slice(offset, offset + 6) === "xref\r\n") return true;
  return /\/Type\s*\/XRef\b/.test(ascii.slice(offset, Math.min(bytes.length, offset + 65536)));
}
function preflight(bytes) {
  const ascii = Buffer.from(bytes).toString("binary");
  if (bytes.length < 5 || ascii.slice(0, 5) !== "%PDF-") fail("WRITING_PDF_INVALID", "文件不是有效 PDF。");
  if (!strictXref(bytes)) fail("WRITING_PDF_XREF_INVALID", "PDF xref 入口无效。")
  if (/\/Encrypt\b/.test(ascii)) fail("WRITING_PDF_ENCRYPTED_REJECTED", "加密或受权限保护的 PDF 不受支持。")
  if (/\/(?:JavaScript|JS)\b/.test(ascii)) fail("WRITING_PDF_JAVASCRIPT_REJECTED", "PDF 包含 JavaScript 动作。")
  if (/\/(?:EmbeddedFiles|EmbeddedFile)\b/.test(ascii)) fail("WRITING_PDF_ATTACHMENT_REJECTED", "PDF 包含嵌入文件。")
  const standardFonts = new Set([
    "Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique",
    "Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique",
    "Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic",
    "Symbol", "ZapfDingbats"
  ]);
  const baseFonts = [...ascii.matchAll(/\/BaseFont\s*\/([^\s\/<>()\[\]]+)/g)].map((match) => match[1]);
  return {
    likelyMissingFont: baseFonts.some((font) => !standardFonts.has(font)) && !/\/FontFile(?:2|3)?\b/.test(ascii)
  };
}
function assertPreparedPdfSourceStable(sourcePath, prepared) {
  const resolved = assertPdfPathHasNoSymlink(sourcePath);
  const before = lstatSync(resolved);
  if (!prepared || before.isSymbolicLink() || !before.isFile() || before.size > PDF_IMPORT_MAX_BYTES) fail("WRITING_SOURCE_CHANGED", "PDF 导入源在准备后发生变化。");
  const bytes = readFileSync(resolved); const after = lstatSync(resolved);
  if (
    after.isSymbolicLink() || before.size !== after.size || before.mtimeMs !== after.mtimeMs || bytes.length !== before.size
    || bytes.length !== Number(prepared.byteLength) || sha256Buffer(bytes) !== String(prepared.expectedSourceSha256 || "").toLowerCase()
  ) fail("WRITING_SOURCE_CHANGED", "PDF 导入源在准备后发生变化。");
  return { sourcePath: resolved, sha256: sha256Buffer(bytes), byteLength: bytes.length };
}
function drainPdfParseQueue() {
  if (activePdfParse) return;
  const ticket = pendingPdfParses.shift();
  if (!ticket) return;
  if (ticket.signal?.aborted) {
    ticket.reject(new WritingPdfError("WRITING_PDF_CANCELLED", "PDF 解析已取消。"));
    drainPdfParseQueue();
    return;
  }
  activePdfParse = true;
  ticket.signal?.removeEventListener("abort", ticket.cancel);
  Promise.resolve()
    .then(ticket.run)
    .then(ticket.resolve, ticket.reject)
    .finally(() => {
      activePdfParse = false;
      drainPdfParseQueue();
    });
}
function withPdfParseSlot(run, signal) {
  return new Promise((resolve, reject) => {
    const ticket = { run, signal, resolve, reject, cancel: null };
    ticket.cancel = () => {
      const index = pendingPdfParses.indexOf(ticket);
      if (index < 0) return;
      pendingPdfParses.splice(index, 1);
      reject(new WritingPdfError("WRITING_PDF_CANCELLED", "PDF 解析已取消。"));
    };
    signal?.addEventListener("abort", ticket.cancel, { once: true });
    pendingPdfParses.push(ticket);
    drainPdfParseQueue();
  });
}
function createReusablePdfWorker() {
  const workerModulePath = path.join(__dirname, "writing-pdf-worker.cjs");
  const worker = new Worker(`require(${JSON.stringify(workerModulePath)});`, {
    eval: true,
    resourceLimits: PDF_WORKER_RESOURCE_LIMITS
  });
  pdfWorkerCreatedCount += 1;
  worker.on("error", () => { if (reusablePdfWorker === worker) reusablePdfWorker = null; });
  worker.on("exit", () => { if (reusablePdfWorker === worker) reusablePdfWorker = null; });
  worker.unref();
  reusablePdfWorker = worker;
  return worker;
}
function activeReusablePdfWorker() { return reusablePdfWorker || createReusablePdfWorker(); }
async function retirePdfWorker(worker) {
  if (reusablePdfWorker === worker) reusablePdfWorker = null;
  pdfWorkerRetiredCount += 1;
  try { await worker.terminate(); } catch { }
}
function pdfWorkerDiagnostics() {
  return {
    active: Boolean(reusablePdfWorker),
    activeParse: activePdfParse,
    pendingCount: pendingPdfParses.length,
    createdCount: pdfWorkerCreatedCount,
    retiredCount: pdfWorkerRetiredCount
  };
}
async function shutdownPdfWorker() {
  pdfWorkerShutdownRequested = true;
  const queued = pendingPdfParses.splice(0);
  for (const ticket of queued) {
    ticket.signal?.removeEventListener("abort", ticket.cancel);
    ticket.reject(new WritingPdfError("WRITING_PDF_CANCELLED", "应用正在退出，PDF 解析已取消。"));
  }
  const worker = reusablePdfWorker;
  if (worker) await retirePdfWorker(worker);
  return { workerTerminated: Boolean(worker), queuedParseCount: queued.length };
}
function runPdfWorkerNow(bytes, options = {}) {
  if (options.signal?.aborted) return Promise.reject(new WritingPdfError("WRITING_PDF_CANCELLED", "PDF 解析已取消。"));
  const worker = activeReusablePdfWorker();
  worker.ref();
  return new Promise((resolve, reject) => {
    let settled = false;
    const detach = () => {
      worker.off("message", onMessage);
      worker.off("error", onError);
      worker.off("exit", onExit);
    };
    const finish = async (callback, retire = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", cancel);
      detach();
      try {
        if (retire) await retirePdfWorker(worker);
        else worker.unref();
      } finally { callback(); }
    };
    const cancel = () => { void finish(() => reject(new WritingPdfError("WRITING_PDF_CANCELLED", "PDF 解析已取消。")), true); };
    const timer = setTimeout(() => { void finish(() => reject(new WritingPdfError("WRITING_PDF_TIMEOUT", "PDF 解析超过 15 秒限制。")), true); }, PDF_TIMEOUT_MS + 500);
    timer.unref?.();
    const onMessage = (message) => { void finish(() => message?.ok
      ? resolve(message.value)
      : reject(new WritingPdfError(message?.error?.code || "WRITING_PDF_PARSE_FAILED", message?.error?.message || "PDF 解析失败。"))); };
    const onError = (error) => { void finish(() => reject(new WritingPdfError(
      error?.code === "ERR_WORKER_OUT_OF_MEMORY" ? "WRITING_PDF_MEMORY_LIMIT" : "WRITING_PDF_PARSE_FAILED",
      error.message || "PDF worker 失败。"
    )), true); };
    const onExit = (code) => { void finish(() => reject(new WritingPdfError("WRITING_PDF_PARSE_FAILED", `PDF worker 异常退出（${code}）。`)), false); };
    worker.once("message", onMessage);
    worker.once("error", onError);
    worker.once("exit", onExit);
    options.signal?.addEventListener("abort", cancel, { once: true });
    try { worker.postMessage({ bytes: new Uint8Array(bytes), options: { fontFallbackLikely: options.fontFallbackLikely === true } }); }
    catch (error) { void finish(() => reject(new WritingPdfError("WRITING_PDF_PARSE_FAILED", error?.message || "PDF worker 启动失败。")), true); }
  });
}
function runPdfWorker(bytes, options = {}) {
  if (pdfWorkerShutdownRequested) return Promise.reject(new WritingPdfError("WRITING_PDF_CANCELLED", "应用正在退出，PDF 解析已取消。"));
  if (options.signal?.aborted) return Promise.reject(new WritingPdfError("WRITING_PDF_CANCELLED", "PDF 解析已取消。"));
  return withPdfParseSlot(() => runPdfWorkerNow(bytes, options), options.signal);
}
async function preparePdfImport(sourcePath, options = {}) {
  if (options.signal?.aborted) fail("WRITING_PDF_CANCELLED", "PDF 解析已取消。");
  const resolved = assertPdfPathHasNoSymlink(sourcePath);
  if (path.extname(resolved).toLowerCase() !== ".pdf") fail("WRITING_PDF_EXTENSION_UNSUPPORTED", "只支持导入 .pdf 文件。");
  const before = lstatSync(resolved);
  if (!before.isFile() || before.isSymbolicLink()) fail("WRITING_PDF_SOURCE_INVALID", "PDF 导入源必须是普通文件。");
  if (before.size > PDF_IMPORT_MAX_BYTES) fail("WRITING_PDF_FILE_TOO_LARGE", "PDF 文件超过 64 MiB 限制。");
  const bytes = readFileSync(resolved); const after = lstatSync(resolved);
  if (after.isSymbolicLink() || before.size !== after.size || before.mtimeMs !== after.mtimeMs || bytes.length !== before.size) fail("WRITING_SOURCE_CHANGED", "PDF 导入源在读取期间发生变化。");
  const prepared = { expectedSourceSha256: sha256Buffer(bytes), byteLength: bytes.length };
  const preflightResult = preflight(bytes);
  const parsed = await runPdfWorker(bytes, { ...options, fontFallbackLikely: preflightResult.likelyMissingFont });
  assertPreparedPdfSourceStable(resolved, prepared);
  return { expectedSourceSha256: prepared.expectedSourceSha256, byteLength: prepared.byteLength, ...parsed };
}
module.exports = { PDF_IMPORT_MAX_BYTES, PDF_PARSER_VERSION, PDF_TIMEOUT_MS, PDF_WORKER_RESOURCE_LIMITS, WritingPdfError, assertPreparedPdfSourceStable, pdfWorkerDiagnostics, preparePdfImport, runPdfWorker, shutdownPdfWorker, strictXref };
