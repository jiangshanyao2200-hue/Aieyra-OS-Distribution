"use strict";
// Dedicated utility process. Only predeclared first-party module operations are
// dispatched; the renderer cannot select a path, module export or Node API.
const path = require("node:path");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const operations = Object.freeze({
  "xlsx-import": ["work-spreadsheet.cjs", "prepareSpreadsheetImport"],
  "docx-import": ["writing-docx-io.cjs", "prepareDocxImport"],
  "docx-export": ["writing-docx-io.cjs", "createDocxExport"],
  "pdf-import": ["writing-pdf-io.cjs", "preparePdfImport"],
  "pdf-readback": ["writing-pdf-io.cjs", "runPdfWorker"]
});
process.parentPort.on("message", async ({ data }) => {
  try {
    const target = operations[data.operation];
    if (!target) throw new Error("模块操作未开放。");
    if (data.development === true) {
      // Only this source tree can serve development operations. The packaged
      // host never enables development, and an ASAR has no renderer sources.
      if (path.resolve(data.runtimeRoot) !== path.resolve(__dirname, "../work") || !fs.existsSync(path.join(__dirname, "../../src/writing-workbench.tsx"))) throw new Error("开发模块必须使用当前工作树源码。");
    } else {
      const manifest = fs.readFileSync(path.join(data.moduleRoot, "module.json"));
      if (createHash("sha256").update(manifest).digest("hex") !== data.manifestSha256) throw new Error("模块在启动前发生变化。");
    }
    const runtime = require(path.join(data.runtimeRoot, target[0]));
    const args = data.args.map(arg => arg?.__moduleBuffer ? Buffer.from(arg.__moduleBuffer) : arg);
    const value = await runtime[target[1]](...args);
    process.parentPort.postMessage({ ok: true, value });
  } catch (error) {
    process.parentPort.postMessage({ ok: false, error: error.message, code: error.code });
  }
});
