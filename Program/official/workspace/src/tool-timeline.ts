import type { AgentMessage } from "./core";

// A streamed final answer and its durable receipt represent one message.
// Keep earlier narration and other runs, then give the final answer a stable ID.
export function settleAssistantFinalMessage(messages: AgentMessage[], runId: string, finalMessage: AgentMessage): AgentMessage[] {
  const current = messages.filter(message => message.id !== finalMessage.id);
  const prefix = `assistant-stream-${runId}-`;
  const streamIndex = current.reduce((last, message, index) =>
    message.role === "assistant" && message.id.startsWith(prefix) ? index : last, -1);
  const toolIndex = current.reduce((last, message, index) => message.toolTrace?.stage === "result" ? index : last, -1);
  return (streamIndex > toolIndex
    ? current.map((message, index) => index === streamIndex ? finalMessage : message)
    : [...current, finalMessage]).slice(-120);
}

export type ToolTimelineProgressLike = {
  runId?: string;
  projectId?: string;
  conversationId?: string;
  phase?: string;
  tool?: string;
  toolRunId?: string;
  operationId?: string;
};

type ToolTraceLike = {
  stage?: string;
  name?: string;
  operationId?: string;
  brief?: string;
  completionText?: string;
  details?: { label?: string; value?: string; kind?: string }[];
  prompts?: { title?: string; prompt?: string }[];
};

type ToolTimelineMessageLike = {
  id: string;
  meta?: string;
  status?: string;
  createdAt?: string;
  toolTrace?: ToolTraceLike;
};

const clean = (value: unknown): string => String(value ?? "").trim();

let fallbackSequence = 0;
const fallbackQueues = new WeakMap<Map<string, string>, Map<string, string[]>>();

const fallbackQueueFor = (aliases: Map<string, string>, scopeKey: string): string[] => {
  let queues = fallbackQueues.get(aliases);
  if (!queues) {
    queues = new Map<string, string[]>();
    fallbackQueues.set(aliases, queues);
  }
  let queue = queues.get(scopeKey);
  if (!queue) {
    queue = [];
    queues.set(scopeKey, queue);
  }
  // The owning conversation clears `aliases` when its project/run changes.
  // Keep the private queue in lockstep so a cleared scope cannot revive a
  // stale operation on the next event.
  if (!aliases.has(scopeKey) && queue.length) queue.length = 0;
  return queue;
};

const registerOperation = (
  aliases: Map<string, string>,
  scopeKey: string,
  queue: string[],
  operationId: string,
): string => {
  if (!queue.includes(operationId)) queue.push(operationId);
  aliases.set(scopeKey, queue[0]);
  return operationId;
};

const settleOperation = (
  aliases: Map<string, string>,
  scopeKey: string,
  queue: string[],
  operationId: string,
): string => {
  const index = queue.indexOf(operationId);
  if (index >= 0) queue.splice(index, 1);
  if (queue.length) aliases.set(scopeKey, queue[0]);
  else aliases.delete(scopeKey);
  return operationId;
};

const operationScopeKey = (payload: ToolTimelineProgressLike): string => [
  clean(payload.projectId) || "project",
  clean(payload.conversationId) || "conversation",
  clean(payload.runId) || "active",
  clean(payload.tool) || (clean(payload.phase).startsWith("image-") ? "image_gen" : "tool"),
].join("::");

export const resolveToolTimelineOperationId = (
  aliases: Map<string, string>,
  payload: ToolTimelineProgressLike,
): string => {
  const phase = clean(payload.phase);
  const tool = clean(payload.tool) || (phase.startsWith("image-") ? "image_gen" : "");
  const explicitOperationId = clean(payload.operationId);
  const explicitToolRunId = clean(payload.toolRunId);
  const lifecycleEvent = phase.startsWith("tool-") || phase.startsWith("image-");
  if (!lifecycleEvent) return explicitOperationId || explicitToolRunId;

  const scopeKey = operationScopeKey({ ...payload, tool });
  const terminal = ["tool-done", "tool-error", "tool-skip", "tool-awaiting-user", "image-error"].includes(phase);
  const queue = fallbackQueueFor(aliases, scopeKey);

  // operationId is the authoritative parent identity in current payloads.
  if (explicitOperationId) {
    if (terminal) return settleOperation(aliases, scopeKey, queue, explicitOperationId);
    return registerOperation(aliases, scopeKey, queue, explicitOperationId);
  }

  // A start call ID is also authoritative and must enter the queue. This is
  // what keeps simultaneous Shell/View Image calls on independent cards.
  if (phase === "tool-start" && explicitToolRunId) {
    return registerOperation(aliases, scopeKey, queue, explicitToolRunId);
  }

  // Legacy image sub-events sometimes put a child request ID in toolRunId and
  // omit operationId. They belong to the active parent image call.
  if (phase.startsWith("image-")) {
    const operationId = queue[0] || aliases.get(scopeKey) || explicitToolRunId ||
      `${clean(payload.runId) || "active"}-${tool || "tool"}-${++fallbackSequence}`;
    registerOperation(aliases, scopeKey, queue, operationId);
    return terminal ? settleOperation(aliases, scopeKey, queue, operationId) : operationId;
  }

  // Non-image native/function tools use their call ID throughout their own
  // lifecycle. Completion removes exactly that call, even when siblings run
  // in parallel and finish out of order.
  if (explicitToolRunId) {
    if (terminal) return settleOperation(aliases, scopeKey, queue, explicitToolRunId);
    return registerOperation(aliases, scopeKey, queue, explicitToolRunId);
  }

  const operationId = queue[0] || aliases.get(scopeKey) ||
    `${clean(payload.runId) || "active"}-${tool || "tool"}-${++fallbackSequence}`;
  registerOperation(aliases, scopeKey, queue, operationId);
  return terminal ? settleOperation(aliases, scopeKey, queue, operationId) : operationId;
};

