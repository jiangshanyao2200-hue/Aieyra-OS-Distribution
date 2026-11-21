/** Agent progress, streaming messages, and renderer bridge. */

import { sanitizeAgentVisibleText } from "./core";
import type { AgentCanvasContext, AgentFileAttachment, AgentMessage, AgentProgress, AgentRuntimeResult, AgentTaskScope, AgentToolTrace, AgentToolTraceDetail, ReferenceImage, WorkflowNode } from "./core";
import type { ProjectKind } from "./project-capabilities";

// -----------------------------------------------------------------------------
// AGENT 01 Agent Progress Labels
// -----------------------------------------------------------------------------

export function agentToolLabel(tool?: string, phase?: string) {
  const value = String(tool || "").trim();
  if (value === "image_gen") return "绘图";
  if (value === "workspace_goal") return "目标与反馈";
  if (value === "document_read") return "文档读取";
  if (value === "novel_write") return "小说创作";
  if (value === "novel_confirm") return "小说核对";
  if (value === "toolbox") return "工作工具箱";
  if (value === "open_tool") return "查看工具说明";
  if (value === "call_tool") return "执行工作工具";
  if (value === "workspace_observe") return "核对工作状态";
  if (value === "work_review") return "阶段核对";
  if (value === "work_import") return "导入资料";
  if (value === "work_publish") return "保存成果";
  if (value === "outline_update") return "大纲更新";
  if (value === "character_update") return "人物卡更新";
  if (value === "chapter_draft") return "章节写作";
  if (value === "chapter_review") return "章节审稿";
  if (value === "document_patch") return "成稿修订";
  if (value === "document_export") return "文档导出";
  if (value === "experience") return "记录经验";
  if (value === "workflow") return "成果画布";
  if (value === "context_manage") return "整理上下文";
  if (value === "memory") return "整理记忆";
  if (value === "ask_user") return "询问用户";
  if (value === "view_image") return "看图";
  if (value === "view_images") return "多图查看";
  if (value === "read_knowledge") return "查阅知识";
  if (value === "remember_images") return "记录图像观察";
  if (value === "summarize_tool_result") return "整理工具结果";
  if (value === "read_tool_result") return "读取工具结果";
  if (value === "web_search") return "搜索网页";
  if (value === "shell_command" || value === "command") return "执行命令";
  if (value === "apply_patch") return "修改文件";
  if (value === "update_plan") return "更新计划";
  if (value) return value;
  if (String(phase || "").includes("memory")) return "Memory";
  return "Agent";
}

function traceCategoryForTool(tool?: string, phase?: string) {
  const value = String(tool || "");
  if (["novel_write", "novel_confirm", "document_read", "outline_update", "character_update", "chapter_draft", "chapter_review", "document_patch", "document_export"].includes(value)) return "写作";
  if (value === "workflow") return "成果";
  if (["image_gen", "view_image", "view_images"].includes(value)) return "图像";
  if (value === "context_manage" || value === "memory" || value === "experience") return "记忆";
  if (value === "ask_user") return "问询";
  if (String(phase || "").startsWith("model-")) return "模型";
  return "工具";
}

function inputObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function shortValue(value: unknown, maxChars = 52) {
  const clean = String(value ?? "").replace(/\s+/g, " ").trim();
  return clean.length > maxChars ? `${clean.slice(0, maxChars)}...` : clean;
}

function shellCommandFromProgress(payload: AgentProgress) {
  const input = inputObject(payload.input);
  const command = String(input.command || "").replace(/\s+/g, " ").trim();
  return shortValue(command, 180);
}

function publicTraceText(value: unknown, maxChars = 220) {
  return cleanTimelineText(sanitizeAgentVisibleText(value), maxChars);
}

