"use strict";
const fs = require("node:fs/promises"), path = require("node:path");
const { createHash } = require("node:crypto");
const { validateSingleImagePrompts } = require("./image-prompt-contract.cjs");
const { atomicWriteBytesAsync } = require("../core/json-storage.cjs");
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const terminal = new Set(["done", "error", "unknown", "skipped"]);
const failure = error => String(error?.message || error || "没有返回图片。");

function normalizeBatchPlan(args) {
  const count = args.count, continuous = args.continuous === true;
  if (!continuous && (!Number.isSafeInteger(count) || count < 1 || count > 1000)) throw Error("批量 count 必须是 1–1000 的整数；持续抽卡使用 continuous=true，直到暂停或停止。");
  if (continuous && count !== undefined) throw Error("continuous 与 count 二选一；有明确总张数时使用 count。");
  const concurrency = args.concurrency ?? 3;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 6) throw Error("图片并发必须为 1–6。");
  const input = structuredClone(args.input || {});
  if (input.count !== undefined || input.items !== undefined || input.generationMode !== undefined) throw Error("批量参数放在外层 count/variants/concurrency；input 只放单张图片参数。");
  if (!["generate", "edit", "replace"].includes(input.operation || "generate")) throw Error("持续批量支持 generate/edit/replace。");
  if (!String(input.prompt || "").trim()) throw Error("请提供完整的单张视觉提示词。");
  const variants = args.variants || [];
  if (!Array.isArray(variants) || variants.length > 1000 || variants.some(v => !v || typeof v.prompt !== "string" || !v.prompt.trim() || v.prompt.length > 24000 || (v.title !== undefined && typeof v.title !== "string"))) throw Error("variants 每项须有完整单张 prompt，最多 1000 项。");
  if (!continuous && variants.length > count) throw Error("风格方案数量不能超过目标张数。");
  validateSingleImagePrompts({ ...input, items: variants });
  if (args.goalId !== undefined && (typeof args.goalId !== "string" || !args.goalId.trim() || !Number.isInteger(args.goalRevision) || args.goalRevision < 1)) throw Error("批量目标需要有效的 goalId 和 goalRevision。");
  const generationMode=args.generationMode||'parallel';
  if(!['parallel','sequential'].includes(generationMode)||generationMode==='sequential'&&concurrency!==1)throw Error('连续系列必须逐张执行');
  return { input, count: continuous ? null : count, continuous, concurrency, generationMode, variants: structuredClone(variants), title: String(args.title || (generationMode==='sequential'?'连续系列':'批量创作')).slice(0, 120), ...(args.goalId ? {goalId:args.goalId,goalRevision:args.goalRevision} : {}) };
}

