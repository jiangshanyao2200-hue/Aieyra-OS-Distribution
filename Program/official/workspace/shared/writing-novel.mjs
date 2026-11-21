/** @typedef {'brief'|'synopsis'|'plot'|'characters'|'outline'} NovelSection */
/** @typedef {{action:'start'|'create'|'write'|'rename'|'confirm'|'read'|'assemble'|'format',format?:'html'|'docx',novelId?:string,title?:string,previousTitle?:string,expectedRootRevision?:number,expectedRevision?:number,section?:NovelSection|'chapter',chapterIndex?:number,text?:string,phase?:NovelSection,reviewKey?:string,confirmationQuote?:string,sourceArtifactIds?:string[],objective?:string}} NovelCommand */
/** @typedef {import('../src/writing-schema').WritingArtifactRecord} NovelArtifact */
// Shared novel identity and version rules. Bodies remain in Writing's versioned files.
import { workVersionFingerprint } from "./work-review.mjs";
export const WRITING_DEMAND_CATEGORIES = [
  { id: "novel", label: "小说", template: "fiction" },
  { id: "paper", label: "论文", template: "academic" },
  { id: "copy", label: "文案", template: "general" },
  { id: "design", label: "设计", template: "general" },
  { id: "ppt", label: "PPT", template: "general" },
  { id: "html", label: "HTML", template: "general" }
];
/** @type {Array<{id:NovelSection,label:string,kind:string}>} */
export const NOVEL_SECTIONS = [
  { id: "brief", label: "需求核对", kind: "outline" },
  { id: "synopsis", label: "简介", kind: "outline" },
  { id: "plot", label: "剧情", kind: "outline" },
  { id: "characters", label: "角色", kind: "character" },
  { id: "outline", label: "大纲", kind: "outline" }
];
export const artifactText = (artifact) => (artifact?.paragraphs || []).map((p) => p.text).join("\n\n");
export const isNovelRoot = (artifact) => artifact?.attributes?.novelRole === "root";
export const isNovelInternal = (artifact) => Boolean(artifact?.attributes?.novelId && artifact?.attributes?.novelSection);
export const novelStamp = (artifact) => artifact ? `${artifact.id}@${artifact.revision}:${artifact.contentSha256}` : "";

/** @param {NovelArtifact[]} artifacts */
export function novelParts(artifacts, novelId) {
  const members = artifacts.filter((item) => item.attributes?.novelId === novelId);
  return {
    sections: Object.fromEntries(NOVEL_SECTIONS.map(({ id }) => [id, members.find((item) => item.attributes?.novelSection === id)])),
    chapters: members.filter((item) => item.kind === "chapter" && !item.attributes?.novelSection)
      .sort((a, b) => Number(a.attributes?.chapterIndex || 0) - Number(b.attributes?.chapterIndex || 0) || a.id.localeCompare(b.id))
  };
}

