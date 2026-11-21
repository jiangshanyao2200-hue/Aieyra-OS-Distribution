// Image work outlives the short Agent turn that submitted it. Jobs retain the
// exact project, conversation and provider owner; they never inherit the next turn.
function createImageJobRuntime({ registerController, releaseController, emit, publicValue = value => value }) {
  const jobs = new Map(), preparing = new Set();
  function checkStart({id, scope, owner, resume = false}) {
    const previous = jobs.get(id);
    if (previous) {
      if (previous.owner !== owner || previous.scope.projectId !== scope.projectId || previous.scope.conversationId !== scope.conversationId) throw Error("图片任务不属于当前会话。");
      if (!resume || previous.status === "running") return { jobId: id, status: previous.status };
      if (!id.startsWith("matrix-batch-") || previous.status !== "error" || !previous.delivered) throw Error("先核对并保存批量任务的结果，再继续尚未发送的图片。");
    }
    return null;
  }
  function start({ id, parentRunId, scope, owner, authScope, prompt, input, taskScope, reviewContext, run, recoveryDepth = 0, onProgress, resume = false }) {
    const reused = checkStart({id, scope, owner, resume});
    if (reused) return reused;
    const controller = registerController(id, authScope);
    const job = { id, parentRunId, scope, owner, authScope, controller, prompt,
      input: structuredClone(publicValue(input)), taskScope: structuredClone(publicValue(taskScope)),
      reviewContext: structuredClone(publicValue(reviewContext)), recoveryDepth, status: "running", startedAt: Date.now(), actions: [], result: null, delivered: false };
    jobs.set(id, job);
    const event = payload => {
      emit(job, { ...payload, backgroundJobId: id, parentRunId,
        projectId: scope.projectId, conversationId: scope.conversationId, runId: id });
      const reported = onProgress?.(snapshot(job), payload);
      // Page acknowledgments are awaited by the batch runner. Other lifecycle
      // events are notifications and must never create unhandled rejections.
      if (payload.phase === "image-batch-page") return reported;
      if (reported?.catch) reported.catch(error => { job.progressError=String(error?.message || error); });
    };
    job.cancel = () => {
      if (job.status !== "running") return false;
      job.status = "cancelled";
      job.result = publicValue({ actions: job.actions, envelope: { ok: false, summary: "绘图已停止" } });
      controller.abort(new Error("绘图已停止"));
      event({ phase: "background-image-result", tool: "image_gen", summary: "绘图已停止", imageJob: snapshot(job) });
      return true;
    };
    event({ phase: "background-image-start", tool: "image_gen", summary: "正在绘图", input, originalPrompt: prompt, startedAtMs: job.startedAt, imageJob: snapshot(job) });
    job.promise = Promise.resolve().then(() => run({ signal: controller.signal, progress: payload => {
      if (controller.signal.aborted) return;
      if (payload.workflowAction) {
        const action = publicValue(payload.workflowAction);
        const key = action.toolRunId || action.operationId || action.node?.id;
        const index = job.actions.findIndex(item => (item.toolRunId || item.operationId || item.node?.id) === key && item.type === action.type);
        if (index < 0) job.actions.push(action); else job.actions[index] = action;
        if (payload.retainActionLimit === 2 && job.id.startsWith("matrix-batch-")) job.actions = job.actions.slice(-2);
      }
      return event(payload);
    } })).then(result => {
      if (controller.signal.aborted) throw controller.signal.reason || new Error("绘图已停止");
      job.result = publicValue(result);
      job.status = result.envelope?.ok === false ? "error" : "completed";
      if (result.actions?.length) job.actions = publicValue(result.actions);
    }).catch(error => {
      job.status = controller.signal.aborted ? "cancelled" : "error";
      job.result = publicValue({ actions: job.actions, envelope: { ok: false, summary: String(error?.message || error) } });
    }).finally(() => {
      releaseController(id, controller);
      event({ phase: "background-image-result", tool: "image_gen", summary: job.status === "completed" ? "图片已返回" : job.result?.envelope?.summary || "绘图未完成",
        imageJob: snapshot(job) });
      // Completed deliveries can be discarded; pending work/undelivered results stay.
      for (const [key, value] of jobs) if (jobs.size > 96 && value.delivered && value.status !== "running") jobs.delete(key);
    });
    return { jobId: id, status: "running" };
  }
  function snapshot(job) {
    return { id: job.id, parentRunId: job.parentRunId, projectId: job.scope.projectId, conversationId: job.scope.conversationId,
      prompt: job.prompt, input: job.input, taskScope: job.taskScope, reviewContext: job.reviewContext, reviewRunId: job.reviewRunId, recoveryDepth: job.recoveryDepth, status: job.status, startedAt: job.startedAt, actions: job.actions, result: job.result, delivered: job.delivered };
  }
  function owned(job, owner, scope) {
    return job && !job.authScope?.signal?.aborted && job.owner === owner && (!scope || job.scope.projectId === scope.projectId && job.scope.conversationId === scope.conversationId);
  }
  return {
    start,
    async startPrepared(options, prepare, rollback) {
      if (preparing.has(options.id)) throw Error("批量任务正在准备，请核对状态后再继续。");
      preparing.add(options.id);
      try {
        const reused = checkStart(options);
        if (reused && !options.resume) return reused;
        await prepare();
        if (reused) return reused;
        try { return start(options); }
        catch (error) { await rollback?.(); throw error; }
      } finally { preparing.delete(options.id); }
    },
    async wait(id, owner, scope, waitMs = 0) {
      const job = jobs.get(id); if (!owned(job, owner, scope)) return null;
      if (job.status === "running" && waitMs > 0) {
        let timer;
        try { await Promise.race([job.promise, new Promise(resolve => { timer = setTimeout(resolve, Math.min(25000, waitMs)); })]); }
        finally { clearTimeout(timer); }
      }
      return owned(job, owner, scope) ? snapshot(job) : null;
    },
    list: owner => [...jobs.values()].filter(job => owned(job, owner) && !job.delivered).map(snapshot),
    receiptStatus(ids, owner, scope) {
      const requested = [...new Set(ids || [])].map(id => jobs.get(id));
      if (!requested.length || requested.some(job => !owned(job, owner, scope))) return "invalid";
      const pending = requested.filter(job => !job.delivered);
      if (!pending.length) return "delivered";
      if (pending.some(job => job.reviewRunId || job.status === "running")) return "reviewing";
      if (pending.every(job => job.reviewResult)) return "reviewed";
      return "ready";
    },
    completions(ids, owner, scope, reviewRunId, reviewController) {
      const all = [...new Set(ids || [])].map(id => jobs.get(id));
      if (all.some(job => !owned(job, owner, scope))) return [];
      const requested = all.filter(job => !job.delivered);
      // Claim the complete receipt group atomically. A reload/repeated request
      // must not review or regenerate a partly claimed batch a second time.
      if (requested.some(job => !owned(job, owner, scope) || job.delivered ||
          !["completed", "error"].includes(job.status) || (job.reviewRunId && job.reviewRunId !== reviewRunId))) return [];
      if (reviewRunId) for (const job of requested) { job.reviewRunId = reviewRunId; job.reviewController = reviewController; }
      return requested.map(snapshot);
    },
    reviewed(ids, owner, scope, result) {
      for (const id of ids || []) { const job = jobs.get(id); if (owned(job, owner, scope) && !job.delivered) job.reviewResult = publicValue(result); }
    },
    cachedReview(ids, owner, scope) {
      const all = [...new Set(ids || [])].map(id => jobs.get(id));
      if (all.some(job => !owned(job, owner, scope))) return null;
      const requested = all.filter(job => !job.delivered);
      return requested.length && requested.every(job => job.reviewResult) ? requested[0].reviewResult : null;
    },
    acknowledge(ids, owner, scope) {
      const requested = [...new Set(ids || [])].map(id => jobs.get(id));
      if (!requested.length || requested.some(job => !owned(job, owner, scope) || (!job.delivered && !job.reviewResult))) return false;
      for (const job of requested) { job.delivered = true; delete job.reviewResult; }
      return true;
    },
    releaseReview(reviewRunId, owner) {
      for (const job of jobs.values()) if (job.owner === owner && job.reviewRunId === reviewRunId) {
        delete job.reviewRunId; delete job.reviewController;
        // Notify a reloaded renderer after the original request releases its claim.
        if (!job.delivered) emit(job, { phase: "background-image-review-ready", tool: "image_gen", backgroundJobId: job.id,
          parentRunId: job.parentRunId, projectId: job.scope.projectId, conversationId: job.scope.conversationId,
          runId: job.id, imageJob: snapshot(job) });
      }
    },
    cancel(id, owner) { let cancelled = false; for (const job of jobs.values()) if ((job.id === id || job.parentRunId === id || job.reviewRunId === id) && (owner === undefined || job.owner === owner)) {
      job.delivered = true;
      if (job.reviewController && !job.reviewController.signal.aborted) { job.reviewController.abort(new Error("绘图检查已停止")); cancelled = true; }
      if (job.cancel()) cancelled = true;
    } return cancelled; },
  };
}
module.exports = { createImageJobRuntime };
