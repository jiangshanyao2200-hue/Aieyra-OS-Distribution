/** @typedef {{artifactId:string,title:string,reviewKey:string,confirmed:boolean,changed:boolean,question:string,nextStep:string,feedback:string}} WorkReviewState */
// Compact version identity for optimistic review checks, not a security receipt.
export function workVersionFingerprint(text) {
  let a = 2166136261, b = 5381;
  for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ text.charCodeAt(i); }
  return `${(a >>> 0).toString(16).padStart(8, "0")}${(b >>> 0).toString(16).padStart(8, "0")}`;
}
// Version-bound review of an actual work artifact. No model-generated approval.
export function workReviewState(artifacts, artifact) {
  if (!artifact?.attributes?.workReviewRequested) return null;
  const visited = new Set();
  const byId = new Map(artifacts.map(item => [item.id, item]));
  const stamps = [];
  const queue = [artifact];
  while (queue.length) {
    const item = queue.pop();
    if (!item || visited.has(item.id)) continue;
    visited.add(item.id);
    stamps.push(`${item.id}@${item.revision}:${item.contentSha256 || ""}:${item.structureSha256 || ""}:${item.status}`);
    for (const id of [...(item.sourceArtifactIds || [])].sort()) {
      const source = byId.get(id);
      if (source) queue.push(source); else stamps.push(`missing:${id}`);
    }
  }
  // Keys remain short enough for the existing scalar attribute storage.
  const reviewKey = `${artifact.id}@${artifact.revision}:${workVersionFingerprint(JSON.stringify([stamps, artifact.attributes.workReviewQuestion, artifact.attributes.workReviewNextStep]))}`;
  const confirmed = artifact.status === "ready" && artifact.attributes.workReviewConfirmedKey === reviewKey;
  return { artifactId: artifact.id, title: artifact.title, reviewKey, confirmed,
    changed: artifact.attributes.workReviewRequestedKey !== reviewKey,
    question: String(artifact.attributes.workReviewQuestion || "请核对本阶段成果。"),
    nextStep: String(artifact.attributes.workReviewNextStep || "继续下一阶段"),
    feedback: String(artifact.attributes.workReviewFeedback || "") };
}

export function requestWorkReview(artifacts, input) {
  const artifact = artifacts.find(item => item.id === input.artifactId);
  if (!artifact || artifact.status !== "ready" || artifact.revision !== input.expectedRevision) throw new Error("阶段成果已变化或尚未就绪，请重新读取后发起核对。");
  if (artifact.attributes?.novelRole || artifact.attributes?.novelId) throw new Error("小说使用 novel_write / novel_confirm 按阶段核对。");
  const question = String(input.question || "").trim();
  if (!question || question.length > 1200) throw new Error("请提供简明的核对问题，长度不超过 1200 字符。");
  const attributes = { ...artifact.attributes, workReviewRequested: true, workReviewQuestion: question,
    workReviewNextStep: String(input.nextStep || "继续下一阶段").slice(0, 600), workReviewFeedback: "", workReviewConfirmedKey: "" };
  const review = workReviewState(artifacts, { ...artifact, attributes });
  return { ...attributes, workReviewRequestedKey: review.reviewKey };
}

export function decideWorkReview(artifacts, input) {
  const artifact = artifacts.find(item => item.id === input.artifactId);
  const state = workReviewState(artifacts, artifact);
  if (!state || input.reviewKey !== state.reviewKey || artifact.status !== "ready") throw new Error("核对的内容或来源已变化，请查看最新版本再决定。");
  if (!["confirm", "revise"].includes(input.action)) throw new Error("请选择确认或提出修改。");
  const feedback = String(input.feedback || "").trim().slice(0, 2000);
  if (input.action === "revise" && !feedback) throw new Error("请填写需要调整的内容。");
  return { ...artifact.attributes, workReviewRequestedKey: state.reviewKey,
    workReviewConfirmedKey: input.action === "confirm" ? state.reviewKey : "", workReviewFeedback: feedback };
}

export const workReviewToolSchema = { type: "function", function: {
  name: "work_review", description: "请求用户核对已保存的阶段成果（分析口径、论文结构、HTML 方案等）。先读取最新版本；返回后等待用户确认或反馈，不能自行确认。小说使用专用逐阶段核对。",
  parameters: { type: "object", properties: { artifactId: { type: "string" }, expectedRevision: { type: "integer", minimum: 1 },
    question: { type: "string", maxLength: 1200 }, nextStep: { type: "string", maxLength: 600 } }, required: ["artifactId", "expectedRevision", "question"], additionalProperties: false }
} };