// Reserve level-one headings for real chapters in assembled books. User
// subheadings and code samples remain content, never extra TOC entries.
export function novelBookText(sections, chapters) {
  const nested = (text) => {
    let fence = null;
    return String(text || "").split("\n").map((line) => {
      const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
      if (marker) {
        if (!fence) fence = marker[1];
        else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
        return line;
      }
      return fence ? line : line.replace(/^(\s{0,3})(#{1,6})(\s+)/, (_match, indent, hashes, gap) => `${indent}${"#".repeat(Math.min(4, hashes.length + 1))}${gap}`);
    }).join("\n");
  };
  return [nested(artifactText(sections.synopsis)), ...chapters.map((chapter) =>
    `# ${String(chapter.title).replace(/[\r\n]+/g, " ")}\n\n${nested(artifactText(chapter))}`
  )].filter(Boolean).join("\n\n");
}

export function novelReviewState(artifacts, root) {
  const { sections, chapters } = novelParts(artifacts, root.id);
  const sourceKeys = (root.sourceArtifactIds || []).map(id => novelStamp(artifacts.find(a => a.id === id)) || `missing:${id}`);
  // Sources can span many imported files. Keep keys within scalar attribute
  // limits so persistence never truncates a valid review into a mismatch.
  const requestKey = sourceKeys.length ? `${novelStamp(root)}|sources:${workVersionFingerprint(sourceKeys.sort().join("|"))}` : novelStamp(root);
  const briefKey = `${requestKey}|${novelStamp(sections.brief)}`;
  const briefReady = Boolean(sections.brief && sections.brief.attributes?.basedOnRequestKey === requestKey);
  const requirementsConfirmed = briefReady && root.attributes?.briefConfirmedKey === briefKey;
  // Preserve already approved legacy books, without allowing new bulk approvals.
  const legacyKey = `${briefKey}|${["synopsis", "outline", "characters", "plot"].map(id => novelStamp(sections[id])).join("|")}`;
  const legacyConfirmed = requirementsConfirmed && root.attributes?.planConfirmedKey === legacyKey
    && ["synopsis", "outline", "characters", "plot"].every(id => sections[id]?.attributes?.basedOnBriefKey === briefKey);
  let basisKey = requestKey, previousConfirmed = true;
  const stages = NOVEL_SECTIONS.map(({ id, label }) => {
    const artifact = sections[id];
    const reviewKey = `${basisKey}|${novelStamp(artifact)}`;
    const ready = previousConfirmed && Boolean(artifact && artifact.status !== "error" && artifact.status !== "stale"
      && (id === "brief" ? briefReady : legacyConfirmed || artifact.attributes?.basedOnStageKey === basisKey));
    const confirmed = ready && (id === "brief" ? requirementsConfirmed : legacyConfirmed || root.attributes?.[`${id}ConfirmedKey`] === reviewKey);
    const stage = { id, label, ready, confirmed, reviewKey, basisKey, artifactId: artifact?.id || null };
    previousConfirmed = confirmed; basisKey = reviewKey;
    return stage;
  });
  const pending = stages.find(stage => !stage.confirmed) || null;
  const planKey = legacyConfirmed ? legacyKey : stages.at(-1).reviewKey;
  const planReady = stages.at(-1).ready;
  const planConfirmed = stages.every(stage => stage.confirmed);
  return { requestKey, briefKey, briefReady, requirementsConfirmed, planKey, planReady, planConfirmed,
    stages, pending, chapterCount: chapters.length,
    label: pending ? `${pending.ready ? "待核对" : "准备"}${pending.label}` : "章节创作" };
}

function fail(message, code = "WRITING_NOVEL_INVALID") {
  throw Object.assign(new Error(message), { code });
}
export function requireNovel(artifacts, novelId) {
  const root = artifacts.find((item) => item.id === novelId);
  if (!root || !isNovelRoot(root)) fail("小说主节点不存在，请重新读取画布。");
  return root;
}

export function confirmedNovelAttributes(artifacts, input) {
  const root = requireNovel(artifacts, input.novelId);
  const state = novelReviewState(artifacts, root);
  const phase = input.phase;
  const stage = state.stages.find(item => item.id === phase);
  if (!stage) fail("请选择当前阶段：需求、简介、剧情、角色或大纲；逐项核对后再开始正文。");
  if (input.reviewKey !== stage.reviewKey || !stage.ready) {
    fail("核对内容已变化，请查看当前版本后再确认。", "WRITING_REVISION_CONFLICT");
  }
  return { ...root.attributes, [`${phase}ConfirmedKey`]: stage.reviewKey,
    [`${phase}ConfirmedAt`]: new Date().toISOString() };
}

// Only the actual current user message may confirm a named, versioned review.
// Bare acknowledgements and negated/conditional confirmations stay in review.
export function confirmNovelUserMessage(artifacts, input, userPrompt, selectedArtifactId) {
  const root = requireNovel(artifacts, input.novelId);
  const selected = artifacts.find((a) => a.id === selectedArtifactId);
  const quote = String(input.confirmationQuote || "").trim();
  const prompt = String(userPrompt || "");
  const withoutReferences = value => value.replace(/(?<![\w@])@W_[A-Za-z0-9_-]{1,29}(?![A-Za-z0-9_-])/gi, "").trim();
  const sentences = prompt.split(/(?<=[。！？?])|\n+/).map((line) => line.trim());
  const confirmedSentence = sentences.some((line) => withoutReferences(line).replace(/[。！]$/, "") === withoutReferences(quote).replace(/[。！]$/, ""));
  const affirmative = withoutReferences(quote).replace(/^(?:好的?|没问题|不用改|无需修改|不需要修改)[，,、\s]+/, "");
  if (!quote || !confirmedSentence || /[?？]|不|别|暂|还没|尚未|如果|等.+再|先.+再/.test(affirmative)) fail("需要用户明确确认当前需求或初版，不能把普通应答当成确认。", "WRITING_NOVEL_REVIEW_REQUIRED");
  const label = input.phase === "brief" ? "需求" : NOVEL_SECTIONS.find(item => item.id === input.phase)?.label;
  const pattern = new RegExp(`^(?:我(?:现在)?|现在|可以)?(?:确认${label}|${label}确认|按这个${label})(?:$|[，,。！\\s])`);
  if (!pattern.test(affirmative) || !(selected?.id === root.id || selected?.attributes?.novelId === root.id || quote.includes(root.id) || quote.includes(root.title))) fail("请明确确认哪部小说的需求或初版。", "WRITING_NOVEL_REVIEW_REQUIRED");
  return confirmedNovelAttributes(artifacts, input);
}

export function planNovelWrite(artifacts, input, author = "agent") {
  const root = requireNovel(artifacts, input.novelId);
  if (Number(input.expectedRootRevision) !== root.revision) fail("小说需求版本已变化，请重新读取。", "WRITING_REVISION_CONFLICT");
  const section = String(input.section || "");
  const definition = NOVEL_SECTIONS.find((item) => item.id === section);
  if (!definition && section !== "chapter") fail("未知小说内容类别。");
  const state = novelReviewState(artifacts, root);
  const stage = state.stages.find(item => item.id === section);
  if (stage && section !== "brief" && !state.stages[state.stages.indexOf(stage) - 1].confirmed) {
    fail(`请先核对并确认${state.pending?.label || "前一阶段"}，再准备${stage.label}。`, "WRITING_NOVEL_REVIEW_REQUIRED");
  }
  if (section !== "brief" && !state.requirementsConfirmed) fail("请先与用户核对并确认需求，再生成初版。", "WRITING_NOVEL_REVIEW_REQUIRED");
  if (section === "chapter" && !state.planConfirmed) fail("请先让用户核对并确认简介、大纲、角色与剧情，再写章节。", "WRITING_NOVEL_REVIEW_REQUIRED");
  const index = Number(input.chapterIndex);
  if (section === "chapter" && (!Number.isSafeInteger(index) || index < 1 || index > 10000)) fail("章节序号需要为 1–10000 的整数。");
  const { sections, chapters } = novelParts(artifacts, root.id);
  const existing = section === "chapter" ? chapters.find((item) => Number(item.attributes?.chapterIndex) === index) : sections[section];
  const text = String(input.text || "").trim();
  if (!text) fail("内容不能为空。");
  if (text.length > 300000) fail("单次内容过长，请分章或分段编辑。");
  // Retried creates are idempotent, but never overwrite an occupied slot.
  if (existing && Number(input.expectedRevision || 0) === 0 && artifactText(existing).trim() === text &&
    (section === "chapter" ? existing.attributes?.basedOnPlanKey === state.planKey : existing.attributes?.basedOnStageKey === stage.basisKey)) return { root, existing, unchanged: true };
  if (Number(input.expectedRevision || 0) !== (existing?.revision || 0)) fail("内容版本已变化，请先读取最新版本；不会覆盖已有内容。", "WRITING_REVISION_CONFLICT");
  if (author === "agent" && existing?.kind === "chapter") fail("修订已有章节请使用 chapter_draft patch，保留用户的修改审阅。", "WRITING_NOVEL_PATCH_REQUIRED");
  const sources = section === "brief" ? [root] : section === "chapter"
    ? [root, ...NOVEL_SECTIONS.map(({ id }) => sections[id]).filter(Boolean), ...chapters.filter((item) => Number(item.attributes?.chapterIndex) === index - 1)]
    : [root, sections.brief];
  return { root, existing, kind: definition?.kind || "chapter", text,
    title: String(input.title || existing?.title || (section === "chapter" ? `第 ${index} 章` : definition.label)).trim().slice(0, 240),
    sources, attributes: { ...existing?.attributes, novelId: root.id, originNovelId: existing?.attributes?.originNovelId || root.id,
      writingTemplate: "fiction", canvasRole: section === "chapter" ? "chapter" : section === "characters" ? "character-list" : "outline",
      ...(section === "chapter" ? { chapterIndex: index, basedOnPlanKey: state.planKey } : { novelSection: section }),
      basedOnRequestKey: state.requestKey, basedOnBriefKey: state.briefKey,
      ...(stage ? { basedOnStageKey: stage.basisKey } : {}) } };
}

export function novelDirectory(artifacts, root) {
  const state = novelReviewState(artifacts, root);
  const { sections, chapters } = novelParts(artifacts, root.id);
  return { novelId: root.id, title: root.title, revision: root.revision, stage: state.label,
    requirementsConfirmed: state.requirementsConfirmed, planConfirmed: state.planConfirmed,
    sections: NOVEL_SECTIONS.map(({ id, label }) => ({ section: id, label, artifactId: sections[id]?.id || null, revision: sections[id]?.revision || 0 })),
    stages: state.stages, nextSection: state.pending?.id || "chapter",
    chapterCount: chapters.length, reviewKey: state.pending?.ready ? state.pending.reviewKey : null };
}

export const NOVEL_AGENT_INSTRUCTIONS = "小说由 AI 创建一个主节点收纳规划，只有章节独立显示。用户给文件时，先 document_read 读取真实资料和修改范围，再沿已有作品推进，不重做无关规划；缺关键目标、题材、读者、篇幅、叙事视角或保留项时先 ask_user，每轮只问当前阶段必要的信息。新创作依次 brief 需求核对 → synopsis 简介 → plot 剧情 → characters 角色 → outline 大纲，每一阶段保存后等待用户核对当前版本，再推进下一项；全部确认后先写样章，核对文风和节奏再按授权分章推进。已有资料中的简介、人物或大纲可以整理为相应阶段成果，不得捏造缺失内容。每阶段保存前读取依赖的最新已确认规划，核对人物关系、时间线、因果、读者视角和篇幅要求；新细节须与既定事实相容。用户指出问题时精确修改当前阶段并自查关联事实，保留其他已确认内容；确需改变上游设定时先说明影响并请用户决定，不能靠未经确认的新设定掩盖矛盾。用户明确确认某阶段时，用 document_read 返回的该阶段 reviewKey 与原句调用 novel_confirm；节点按钮的确认由宿主保存。不能把模糊应答当成确认，不自行跳过核对。修改已确认规划会让下游确认失效，保留旧稿并先复核。novel_write 复用相同 novelId/section/chapterIndex，已有章节修改用 chapter_draft patch。上下文只放目录，正文按需读取；来源与当前版本优先。writing_image 提供配图目录和绑定，默认 HTML 交付、Word 为 DOCX。";

export const novelWriteToolSchema = {
  type: "function", function: { name: "novel_write", description: "为已有小说保存需求核对、规划或新章节。保留小说身份与章节归属，校验逐阶段用户确认及版本；规划收在主节点内。",
    parameters: { type: "object", properties: {
      novelId: { type: "string" }, expectedRootRevision: { type: "integer", minimum: 1 },
      section: { type: "string", enum: [...NOVEL_SECTIONS.map((s) => s.id), "chapter"] },
      expectedRevision: { type: "integer", minimum: 0, description: "新建填 0，修改现有规划填 document_read 的实际版本。" },
      chapterIndex: { type: "integer", minimum: 1, maximum: 10000 }, title: { type: "string" }, text: { type: "string" },
      brief: { type: "string", description: "简短的工具动作名称。" }
    }, required: ["novelId", "expectedRootRevision", "section", "expectedRevision", "text"], additionalProperties: false }
  }
};

export const novelConfirmToolSchema = { type: "function", function: {
  name: "novel_confirm", description: "用户明确说确认需求、简介、剧情、角色或大纲时，记录当前版本的确认。先读取小说；普通‘好的’、否定或条件句不能确认。用户也可在小说主节点直接点击确认。",
  parameters: { type: "object", properties: {
    novelId: { type: "string" }, phase: { type: "string", enum: NOVEL_SECTIONS.map(item => item.id) },
    reviewKey: { type: "string", description: "document_read novel 返回的当前 reviewKey。" },
    confirmationQuote: { type: "string", description: "本轮真实用户消息里的完整确认句，不能引用模型自己的文字。" }
  }, required: ["novelId", "phase", "reviewKey", "confirmationQuote"], additionalProperties: false }
} };