function operationFromProgress(payload: AgentProgress) {
  if (payload.operation) return cleanTimelineText(payload.operation, 48);
  const tool = String(payload.tool || "");
  const input = inputObject(payload.input);
  const mode = String(input.mode || input.operation || "").trim();
  if (tool === "workflow") return operationLabel(mode || "list_nodes");
  if (tool === "image_gen") return operationLabel(mode || "generate");
  if (tool === "view_image") return "查看图片";
  if (tool === "context_manage") return "上下文管理";
  if (tool === "memory") return operationLabel(mode || "记忆");
  if (tool === "ask_user") return "请求用户";
  if (tool === "shell_command" || tool === "command") return "Shell Command";
  if (tool === "apply_patch") return "Apply Patch";
  if (tool === "update_plan") return "Update Plan";
  return agentToolLabel(tool, payload.phase);
}

function operationLabel(value: string) {
  const map: Record<string, string> = {
    compose: "整理提示词",
    generate: "绘图",
    edit: "图像编辑",
    redraw: "AI 重绘",
    cutout: "AI 抠图",
    layer_merge: "图层合成",
    add: "写入记忆",
    check: "检索记忆",
    read: "读取记忆",
    list_nodes: "成果列表",
    describe_node: "成果详情",
    focus_node: "定位成果",
    connect_nodes: "关联成果",
    disconnect_node: "移除关系",
    delete_node: "删除成果",
    update_node: "更新成果",
    continue_node: "继续生图",
    redraw_node: "基于节点重绘",
    cutout_node: "基于节点抠图"
  };
  return map[value] || value || "执行";
}

function paramsFromProgress(payload: AgentProgress) {
  if (payload.params) return cleanTimelineText(payload.params, 92);
  const input = inputObject(payload.input);
  const parts = [
    input.nodeId ? `节点 ${shortValue(input.nodeId)}` : "",
    input.sourceId || input.targetId ? `${shortValue(input.sourceId)} -> ${shortValue(input.targetId)}` : "",
    input.parentId ? `父节点 ${shortValue(input.parentId)}` : "",
    input.mode ? `模式 ${shortValue(input.mode)}` : "",
    input.count ? `${shortValue(input.count)} 张` : "",
    input.ratio ? String(input.ratio) : "",
    input.resolution ? String(input.resolution) : "",
    input.model ? shortValue(input.model, 32) : "",
    input.prompt ? `prompt ${shortValue(input.prompt, 34)}` : "",
    input.query ? `查询 ${shortValue(input.query, 42)}` : "",
    input.command ? shortValue(String(input.command).replace(/\s+/g, " "), 150) : "",
    input.title ? `标题 ${shortValue(input.title, 34)}` : ""
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "参数已记录";
}

function promptsFromProgress(payload: AgentProgress) {
  if (String(payload.tool || "") !== "image_gen" && !String(payload.phase || "").startsWith("image-")) return undefined;
  const input = inputObject(payload.input);
  const items = Array.isArray(input.batchItems) && input.batchItems.length
    ? input.batchItems
    : Array.isArray(input.items)
      ? input.items
      : [];
  const prompts = items
    .map((item, index) => {
      const value = inputObject(item);
      const prompt = String(value.prompt || "").trim();
      return prompt ? { title: String(value.title || `提示词 ${index + 1}`).trim(), prompt } : null;
    })
    .filter((item): item is { title: string; prompt: string } => Boolean(item));
  if (prompts.length) return prompts;
  const prompt = String(input.prompt || "").trim();
  return prompt ? [{ title: "生图提示词", prompt }] : undefined;
}

function traceDetail(label: string, value: unknown, kind: AgentToolTraceDetail["kind"] = "text") {
  const clean = publicTraceText(value, kind === "code" ? 520 : 240);
  return clean ? { label, value: clean, kind } satisfies AgentToolTraceDetail : null;
}

function tracePathName(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const parts = raw.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] || raw;
}

function imageBackgroundLabel(value: unknown) {
  const mode = String(value ?? "").trim().toLowerCase();
  if (mode === "transparent") return "透明背景";
  if (mode === "opaque") return "不透明背景";
  if (mode === "auto") return "自动背景";
  return String(value ?? "").trim();
}

function imageAlphaLabel(value: unknown) {
  const mode = String(value ?? "").trim().toLowerCase();
  if (mode === "native-alpha") return "模型原生透明通道";
  if (mode === "local-alpha-extraction") return "本地透明提取";
  return String(value ?? "").trim();
}

