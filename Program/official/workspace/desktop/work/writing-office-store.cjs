"use strict";
const { createHash } = require("node:crypto");
const { existsSync, mkdirSync, lstatSync, readFileSync, writeFileSync, openSync, fsyncSync, closeSync, renameSync, rmSync } = require("node:fs");
const path = require("node:path");
const OFFICE_FORMATS = { doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation" };
const OFFICE_MAX_BYTES = 64 * 1024 * 1024;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const objectName = /^[a-f0-9]{64}\.(?:doc|docx|ppt|pptx|png)$/;
function officeRelativePath(value) {
  const parts = String(value || "").split("/");
  return parts.length === 4 && parts[0] === ".iiimage" && parts[1] === "writing" && parts[2] === "office" && objectName.test(parts[3]) ? parts.join("/") : "";
}
function controlledOfficeFile(projectRoot, relativePath, mustExist = true) {
  const relative = officeRelativePath(relativePath);
  if (!relative) throw new Error("Office 文档路径无效。");
  const root = path.resolve(projectRoot), candidate = path.join(root, ...relative.split("/"));
  let cursor = path.parse(candidate).root;
  for (const part of candidate.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    if (existsSync(cursor)) {
      if (lstatSync(cursor).isSymbolicLink()) throw new Error("Office 文档路径包含符号链接。");
    } else if (cursor !== candidate || mustExist) {
      if (mustExist) throw new Error("Office 文件不存在。");
      mkdirSync(cursor);
    }
  }
  return candidate;
}
function storeOfficeObject(projectRoot, bytes, extension) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > OFFICE_MAX_BYTES || !/^(doc|docx|ppt|pptx|png)$/.test(extension)) throw new Error("Office 保存内容无效或过大。");
  const sha256 = hash(bytes), relativePath = `.iiimage/writing/office/${sha256}.${extension}`;
  const file = controlledOfficeFile(projectRoot, relativePath, false);
  if (!existsSync(file)) {
    const staged = file + "." + process.pid + ".tmp";
    let descriptor;
    try { descriptor = openSync(staged, "wx"); writeFileSync(descriptor, bytes); fsyncSync(descriptor); closeSync(descriptor); descriptor = undefined; renameSync(staged, file); }
    finally { if (descriptor !== undefined) closeSync(descriptor); rmSync(staged, { force: true }); }
  }
  else if (hash(readFileSync(file)) !== sha256) throw new Error("Office 历史内容校验失败。");
  return { relativePath, sha256, byteLength: bytes.length };
}
function sanitizeOfficeProvenance(value) {
  if (value == null) return null;
  const relativePath = officeRelativePath(value.relativePath), previewRelativePath = officeRelativePath(value.previewRelativePath);
  const sha256 = String(value.sha256 || ""), previewSha256 = String(value.previewSha256 || "");
  const byteLength = Number(value.byteLength);
  if (!relativePath || !previewRelativePath || !OFFICE_FORMATS[path.extname(relativePath).slice(1)] ||
    path.basename(relativePath).split(".")[0] !== sha256 || path.basename(previewRelativePath) !== `${previewSha256}.png` ||
    !Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > OFFICE_MAX_BYTES) throw new Error("Office 版本信息无效。");
  return { relativePath, sha256, byteLength, previewRelativePath, previewSha256 };
}
function makeOfficeProvenance(projectRoot, bytes, extension, preview) {
  const document = storeOfficeObject(projectRoot, bytes, extension), image = storeOfficeObject(projectRoot, preview, "png");
  return { ...document, previewRelativePath: image.relativePath, previewSha256: image.sha256 };
}
function validateOfficeProvenance(projectRoot, value, checked = new Set()) {
  const office = sanitizeOfficeProvenance(value);
  if (!office) return;
  for (const [relative, expectedHash, length] of [[office.relativePath, office.sha256, office.byteLength], [office.previewRelativePath, office.previewSha256, null]]) {
    const file = controlledOfficeFile(projectRoot, relative), stat = lstatSync(file);
    if (!stat.isFile() || stat.size > OFFICE_MAX_BYTES || (length != null && length !== stat.size) || (!checked.has(relative) && hash(readFileSync(file)) !== expectedHash)) throw new Error("Office 文档或预览与保存版本不一致。");
    checked.add(relative);
  }
}
module.exports = { OFFICE_FORMATS, OFFICE_MAX_BYTES, officeRelativePath, controlledOfficeFile, makeOfficeProvenance, sanitizeOfficeProvenance, validateOfficeProvenance };
