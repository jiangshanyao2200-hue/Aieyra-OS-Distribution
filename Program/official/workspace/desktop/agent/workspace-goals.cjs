"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");

// Project data, independent of model context and of optional feedback notes.
// No scheduler: a goal never submits another model/image request itself.
const text = (value, max = 4000) => String(value || "").trim().slice(0, max);
const fileFor = root => path.join(root, ".iiimage", "goals.json");
function loadGoals(root) {
  const file = fileFor(root);
  if (!fs.existsSync(file)) return { version: 1, goals: [] };
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  if (value.version !== 1 || !Array.isArray(value.goals)) throw new Error("目标记录格式无法识别，原文件已保留。");
  return value;
}
function saveGoals(root, state) {
  const file = fileFor(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  try { fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", "utf8"); fs.renameSync(tmp, file); }
  finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
function mutate(root, id, expectedRevision, change) {
  const state = loadGoals(root), goal = state.goals.find(item => item.id === id);
  if (!goal) throw new Error("目标不存在，请重新读取当前项目目标。");
  if (expectedRevision !== undefined && expectedRevision !== goal.revision) throw new Error("目标或反馈已更新，请重新读取再修改。");
  const result = change(goal);
  if (result === false) return goal;
  goal.revision += 1;
  saveGoals(root, state);
  return goal;
}
const assetKey = asset => asset.occurrenceId || asset.assetId || asset.contentHash || asset.relativePath || asset.path || asset.assetUrl;
const imageVersions = new Map();
function imageVersion(asset) {
  if (asset.path) {
    if (!fs.existsSync(asset.path)) throw new Error("目标图片文件已移除，请恢复或明确更换参考。");
    const stat = fs.statSync(asset.path);
    if (!stat.isFile() || stat.size > 128 * 1024 * 1024) throw new Error("目标图片无法读取或超过读取范围。");
    const stamp = `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.ino}`, key = path.resolve(asset.path);
    if (imageVersions.get(key)?.stamp === stamp) return imageVersions.get(key).hash;
    const hash = createHash("sha256").update(fs.readFileSync(asset.path)).digest("hex");
    if (imageVersions.size >= 256) imageVersions.delete(imageVersions.keys().next().value);
    imageVersions.set(key, { stamp, hash });
    return hash;
  }
  throw new Error("目标图片缺少可核对的本地文件，请重新读取项目素材。");
}
function goalImages(nodes) {
  return (nodes || []).flatMap(node => node.type === "image" ? (node.assets || []).map((asset, assetIndex) => ({
    ...asset, nodeId: node.id, assetIndex, displayCode: asset.displayCode || `${node.displayCode || node.id}${assetIndex + 1}`,
    name: asset.name || node.title || "参考图", role: "reference"
  })) : []);
}
function captureAnchors(context, references) {
  const images = goalImages(context.nodes);
  const explicit = Array.isArray(references) ? references.flatMap(ref => {
    const selected = images.filter(asset => asset.nodeId === ref.nodeId && (ref.assetIndex === undefined || asset.assetIndex === ref.assetIndex));
    if (!selected.length) throw new Error("固定参考必须来自当前项目的真实图片。");
    return selected;
  }) : [...(context.taskScope?.sourceAssets || []), ...(context.taskScope?.referenceAssets || []), ...(context.taskScope?.contextAssets || [])];
  const unique = [...new Map(explicit.map(asset => [assetKey(asset), asset])).values()];
  if (unique.length > 24) throw new Error("请明确最多 24 张目标参考图，其他材料可按需查看。");
  return unique.map(asset => ({ nodeId: asset.nodeId || asset.ownerNodeId, assetIndex: asset.assetIndex,
    key: assetKey(asset), version: imageVersion(asset), code: asset.displayCode, name: asset.name,
    occurrenceId: asset.occurrenceId, assetId: asset.assetId, relativePath: asset.relativePath }));
}
function resolveGoalImages(goal, nodes) {
  const images = goalImages(nodes), assets = [], issues = [];
  for (const anchor of goal.anchors || []) {
    const found = images.find(asset => assetKey(asset) === anchor.key)
      || images.find(asset => anchor.occurrenceId && asset.occurrenceId === anchor.occurrenceId)
      || images.find(asset => anchor.assetId && asset.assetId === anchor.assetId);
    if (!found) { issues.push({ code: anchor.code, issue: "原始参考已移除，请恢复或明确更换参考" }); continue; }
    try {
      if (anchor.version && imageVersion(found) !== anchor.version) { issues.push({ code: anchor.code, issue: "原始参考内容已改变，请核对后明确更换参考" }); continue; }
    } catch (error) { issues.push({ code: anchor.code, issue: error.message }); continue; }
    assets.push({ ...found, purpose: "持续目标的原始参考；须保留用户确认的视觉特点" });
  }
  return { assets, issues };
}
function goalSummary(goal) {
  return { id: goal.id, revision: goal.revision, objective: goal.objective, status: goal.status,
    feedbackMode: goal.feedbackMode, keep: goal.keep, referenceCount: goal.anchors.length,
    sourceArtifactIds: goal.sourceArtifactIds, rounds: goal.checkpoints.length,
    latest: goal.checkpoints.length ? { ...goal.checkpoints.at(-1), feedbackHistory: undefined } : null };
}
function listGoals(root) { return loadGoals(root).goals.map(goalSummary); }
function readGoal(root, id) {
  const goal = loadGoals(root).goals.find(item => item.id === id);
  if (!goal) throw new Error("当前项目没有这个目标。");
  return goal;
}
function goalContext(goal) {
  const checkpoints = goal.checkpoints.slice(-10);
  const selected = goal.checkpoints.find(item => item.id === goal.selectedCheckpointId);
  if (selected && !checkpoints.includes(selected)) checkpoints.unshift(selected);
  let budget = 12000;
  const retained = [];
  for (const cp of goal.checkpoints) {
    for (const feedback of [...(cp.feedbackHistory || []), cp.feedback].filter(Boolean)) {
      if (!feedback.keep) continue;
      if (budget >= feedback.keep.length) { retained.push({ checkpointId: cp.id, keep: feedback.keep }); budget -= feedback.keep.length; }
      else { retained.push({ checkpointId: cp.id, readEarlierFeedback: true }); }
    }
  }
  return { ...goal, updates: undefined, checkpoints: checkpoints.map(cp => ({ ...cp, feedbackHistory: undefined })),
    retainedFeedback: retained, totalRounds: goal.checkpoints.length,
    olderFeedback: "完整历轮反馈持久保存；workspace_goal read 按 offset/limit 查看。较新的明确纠正优先。" };
}
function runGoalTool(root, input, context = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("目标参数需要对象。");
  if (input.feedbackMode !== undefined && !["notes", "chat"].includes(input.feedbackMode)) throw new Error("反馈方式必须为 notes 或 chat。");
  if (input.status !== undefined && !["active", "paused", "satisfied"].includes(input.status)) throw new Error("目标状态无效。");
  for (const [key, maximum] of [["offset", Number.MAX_SAFE_INTEGER], ["limit", 20]]) {
    if (input[key] !== undefined && (!Number.isSafeInteger(input[key]) || input[key] < (key === "limit" ? 1 : 0) || input[key] > maximum)) throw new Error("目标分页参数超出范围。");
  }
  if (input.references !== undefined && (!Array.isArray(input.references) || input.references.length > 24 || input.references.some(ref => !ref || typeof ref.nodeId !== "string" || !ref.nodeId || ref.nodeId.length > 160 || (ref.assetIndex !== undefined && (!Number.isSafeInteger(ref.assetIndex) || ref.assetIndex < 0))))) throw new Error("目标参考需要最多 24 个真实节点及有效图片位置。");
  if (input.sourceArtifactIds !== undefined && (!Array.isArray(input.sourceArtifactIds) || input.sourceArtifactIds.length > 40 || input.sourceArtifactIds.some(id => typeof id !== "string" || !id || id.length > 180))) throw new Error("目标资料需要最多 40 个有效成果 ID。");
  const operation = input.operation;
  if (operation === "list") {
    const all = listGoals(root), offset = input.offset || 0, limit = input.limit || 20;
    return { goals: all.slice(offset, offset + limit), total: all.length, nextOffset: offset + limit < all.length ? offset + limit : null };
  }
  if (operation === "start") {
    if (!text(input.objective)) throw new Error("请先明确用户要达成的目标。");
    const state = loadGoals(root);
    const key = context.toolRunId || "";
    const existing = key && state.goals.find(goal => goal.createdByOperation === key);
    if (existing) return { goal: existing };
    const goal = { id: `goal-${randomUUID()}`, revision: 1, objective: text(input.objective),
      userRequest: text(context.prompt, 12000), keep: text(input.keep), status: "active",
      feedbackMode: input.feedbackMode || "notes", anchors: captureAnchors(context, input.references),
      sourceArtifactIds: [...new Set(input.sourceArtifactIds || [])], checkpoints: [],
      conversationId: context.conversationId || "", createdByOperation: key };
    if (goal.sourceArtifactIds.some(id => !(context.artifacts || []).some(artifact => artifact.id === id))) throw new Error("目标资料必须是当前项目已有成果。");
    goal.sources = goal.sourceArtifactIds.map(id => { const artifact = context.artifacts.find(item => item.id === id); return { id, revision: artifact.revision, contentSha256: artifact.contentSha256 }; });
    state.goals.push(goal); saveGoals(root, state);
    return { goal };
  }
  if (operation === "read" || operation === "resume") {
    const goal = readGoal(root, input.goalId);
    const start = Math.max(0, input.offset || 0), limit = Math.min(20, input.limit || 10);
    return { goal: operation === "resume" ? goalContext(goal) : { ...goal, checkpoints: goal.checkpoints.slice(start, start + limit) },
      sourceChanges: (goal.sources || []).filter(source => { const current = (context.artifacts || []).find(item => item.id === source.id); return !current || current.revision !== source.revision || current.contentSha256 !== source.contentSha256; }),
      totalRounds: goal.checkpoints.length, nextOffset: start + limit < goal.checkpoints.length ? start + limit : null,
      instruction: "原始参考、用户反馈和保留项共同约束本目标；看最新成果后再决定，不能将已有成果替代原始参考。用户新任务不自动沿用此目标。" };
  }
  if (operation === "update") {
    const goal = mutate(root, input.goalId, input.expectedRevision, goal => {
      if (!Number.isInteger(input.expectedRevision)) throw new Error("更新目标需要刚读取的 expectedRevision。");
      if (input.objective !== undefined) { if (!text(input.objective)) throw new Error("目标不能为空。"); goal.objective = text(input.objective); }
      if (input.keep !== undefined) goal.keep = text(input.keep);
      if (input.feedbackMode) goal.feedbackMode = input.feedbackMode;
      if (input.status) goal.status = input.status;
      if (input.references) goal.anchors = captureAnchors(context, input.references);
      goal.updates = [...(goal.updates || []), { revision: goal.revision + 1, userRequest: text(context.prompt, 12000),
        objective: goal.objective, keep: goal.keep, feedbackMode: goal.feedbackMode, status: goal.status }];
    });
    return { goal };
  }
  throw new Error("未知目标操作。");
}
function checkpointGoal(root, input) {
  let checkpoint;
  const goal = mutate(root, input.goalId, undefined, goal => {
    checkpoint = goal.checkpoints.find(item => item.key === input.key);
    if (checkpoint) return false;
    if (goal.status !== "active") return false;
    if (!input.key || !input.outputs?.length) throw new Error("反馈必须关联已保存的实际成果。");
    checkpoint = { id: `round-${randomUUID()}`, key: input.key, outputs: input.outputs,
      question: text(input.question, 1200) || "请先查看成品。哪些地方满意、希望保留？哪些地方需要调整？",
      previousId: goal.checkpoints.at(-1)?.id || "", feedback: null };
    goal.checkpoints.push(checkpoint);
    goal.selectedCheckpointId = checkpoint.id;
  });
  return { goal: goalSummary(goal), checkpoint, showNote: Boolean(checkpoint && goal.feedbackMode === "notes" && goal.status === "active") };
}
function recordGoalFeedback(root, input) {
  return mutate(root, input.goalId, undefined, goal => {
    const checkpoint = goal.checkpoints.find(item => item.id === input.checkpointId);
    if (!checkpoint) throw new Error("该轮成果记录不存在。");
    if (input.outputKey && input.outputKey !== JSON.stringify(checkpoint.outputs)) throw new Error("成果已改变，请查看当前版本再反馈。");
    const feedback = { satisfied: input.satisfied === true, keep: text(input.keep), change: text(input.change),
      userText: text(input.userText), source: input.source === "conversation" ? "conversation" : "user" };
    if (!feedback.satisfied && !feedback.change && !feedback.userText) throw new Error("请填写需要改进的地方。");
    if (JSON.stringify(checkpoint.feedback) === JSON.stringify(feedback)) return false;
    // Preserve earlier comments when the user changes their mind or adds detail.
    if (checkpoint.feedback) checkpoint.feedbackHistory = [...(checkpoint.feedbackHistory || []), checkpoint.feedback];
    checkpoint.feedback = feedback;
    goal.selectedCheckpointId = checkpoint.id;
    goal.status = feedback.satisfied ? "satisfied" : "active";
  });
}
// Work review and its goal feedback are both synchronous project writes. If
// the authoritative session commit fails, restore the previous goal record;
// callers hold the existing project lock throughout this operation.
function withGoalCommit(root, change, commit) {
  const before = loadGoals(root);
  const result = change();
  try { return commit(result); }
  catch (error) { saveGoals(root, before); throw error; }
}
function linkGoalNote(root, goalId, checkpointId, noteNodeId) {
  return mutate(root, goalId, undefined, goal => {
    const cp = goal.checkpoints.find(item => item.id === checkpointId);
    if (!cp || cp.noteNodeId === noteNodeId) return false;
    cp.noteNodeId = noteNodeId;
  });
}
const goalToolSchema = { type: "function", function: { name: "workspace_goal",
  description: "按需保存/读取持续目标、最初参考、保留项和历轮反馈。用户要求逐轮改进到满意时 start；续作先 resume 恢复参考，read 分页追溯。普通任务无需启用。关闭便签用 update feedbackMode=chat，目标仍保留；无自动循环。",
  parameters: { type: "object", additionalProperties: false, required: ["operation"], properties: {
    operation: { type: "string", enum: ["list", "start", "read", "resume", "update"] }, goalId: { type: "string" },
    objective: { type: "string", maxLength: 4000 }, keep: { type: "string", maxLength: 4000 },
    expectedRevision: { type: "integer", minimum: 1 }, feedbackMode: { type: "string", enum: ["notes", "chat"] },
    status: { type: "string", enum: ["active", "paused", "satisfied"] },
    references: { type: "array", maxItems: 24, items: { type: "object", additionalProperties: false,
      required: ["nodeId"], properties: { nodeId: { type: "string" }, assetIndex: { type: "integer", minimum: 0 } } } },
    sourceArtifactIds: { type: "array", maxItems: 40, items: { type: "string" } },
    offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 20 }
  } } } };
const goalInstructions = "持续目标按需启用：用户要求沿参考反复改进、做到满意或明确目标协作时，用 workspace_goal start 保存目标、最初参考和保留项。普通单次任务不要频繁创建目标或便签。每轮续作先 resume 对应目标，读取历轮满意/不满意反馈并查看原始参考与最新成果；不因未重新 @ 而丢失参考，不把最新生成图替代原始参考。仅把用户实际表达的要求记为确认，主动澄清关键未知。生成后先交用户查看，再等反馈，不自发连续重画。用户说不再创建便签时 update feedbackMode=chat，仍保留目标与反馈；要求暂停或新目标时尊重最新意图，独立任务不自动继承旧目标。工作沿用实际成果的 work_review，无需另建重复需求；目标与反馈是本项目当前事实，不是跨任务经验。";
module.exports = { loadGoals, listGoals, readGoal, runGoalTool, checkpointGoal, recordGoalFeedback,
  linkGoalNote, resolveGoalImages, goalImages, goalSummary, goalContext, goalToolSchema, goalInstructions, imageVersion, withGoalCommit };