// One durable task, bounded single-image calls, one canvas container per 100
// continuous outputs (finite tasks stay together). Unknown calls never replay.
function createImageBatchRuntime({ directory, storage = fs }) {
  const tasks = new Map();
  const file = (scope, id) => path.join(directory, hash([scope.projectId, scope.conversationId]), `${id}.json`);
  const assertId = id => { if (!/^matrix-batch-[a-f0-9-]{36}$/.test(String(id))) throw Error("批量任务标识无效。"); };
  async function persist(task) {
    const value = JSON.stringify(task.data), target = file(task.scope, task.data.id);
    task.saving = (task.saving || Promise.resolve()).catch(() => {}).then(async () => {
      await atomicWriteBytesAsync(target, value, { storage });
    });
    await task.saving;
  }
  async function get(scope, id) {
    assertId(id);
    let task = tasks.get(id);
    if (!task) {
      const data = JSON.parse(await storage.readFile(file(scope, id), "utf8"));
      if (data.id !== id || data.projectId !== scope.projectId || data.conversationId !== scope.conversationId || data.canvasProjectId !== scope.canvasProjectId) throw Error("批量任务归属不一致。");
      for (const slot of data.slots) if (slot.status === "running") { slot.status = "unknown"; slot.error = "程序中断，结果未确认。核对成果后处理，不自动重画。"; }
      if (["running", "paused", "pausing"].includes(data.status)) data.status = "interrupted";
      task = { scope, data }; tasks.set(id, task); await persist(task);
    }
    if (task.data.projectId !== scope.projectId || task.data.conversationId !== scope.conversationId || task.data.canvasProjectId !== scope.canvasProjectId) throw Error("批量任务不属于当前会话。");
    return task;
  }
  function snapshot(task) {
    const d = task.data, done = (d.archived?.done || 0) + d.slots.filter(s => s.status === "done").length, failed = (d.archived?.error || 0) + d.slots.filter(s => s.status === "error").length, unknown = d.slots.filter(s => s.status === "unknown").length;
    return { id: d.id, status: d.status, count: d.plan.count, continuous: d.plan.continuous, concurrency: d.plan.concurrency,
      completed: done, failed, unknown, skipped: (d.archived?.skipped || 0) + d.slots.filter(s => s.status === "skipped").length, unknownSlots: d.slots.filter(s=>s.status === "unknown").map(s=>s.index+1), running: d.slots.filter(s => s.status === "running").length, scheduled: (d.baseIndex || 0) + d.slots.length,
      error: d.error || "", summary: `${d.status === "paused" || d.status === "pausing" ? "已暂停" : d.status === "cancelled" ? "已停止" : d.status === "completed" ? "批量完成" : d.status === "error" ? "批量部分完成" : d.status === "interrupted" ? "等待恢复" : "批量创作"} · 已保存 ${done}${d.plan.count ? `/${d.plan.count}` : ""} 张${failed ? `，失败 ${failed} 张` : ""}${unknown ? `，${unknown} 张结果待核对` : ""}` };
  }
  function actions(task) {
    const d = task.data, pages = new Map();
    for (const slot of d.slots) {
      const page = d.plan.continuous ? Math.floor(slot.index / 100) : 0;
      if (!pages.has(page)) pages.set(page, []); pages.get(page).push(slot);
    }
    return [...pages].map(([page, slots]) => {
      const key = `${d.id}-page-${page}`, assets = [], items = slots.map(slot => {
        if (slot.asset) assets.push({ ...slot.asset, index: assets.length + 1, prompt: slot.prompt, title: slot.title });
        return { id: `slot-${slot.index}`, requestIndex: slot.index + 1, ...(slot.asset ? { assetIndex: assets.length } : {}), prompt: slot.prompt, title: slot.title, status: slot.status === "done" ? "done" : terminal.has(slot.status) ? "error" : "pending", error: slot.error };
      });
      const total = d.plan.continuous ? Math.max(1, slots.length) : d.plan.count;
      const active = ["running", "pausing"].includes(d.status) && (slots.some(s => !terminal.has(s.status)) || !d.plan.continuous && slots.length < total || d.plan.continuous && slots.length < 100);
      return { type: "workflow.node.create", operationId: key, toolRunId: key, node: {
        nodeType: "image", title: `${d.plan.title}${d.plan.continuous ? ` · ${page + 1}` : ""}`, prompt: d.plan.input.prompt, parentId: d.plan.input.parentId,
        assets, outputs: assets.length, imageState: active ? "generating" : assets.length ? "done" : "error",
        imageError: d.error || undefined, imageParams: { ...d.plan.input, count: total, batchMode: d.plan.generationMode||"parallel" },
        imageCollection: { id: `collection-${key}`, kind: d.plan.generationMode==='sequential'?"series":"batch", generationMode: d.plan.generationMode||"parallel", createdAt: d.startedAt, sourceNodeId: d.plan.input.parentId, items },
        imageProgress: { total, completed: assets.length, failed: slots.filter(s => ["error", "unknown"].includes(s.status)).length, failedSlots: slots.filter(s => ["error", "unknown"].includes(s.status)).map(s => s.index + 1), retryCount: 0, maxRetries: 0, stopped: !active && assets.length < total, message: snapshot(task).summary }
      } };
    });
  }
  async function create(scope, id, args, identity, references = []) {
    assertId(id); const plan = normalizeBatchPlan(args);
    if (tasks.has(id)) throw Error("批量任务已存在。");
    try { await storage.access(file(scope,id)); throw Error("批量任务已存在。"); } catch(error) { if(error.code !== "ENOENT") throw error; }
    const task = { scope, data: { version: 2, id, projectId: scope.projectId, conversationId: scope.conversationId, canvasProjectId: scope.canvasProjectId, identity, references: structuredClone(references), plan, status: "running", slots: [], baseIndex: 0, archived: { done: 0, error: 0, skipped: 0 }, startedAt: new Date().toISOString() } };
    await persist(task); tasks.set(id, task); return snapshot(task);
  }
  async function control(scope, id, operation, options = {}) {
    const task = await get(scope, id), d = task.data;
    if (operation === "pause" && d.status === "running") d.status = d.slots.some(s => s.status === "running") ? "pausing" : "paused";
    if (operation === "resume") {
      if (options.identity && d.identity !== options.identity) throw Error("批量任务的模型连接、参数或参考资料已变化，请核对原任务后继续。");
      if (d.slots.some(s => s.status === "unknown")) throw Error("有图片请求结果未确认，请先核对已保存成果；不会自动重发未知请求。");
      if (["paused", "pausing", "interrupted"].includes(d.status)) { d.status = "running"; d.error = ""; }
    }
    if (operation === "cancel" && !["completed", "cancelled"].includes(d.status)) d.status = "cancelled";
    if (operation === "skip") {
      if (!["paused", "interrupted"].includes(d.status) || !Array.isArray(options.slots) || !options.slots.length) throw Error("先暂停并核对未知结果，再明确指定要跳过的序号。");
      const selected = options.slots.map(index => d.slots.find(slot => slot.index + 1 === index));
      if (selected.some(slot => !slot || slot.status !== "unknown")) throw Error("只能跳过结果未知的图片请求。");
      for (const slot of selected) slot.status = "skipped";
    }
    await persist(task); task.wake?.(); return snapshot(task);
  }
  async function run(scope, id, { identity, signal, progress, generate }) {
    const task = await get(scope, id), d = task.data;
    if (task.executing) throw Error("批量任务已经在执行。");
    if (d.identity !== identity) throw Error("批量任务的模型连接、参数或参考资料已变化，请核对原任务后继续。");
    if (d.status !== "running") throw Error("批量任务尚未恢复。");
    task.executing = true;
    const publish = () => { for (const action of actions(task)) progress({ phase: "image-progress", workflowAction: action, summary: snapshot(task).summary, batch: snapshot(task), ...(d.plan.continuous ? { retainActionLimit: 2 } : {}) }); };
    const wake = () => task.wake?.(); signal.addEventListener("abort", wake);
    const active = new Set();
    async function publishPage(page, slots) {
      if (page < (d.notifiedThrough || 0)) return;
      const pageActions = actions({data:{...d,status:"paused",slots}});
      // Await the owning canvas and durable Agent inbox before advancing. A
      // failed save pauses dispatch; retrying this receipt never redraws pixels.
      await progress({phase:"image-batch-page",batch:snapshot(task),batchPage:{id:`${id}-page-${page}`,page:page+1,first:page*100+1,last:page*100+slots.length},pageActions});
      d.notifiedThrough = page + 1;
      await persist(task);
    }
    async function one(slot) {
      try {
        const result = await generate({ ...d.plan.input, ...slot.parameters, prompt: slot.prompt, count: 1 }, `${id}-slot-${slot.index}`);
        const asset = result.actions?.flatMap(a => a.node?.assets || []).find(a => a.path || a.assetUrl);
        if (!asset) throw Error(result.envelope?.summary || "没有返回图片。");
        slot.asset = asset; slot.status = "done";
      } catch (error) {
        slot.error = failure(error); slot.status = /ambiguous|结果.*(?:未确认|不明)|超时|timeout|abort|停止|取消/i.test(slot.error) || signal.aborted ? "unknown" : "error";
        if (d.status !== "cancelled" && (slot.status === "unknown" || /quota|余额|配额|auth|401|403|凭证|未登录|license|政策|policy|不支持/i.test(slot.error))) { d.status = "pausing"; d.error = slot.error; }
      }
      try { await persist(task); publish(); } catch (error) { d.status = "pausing"; d.error = `批量记录尚未保存：${failure(error)}`; }
    }
    try {
      // Replay bounded archived pages into the owning canvas after a restart.
      for (let page=0; page<(d.baseIndex || 0)/100; page++) {
        const slots = JSON.parse(await storage.readFile(`${file(scope,id)}.page-${page}`,"utf8"));
        for (const action of actions({data:{...d,status:"paused",slots}})) progress({phase:"image-progress",workflowAction:action,batch:snapshot(task),retainActionLimit:2});
        await publishPage(page, slots);
      }
      publish();
      for (;;) {
        if (signal.aborted || d.status === "cancelled") { d.status = "cancelled"; break; }
        if (d.status === "pausing" && !active.size) { d.status = "paused"; await persist(task); publish(); }
        if (d.status === "running") {
          if (d.plan.continuous && d.slots.length === 100 && !active.size) {
            // Archive first, then advance the compact manifest. A crash between
            // writes can only overwrite this same page, never replay its calls.
            const page = (d.baseIndex || 0) / 100;
            await publishPage(page, d.slots);
            await atomicWriteBytesAsync(`${file(scope,id)}.page-${page}`, JSON.stringify(d.slots), { storage });
            d.archived ||= {done:0,error:0,skipped:0};
            for (const slot of d.slots) d.archived[slot.status] = (d.archived[slot.status] || 0) + 1;
            d.baseIndex = (d.baseIndex || 0) + 100; d.slots = []; await persist(task);
          }
          while (active.size < d.plan.concurrency && d.status === "running" && !signal.aborted && d.slots.length < (d.plan.continuous ? 100 : d.plan.count)) {
            const index = (d.baseIndex || 0) + d.slots.length, variant = d.plan.variants[index % d.plan.variants.length];
            const parameters=Object.fromEntries(['size','ratio','resolution','quality'].filter(k=>variant?.[k]!==undefined).map(k=>[k,variant[k]]));
            const slot = { index, status: "running", prompt: variant?.prompt || d.plan.input.prompt, title: variant?.title || `方案 ${index + 1}`, parameters };
            d.slots.push(slot);
            try { await persist(task); } catch(error) { d.slots.pop(); throw error; }
            // Pause/cancel can arrive while the durable reservation is writing.
            // This slot has not reached the provider and can still be withdrawn.
            if (d.status !== "running" || signal.aborted) { d.slots.pop(); await persist(task); break; }
            const work = one(slot).finally(() => active.delete(work)); active.add(work);
            if (d.status !== "running" || signal.aborted) break;
          }
          if (!active.size && !d.plan.continuous && d.slots.length >= d.plan.count) { d.status = d.slots.some(s => s.status !== "done") ? "error" : "completed"; break; }
        }
        if (active.size) await Promise.race(active);
        else await new Promise(resolve => { task.wake = resolve; if (signal.aborted || d.status === "running" || d.status === "cancelled") resolve(); });
      }
      await Promise.allSettled(active); await persist(task); publish();
      return { actions: actions(task), envelope: { ok: d.status === "completed", summary: snapshot(task).summary }, batch: snapshot(task) };
    } catch(error) {
      d.status = "pausing"; d.error = failure(error); await Promise.allSettled(active); d.status = "interrupted";
      await persist(task); publish(); throw error;
    } finally { task.executing = false; delete task.wake; signal.removeEventListener("abort", wake); }
  }
  async function recover(scope,id,nodes) {
    const task = await get(scope,id), d = task.data;
    for(const slot of d.slots.filter(s=>s.status === "unknown")) {
      const page = d.plan.continuous ? Math.floor(slot.index/100) : 0;
      const node = nodes.find(n=>n.generationRunId === `${id}-page-${page}` && n.imageCollection?.items?.some(i=>i.id === `slot-${slot.index}` && i.status === "done"));
      const item = node?.imageCollection?.items?.find(i=>i.id === `slot-${slot.index}` && i.status === "done");
      const asset = item && node.assets?.[item.assetIndex-1];
      if(asset && (asset.path || asset.assetUrl)) { slot.asset=asset;slot.status="done";delete slot.error; }
    }
    await persist(task);return snapshot(task);
  }
  return { create, run, control, recover, async actions(scope,id) { return actions(await get(scope,id)); }, async status(scope,id) { return snapshot(await get(scope,id)); }, async plan(scope,id) { return (await get(scope,id)).data.plan; }, async references(scope,id) { return (await get(scope,id)).data.references || []; }, async list(scope) {
    let files; try { files = await storage.readdir(path.dirname(file(scope,"index"))); } catch(error) { if(error.code === "ENOENT") return []; throw error; }
    const result=[]; for (const name of files.filter(n=>/^matrix-batch-[a-f0-9-]{36}\.json$/.test(n))) result.push(snapshot(await get(scope,name.slice(0,-5)))); return result;
  } };
}
module.exports = { createImageBatchRuntime, normalizeBatchPlan };