function imageDetailRows(payload: AgentProgress, input: Record<string, unknown>, rows: AgentToolTraceDetail[]) {
  const add = (label: string, value: unknown, kind: AgentToolTraceDetail["kind"] = "text") => {
    const row = traceDetail(label, value, kind);
    if (row) rows.push(row);
  };
  add("操作", operationFromProgress(payload));
  if (input.model) add("模型", input.model);
  if (input.ratio) add("比例", input.ratio);
  if (input.resolution) add("分辨率", input.resolution);
  if (input.size) add("尺寸", input.size);
  const count = input.count ?? (Array.isArray(input.items) ? input.items.length : undefined);
  if (count !== undefined) add("数量", `${count} 张`);
  if (input.quality) add("质量", input.quality);
  if (input.generationMode) add("生成方式", String(input.generationMode) === "sequential" ? "顺序生成" : "并行生成");
  if (input.outputFormat) add("格式", String(input.outputFormat).toUpperCase());
  if (input.background) add("背景", imageBackgroundLabel(input.background));
  if (input.alphaStrategy) add("透明策略", imageAlphaLabel(input.alphaStrategy));
  else if (input.transparentPreferred === true) add("透明策略", "优先透明 PNG");
  if (input.inputFidelity) add("参考保真", String(input.inputFidelity) === "high" ? "高" : "标准");
  if (Array.isArray(input.referenceImages)) add("参考图", `${input.referenceImages.length} 张`);
  if (input.sourceImage || input.editImage) add("来源", "已绑定原图");
  if (input.maskImage || input.maskDataUrl) add("蒙版", "已附带编辑区域");
  if (Array.isArray(input.layerPlan)) add("分层", `${input.layerPlan.length} 个图层`);
  if (Array.isArray(input.layers)) add("合成", `${input.layers.length} 个图层`);
}

function patchFileRows(patch: string) {
  const files = [...patch.matchAll(/^\*\*\* (Add|Update|Delete) File:\s*(.+)$/gm)]
    .map((match) => ({ action: match[1], file: String(match[2] || "").trim() }))
    .filter((item) => item.file);
  if (!files.length) return { files: [], summary: "已提交项目补丁" };
  const grouped = ["Add", "Update", "Delete"].flatMap((action) => {
    const names = files.filter((item) => item.action === action).map((item) => item.file);
    if (!names.length) return [];
    const label = action === "Add" ? "新增" : action === "Update" ? "更新" : "删除";
    return [`${label} ${names.length}：${names.slice(0, 8).join("、")}${names.length > 8 ? " 等" : ""}`];
  });
  return { files, summary: grouped.join("；") };
}

