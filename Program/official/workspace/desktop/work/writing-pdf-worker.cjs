"use strict";

const { createHash } = require("node:crypto");
const { parentPort } = require("node:worker_threads");
const { DOMMatrix, DOMPoint, DOMRect } = require("@napi-rs/canvas/geometry.js");

const PAGE_LIMIT = 4096;
const CANONICAL_LIMIT = 8 * 1024 * 1024;
const BLOCK_LIMIT = 20_000;
const PAGE_BLOCK_LIMIT = 2_000;
const BLOCK_TEXT_LIMIT = 4_096;
const ANNOTATION_PAGE_LIMIT = 1_024;
const ANNOTATION_LIMIT = 4_096;
const TIMEOUT_MS = 15_000;
const parserVersion = "pdfjs-dist-6.2.108+iiimage-pdf-v1";

function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function cleanText(value) { return String(value || "").replace(/\u00a0/g, " ").replace(/[\t\f\v ]+/g, " ").trim(); }
function boundedNumber(value, label) { const number = Number(value); if (!Number.isFinite(number)) fail("WRITING_PDF_GEOMETRY_INVALID", `PDF ${label} 不是有限数值。`); return Math.round(number * 1000) / 1000; }
function withTimeout(promise) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error("PDF 解析超过 15 秒限制。"), { code: "WRITING_PDF_TIMEOUT" })), TIMEOUT_MS);
    timer.unref?.();
  })]).finally(() => clearTimeout(timer));
}
function hasEntries(value) { return value instanceof Map ? value.size > 0 : Boolean(value && Object.keys(value).length); }

globalThis.DOMMatrix ||= DOMMatrix;
globalThis.DOMPoint ||= DOMPoint;
globalThis.DOMRect ||= DOMRect;
if (typeof Uint8Array.prototype.toHex !== "function") {
  Object.defineProperty(Uint8Array.prototype, "toHex", {
    configurable: true,
    value() { return Buffer.from(this.buffer, this.byteOffset, this.byteLength).toString("hex"); }
  });
}
if (typeof Map.prototype.getOrInsertComputed !== "function") {
  Object.defineProperty(Map.prototype, "getOrInsertComputed", {
    configurable: true,
    value(key, callback) {
      if (this.has(key)) return this.get(key);
      const value = callback(key);
      this.set(key, value);
      return value;
    }
  });
}

class TextOnlyCanvasFactory {
  create() { fail("WRITING_PDF_RENDERING_UNSUPPORTED", "PDF 文本解析不得创建原生画布。"); }
  reset() { fail("WRITING_PDF_RENDERING_UNSUPPORTED", "PDF 文本解析不得重置原生画布。"); }
  destroy() {}
}

