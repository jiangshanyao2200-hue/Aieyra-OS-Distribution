// Base reference identity: independent of order, layout, title and selection.
// Pure JS is shared by the renderer and the authoritative main process.
export function workspaceReferenceCode(kind, id) {
  let hash = 0xcbf29ce484222325n;
  for (const char of `${kind}:${id}`) {
    hash ^= BigInt(char.codePointAt(0));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `W_${hash.toString(36).padStart(13, "0")}`;
}

export function workspaceMentionTokens(prompt) {
  return [...String(prompt || "").matchAll(/(?<![\w@])@([A-Za-z][A-Za-z0-9_-]{0,31})(?![A-Za-z0-9_-])/g)].map(match => match[1]);
}

export function resolveWorkspaceReferences(prompt, candidates) {
  const byCode = new Map();
  for (const candidate of candidates) {
    const code = candidate.code.toLowerCase();
    const matches = byCode.get(code) || [];
    if (!matches.some(item => item.nodeId === candidate.nodeId && item.kind === candidate.kind)) matches.push(candidate);
    byCode.set(code, matches);
  }
  const references = [], issues = [], used = new Set();
  for (const token of workspaceMentionTokens(prompt)) {
    const code = token.toLowerCase();
    if (used.has(code)) continue;
    used.add(code);
    const matches = byCode.get(code) || [];
    if (matches.length === 1) references.push(matches[0]);
    else if (matches.length > 1 || /^w_/i.test(token)) issues.push({ code: token, reason: matches.length ? "ambiguous" : "missing" });
  }
  if (references.length > 60) issues.push({ code: "", reason: "limit" });
  return { references: references.slice(0, 60), issues };
}

export function writingReferenceCandidates(artifacts = []) {
  return artifacts.map(artifact => ({ kind: "document", code: workspaceReferenceCode("document", artifact.id),
    nodeId: artifact.id, title: artifact.title || "文档", revision: artifact.revision }));
}

export function workspaceReferenceError(issues) {
  return issues.map(issue => issue.reason === "limit" ? "一次最多引用 60 个节点。"
    : `@${issue.code} ${issue.reason === "missing" ? "已不在当前画布" : "对应多个节点"}，请在输入框删除或重新选择该引用。`).join("\n");
}