function toolDetailsFromProgress(payload: AgentProgress): AgentToolTraceDetail[] | undefined {
  const tool = String(payload.tool || (String(payload.phase || "").startsWith("image-") ? "image_gen" : "")).trim();
  const input = inputObject(payload.input);
  const rows: AgentToolTraceDetail[] = [];
  const add = (label: string, value: unknown, kind: AgentToolTraceDetail["kind"] = "text") => {
    const row = traceDetail(label, value, kind);
    if (row) rows.push(row);
  };

  if (tool === "image_gen") {
    imageDetailRows(payload, input, rows);
  } else if (tool === "shell_command" || tool === "command") {
    add("命令", String(input.command || payload.brief || "").replace(/\s+/g, " "), "code");
    add("目录", input.workdir || "当前打开项目");
    if (input.timeout_ms !== undefined) add("最长等待", `${Math.max(0, Number(input.timeout_ms) || 0) / 1000} 秒`);
    if (input.login !== undefined) add("Shell 模式", input.login === false ? "标准模式" : "登录模式");
  } else if (tool === "apply_patch") {
    const patch = String(input.patch || "");
    const parsed = patchFileRows(patch);
    add("变更文件", parsed.summary, "list");
    if (patch) {
      const added = (patch.match(/^\+(?!\+\+)/gm) || []).length;
      const removed = (patch.match(/^-(?!- -)/gm) || []).length;
      if (added || removed) add("行变更", `新增 ${added} · 删除 ${removed}`);
    }
  } else if (tool === "update_plan") {
    const plan = Array.isArray(input.plan) ? input.plan : [];
    add("计划步骤", `${plan.length} 项`);
    const active = plan
      .filter((item) => inputObject(item).status === "in_progress")
      .map((item) => String(inputObject(item).step || "").trim())
      .filter(Boolean);
    if (active.length) add("当前步骤", active.join("；"), "list");
    const completed = plan.filter((item) => inputObject(item).status === "completed").length;
    if (completed) add("进度", `已完成 ${completed}/${plan.length}`);
    if (input.explanation) add("说明", input.explanation);
  } else if (tool === "web_search") {
    add("查询", input.query || payload.brief, "code");
    if (input.action) add("方式", input.action);
    if (Array.isArray(input.domains) && input.domains.length) add("限定站点", input.domains.join("、"));
  } else if (tool === "view_image") {
    add("图片", tracePathName(input.path || payload.brief));
    if (input.detail) add("查看精度", input.detail === "original" ? "原始像素" : "高精度预览");
  } else if (tool === "workflow") {
    add("操作", operationFromProgress(payload));
    if (input.nodeId || input.nodeTitle) add("成果", input.nodeTitle || "已定位成果");
    if (input.sourceId || input.targetId) add("关系", "已指定来源与目标");
    if (input.relationType) add("关系类型", input.relationType);
  } else if (tool === "ask_user") {
    if (input.kind) add("请求类型", input.kind);
    if (input.question) add("问题", input.question);
    if (Array.isArray(input.options) && input.options.length) add("选项", `${input.options.length} 个`);
  } else if (tool === "experience" || tool === "memory" || tool === "context_manage") {
    add("操作", operationFromProgress(payload));
    if (input.action) add("动作", input.action);
    if (input.operation && input.operation !== input.action) add("模式", input.operation);
  } else {
    if (input.operation || input.action) add("操作", input.operation || input.action);
    if (input.title) add("标题", input.title);
    if (input.query) add("查询", input.query, "code");
    if (input.prompt && tool !== "image_gen") add("内容", input.prompt);
  }

  if (!rows.length && payload.params) add("参数", payload.params);
  return rows.length ? rows.slice(0, 32) : undefined;
}

function completionTextForProgress(payload: AgentProgress) {
  const phase = String(payload.phase || "");
  if (phase === "tool-error" || phase === "image-error") {
    const summary = publicTraceText(payload.summary || payload.detail || "执行失败", 120);
    return summary ? `执行失败：${summary}` : "执行失败";
  }
  if (phase === "tool-awaiting-user") return "等待你接受或拒绝修改提案";
  if (phase !== "tool-done" && phase !== "tool-skip") return undefined;
  const tool = String(payload.tool || "");
  const input = inputObject(payload.input);
  if (tool === "experience") {
    const action = String(input.action || "");
    if (action === "add" || action === "write") return "记录经验成功";
    if (action === "read") return "绘画经验读取成功";
    if (action === "replace") return "绘画经验更新成功";
    if (action === "compact") return "绘画经验整理成功";
    return "经验处理完成";
  }
  if (tool === "image_gen") return "绘图已完成";
  if (tool === "workflow") return "画布操作完成";
  if (tool === "view_image") return "图片读取完成";
  if (tool === "web_search") return "搜索完成";
  if (tool === "shell_command" || tool === "command") return "已调用 Shell 工具";
  if (tool === "apply_patch") return "已调用 Apply Patch 工具";
  if (tool === "update_plan") return "已调用 Update Plan 工具";
  return `${agentToolLabel(tool, phase)} 已完成`;
}

