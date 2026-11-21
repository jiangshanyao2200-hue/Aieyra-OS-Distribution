import type { CodingItem, CodingState } from "./coding-types";
import type { WorkflowNode } from "./core";

export function workspaceDrawingCount(state: CodingState, nodes: WorkflowNode[]) {
  const jobs = new Map((state.items || []).filter(item => item.image).map(item => [item.image!.id, item.image!]));
  const jobIds = [...jobs.keys()];
  let count = 0;
  for (const job of jobs.values()) {
    if (!["running", "pausing"].includes(job.status) || job.batch?.status === "paused") continue;
    count += job.batch ? job.batch.count === null || job.batch.status === "pausing" ? job.batch.running : Math.max(0, job.batch.count - job.batch.completed - job.batch.failed - job.batch.unknown - (job.batch.skipped || 0))
      : Array.isArray(job.input.items) ? job.input.items.length : Math.max(1, Number(job.input.count) || 1);
  }
  for (const node of nodes) {
    if (node.imageState !== "generating" || jobIds.some(id => node.generationRunId === id || node.generationRunId?.startsWith(`${id}-page-`))) continue;
    count += node.imageProgress ? Math.max(0, node.imageProgress.total - node.imageProgress.completed - (node.imageProgress.failed || 0)) : 1;
  }
  return count;
}

/** Global chrome deliberately excludes commands, plan steps and streamed reply text. */
export function workspaceActivity(state: CodingState, drawingCount: number) {
  const parts: string[] = [];
  if (drawingCount > 0) parts.push(`${drawingCount} 张图正在绘制`);
  if (state.items?.some(item => item.image?.status === "saving")) parts.push("图片成果正在保存");
  const agents = (state.agents || []).filter(agent => ["starting", "running", "waiting", "stopping"].includes(agent.status));
  if (agents.length) parts.push(agents.length === 1 ? `${agents[0].name} ${agents[0].status === "waiting" ? "等待回复" : "正在工作"}` : `${agents.length} 位流窜 AI 正在协作`);
  if (state.requests?.length || state.waitingFor) parts.push("画布助手 等待回复");
  else if (state.error || state.status === "error") parts.push("画布助手 任务需要查看");
  else if (state.turnId || state.status === "running" || state.status === "compacting") parts.push("画布助手 正在工作");
  else if (state.status === "connecting") parts.push("画布助手 正在连接");
  return parts.join(" · ");
}