async function parse(bytes, options = {}) {
  if (!(bytes instanceof Uint8Array)) fail("WRITING_PDF_WORKER_INPUT_INVALID", "PDF worker 只接受 Uint8Array 字节。");
  const originalWarn = console.warn;
  let fontFallbackWarning = options?.fontFallbackLikely === true;
  console.warn = (...values) => {
    const warning = values.map((value) => String(value || "")).join(" ");
    if (/font|standardFontDataUrl/i.test(warning)) fontFallbackWarning = true;
  };
  let loadingTask; let document;
  try {
    const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
    loadingTask = pdfjs.getDocument({
      data: bytes,
      CanvasFactory: TextOnlyCanvasFactory,
      disableRange: true, disableStream: true, disableAutoFetch: true,
      withCredentials: false, useWorkerFetch: false, useWasm: false, enableXfa: false,
      stopAtErrors: true, disableFontFace: true, useSystemFonts: false,
      isOffscreenCanvasSupported: false, isImageDecoderSupported: false,
      maxImageSize: 8_388_608, canvasMaxAreaInBytes: 32 * 1024 * 1024,
      verbosity: pdfjs.VerbosityLevel.WARNINGS
    });
    document = await withTimeout(loadingTask.promise);
    if (!Number.isSafeInteger(document.numPages) || document.numPages < 1 || document.numPages > PAGE_LIMIT) fail("WRITING_PDF_PAGE_LIMIT", "PDF 页数超过 4,096 页限制。");
    if (hasEntries(await withTimeout(document.getJSActions()))) fail("WRITING_PDF_JAVASCRIPT_REJECTED", "PDF 包含 JavaScript 动作。");
    if (hasEntries(await withTimeout(document.getAttachments()))) fail("WRITING_PDF_ATTACHMENT_REJECTED", "PDF 包含嵌入文件。");
    const pages = []; const warnings = []; const canonical = []; let totalBlocks = 0; let canonicalBytes = 0; let externalUriCount = 0; let annotationCount = 0; let scannedPageCount = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await withTimeout(document.getPage(pageNumber));
      try {
        const viewport = page.getViewport({ scale: 1 });
        const annotations = await withTimeout(page.getAnnotations({ intent: "display" }));
        if (!Array.isArray(annotations) || annotations.length > ANNOTATION_PAGE_LIMIT) fail("WRITING_PDF_ANNOTATION_LIMIT", "PDF 单页批注超过 1,024 个限制。");
        annotationCount += annotations.length;
        if (annotationCount > ANNOTATION_LIMIT) fail("WRITING_PDF_ANNOTATION_LIMIT", "PDF 批注总量超过 4,096 个限制。");
        externalUriCount += annotations.filter((item) => item?.url || item?.unsafeUrl).length;
        const content = await withTimeout(page.getTextContent({ disableNormalization: false }));
        if (!Array.isArray(content.items) || content.items.length > PAGE_BLOCK_LIMIT) fail("WRITING_PDF_PAGE_BLOCK_LIMIT", "PDF 单页文本项超过 2,000 个限制。");
        const textItems = content.items.filter((item) => typeof item?.str === "string" && cleanText(item.str));
        if (textItems.length > PAGE_BLOCK_LIMIT) fail("WRITING_PDF_PAGE_BLOCK_LIMIT", "PDF 单页文本块超过 2,000 个限制。");
        const blocks = textItems.map((item, index) => {
          const text = cleanText(item.str);
          if (text.length > BLOCK_TEXT_LIMIT) fail("WRITING_PDF_BLOCK_TEXT_LIMIT", "PDF 单个文本块超过 4,096 字符限制。");
          const transform = Array.isArray(item.transform) ? item.transform : [];
          const bbox = { x: boundedNumber(transform[4], "文本 x"), y: boundedNumber(transform[5], "文本 y"), width: boundedNumber(Math.abs(Number(item.width)), "文本宽度"), height: boundedNumber(Math.abs(Number(item.height)), "文本高度") };
          return { blockId: `p${pageNumber}-b${index + 1}`, text, bbox, blockSha256: sha256(Buffer.from(text, "utf8")) };
        });
        totalBlocks += blocks.length;
        if (totalBlocks > BLOCK_LIMIT) fail("WRITING_PDF_BLOCK_LIMIT", "PDF 文本块超过 20,000 个限制。");
        const pageText = blocks.map((item) => item.text).join("\n");
        for (const block of blocks) { canonical.push(block.text); canonicalBytes += Buffer.byteLength(block.text, "utf8") + (canonical.length > 1 ? 2 : 0); }
        if (canonicalBytes > CANONICAL_LIMIT) fail("WRITING_PDF_CANONICAL_LIMIT", "PDF canonical 文本超过 8 MiB 限制。");
        const scanned = blocks.length === 0;
        if (scanned) {
          scannedPageCount += 1;
          if (warnings.length < 22) warnings.push(`第 ${pageNumber} 页未提取到原生文本，可能是扫描页。`);
        }
        if (!(viewport.width > 0 && viewport.height > 0)) fail("WRITING_PDF_GEOMETRY_INVALID", "PDF 页面尺寸无效。");
        pages.push({ pageNumber, width: boundedNumber(viewport.width, "页面宽度"), height: boundedNumber(viewport.height, "页面高度"), rotation: boundedNumber(viewport.rotation, "页面旋转"), status: scanned ? "scanned" : "ready", textSha256: sha256(Buffer.from(pageText, "utf8")), blocks });
      } finally { page.cleanup?.(); }
    }
    if (fontFallbackWarning && warnings.length < 22) warnings.push("PDF 字体或标准字体资源不可用，已保留提取文本并标记回退。");
    if (scannedPageCount > warnings.filter((warning) => /扫描页/.test(warning)).length) warnings.push(`另有扫描页未逐页列出；共 ${scannedPageCount} 页无原生文本。`);
    if (externalUriCount) warnings.push(`检测到 ${externalUriCount} 个外部链接，未访问。`);
    const canonicalText = canonical.join("\n\n").trim();
    return { parserVersion, canonicalText, canonicalSha256: sha256(Buffer.from(canonicalText, "utf8")), warnings, structure: { pageCount: pages.length, blockCount: totalBlocks, externalRelationshipCount: externalUriCount }, pages };
  } catch (error) {
    if (error?.code) throw error;
    fail("WRITING_PDF_PARSE_FAILED", "PDF 无法安全解析。");
  } finally {
    console.warn = originalWarn;
    await document?.cleanup?.();
    await document?.destroy?.();
    await loadingTask?.destroy?.();
  }
}

let parsing = false;
parentPort?.on("message", async (message) => {
  if (parsing) {
    parentPort.postMessage({ ok: false, error: { code: "WRITING_PDF_WORKER_BUSY", message: "PDF worker 正在处理另一份文档。" } });
    return;
  }
  parsing = true;
  try { parentPort.postMessage({ ok: true, value: await parse(message?.bytes, message?.options) }); }
  catch (error) { parentPort.postMessage({ ok: false, error: { code: String(error?.code || "WRITING_PDF_PARSE_FAILED"), message: String(error?.message || "PDF 解析失败。") } }); }
  finally { parsing = false; }
});