export function toolTraceForProgress(payload: AgentProgress): AgentToolTrace | null {
  const phase = String(payload.phase || "");
  const tool = String(payload.tool || "");
  if (!tool && !phase.startsWith("image-")) return null;
  if (!phase.startsWith("tool-") && !phase.startsWith("image-")) return null;
  const name = tool || (phase.startsWith("image-") ? "image_gen" : "");
  const command = name === "shell_command" || name === "command" ? shellCommandFromProgress(payload) : "";
  const brief = publicTraceText(command || payload.brief || payload.summary || payload.detail || operationFromProgress(payload), 180);
  const startedAtMs = Number.isFinite(Number(payload.startedAtMs)) && Number(payload.startedAtMs) > 0
    ? Math.floor(Number(payload.startedAtMs))
    : undefined;
  return {
    operationId: String(payload.operationId || payload.toolRunId || "").trim() || undefined,
    ...(startedAtMs ? { startedAtMs } : {}),
    label: traceCategoryForTool(name, phase),
    name,
    operation: operationFromProgress(payload),
    params: paramsFromProgress(payload),
    brief,
    details: toolDetailsFromProgress(payload),
    prompts: promptsFromProgress(payload),
    completionText: completionTextForProgress(payload)
  };
}

export function cleanTimelineText(value?: unknown, maxChars = 220) {
  const raw = typeof value === "string"
    ? value
    : value && typeof value === "object"
      ? JSON.stringify(value)
      : String(value ?? "");
  const clean = raw.replace(/\s+/g, " ").trim();
  return clean.length > maxChars ? `${clean.slice(0, maxChars)}...` : clean;
}

export function timelineTextForProgress(payload: AgentProgress) {
  const phase = String(payload.phase || "");
  const tool = String(payload.tool || "");
  const summary = publicTraceText(payload.summary || payload.detail || "");
  const label = agentToolLabel(tool, phase);

  if (phase === "model-thinking-delta" || phase === "assistant-message-delta") return "";
  if (phase === "model-thinking-done") return "";
  // The same assistant content is already delivered through assistant-message-delta.
  // Rendering the terminal assistant-message phase as another timeline entry duplicates
  // the model's pre-tool brief in streamed conversations.
  if (phase === "assistant-message") return "";
  if (phase === "runtime-start" || phase === "runtime-request") return "";
  // The chat IPC rejects immediately after this terminal event; its caller
  // owns the persistent error message. Keep progress for the live indicator.
  if (phase === "runtime-error" && !tool) return "";
  if (phase === "user-steer") return "";
  if (phase === "model-route" || phase === "model-route-fallback") return "";
  if (phase === "model-request-detail" || phase === "model-response-detail") return "";
  // The persistent Agent activity indicator already represents model request /
  // thinking state. Adding another timeline message here creates a second
  // competing status for the same work and leaves stale noise after the run.
  if (phase === "model-request") return "";
  if (phase === "model-force" || phase === "model-tool-choice" || phase === "model-arg-correct") return "";
  if (phase === "model-response") return "";
  if (phase === "model-retry") return summary || "Agent 协议返回异常。";
  if (phase === "tool-start" && tool === "image_gen") return "正在绘图。";
  if (phase === "tool-poll" && tool === "image_gen") return "正在绘图。";
  if ((phase === "tool-start" || phase === "tool-poll") && (tool === "shell_command" || tool === "command")) {
    const command = shellCommandFromProgress(payload);
    return command ? `正在调用：Shell Command · ${command}` : "正在调用：Shell Command";
  }
  if (phase === "tool-start") return `正在调用：${label}`;
  if (phase === "tool-poll") return `正在调用：${label}`;
  if (phase === "tool-awaiting-user") return `${label} 已生成修改提案，等待你接受或拒绝。`;
  if (phase === "tool-done" && tool === "experience") return "记录经验成功";
  if (phase === "tool-done" && tool === "image_gen") return "绘图已完成";
  if (phase === "tool-done" && (tool === "shell_command" || tool === "command")) return "已调用 Shell 工具";
  if (phase === "tool-done") return `已调用 ${label} 工具`;
  if (phase === "tool-error") return `${label} 失败${summary ? `：${summary}` : ""}`;
  if (phase === "tool-skip") return `${label} 跳过${summary ? `：${summary}` : ""}`;
  if (phase === "image-request") return "正在绘图。";
  if (phase === "image-response") return "";
  if (phase === "image-dry-run") return "Image Gen 模拟执行完成。";
  if (phase === "image-error" || phase === "runtime-error" || phase === "server-error") return `${label} 失败${summary ? `：${summary}` : ""}`;
  if (phase === "memory-start") return summary || `正在${tool === "context_manage" ? "整理上下文" : "写日记"}。`;
  if (phase === "memory-done") return summary || "记忆整理完成。";
  if (phase === "memory-warning") return summary || "记忆整理遇到问题。";
  if (phase.startsWith("server-")) return summary;
  return summary;
}

