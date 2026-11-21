"use strict";
const path = require("node:path");
// Each parser/export job gets a disposable process. A native crash, uncaught
// rejection or timeout rejects that job; Electron and Image keep running.
function runModuleProcess(utilityProcess, input, { timeoutMs = 30000, onStart } = {}) {
  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(path.join(__dirname, "workspace-module-worker.cjs"), [], {
      serviceName: "Aieyra 写作模块", stdio: "ignore", execArgv: ["--max-old-space-size=256"]
    });
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener("spawn", start);
      child.removeListener("message", message);
      // Killing a child can itself fail or emit an error. Neither may escape
      // an event callback into the host process or leave this job unresolved.
      try { child.kill(); } catch (failure) { error ||= failure; }
      if (error) reject(error); else resolve(value);
    };
    const start = () => {
      if (settled) return;
      try { onStart?.(child); if (!settled) child.postMessage(input); }
      catch (error) { finish(error); }
    };
    const message = result => {
      if (!result || typeof result !== "object" || typeof result.ok !== "boolean") {
        finish(Object.assign(new Error("写作模块返回了无效结果，可以重试。"), { code: "WORKSPACE_MODULE_REPLY_INVALID" }));
        return;
      }
      if (result.ok) finish(null, result.value);
      else finish(Object.assign(new Error(typeof result.error === "string" ? result.error : "模块处理失败。"), { code: result.code }));
    };
    const timer = setTimeout(() => finish(Object.assign(new Error("写作模块处理超时，当前任务已停止。"), { code: "WORKSPACE_MODULE_TIMEOUT" })), timeoutMs);
    child.on("exit", code => finish(Object.assign(new Error(`写作模块进程已退出（${code}），可以重试。`), { code: "WORKSPACE_MODULE_EXIT" })));
    // Keep the error listener through process teardown; late errors are inert.
    child.on("error", error => finish(error));
    child.on("message", message);
    child.once("spawn", start);
  });
}
module.exports = { runModuleProcess };
