"use strict";
const { createHash } = require("node:crypto");
const bundled = require("../../shared/config/provider-model-catalog.json");
const protocols = ["auto", "responses", "chat", "anthropic", "google"];
const protocolNames = { responses: "responses", chat_completions: "chat", anthropic_messages: "anthropic", google_generate: "google" };
const presets = [
  { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com" },
  { id: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
  { id: "opencode", name: "OpenCode Zen", baseUrl: "https://opencode.ai/zen/v1" },
  { id: "opencode-go", name: "OpenCode Go", baseUrl: "https://opencode.ai/zen/go/v1" }
];
function providerKind(baseUrl) {
  try {
    const url = new URL(baseUrl);
    if (url.hostname === "api.deepseek.com") return "deepseek";
    if (url.hostname === "openrouter.ai") return "openrouter";
    if (url.hostname === "opencode.ai") return /^\/zen\/go(?:\/|$)/.test(url.pathname) ? "opencode-go" : "opencode";
  } catch {}
  return "custom";
}
const plain = value => value && typeof value === "object" && !Array.isArray(value);
const safeName = value => typeof value === "string" && value.length > 0 && value.length <= 200 && !/[\x00-\x1f\x7f]/.test(value) && !["__proto__", "constructor", "prototype"].includes(value);
// Verified against api-docs.deepseek.com/quick_start/pricing on 2026-09-20.
const deepseekModels = Object.fromEntries(["deepseek-flash", "deepseek-v4-pro"].map(id => [id, {
  id, name: id, api_protocol: "chat_completions", context_window: 1048576,
  output_limit: 393216, tool_calls: true, vision: id === "deepseek-flash", reasoning_field: "reasoning_content"
}]));
const knownModel = (kind, id) => (kind === "deepseek" ? deepseekModels[id] : bundled.providers[kind]?.[id]) || {};
function jsonValue(value, depth = 0) {
  if (depth > 8) throw Error("模型参数嵌套过深。");
  if (value === null || typeof value === "boolean" || typeof value === "string" && value.length < 16000 || typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value) && value.length <= 128) return value.map(v => jsonValue(v, depth + 1));
  if (plain(value) && Object.keys(value).length <= 80) return Object.fromEntries(Object.entries(value).map(([k,v]) => {
    if (!safeName(k)) throw Error("模型参数字段无效。");
    return [k,jsonValue(v,depth+1)];
  }));
  throw Error("模型参数需要有限大小的 JSON 值。");
}
const reserved = new Set(["model", "messages", "input", "instructions", "system", "contents", "systemInstruction", "tools", "tool_choice", "toolConfig", "stream", "authorization", "api_key", "apiKey"]);
function normalizeAdapter(input = {}) {
  if (!plain(input)) throw Error("模型适配需要对象。");
  const output = {};
  for (const key of Object.keys(input)) if (!["protocol", "contextWindow", "maxOutputTokens", "supportsImages", "supportsTools", "reasoning", "reasoningField", "parameters", "omitParameters"].includes(key)) throw Error(`未知模型适配字段：${key}`);
  if (input.protocol !== undefined) { if (!protocols.includes(input.protocol)) throw Error("模型协议无效。"); output.protocol = input.protocol; }
  for (const key of ["contextWindow", "maxOutputTokens"]) if (input[key] !== undefined) {
    if (!Number.isSafeInteger(input[key]) || input[key] < 1 || input[key] > 10000000) throw Error("上下文或输出长度需要有效整数。"); output[key] = input[key];
  }
  for (const key of ["supportsImages", "supportsTools"]) if (input[key] !== undefined) { if (typeof input[key] !== "boolean") throw Error("模型能力开关需要布尔值。"); output[key] = input[key]; }
  if (output.contextWindow && output.maxOutputTokens && output.maxOutputTokens >= output.contextWindow) throw Error("输出上限需小于上下文容量，为输入和工具结果留出空间。");
  if (input.reasoningField !== undefined) { if (!["none", "reasoning_content", "reasoning_details"].includes(input.reasoningField)) throw Error("思考续接字段无效。"); output.reasoningField = input.reasoningField; }
  if (input.reasoning !== undefined) {
    const r = input.reasoning;
    if (!plain(r) || Object.keys(r).some(k => !["mode", "effort", "budgetTokens"].includes(k)) || r.mode !== undefined && !["auto", "off", "enabled"].includes(r.mode) || r.effort !== undefined && !["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"].includes(r.effort) || r.budgetTokens !== undefined && (!Number.isSafeInteger(r.budgetTokens) || r.budgetTokens < 0 || r.budgetTokens > 1000000)) throw Error("思考模式、强度或预算无效。");
    output.reasoning = { ...r };
  }
  if (input.parameters !== undefined) {
    if (!plain(input.parameters) || Object.keys(input.parameters).some(k => reserved.has(k))) throw Error("自定义参数不能覆盖模型、上下文、工具、流式或凭证。");
    output.parameters = jsonValue(input.parameters);
    if (JSON.stringify(output.parameters).length > 24000) throw Error("模型参数过大。");
  }
  if (input.omitParameters !== undefined) {
    if (!Array.isArray(input.omitParameters) || input.omitParameters.length > 40 || input.omitParameters.some(k => !safeName(k) || reserved.has(k))) throw Error("省略参数列表无效。");
    output.omitParameters = [...new Set(input.omitParameters)];
  }
  return output;
}
function normalizeAdapters(value = {}) {
  if (!plain(value) || Object.keys(value).length > 1000) throw Error("模型适配列表无效。");
  return Object.fromEntries(Object.entries(value).map(([id, adapter]) => { if (!safeName(id)) throw Error("模型 ID 无效。"); return [id, normalizeAdapter(adapter)]; }));
}
function normalizeDirectory(value = []) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 3000).filter(item => safeName(item?.id)).map(item => ({ id: item.id,
    name: String(item.name || item.id).slice(0,200),
    ...(protocols.includes(item.protocol) && item.protocol !== "auto" ? { protocol: item.protocol } : {}),
    ...Object.fromEntries(["contextWindow", "maxOutputTokens"].filter(k => Number.isSafeInteger(item[k]) && item[k] > 0 && item[k] <= 10000000).map(k=>[k,item[k]])),
    ...Object.fromEntries(["supportsTools", "supportsImages"].filter(k => typeof item[k] === "boolean").map(k=>[k,item[k]])),
    supportedParameters: Array.isArray(item.supportedParameters) ? item.supportedParameters.filter(safeName).slice(0,100) : [],
    source: String(item.source || "provider catalog").slice(0,240)
  }));
}
function modelDirectory(data, baseUrl) {
  const kind = providerKind(baseUrl);
  const items = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : plain(data?.models) ? Object.entries(data.models).map(([id,value])=>({...value,id})) : [];
  return normalizeDirectory(items.filter(raw => typeof raw === "string" || plain(raw)).map(raw => {
    const item = typeof raw === "string" ? { id: raw } : {...raw, id:raw.id || raw.name};
    const known = knownModel(kind, item?.id);
    return { id: item.id, name: item.displayName || item.name || known.name || item.id,
      protocol: kind === "openrouter" ? "chat" : protocolNames[known.api_protocol],
      contextWindow: item.context_length || item.context_window || item.inputTokenLimit || known.context_window,
      maxOutputTokens: item.top_provider?.max_completion_tokens || item.max_output_tokens || item.outputTokenLimit || known.output_limit,
      supportsTools: kind.startsWith("opencode") && /^jev-/.test(item.id) ? false : Array.isArray(item.supported_parameters) ? item.supported_parameters.includes("tools") : known.tool_calls,
      supportsImages: item.architecture?.input_modalities ? item.architecture.input_modalities.includes("image") : known.vision,
      supportedParameters: item.supported_parameters,
      source: known.id ? `provider catalog + ${kind} official protocol table (2026-09-20)` : "provider catalog" };
  }));
}
function resolveModelAdapter(provider = {}, model) {
  const kind = providerKind(provider.baseUrl || provider.displayBaseUrl), directory = provider.modelDirectory?.find(item=>item.id===model) || {};
  const custom = normalizeAdapter(provider.modelAdapters?.[model] || {}), known = knownModel(kind, model);
  const family = /deepseek/i.test(model) ? "deepseek" : /gemini/i.test(model) ? "gemini" : /claude/i.test(model) ? "claude" : /(?:^|\/)(?:gpt-|o[134](?:-|$)|codex-)/i.test(model) ? "openai" : "compatible";
  const protocol = custom.protocol && custom.protocol !== "auto" ? custom.protocol : kind === "openrouter" ? "chat" : directory.protocol || protocolNames[known.api_protocol] ||
    (kind.startsWith("opencode") && family === "claude" ? "anthropic" : kind.startsWith("opencode") && family === "gemini" ? "google" : family === "openai" ? "responses" : "chat");
  return { kind, family, protocol, contextWindow: directory.contextWindow || known.context_window || 0,
    maxOutputTokens: directory.maxOutputTokens || known.output_limit || 0,
    supportsImages: directory.supportsImages ?? known.vision ?? (["openai", "claude", "gemini"].includes(family) || /vision/i.test(model)),
    supportsTools: directory.supportsTools ?? (kind.startsWith("opencode") && /^jev-/.test(model) ? false : true), supportedParameters: directory.supportedParameters || [],
    reasoningField: kind === "openrouter" ? "reasoning_details" : known.reasoning_field || (family === "deepseek" ? "reasoning_content" : "none"),
    ...custom, protocol, source: Object.keys(custom).length ? "custom override" : directory.source || (known.id ? "bundled official protocol table" : "model family default; probe if needed") };
}
function applyParameters(body, profile) {
  const r = profile.reasoning || {}, effort = r.effort || body.reasoning_effort || body.reasoning?.effort;
  if (profile.protocol === "chat") {
    delete body.reasoning; delete body.reasoning_effort;
    if (profile.family !== "openai" || profile.kind === "openrouter") delete body.service_tier;
    if (profile.kind === "openrouter") {
      body.provider = { require_parameters: true };
      if (r.mode === "off") body.reasoning = { enabled: false };
      else if (r.mode === "enabled" || effort || r.budgetTokens !== undefined) body.reasoning = { enabled: true, ...(r.budgetTokens !== undefined ? { max_tokens: r.budgetTokens } : effort ? { effort } : {}) };
    } else if (profile.family === "deepseek") {
      if (r.mode === "off") body.thinking = { type: "disabled" };
      else if (r.mode === "enabled") body.thinking = { type: "enabled" };
      if (effort && r.mode !== "off") body.reasoning_effort = ({ minimal: "low", medium: "high", xhigh: "high", ultra: "max" })[effort] || effort;
      if (effort === "none") { body.thinking = { type: "disabled" }; delete body.reasoning_effort; }
      if (profile.kind === "deepseek" && !body.max_tokens) body.max_tokens = r.mode === "off" ? 8192 : 65536;
    } else if (effort && r.mode !== "off") body.reasoning_effort = effort;
    if (profile.maxOutputTokens) body.max_tokens = Math.min(body.max_tokens || profile.maxOutputTokens, profile.maxOutputTokens);
  } else if (profile.protocol === "responses") {
    if (r.mode === "off") body.reasoning = { effort: "none" };
    else if (effort) body.reasoning = { ...body.reasoning, effort };
    if (profile.maxOutputTokens) body.max_output_tokens = Math.min(body.max_output_tokens || profile.maxOutputTokens, profile.maxOutputTokens);
  } else if (profile.protocol === "anthropic") {
    if (r.mode === "enabled") body.thinking = r.budgetTokens ? { type: "enabled", budget_tokens: r.budgetTokens } : { type: "adaptive" };
    if (r.mode === "off") body.thinking = { type: "disabled" };
    if (r.effort && r.mode !== "off") body.output_config = { effort: r.effort };
  } else if (profile.protocol === "google" && (r.mode && r.mode !== "auto" || r.effort || r.budgetTokens !== undefined)) {
    body.generationConfig ||= {};
    body.generationConfig.thinkingConfig = r.mode === "off" ? { thinkingBudget: 0 } : { includeThoughts: true, ...(r.budgetTokens !== undefined ? { thinkingBudget: r.budgetTokens } : { thinkingLevel: r.effort || "high" }) };
  }
  function merge(target, parameters) {
    for (const [key,value] of Object.entries(parameters)) {
      if (plain(value) && plain(target[key])) merge(target[key], value);
      else target[key] = structuredClone(value);
    }
  }
  merge(body, profile.parameters || {});
  for (const key of profile.omitParameters || []) delete body[key];
  // Native parameters may lower the configured output ceiling, never bypass it.
  if (profile.maxOutputTokens) {
    if (profile.protocol === "google") {
      body.generationConfig ||= {};
      body.generationConfig.maxOutputTokens = Math.min(body.generationConfig.maxOutputTokens || profile.maxOutputTokens, profile.maxOutputTokens);
    } else {
      const key = profile.protocol === "responses" ? "max_output_tokens" : "max_completion_tokens" in body ? "max_completion_tokens" : "max_tokens";
      body[key] = Math.min(body[key] || profile.maxOutputTokens, profile.maxOutputTokens);
      if (key === "max_completion_tokens") delete body.max_tokens;
    }
  }
  if (profile.protocol === "anthropic" && body.thinking?.type === "enabled" && (body.thinking.budget_tokens < 1024 || body.thinking.budget_tokens >= body.max_tokens)) throw Error("Anthropic 思考预算至少为 1024，且需小于最大输出长度。");
  return body;
}
const adapterIdentity = (provider, model) => createHash("sha256").update(JSON.stringify([provider.mode,provider.profileId,provider.baseUrl,model,resolveModelAdapter(provider,model).protocol])).digest("hex");
const adapterSchema = { type: "object", additionalProperties: false, properties: {
  protocol: { type: "string", enum: protocols }, contextWindow: { type: "integer", minimum: 1, maximum: 10000000 }, maxOutputTokens: { type: "integer", minimum: 1, maximum: 10000000 },
  supportsTools: { type: "boolean" }, supportsImages: { type: "boolean" }, reasoningField: { type: "string", enum: ["none","reasoning_content","reasoning_details"] },
  reasoning: { type: "object", properties: { mode: { type: "string", enum: ["auto","off","enabled"] }, effort: { type: "string", enum: ["none","minimal","low","medium","high","xhigh","max","ultra"] }, budgetTokens: { type: "integer", minimum: 0, maximum: 1000000 } }, additionalProperties: false },
  parameters: { type: "object", additionalProperties: true, description: "供应商原生参数；不能覆盖模型、历史、工具、流式或凭证。" }, omitParameters: { type: "array", items: { type: "string" }, maxItems: 40 }
} };
module.exports = { presets, protocols, providerKind, safeModelId: safeName, normalizeAdapter, normalizeAdapters, normalizeDirectory, modelDirectory, resolveModelAdapter, applyParameters, adapterIdentity, adapterSchema };
