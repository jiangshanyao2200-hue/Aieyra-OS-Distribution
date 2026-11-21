"use strict";
// Official optional modules. The catalogue is generated with the base build;
// packages must match that catalogue exactly before any code is loaded.
const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const fail = message => Object.assign(new Error(message), { code: "WORKSPACE_MODULE_UNAVAILABLE" });
const safeRelative = value => typeof value === "string" && value.length < 240 && !value.includes("\\") && !value.includes(":") && !value.startsWith("/") && value.split("/").every(p => p && p !== "." && p !== "..");
function createWorkspaceModuleManager({ root, cataloguePath, sourceRoot, development = false }) {
  let checked = null, fault = "", changing = false, users = 0;
  function catalogue() {
    try { return JSON.parse(fs.readFileSync(cataloguePath, "utf8")).writing; } catch { return null; }
  }
  function directory() { return path.join(root, "writing"); }
  function sourceManifest() {
    try {
      for (const file of ["src/writing-workbench.tsx", "desktop/work/writing-runtime.cjs", "desktop/work/writing-docx-io.cjs", "desktop/work/writing-pdf-io.cjs"]) fs.accessSync(path.join(sourceRoot, file));
      const metadata = JSON.parse(fs.readFileSync(path.join(sourceRoot, "package.json"), "utf8"));
      return { id: "writing", apiVersion: 2, version: metadata.version, baseVersion: metadata.version, development: true };
    } catch (error) { throw fail(`工作模块源码不可用：${error.message}`); }
  }
  function assertPackagedModule() {
    if (development) throw fail("开发模式直接使用当前源码，无需安装或卸载工作模块。");
  }
  function check() {
    if (changing) throw fail("模块正在安装，请稍后重试。");
    if (fault) throw fail(fault);
    if (development) return sourceManifest();
    if (checked) return checked;
    const expected = catalogue();
    if (!expected) throw fail("当前版本尚未提供可安装的写作模块包。");
    try {
      const manifestBytes = fs.readFileSync(path.join(directory(), "module.json"));
      if (hash(manifestBytes) !== expected.manifestSha256) throw fail("写作模块清单已损坏，请重新安装。");
      const manifest = JSON.parse(manifestBytes);
      if (manifest.id !== "writing" || manifest.apiVersion !== 2 || manifest.baseVersion !== expected.baseVersion) throw fail("写作模块与当前基座不兼容，请重新安装。");
      for (const file of manifest.files) {
        if (!safeRelative(file.path)) throw fail("模块路径无效。");
        const target = path.join(directory(), file.path);
        let cursor = directory();
        if (fs.lstatSync(cursor).isSymbolicLink()) throw fail("模块目录不能是链接。");
        for (const part of file.path.split("/")) { cursor = path.join(cursor, part); if (fs.lstatSync(cursor).isSymbolicLink()) throw fail("模块文件不能是链接。"); }
        if (fs.statSync(target).size !== file.size || hash(fs.readFileSync(target)) !== file.sha256) throw fail("写作模块文件不完整，请重新安装。");
      }
      checked = manifest;
      return manifest;
    } catch (error) {
      if (error.code === "ENOENT") throw fail("请先在右侧“模块”中安装写作模块。");
      throw error;
    }
  }
  function status() {
    const available = catalogue();
    try { const installed = check(); return { id: "writing", state: "installed", version: installed.version, bytes: development ? undefined : available.bytes, development }; }
    catch (error) { return { id: "writing", state: fs.existsSync(directory()) ? "error" : "missing", error: error.message, bytes: available?.bytes, development }; }
  }
  async function download(fetcher) {
    assertPackagedModule();
    const expected = catalogue();
    if (!expected || !/^\d+\.\d+\.\d+$/.test(expected.baseVersion) || !Number.isSafeInteger(expected.bytes) || expected.bytes <= 0 || expected.bytes > 128 * 1024 * 1024) throw fail("当前版本的写作模块下载信息无效。");
    throw fail("请通过 OS 程序管理安装扩展。");
    const url = "";
    const response = await fetcher(url, { redirect: "error", signal: AbortSignal.timeout(180_000), headers: { "User-Agent": `Aieyra-Workspace/${expected.baseVersion}` } });
    if (!response.ok || !response.body) throw fail(`写作模块下载失败（${response.status}），请稍后重试。`);
    const reader = response.body.getReader(), chunks = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > expected.bytes) throw fail("写作模块下载大小不匹配。");
        chunks.push(Buffer.from(value));
      }
      const bytes = Buffer.concat(chunks);
      if (size !== expected.bytes || hash(bytes) !== expected.sha256) throw fail("写作模块下载不完整或校验失败，请重试。");
      return bytes;
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  function runtime(name) {
    const manifest = check();
    if (!/^writing-[a-z-]+\.(?:cjs|mjs)$/.test(name)) throw fail("模块入口无效。");
    try {
      const structured = development || manifest.files.some(file => file.path === "runtime/desktop/work/writing-runtime.cjs");
      const runtimeRoot = development ? sourceRoot : path.join(directory(), "runtime");
      const runtimePath = file => path.join(runtimeRoot, structured ? (file.endsWith(".mjs") ? "shared" : "desktop/work") : "", file);
      const illustrationPath = runtimePath("writing-illustrations.cjs");
      require(illustrationPath).setImageProcessor(require(require.resolve("sharp", { paths: [sourceRoot] })));
      return require(runtimePath(name));
    }
    catch (error) { fault = `写作模块加载失败：${error.message}`; throw fail(fault); }
  }
  function asset(relative) {
    assertPackagedModule();
    const manifest = check();
    const file = manifest.files.find(f => f.path === `renderer/${relative}`);
    if (!safeRelative(relative) || !file) throw fail("模块资源不存在。");
    const bytes = fs.readFileSync(path.join(directory(), file.path));
    if (hash(bytes) !== file.sha256) { checked = null; throw fail("模块资源校验失败。"); }
    return bytes;
  }
  async function install(bytes) {
    assertPackagedModule();
    if (changing || users) throw fail("写作模块正在使用，请结束任务并关闭写作项目后重试。");
    changing = true;
    const stage = path.join(root, `.writing-${randomUUID()}`), previous = path.join(root, ".writing-previous");
    try {
      const expected = catalogue();
      if (!expected || bytes.length !== expected.bytes || hash(bytes) !== expected.sha256) throw fail("模块包与当前基座不匹配或下载不完整。");
      const zip = await require("jszip").loadAsync(bytes, { checkCRC32: true });
      const manifestBytes = await zip.file("module.json")?.async("nodebuffer");
      if (!manifestBytes || hash(manifestBytes) !== expected.manifestSha256) throw fail("模块清单校验失败。");
      const manifest = JSON.parse(manifestBytes);
      const allowed = new Set(["module.json", ...manifest.files.map(f => f.path)]);
      if (manifest.id !== "writing" || manifest.apiVersion !== 2 || manifest.baseVersion !== expected.baseVersion || manifest.files.length > 30000) throw fail("模块版本不兼容。");
      for (const entry of Object.values(zip.files)) {
        if (entry.unsafeOriginalName && entry.unsafeOriginalName !== entry.name) throw fail("模块包路径无效。");
        if (!entry.dir && (!safeRelative(entry.name) || !allowed.has(entry.name))) throw fail("模块包包含未登记文件。");
      }
      fs.mkdirSync(stage, { recursive: true });
      let total = 0;
      for (const file of manifest.files) {
        if (!safeRelative(file.path) || !Number.isSafeInteger(file.size) || file.size < 0 || (total += file.size) > 256 * 1024 * 1024) throw fail("模块文件大小或路径无效。");
        const entry = zip.file(file.path);
        if (!entry || entry._data?.uncompressedSize !== file.size) throw fail("模块文件缺失或大小无效。");
        const data = await entry.async("nodebuffer");
        if (hash(data) !== file.sha256) throw fail("模块文件校验失败。");
        const target = path.join(stage, file.path); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, data, { flag: "wx" });
      }
      fs.writeFileSync(path.join(stage, "module.json"), manifestBytes);
      fs.rmSync(previous, { recursive: true, force: true });
      if (fs.existsSync(directory())) fs.renameSync(directory(), previous);
      try { fs.renameSync(stage, directory()); } catch (error) { if (fs.existsSync(previous)) fs.renameSync(previous, directory()); throw error; }
      checked = null; fault = "";
      for (const key of Object.keys(require.cache)) if (key.startsWith(directory() + path.sep)) delete require.cache[key];
      fs.rmSync(previous, { recursive: true, force: true });
      changing = false;
      return status();
    } finally { changing = false; fs.rmSync(stage, { recursive: true, force: true }); }
  }
  function remove() {
    assertPackagedModule();
    if (changing || users) throw fail("写作模块正在使用，请关闭写作项目后重试。");
    fs.rmSync(directory(), { recursive: true, force: true });
    checked = null; fault = "";
    for (const key of Object.keys(require.cache)) if (key.startsWith(directory() + path.sep)) delete require.cache[key];
    return status();
  }
  return { status, assertAvailable: check, runtime, asset, install, remove, download,
    async use(operation) { check(); users++; try { return await operation(); } finally { users--; } },
    processInput(operation, args) {
      const manifest = check();
      if (development) return { operation, args, development: true, runtimeRoot: path.join(sourceRoot, "desktop/work") };
      const structured = manifest.files.some(file => file.path === "runtime/desktop/work/writing-runtime.cjs");
      return { operation, args, moduleRoot: directory(), runtimeRoot: path.join(directory(), "runtime", structured ? "desktop/work" : ""), manifestSha256: catalogue().manifestSha256 };
    },
    entry() { check(); if (development) return { development: true }; return { url: `aieyra-module://writing/workbench.js?v=${catalogue().manifestSha256}`, css: `aieyra-module://writing/style.css?v=${catalogue().manifestSha256}` }; }
  };
}
module.exports = { createWorkspaceModuleManager };