const promptSignature = (trace?: ToolTraceLike): string => JSON.stringify(
  (trace?.prompts ?? []).map((item) => ({ title: clean(item.title), prompt: clean(item.prompt) })),
);

const detailSignature = (trace?: ToolTraceLike): string => JSON.stringify(
  (trace?.details ?? []).map((item) => ({ label: clean(item.label), value: clean(item.value), kind: clean(item.kind) })),
);

const exactTraceSignature = (trace?: ToolTraceLike): string => [
  clean(trace?.stage),
  clean(trace?.name),
  clean(trace?.brief),
  clean(trace?.completionText),
  detailSignature(trace),
  promptSignature(trace),
].join("\u0000");

const explicitOperationIdFromMessage = (message: ToolTimelineMessageLike): string => {
  const explicit = clean(message.toolTrace?.operationId);
  return explicit;
};

const legacyOperationIdFromMessage = (message: ToolTimelineMessageLike): string => {
  const match = String(message.id || "").match(/^progress-tool-(.+)-(?:start|result)$/);
  return match ? clean(match[1]) : "";
};

const canonicalProgressMessageId = (operationId: string): string => {
  const key = operationId.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 96) || "active-tool";
  return `progress-tool-${key}`;
};

export const collapseDuplicateToolTimelineMessages = <T extends ToolTimelineMessageLike>(messages: T[]): T[] => {
  const result: T[] = [];
  const operationIndexes = new Map<string, number>();
  const legacyDerivedOperationIds = new Set<string>();
  for (const message of messages) {
    const previous = result[result.length - 1];
    const currentTrace = message.toolTrace;
    const previousTrace = previous?.toolTrace;
    const bothProgress = message.meta === "progress" && previous?.meta === "progress" && currentTrace && previousTrace;

    if (message.meta === "progress" && currentTrace) {
      const explicitOperationId = explicitOperationIdFromMessage(message);
      const operationId = explicitOperationId || legacyOperationIdFromMessage(message);
      const legacyExactDuplicate =
        !explicitOperationId &&
        bothProgress &&
        (!explicitOperationIdFromMessage(previous) || legacyDerivedOperationIds.has(explicitOperationIdFromMessage(previous))) &&
        clean(currentTrace.stage) === clean(previousTrace.stage) &&
        clean(currentTrace.name) === clean(previousTrace.name) &&
        clean(message.createdAt) === clean(previous.createdAt) &&
        clean(message.status) === clean(previous.status) &&
        exactTraceSignature(currentTrace) === exactTraceSignature(previousTrace) &&
        /^progress-tool-/.test(message.id) &&
        /^progress-tool-/.test(previous.id);
      if (legacyExactDuplicate) continue;
      if (operationId) {
        if (!explicitOperationId) legacyDerivedOperationIds.add(operationId);
        const canonical = { ...message, id: canonicalProgressMessageId(operationId), toolTrace: { ...currentTrace, operationId } } as T;
        const existingIndex = operationIndexes.get(operationId);
        if (existingIndex !== undefined) {
          const existing = result[existingIndex];
          // A terminal event replaces the running event in place. This keeps
          // parallel operations independent while retaining their chronology.
          const terminal = message.status !== "running" || currentTrace.stage === "result";
          const existingTerminal = existing?.status !== "running" || existing?.toolTrace?.stage === "result";
          if (terminal || !existingTerminal) {
            result[existingIndex] = {
              ...canonical,
              createdAt: existing.createdAt || canonical.createdAt,
              toolTrace: {
                ...existing.toolTrace,
                ...canonical.toolTrace,
                operationId,
              },
            } as T;
          }
          continue;
        }
        operationIndexes.set(operationId, result.length);
        result.push(canonical);
        continue;
      }
    }

    if (!bothProgress || clean(currentTrace.stage) !== clean(previousTrace.stage) || clean(currentTrace.name) !== clean(previousTrace.name)) {
      result.push(message);
      continue;
    }
    const currentOperationId = clean(currentTrace.operationId);
    const previousOperationId = clean(previousTrace.operationId);
    if (currentOperationId && currentOperationId === previousOperationId) {
      result[result.length - 1] = message;
      continue;
    }
    result.push(message);
  }
  return result;
};