const compactText = (value: string, length = 130) => value.replace(/\s+/g, " ").trim().slice(0, length);
export const shortPath = (value: string) => value.replace(/\\/g, "/").replace(/^.*\/project-[^/]+\//, "").split("/").slice(-2).join("/");
export const displayCommand = (value: string) => value.replace(/^"[^"\n]*(?:pwsh|powershell)(?:\.exe)?"\s+-(?:NoProfile\s+-)?Command\s*/i, "").replace(/^'([\s\S]*)'$/, "$1");
const agentTools: Record<string, string> = { spawnAgent: "启动子 Agent", wait: "等待子 Agent", sendInput: "补充子任务", closeAgent: "结束子 Agent", resumeAgent: "继续子任务", completed: "子任务完成", interacted: "子任务交互" };
const matrixToolLabels: Record<string, string> = { "images.generate": "生成或编辑图片", "images.wait": "等待图片保存", "images.status": "核对图片状态", "images.view": "查看图片像素", "images.view_many": "查看图片组", "images.import": "导入图片素材", "images.guidance": "读取绘图偏好", "images.cancel": "停止绘图", "images.locate": "定位画布成果", "canvas.workflow": "操作画布", "canvas.experience": "绘图经验" };
const directToolLabels: Record<string, string> = { image_generate: "生成图片", image_edit: "编辑图片", image_batch: "批量绘图", image_view: "查看图片组", image_import: "导入图片素材", image_status: "核对图片状态", image_cancel: "停止绘图", canvas: "操作画布" };

export function codingItemSummary(item: CodingItem) {
  if (item.image) return item.image.summary || "图片任务";
  if (item.delegation) return `${item.delegation.name} · ${item.delegation.model}`;
  if (item.type === "mcpToolCall" && item.server === "matrix") {
    if (item.tool && directToolLabels[item.tool]) return directToolLabels[item.tool];
    const name = (item.arguments as { name?: string })?.name;
    const label = name && (matrixToolLabels[name] || name);
    return label ? `${item.tool === "open_tool" ? "读取说明 · " : ""}${label}` : ({ toolbox: "查找可用能力", open_tool: "读取工具说明", call_tool: "执行 Workspace 操作" } as Record<string, string>)[item.tool || ""] || "画布助手 工具箱";
  }
  if (item.type === "commandExecution") return compactText(displayCommand(item.command || "执行命令"));
  if (item.type === "fileChange") return item.changes?.map(change => shortPath(change.path)).join(" · ") || "项目文件";
  if (item.type === "plan") return `${item.plan?.filter(step => step.status === "completed").length || 0} / ${item.plan?.length || 0} 步完成`;
  if (item.type === "collabAgentToolCall") return agentTools[item.tool || ""] || "协作执行";
  if (item.type === "contextCompaction") return item.status === "inProgress" ? "整理会话上下文" : "上下文整理记录";
  if (item.type === "reasoning" || item.type === "agentMessage") return compactText(item.text || (item.status === "inProgress" ? "等待模型提供摘要…" : "模型未提供思考摘要"));
  return item.query || (item.path ? shortPath(item.path) : item.tool || item.name || "执行记录");
}

export function codingActivity(state: CodingState, options: { drawing?: boolean; starting?: boolean; stopping?: boolean; welcoming?: boolean } = {}) {
  const activity = (kind: string, label: string, detail: string, key = kind, progress = "", phase = kind, completed = 0, total = 0) => ({ kind, label, detail: compactText(detail, 100), key, progress, phase, completed, total });
  if (state.requests?.length || state.waitingFor) return activity("waiting", "等你回复", state.requests?.[0]?.params.questions?.[0]?.question || "有个细节需要你确认");
  if (state.error || state.status === "error") return activity("error", "需要查看", "任务遇到问题，点击查看详情");
  if (options.stopping) return activity("stopping", "正在停止", "正在结束当前任务");
  if (state.retrying) return activity("connecting", "正在重连", "连接暂时中断，正在恢复当前任务", `retry-${state.retrying.turnId}`);
  if (state.status === "compacting") return activity("compacting", "整理思路", "正在整理会话上下文");
  if (options.welcoming) return activity("connecting", "正在准备", "正在和 Eyra 建立连接");
  if (state.status === "connecting") return activity("connecting", "正在连接", "正在恢复当前会话");
  if (state.turnId || state.status === "running" || options.starting || options.drawing) {
    const items = state.items || [];
    let start = items.length;
    while (start > 0 && items[start - 1].type !== "userMessage") start--;
    const current = items.slice(start).filter(item => !state.turnId || !item.turnId || item.turnId === state.turnId);
    const plan = [...current].reverse().find(item => item.type === "plan")?.plan || state.plan || [];
    const step = plan.find(item => item.status === "in_progress" || item.status === "inProgress");
    const completed = plan.filter(item => item.status === "completed").length;
    const progress = plan.length ? `${completed}/${plan.length} 步` : "";
    const item = [...current].reverse().find(item => item.status === "inProgress" && item.type !== "plan");
    if (item) {
      const labels: Record<string, string> = { reasoning: "正在思考", webSearch: "查找资料", commandExecution: "执行命令", fileChange: "修改文件", imageView: "查看图片", imageGeneration: item.image?.status === "saving" ? "保存图片" : "创作图片", collabAgentToolCall: "协作处理中", contextCompaction: "整理思路", mcpToolCall: "使用工具", dynamicToolCall: "使用工具", agentMessage: item.phase === "commentary" ? "推进任务" : "整理结果" };
      const detail = item.type === "agentMessage" && item.phase !== "commentary" ? step?.step || "正在为你整理结果" : codingItemSummary(item);
      return activity("working", labels[item.type] || "正在处理", detail, item.id, progress, item.type, completed, plan.length);
    }
    return activity("working", options.drawing ? "创作图片" : "正在处理", step?.step || "正在推进当前任务", step?.step || state.turnId || "starting", progress, options.drawing ? "imageGeneration" : "reasoning", completed, plan.length);
  }
  if (state.status === "stopped") return activity("stopped", "已停止", "可以继续对话");
  return activity("idle", "随时开始", "和 Eyra 一起创作");
}