// -----------------------------------------------------------------------------
// AGENT 02 Streaming Message Reducers
// -----------------------------------------------------------------------------

export function appendStreamingAgentMessage(messages: AgentMessage[], nextMessage: AgentMessage) {
  const index = messages.findIndex((message) => message.id === nextMessage.id);
  if (index < 0) return [...messages, nextMessage];
  return messages
    .map((message) =>
      message.id === nextMessage.id
        ? {
            ...message,
            ...nextMessage,
            content: `${message.content || ""}${nextMessage.content || ""}`
          }
        : message
    )
    ;
}

export function finishThinkingMessages(messages: AgentMessage[], runId?: string, modelRound?: number) {
  const exactId = runId && modelRound ? `thinking-${runId}-round-${modelRound}` : "";
  const prefix = runId ? `thinking-${runId}` : "";
  return messages.map((message) =>
    message.meta === "thinking" && (!runId || (exactId ? message.id === exactId : message.id.startsWith(prefix)))
      ? { ...message, status: "done" as const, collapsed: true }
      : message
  );
}

export function finishRunStreamingMessages(messages: AgentMessage[], runId?: string) {
  const streamPrefix = runId ? `assistant-stream-${runId}` : "";
  const thinkingPrefix = runId ? `thinking-${runId}` : "";
  return messages.map((message) => {
    if (message.meta === "thinking" && (!thinkingPrefix || message.id.startsWith(thinkingPrefix))) {
      return { ...message, status: "done" as const, collapsed: true };
    }
    if (message.meta === "assistant-stream" && (!streamPrefix || message.id.startsWith(streamPrefix))) {
      return { ...message, status: "done" as const };
    }
    if (message.meta === "progress" && message.status === "running") {
      return { ...message, status: "done" as const };
    }
    return message;
  });
}

// -----------------------------------------------------------------------------
// AGENT 03 Agent Bridge
// -----------------------------------------------------------------------------

export async function requestAgent(
  messages: AgentMessage[],
  nodes: WorkflowNode[],
  prompt: string,
  runId?: string,
  referenceImages: ReferenceImage[] = [],
  projectId?: string,
  conversationId?: string,
  selectedNodeId?: string,
  selectedNodeIds: string[] = [],
  taskScope?: AgentTaskScope,
  projectContext?: {
    projectKind?: ProjectKind;
    selectedArtifactId?: string;
    selectedParagraphId?: string;
    selectedLineageArtifactId?: string;
    canvasContext?: AgentCanvasContext;
    userReply?: { requestId: string; selectedOptionId?: string };
    originalPrompt?: string;
    imageJobCompletionIds?: string[];
    goalId?: string;
    summarizePreferences?: boolean;
  },
  fileAttachments: AgentFileAttachment[] = []
) {
  if (!window.aieyraAgent) {
    throw new Error("Agent 桥接不可用，请重启桌面端。");
  }

  const result = await window.aieyraAgent.chat({
    runId,
    prompt,
    messages,
    nodes,
    referenceImages,
    fileAttachments,
    taskScope,
    projectId,
    conversationId,
    selectedNodeId,
    selectedNodeIds,
    ...projectContext
  });
  if (!result.ok) {
    throw new Error(result.error ?? "Agent runtime 请求失败。");
  }

  return {
    ...result,
    content: result.content ?? ""
  } satisfies AgentRuntimeResult;
}
