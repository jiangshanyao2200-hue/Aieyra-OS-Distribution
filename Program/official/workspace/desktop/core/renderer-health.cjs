// Main-process recovery remains usable when the renderer cannot run JavaScript.
// No project content, model credentials or URLs enter these resource records.
function watchRendererHealth({ app, window, dialog, log, saveReport, draftGuard, isQuitting = () => false }) {
  const contents = window.webContents;
  const samples = [];
  let recoveryPrompt = null;
  let pendingRecovery = null;
  let lastAutomaticRecovery = 0;
  let generation = 0;
  let disposed = false;
  let hung = false;
  const sample = () => {
    if (disposed || window.isDestroyed()) return;
    try {
      const current = { time: new Date().toISOString(), processes: app.getAppMetrics().map(item => ({
        pid: item.pid, type: item.type, cpu: item.cpu?.percentCPUUsage,
        workingSetKB: item.memory?.workingSetSize, peakWorkingSetKB: item.memory?.peakWorkingSetSize,
        privateKB: item.memory?.privateBytes
      })) };
      samples.push(current);
      if (samples.length > 16) samples.shift();
    } catch { /* Diagnostics must never interfere with the workspace. */ }
  };
  const record = (event, details = {}) => {
    sample();
    try { saveReport({ time: new Date().toISOString(), event, details, samples: [...samples] }); }
    catch (error) { log(`renderer health report failed ${error.code || error.name}`); }
  };
  const resetDraftGuard = () => {
    // The dead document can no longer answer save-drafts. Its durable draft
    // remains in IndexedDB; a newly loaded document registers its own guard.
    draftGuard.finish?.(false);
    draftGuard.ready = false;
    draftGuard.approved = false;
  };
  const reload = () => {
    if (disposed || window.isDestroyed() || isQuitting()) return;
    resetDraftGuard();
    log("renderer recovery reload");
    try { contents.reload(); }
    catch (error) { log(`renderer recovery reload failed ${error.code || error.name}`); }
  };
  const offerRecovery = async (crashed) => {
    if (disposed || window.isDestroyed() || isQuitting()) return;
    if (recoveryPrompt) {
      if (recoveryPrompt.token !== generation) pendingRecovery = { crashed, token: generation };
      return;
    }
    const token = generation;
    const prompt = { token };
    recoveryPrompt = prompt;
    try {
      const result = await dialog.showMessageBox(window, {
      type: "warning", title: "Aieyra Workspace",
      message: crashed ? "界面未能恢复" : "界面暂时没有响应",
      detail: crashed
        ? "已保存的项目、成果与输入草稿仍保留。可以重新加载界面，不会重新提交绘图请求。"
        : "可以继续等待。重新加载会恢复已保存的项目与输入草稿，尚未保存的界面编辑可能丢失。",
      buttons: crashed ? ["重新加载界面", "稍后处理"] : ["继续等待", "重新加载界面"],
      defaultId: 0, cancelId: crashed ? 1 : 0, noLink: true
      });
      if (token !== generation || (!crashed && !hung)) return;
      if (result.response === (crashed ? 0 : 1)) reload();
    } catch (error) { log(`renderer recovery dialog failed ${error.code || error.name}`); }
    finally {
      if (recoveryPrompt === prompt) recoveryPrompt = null;
      const pending = pendingRecovery;
      pendingRecovery = null;
      if (pending?.token === generation) void offerRecovery(pending.crashed);
    }
  };
  const gone = (_event, details = {}) => {
    generation++;
    hung = false;
    resetDraftGuard();
    log(`render gone ${JSON.stringify(details)}`);
    record("render-process-gone", details);
    if (disposed || isQuitting() || details.reason === "clean-exit") return;
    // A single crashed document can recover without restarting native jobs.
    // Repeated crashes stop here instead of entering an automatic reload loop.
    if (Date.now() - lastAutomaticRecovery > 120000) {
      lastAutomaticRecovery = Date.now();
      reload();
    } else void offerRecovery(true);
  };
  const unresponsive = () => { hung = true; record("unresponsive"); void offerRecovery(false); };
  const responsive = () => { hung = false; generation++; };
  const loaded = () => { hung = false; generation++; sample(); };
  sample();
  const timer = setInterval(sample, 30000);
  timer.unref?.();
  contents.on("render-process-gone", gone);
  contents.on("unresponsive", unresponsive);
  contents.on("responsive", responsive);
  contents.on("did-finish-load", loaded);
  window.once("closed", () => {
    disposed = true; generation++; clearInterval(timer);
    contents.removeListener("render-process-gone", gone);
    contents.removeListener("unresponsive", unresponsive);
    contents.removeListener("responsive", responsive);
    contents.removeListener("did-finish-load", loaded);
  });
}
module.exports = { watchRendererHealth };
