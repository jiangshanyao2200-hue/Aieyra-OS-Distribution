"use strict";

const {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} = require("node:fs");
const { randomBytes } = require("node:crypto");
const path = require("node:path");
const modelCapabilityRegistry = require("../../shared/config/model-capabilities.json");
const { normalizeAdapters, normalizeDirectory } = require("./provider-adapters.cjs");

const CONNECTION_CONTRACT_VERSION = 3;
const CONNECTION_MODES = Object.freeze(["local", "official", "custom"]);
const CONNECTION_PHASES = Object.freeze([
  "local-ready",
  "disconnected",
  "connecting",
  "ready",
  "error"
]);
const CONNECTION_ERROR_KINDS = Object.freeze([
  "security",
  "network",
  "auth",
  "timeout",
  "cancelled",
  "models-incompatible"
]);
const CREDENTIAL_STORAGE_KINDS = Object.freeze([
  "safe-storage",
  "memory-only",
  "unavailable"
]);

const modeSet = new Set(CONNECTION_MODES);
const phaseSet = new Set(CONNECTION_PHASES);
const errorKindSet = new Set(CONNECTION_ERROR_KINDS);
const controlCharacterPattern = /[\u0000-\u001f\u007f]/;
const controlCharactersGlobalPattern = /[\u0000-\u001f\u007f]/g;
const encodedControlCharacterPattern = /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i;
const encodedPathSeparatorPattern = /%(?:2f|5c)/i;
const maxBaseUrlLength = 2_048;
const defaultMaxApiKeyLength = 8_192;
const publicCredentialRedaction = "[redacted credential]";
const supportedReasoningEfforts = new Set(Array.isArray(modelCapabilityRegistry.reasoningEfforts)
  ? modelCapabilityRegistry.reasoningEfforts.map((value) => String(value))
  : ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);
const supportedServiceTiers = new Set(["standard", "fast", "ultrafast"]);

function normalizeAgentProvider(value) {
  // Legacy CODEX/CUSTOM choices both used the OpenAI-compatible transport.
  // Keep their settings readable while exposing one explicit vendor contract.
  return ["OPENAI", "CODEX", "CUSTOM"].includes(String(value || "").toUpperCase()) ? "OPENAI" : "OPENAI";
}

function agentModelCapability(modelValue) {
  const model = String(modelValue || "").trim();
  const rules = Array.isArray(modelCapabilityRegistry.rules) ? modelCapabilityRegistry.rules : [];
  const rule = rules.find((candidate) => {
    try {
      return new RegExp(String(candidate?.pattern || ""), "i").test(model);
    } catch {
      return false;
    }
  }) || modelCapabilityRegistry.fallback || {};
  const reasoningEfforts = Array.isArray(rule.reasoningEfforts)
    ? rule.reasoningEfforts.map((value) => String(value)).filter((value) => supportedReasoningEfforts.has(value))
    : [];
  const serviceTiers = rule.kind !== "image" && Array.isArray(rule.serviceTiers)
    ? rule.serviceTiers.map((value) => String(value)).filter((value) => supportedServiceTiers.has(value))
    : [];
  if (!serviceTiers.includes("standard")) serviceTiers.unshift("standard");
  return Object.freeze({
    kind: rule.kind === "image" ? "image" : "text",
    reasoningEfforts: Object.freeze(reasoningEfforts),
    defaultReasoningEffort: reasoningEfforts.includes(String(rule.defaultReasoningEffort || ""))
      ? String(rule.defaultReasoningEffort)
      : reasoningEfforts[0] || "",
    supportsReasoning: rule.kind !== "image" && reasoningEfforts.length > 0,
    ultraReasoningEffort: reasoningEfforts.includes(String(rule.ultraReasoningEffort || ""))
      ? String(rule.ultraReasoningEffort) : "",
    reasoningContext: ["auto", "current_turn", "all_turns"].includes(rule.reasoningContext) ? rule.reasoningContext : "",
    defaultContextWindowTokens: Math.max(0, Number(rule.defaultContextWindowTokens) || 0),
    contextWindowTokens: Math.max(0, Number(rule.contextWindowTokens) || 0),
    maxOutputTokens: Math.max(0, Number(rule.maxOutputTokens) || 0),
    serviceTiers: Object.freeze(serviceTiers),
    supportsFastMode: serviceTiers.includes("fast")
  });
}

function normalizeAgentRuntimeOptions(value = {}, fallback = {}) {
  const agentProvider = normalizeAgentProvider(value.agentProvider ?? fallback.agentProvider);
  const model = value.agentModel ?? fallback.agentModel ?? "";
  const capability = agentModelCapability(model);
  const requestedReasoningEffort = String(value.reasoningEffort ?? fallback.reasoningEffort ?? "");
  const reasoningEffort = capability.supportsReasoning
    ? capability.reasoningEfforts.includes(requestedReasoningEffort)
      ? requestedReasoningEffort
      : requestedReasoningEffort === "ultra" && capability.reasoningEfforts.includes("max")
        ? "max"
      : capability.defaultReasoningEffort
    : "";
  const rawServiceTier = value.serviceTier ?? fallback.serviceTier;
  const normalizedServiceTier = String(rawServiceTier || "").toLowerCase();
  const requestedServiceTier = rawServiceTier === true || normalizedServiceTier === "fast" || normalizedServiceTier === "priority"
    ? "fast"
    : normalizedServiceTier || ((value.fastMode ?? fallback.fastMode) === true ? "fast" : "standard");
  const serviceTier = capability.serviceTiers.includes(requestedServiceTier) ? requestedServiceTier : "standard";
  return Object.freeze({
    agentProvider,
    reasoningEffort,
    serviceTier,
    fastMode: serviceTier !== "standard",
    capability
  });
}

function providerReasoningEffortForRequest(model, value) {
  const capability = agentModelCapability(model);
  const requested = String(value || "");
  if (requested !== "ultra") return capability.reasoningEfforts.includes(requested) ? requested : "";
  if (capability.ultraReasoningEffort) return capability.ultraReasoningEffort;
  return ["max", "xhigh", "high", "medium", "low"]
    .find((effort) => capability.reasoningEfforts.includes(effort)) || "";
}

function providerServiceTierForRequest(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "ultrafast") return "ultrafast";
  return normalized === "fast" || normalized === "priority" ? "priority" : undefined;
}

class ConnectionSecurityError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ConnectionSecurityError";
    this.code = code;
  }
}

function securityError(code, message) {
  throw new ConnectionSecurityError(code, message);
}

function normalizedString(value, label, maxLength, { allowEmpty = false } = {}) {
  if (typeof value !== "string") {
    securityError("INVALID_TEXT", `${label} 必须是字符串。`);
  }
  if (controlCharacterPattern.test(value)) {
    securityError("CONTROL_CHARACTER", `${label} 不能包含控制字符。`);
  }
  const normalized = value.trim();
  if (!allowEmpty && !normalized) {
    securityError("EMPTY_TEXT", `${label} 不能为空。`);
  }
  if (normalized.length > maxLength) {
    securityError("TEXT_TOO_LONG", `${label} 过长。`);
  }
  return normalized;
}

function normalizeProfileId(value) {
  const profileId = normalizedString(value, "连接配置 ID", 128);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(profileId)) {
    securityError("INVALID_PROFILE_ID", "连接配置 ID 格式无效。");
  }
  return profileId;
}

function normalizeModelName(value, { allowEmpty = true } = {}) {
  const model = normalizedString(value ?? "", "模型名称", 200, { allowEmpty });
  if (model && /\s{2,}/.test(model)) {
    securityError("INVALID_MODEL", "模型名称格式无效。");
  }
  return model;
}

function normalizeModels(value) {
  if (value == null) return Object.freeze([]);
  if (!Array.isArray(value)) {
    securityError("INVALID_MODELS", "模型列表必须是数组。");
  }
  if (value.length > 10_000) {
    securityError("TOO_MANY_MODELS", "模型列表数量异常。");
  }
  const seen = new Set();
  const models = [];
  for (const item of value) {
    const model = normalizeModelName(item, { allowEmpty: false });
    if (!seen.has(model)) {
      seen.add(model);
      models.push(model);
    }
  }
  return Object.freeze(models);
}

function normalizeImageModelNotes(value, imageModels = []) {
  if (value == null) return Object.freeze({});
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    securityError("INVALID_IMAGE_MODEL_NOTES", "生图模型备注必须是对象。");
  }
  const availableByKey = new Map(imageModels.map((model) => [model.toLowerCase(), model]));
  const notes = {};
  for (const [rawModel, rawNote] of Object.entries(value).slice(0, 100)) {
    const model = normalizeModelName(rawModel, { allowEmpty: false });
    const canonicalModel = availableByKey.get(model.toLowerCase());
    if (!canonicalModel) continue;
    const note = normalizedString(String(rawNote ?? ""), "生图模型备注", 240, { allowEmpty: true }).replace(/\s+/g, " ");
    if (note) notes[canonicalModel] = note;
  }
  return Object.freeze(notes);
}

function isImageGenerationModelId(value) {
  const model = String(value || "").trim().toLowerCase();
  if (!model) return false;
  if (agentModelCapability(model).kind === "image") return true;
  return /(?:^|[-_:.\/])(?:image|imagen|flux|dall-e|midjourney|stable-diffusion|sdxl|sd3|ideogram|recraft|seedream|doubao-image|qwen-image|hunyuan-image|wanx|wanxiang|kolors|playground)(?:$|[-_:.\/])/i.test(model) ||
    /^(?:gpt-image|chatgpt-image|imagen|flux|dall-e|midjourney|stable-diffusion|sdxl|sd3|ideogram|recraft|seedream|wanx|wanxiang|qwen-image|hunyuan-image|kolors|playground)/i.test(model);
}

function modelsFromAvailable(value, availableModels) {
  const availableByKey = new Map(availableModels.map((model) => [model.toLowerCase(), model]));
  return Object.freeze(normalizeModels(value)
    .map((model) => availableByKey.get(model.toLowerCase()))
    .filter(Boolean));
}

function normalizeModelKeyBindings(value = {}) {
  return Object.freeze(Object.fromEntries(["agent", "image"].map(kind => [kind, Object.freeze(Object.fromEntries(
    Object.entries(value?.[kind] || {}).filter(([model, tokenId]) => model.length <= 200 && /^\d{1,20}$/.test(String(tokenId)) && Number(tokenId) > 0)
      .slice(0, 1000).map(([model, tokenId]) => [model.toLowerCase(), String(tokenId)])
  ))])));
}

function normalizedProviderModelCollections(value = {}, previous = null) {
  const models = normalizeModels(value.models ?? previous?.models ?? []);
  const inferredImageModels = models.filter(isImageGenerationModelId);
  const inferredAgentModels = models.filter((model) => !isImageGenerationModelId(model));
  // A model discovery response replaces the available model universe. When
  // it omits the derived collections, infer them from that fresh response
  // instead of carrying an empty/stale collection from the prior snapshot.
  // For partial state updates (no `models` field), preserve the prior explicit
  // selections and pools.
  const hasFreshModels = value.models != null;
  const agentModels = modelsFromAvailable(
    value.agentModels ?? (hasFreshModels ? inferredAgentModels : previous?.agentModels ?? inferredAgentModels),
    models
  );
  const imageModels = modelsFromAvailable(
    value.imageModels ?? (hasFreshModels ? inferredImageModels : previous?.imageModels ?? inferredImageModels),
    models
  );
  const requestedAgentModel = normalizeModelName(value.agentModel ?? previous?.agentModel ?? "");
  const requestedImageModel = normalizeModelName(value.imageModel ?? previous?.imageModel ?? "");
  const agentModel = agentModels.find((model) => model.toLowerCase() === requestedAgentModel.toLowerCase()) || "";
  const imageModel = imageModels.find((model) => model.toLowerCase() === requestedImageModel.toLowerCase()) || "";
  const agentPoolSource = value.agentModelPool ?? previous?.agentModelPool ?? [];
  const imagePoolSource = value.imageModelPool ?? previous?.imageModelPool ?? [];
  const agentModelPool = modelsFromAvailable([agentModel, ...normalizeModels(agentPoolSource)].filter(Boolean), agentModels);
  const imageModelPool = modelsFromAvailable([imageModel, ...normalizeModels(imagePoolSource)].filter(Boolean), imageModels);
  const imageModelNotes = normalizeImageModelNotes(value.imageModelNotes ?? previous?.imageModelNotes ?? {}, imageModelPool);
  return { models, agentModels, imageModels, agentModel, imageModel, agentModelPool, imageModelPool, imageModelNotes,
    modelKeyBindings: normalizeModelKeyBindings(value.modelKeyBindings ?? previous?.modelKeyBindings) };
}

function normalizedHostname(hostname) {
  let result = String(hostname || "").toLowerCase();
  if (result.startsWith("[") && result.endsWith("]")) result = result.slice(1, -1);
  while (result.endsWith(".")) result = result.slice(0, -1);
  return result;
}

function parseIpv4(hostname) {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null;
  const bytes = parts.map(Number);
  return bytes.every((byte) => byte >= 0 && byte <= 255) ? bytes : null;
}

function ipv4Classification(hostname) {
  const bytes = parseIpv4(hostname);
  if (!bytes) return "unknown";
  const [first, second] = bytes;
  if (first === 127) return "loopback";
  if (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254) ||
    (first === 100 && second >= 64 && second <= 127)
  ) {
    return "lan";
  }
  return "public";
}

function ipv6Classification(hostname) {
  const host = normalizedHostname(hostname);
  if (!host.includes(":")) return "unknown";
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") return "loopback";
  const mappedIpv4 = host.match(/^(?:::ffff:|0:0:0:0:0:ffff:)(\d+\.\d+\.\d+\.\d+)$/i);
  if (mappedIpv4) return ipv4Classification(mappedIpv4[1]);
  const firstPart = host.split(":").find(Boolean);
  if (!firstPart || !/^[0-9a-f]{1,4}$/i.test(firstPart)) return "unknown";
  const firstHextet = Number.parseInt(firstPart, 16);
  if ((firstHextet & 0xfe00) === 0xfc00 || (firstHextet & 0xffc0) === 0xfe80) {
    return "lan";
  }
  return "public";
}

function classifyHttpHostname(hostname) {
  const host = normalizedHostname(hostname);
  if (host === "localhost" || host.endsWith(".localhost")) return "loopback";
  const ipv4 = ipv4Classification(host);
  if (ipv4 !== "unknown") return ipv4;
  const ipv6 = ipv6Classification(host);
  if (ipv6 !== "unknown") return ipv6;
  if (host.endsWith(".local") || host.endsWith(".lan") || host.endsWith(".home.arpa")) {
    return "lan";
  }
  return "public";
}

function rawPathFromUrlText(value) {
  const schemeIndex = value.indexOf("://");
  if (schemeIndex < 0) return "";
  const pathIndex = value.indexOf("/", schemeIndex + 3);
  return pathIndex < 0 ? "" : value.slice(pathIndex);
}

function assertSafePathText(value, label) {
  if (value.includes("\\") || encodedPathSeparatorPattern.test(value)) {
    securityError("UNSAFE_PATH", `${label} 不能包含反斜杠或编码后的路径分隔符。`);
  }
  if (encodedControlCharacterPattern.test(value)) {
    securityError("CONTROL_CHARACTER", `${label} 不能包含编码后的控制字符。`);
  }
  const segments = value.split("/");
  for (const segment of segments) {
    let decoded = "";
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      securityError("INVALID_PERCENT_ENCODING", `${label} 包含无效的百分号编码。`);
    }
    if (decoded === "." || decoded === "..") {
      securityError("PATH_TRAVERSAL", `${label} 不能包含相对路径段。`);
    }
    if (controlCharacterPattern.test(decoded) || decoded.includes("/") || decoded.includes("\\")) {
      securityError("UNSAFE_PATH", `${label} 包含不安全的路径内容。`);
    }
  }
}

function normalizeCustomBaseUrl(value, options = {}) {
  const raw = normalizedString(value, "Base URL", maxBaseUrlLength);
  if (raw.includes("?") || raw.includes("#")) {
    securityError("URL_QUERY_OR_HASH", "Base URL 不能包含 query 或 hash。");
  }
  const rawPath = rawPathFromUrlText(raw);
  assertSafePathText(rawPath, "Base URL");

  let target;
  try {
    target = new URL(raw);
  } catch {
    securityError("INVALID_BASE_URL", "Base URL 格式无效。");
  }
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    securityError("UNSUPPORTED_PROTOCOL", "Base URL 只允许 HTTPS 或 HTTP。");
  }
  if (!target.hostname) {
    securityError("MISSING_HOST", "Base URL 缺少主机名。");
  }
  if (target.username || target.password) {
    securityError("URL_USERINFO", "Base URL 不能包含用户名或密码。");
  }
  if (target.search || target.hash) {
    securityError("URL_QUERY_OR_HASH", "Base URL 不能包含 query 或 hash。");
  }

  if (target.protocol === "http:") {
    const classification = classifyHttpHostname(target.hostname);
    if (classification === "public") {
      securityError("PUBLIC_HTTP_FORBIDDEN", "公网服务必须使用 HTTPS。");
    }
    if (classification === "lan" && options.allowInsecureLan !== true) {
      securityError("INSECURE_LAN_CONFIRMATION_REQUIRED", "局域网 HTTP 需要用户明确确认。 ");
    }
  }

  const pathSegments = target.pathname.split("/").filter(Boolean);
  target.pathname = pathSegments.length ? `/${pathSegments.join("/")}` : "/";
  target.search = "";
  target.hash = "";
  const canonical = target.toString();
  return target.pathname === "/" ? canonical.slice(0, -1) : canonical.replace(/\/$/, "");
}

function normalizeEndpointPath(value) {
  const endpoint = normalizedString(value, "API endpoint", 1_024);
  if (endpoint.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(endpoint)) {
    securityError("ABSOLUTE_ENDPOINT", "API endpoint 必须是相对路径。");
  }
  if (endpoint.includes("?") || endpoint.includes("#")) {
    securityError("ENDPOINT_QUERY_OR_HASH", "API endpoint 不能包含 query 或 hash。");
  }
  assertSafePathText(endpoint, "API endpoint");
  const segments = endpoint.split("/").filter(Boolean);
  if (!segments.length) {
    securityError("EMPTY_ENDPOINT", "API endpoint 不能为空。");
  }
  return segments;
}

function joinProviderEndpoint(baseUrl, endpoint, options = {}) {
  const normalizedBase = normalizeCustomBaseUrl(baseUrl, options);
  const target = new URL(`${normalizedBase}/`);
  const baseSegments = target.pathname.split("/").filter(Boolean);
  const endpointSegments = normalizeEndpointPath(endpoint);
  const baseHasV1 = /^v\d+(?:(?:alpha|beta)\d*)?$/i.test(String(baseSegments.at(-1) || ""));
  const endpointHasV1 = String(endpointSegments[0] || "").toLowerCase() === "v1";

  if (baseHasV1 && endpointHasV1) endpointSegments.shift();
  if (!baseHasV1 && !endpointHasV1) endpointSegments.unshift("v1");
  target.pathname = `/${[...baseSegments, ...endpointSegments].join("/")}`;
  target.search = "";
  target.hash = "";
  return target.toString();
}

function validateApiKey(value, options = {}) {
  if (typeof value !== "string") {
    securityError("INVALID_API_KEY", "API Key 必须是字符串。");
  }
  const requestedMaximum = Number(options.maxLength);
  const maximum = Number.isSafeInteger(requestedMaximum) && requestedMaximum >= 32
    ? Math.min(requestedMaximum, 65_536)
    : defaultMaxApiKeyLength;
  if (!value || !value.trim()) {
    securityError("EMPTY_API_KEY", "API Key 不能为空。");
  }
  if (value !== value.trim()) {
    securityError("API_KEY_WHITESPACE", "API Key 不能包含首尾空白。");
  }
  if (value.length > maximum) {
    securityError("API_KEY_TOO_LONG", "API Key 长度异常。");
  }
  if (!/^[\x21-\x7e]+$/.test(value)) {
    securityError("API_KEY_UNSAFE_CHARACTER", "API Key 包含不安全字符。");
  }
  return value;
}

function safeStorageAvailable(safeStorage) {
  try {
    return Boolean(
      safeStorage &&
      typeof safeStorage.isEncryptionAvailable === "function" &&
      typeof safeStorage.encryptString === "function" &&
      typeof safeStorage.decryptString === "function" &&
      safeStorage.isEncryptionAvailable()
    );
  } catch {
    return false;
  }
}

const credentialVaultStates = new WeakMap();

function readEncryptedCredentialPayload(state) {
  if (state.loaded) return;
  if (!state.filePath || !existsSync(state.filePath)) {
    state.loaded = true;
    return;
  }
  state.encryptedPayloadPresent = true;
  // safeStorage can report unavailable before Electron is ready. Leave the
  // payload deferred so a later status/capture can retry without losing it.
  if (!safeStorageAvailable(state.safeStorage)) return;
  state.loaded = true;

  try {
    const envelope = JSON.parse(readFileSync(state.filePath, "utf8"));
    if (
      !envelope ||
      envelope.version !== CONNECTION_CONTRACT_VERSION ||
      typeof envelope.ciphertext !== "string" ||
      !envelope.ciphertext ||
      !/^[a-zA-Z0-9+/]+={0,2}$/.test(envelope.ciphertext)
    ) {
      throw new Error("invalid envelope");
    }
    const plaintext = state.safeStorage.decryptString(Buffer.from(envelope.ciphertext, "base64"));
    const decoded = JSON.parse(plaintext);
    if (!decoded || decoded.version !== CONNECTION_CONTRACT_VERSION || !Array.isArray(decoded.profiles)) {
      throw new Error("invalid credential payload");
    }
    const recovered = new Map();
    const recoveredEpochs = new Map();
    for (const item of decoded.profiles) {
      const profileId = normalizeProfileId(item?.profileId);
      const apiKey = validateApiKey(item?.apiKey);
      const epoch = Number.isSafeInteger(item?.epoch) && item.epoch > 0 ? item.epoch : 1;
      recovered.set(profileId, { apiKey, epoch, persisted: true });
      recoveredEpochs.set(profileId, epoch);
    }
    if (decoded.epochs != null) {
      if (!Array.isArray(decoded.epochs)) throw new Error("invalid credential epochs");
      for (const item of decoded.epochs) {
        const profileId = normalizeProfileId(item?.profileId);
        const epoch = Number.isSafeInteger(item?.epoch) && item.epoch > 0 ? item.epoch : 0;
        if (!epoch) throw new Error("invalid credential epoch");
        recoveredEpochs.set(profileId, Math.max(epoch, recoveredEpochs.get(profileId) || 0));
      }
    }
    state.records = recovered;
    state.epochs = recoveredEpochs;
    state.loadFailed = false;
  } catch {
    state.records.clear();
    state.loadFailed = true;
  }
}

function persistEncryptedCredentialPayload(state, records, epochs = state.epochs) {
  if (!state.filePath || !safeStorageAvailable(state.safeStorage)) return false;
  let temporaryPath = "";
  try {
    const profiles = [...records.entries()]
      .filter(([, record]) => record.persisted)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([profileId, record]) => ({ profileId, apiKey: record.apiKey, epoch: record.epoch }));
    const serializedEpochs = [...epochs.entries()]
      .filter(([, epoch]) => Number.isSafeInteger(epoch) && epoch > 0)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([profileId, epoch]) => ({ profileId, epoch }));
    const plaintext = JSON.stringify({
      version: CONNECTION_CONTRACT_VERSION,
      profiles,
      epochs: serializedEpochs
    });
    const encrypted = state.safeStorage.encryptString(plaintext);
    const ciphertext = Buffer.isBuffer(encrypted) ? encrypted : Buffer.from(encrypted);
    if (!ciphertext.length) return false;
    const directory = path.dirname(state.filePath);
    mkdirSync(directory, { recursive: true });
    temporaryPath = `${state.filePath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    writeFileSync(
      temporaryPath,
      `${JSON.stringify({ version: CONNECTION_CONTRACT_VERSION, ciphertext: ciphertext.toString("base64") })}\n`,
      { encoding: "utf8", mode: 0o600 }
    );
    renameSync(temporaryPath, state.filePath);
    temporaryPath = "";
    state.encryptedPayloadPresent = true;
    state.loadFailed = false;
    return true;
  } catch {
    return false;
  } finally {
    if (temporaryPath && existsSync(temporaryPath)) {
      try {
        unlinkSync(temporaryPath);
      } catch {
        // A failed cleanup never exposes the plaintext; the temporary file is encrypted too.
      }
    }
  }
}

function credentialStatusForState(state, profileId) {
  readEncryptedCredentialPayload(state);
  const record = state.records.get(profileId);
  const encryptionAvailable = safeStorageAvailable(state.safeStorage);
  return Object.freeze({
    configured: Boolean(record?.apiKey),
    persisted: Boolean(record?.persisted),
    storage: record
      ? record.persisted
        ? "safe-storage"
        : "memory-only"
      : encryptionAvailable
        ? "safe-storage"
        : "unavailable",
    epoch: Number(state.epochs.get(profileId) || record?.epoch || 0)
  });
}

function captureCredential(vault, profileId) {
  const state = credentialVaultStates.get(vault);
  if (!state) securityError("INVALID_CREDENTIAL_VAULT", "凭证存储实例无效。");
  readEncryptedCredentialPayload(state);
  const record = state.records.get(profileId);
  if (!record?.apiKey) {
    securityError("CREDENTIAL_NOT_CONFIGURED", "当前连接尚未配置 API Key。");
  }
  return { apiKey: record.apiKey, epoch: record.epoch };
}

class CredentialVault {
  constructor(options = {}) {
    credentialVaultStates.set(this, {
      safeStorage: options.safeStorage || null,
      filePath: options.filePath ? path.resolve(String(options.filePath)) : "",
      records: new Map(),
      epochs: new Map(),
      loaded: false,
      encryptedPayloadPresent: false,
      loadFailed: false
    });
  }

  credentialStatus(profileIdValue) {
    const profileId = normalizeProfileId(profileIdValue);
    return credentialStatusForState(credentialVaultStates.get(this), profileId);
  }

  setCredential(profileIdValue, apiKeyValue, options = {}) {
    const profileId = normalizeProfileId(profileIdValue);
    const apiKey = validateApiKey(apiKeyValue, options);
    const state = credentialVaultStates.get(this);
    readEncryptedCredentialPayload(state);
    if (state.encryptedPayloadPresent && !state.loaded) {
      securityError(
        "CREDENTIAL_STORAGE_UNAVAILABLE",
        "已有加密凭证暂时无法解锁；为避免旧凭证在下次启动时复活，本次不能静默替换。"
      );
    }
    const previous = state.records.get(profileId);
    const epoch = Math.max(0, Number(state.epochs.get(profileId) || previous?.epoch || 0)) + 1;
    const encryptionAvailable = safeStorageAvailable(state.safeStorage);
    const shouldPersist = options.persist === true && encryptionAvailable && Boolean(state.filePath);
    const nextRecord = { apiKey, epoch, persisted: shouldPersist };
    const nextRecords = new Map(state.records);
    const nextEpochs = new Map(state.epochs);
    nextRecords.set(profileId, nextRecord);
    nextEpochs.set(profileId, epoch);

    const diskMustChange = shouldPersist || Boolean(previous?.persisted);
    if (diskMustChange) {
      if (!encryptionAvailable || !state.filePath) {
        securityError("CREDENTIAL_STORAGE_UNAVAILABLE", "无法安全更新已持久化的凭证。");
      }
      if (!persistEncryptedCredentialPayload(state, nextRecords, nextEpochs)) {
        securityError("CREDENTIAL_PERSIST_FAILED", "加密凭证写入失败。");
      }
    }
    // Once a user submits a memory-only replacement, do not later merge an
    // older deferred disk payload over it.
    state.loaded = true;
    state.records = nextRecords;
    state.epochs = nextEpochs;
    return credentialStatusForState(state, profileId);
  }

  clearCredential(profileIdValue) {
    const profileId = normalizeProfileId(profileIdValue);
    const state = credentialVaultStates.get(this);
    readEncryptedCredentialPayload(state);
    if (state.encryptedPayloadPresent && !state.loaded) {
      securityError(
        "CREDENTIAL_STORAGE_UNAVAILABLE",
        "已有加密凭证暂时无法解锁；为避免下次启动恢复旧凭证，本次不能假装已清除。"
      );
    }
    const previous = state.records.get(profileId);
    if (!previous) return credentialStatusForState(state, profileId);
    const nextRecords = new Map(state.records);
    const nextEpochs = new Map(state.epochs);
    nextRecords.delete(profileId);
    nextEpochs.set(profileId, Math.max(0, Number(state.epochs.get(profileId) || previous.epoch || 0)) + 1);
    if (previous.persisted) {
      if (!safeStorageAvailable(state.safeStorage) || !state.filePath) {
        securityError("CREDENTIAL_STORAGE_UNAVAILABLE", "无法安全清除已持久化的凭证。");
      }
      if (!persistEncryptedCredentialPayload(state, nextRecords, nextEpochs)) {
        securityError("CREDENTIAL_CLEAR_FAILED", "加密凭证清除失败。");
      }
    }
    state.loaded = true;
    state.records = nextRecords;
    state.epochs = nextEpochs;
    return credentialStatusForState(state, profileId);
  }
}

function createCredentialVault(options = {}) {
  return new CredentialVault(options);
}

function normalizeCredentialStatus(value = {}) {
  const storage = CREDENTIAL_STORAGE_KINDS.includes(value.storage) ? value.storage : "unavailable";
  return Object.freeze({
    configured: value.configured === true,
    persisted: value.persisted === true,
    storage,
    epoch: Number.isSafeInteger(value.epoch) && value.epoch > 0 ? value.epoch : 0
  });
}

function redactedPublicText(value, maximum = 500) {
  return String(value || "")
    .replace(controlCharactersGlobalPattern, " ")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(/((?:api[_ -]?key|authorization|token|cookie)\s*[:=]\s*)[^\s,;]+/gi, "$1[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function normalizePublicError(value) {
  if (!value || typeof value !== "object") return undefined;
  const kind = errorKindSet.has(value.kind) ? value.kind : "network";
  const message = redactedPublicText(value.message) || "连接失败。";
  return Object.freeze({ kind, message });
}

function normalizePublicAccount(value) {
  if (!value || typeof value !== "object") return undefined;
  const account = {
    id: redactedPublicText(value.id, 128),
    email: redactedPublicText(value.email, 320),
    username: redactedPublicText(value.username, 128),
    account: redactedPublicText(value.account, 128),
    name: redactedPublicText(value.name, 128),
    balanceCents: Math.max(0, Number(value.balanceCents) || 0),
    crmUserId: redactedPublicText(value.crmUserId, 128),
    inviteCode: redactedPublicText(value.inviteCode, 128),
    agentLevel: redactedPublicText(value.agentLevel, 80),
    trialImagesRemaining: Math.max(0, Number(value.trialImagesRemaining) || 0),
    trialUsed: value.trialUsed === true,
    createdAt: redactedPublicText(value.createdAt, 80)
  };
  for (const key of Object.keys(account)) {
    if (account[key] === "" || account[key] == null) delete account[key];
  }
  return Object.freeze(account);
}

function createConnectionPublicSnapshot(value = {}) {
  const mode = modeSet.has(value.mode) ? value.mode : "local";
  const phase = mode === "local"
    ? "local-ready"
    : phaseSet.has(value.phase) && value.phase !== "local-ready"
      ? value.phase
      : "disconnected";
  const credential = normalizeCredentialStatus(value.credential);
  const modelCollections = normalizedProviderModelCollections(value);
  const {
    models,
    agentModels,
    imageModels,
    agentModel,
    imageModel,
    agentModelPool,
    imageModelPool,
    imageModelNotes
  } = modelCollections;
  const runtimeOptions = normalizeAgentRuntimeOptions(value, { agentModel });
  const profileId = mode === "local"
    ? "local"
    : normalizeProfileId(value.profileId || `${mode}:default`);
  const snapshot = {
    version: CONNECTION_CONTRACT_VERSION,
    mode,
    phase,
    aiReady:
      mode !== "local" &&
      phase === "ready" &&
      credential.configured &&
      Boolean(agentModel) &&
      agentModels.includes(agentModel),
    profileId,
    profileName: mode === "local"
      ? "尚未连接"
      : normalizedString(value.profileName || (mode === "official" ? "Aieyra 官方" : "自定义 API"), "连接名称", 120),
    displayBaseUrl: mode === "local" ? "" : normalizedString(value.displayBaseUrl || "", "Base URL", maxBaseUrlLength, { allowEmpty: true }),
    credential,
    models,
    agentModels,
    imageModels,
    agentModel,
    agentModelPool,
    imageModel,
    imageModelPool,
    imageModelNotes,
    modelKeyBindings: modelCollections.modelKeyBindings,
    modelDirectory: normalizeDirectory(value.modelDirectory),
    modelsSource: value.modelsSource === "manual" ? "manual" : "catalog",
    modelAdapters: normalizeAdapters(value.modelAdapters),
    agentProvider: runtimeOptions.agentProvider,
    reasoningEffort: runtimeOptions.reasoningEffort || "low",
    serviceTier: runtimeOptions.serviceTier,
    fastMode: runtimeOptions.fastMode
  };
  const account = mode === "official" ? normalizePublicAccount(value.account) : undefined;
  const error = phase === "error" ? normalizePublicError(value.error) : undefined;
  if (account) snapshot.account = account;
  if (error) snapshot.error = error;
  return Object.freeze(snapshot);
}

const connectionRuntimeStates = new WeakMap();

function localConnectionState() {
  return {
    mode: "local",
    phase: "local-ready",
    profileId: "local",
    profileName: "尚未连接",
    baseUrl: "",
    allowInsecureLan: false,
    models: Object.freeze([]),
    agentModels: Object.freeze([]),
    imageModels: Object.freeze([]),
    agentModel: "",
    agentModelPool: Object.freeze([]),
    imageModel: "",
    imageModelPool: Object.freeze([]),
    imageModelNotes: Object.freeze({}),
    agentProvider: "OPENAI",
    reasoningEffort: "low",
    serviceTier: "standard",
    fastMode: false,
    account: undefined,
    error: undefined
  };
}

function normalizeProviderConfiguration(input = {}, previous = null) {
  if (!input || typeof input !== "object") {
    securityError("INVALID_CONNECTION", "连接配置必须是对象。");
  }
  const mode = input.mode;
  if (mode !== "official" && mode !== "custom") {
    securityError("INVALID_PROVIDER_MODE", "Provider 模式必须是 official 或 custom。");
  }
  const allowInsecureLan = mode === "custom" && (input.allowInsecureLan ?? previous?.allowInsecureLan) === true;
  const baseUrl = normalizeCustomBaseUrl(input.baseUrl ?? previous?.baseUrl ?? "", { allowInsecureLan });
  if (mode === "official" && !baseUrl.startsWith("https://")) {
    securityError("OFFICIAL_HTTPS_REQUIRED", "官方连接必须使用 HTTPS。");
  }
  const phase = input.phase ?? previous?.phase ?? "disconnected";
  if (!phaseSet.has(phase) || phase === "local-ready") {
    securityError("INVALID_CONNECTION_PHASE", "Provider 连接阶段无效。");
  }
  const modelCollections = normalizedProviderModelCollections(input, previous);
  const { agentModel } = modelCollections;
  const runtimeOptions = normalizeAgentRuntimeOptions(input, { ...previous, agentModel });
  return {
    mode,
    phase,
    profileId: normalizeProfileId(input.profileId ?? previous?.profileId ?? `${mode}:default`),
    profileName: normalizedString(
      input.profileName ?? previous?.profileName ?? (mode === "official" ? "Aieyra 官方" : "自定义 API"),
      "连接名称",
      120
    ),
    baseUrl,
    allowInsecureLan,
    ...modelCollections,
    modelDirectory: normalizeDirectory(input.modelDirectory ?? previous?.modelDirectory),
    modelsSource: (input.modelsSource ?? previous?.modelsSource) === "manual" ? "manual" : "catalog",
    modelAdapters: normalizeAdapters(input.modelAdapters ?? previous?.modelAdapters),
    agentProvider: runtimeOptions.agentProvider,
    reasoningEffort: runtimeOptions.reasoningEffort || "low",
    serviceTier: runtimeOptions.serviceTier,
    fastMode: runtimeOptions.fastMode,
    account: mode === "official" ? normalizePublicAccount(input.account ?? previous?.account) : undefined,
    error: phase === "error" ? normalizePublicError(input.error ?? previous?.error) : undefined
  };
}

function validatedHeaderEntries(headers) {
  if (headers == null) return [];
  if (typeof headers !== "object" || Array.isArray(headers)) {
    securityError("INVALID_HEADERS", "请求头必须是对象。");
  }
  const result = [];
  for (const [name, value] of Object.entries(headers)) {
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(name)) {
      securityError("INVALID_HEADER_NAME", "请求头名称无效。");
    }
    const values = Array.isArray(value) ? value : [value];
    if (values.some((item) => controlCharacterPattern.test(String(item ?? "")))) {
      securityError("INVALID_HEADER_VALUE", "请求头值包含控制字符。");
    }
    result.push([name, value]);
  }
  return result;
}

function scrubExactCredentialText(value, credential) {
  const text = String(value ?? "");
  if (!credential || !text.includes(credential)) return text;
  return text.split(credential).join(publicCredentialRedaction);
}

function scrubExactCredentialValue(value, credential, state = null, depth = 0) {
  if (typeof value === "string") return scrubExactCredentialText(value, credential);
  if (value == null || typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return value;
  if (typeof value === "symbol" || typeof value === "function") return undefined;
  if (Buffer.isBuffer(value)) {
    const credentialBytes = Buffer.from(credential, "utf8");
    return credentialBytes.length && value.indexOf(credentialBytes) >= 0
      ? Buffer.from(publicCredentialRedaction, "utf8")
      : value;
  }
  if (typeof value !== "object") return value;
  if (depth >= 64) return publicCredentialRedaction;

  const context = state || { seen: new WeakMap() };
  if (context.seen.has(value)) return context.seen.get(value);

  if (value instanceof Error) {
    const cleaned = new Error(scrubExactCredentialText(value.message, credential));
    context.seen.set(value, cleaned);
    cleaned.name = scrubExactCredentialText(value.name || "Error", credential);
    if (typeof value.stack === "string") cleaned.stack = scrubExactCredentialText(value.stack, credential);
    for (const key of Object.keys(value)) {
      const publicKey = scrubExactCredentialText(key, credential);
      try {
        Object.defineProperty(cleaned, publicKey, {
          configurable: true,
          enumerable: true,
          writable: true,
          value: scrubExactCredentialValue(value[key], credential, context, depth + 1)
        });
      } catch {
        Object.defineProperty(cleaned, publicKey, {
          configurable: true,
          enumerable: true,
          writable: true,
          value: publicCredentialRedaction
        });
      }
    }
    return cleaned;
  }

  const cleaned = Array.isArray(value) ? [] : {};
  context.seen.set(value, cleaned);
  for (const key of Object.keys(value)) {
    const publicKey = Array.isArray(value) ? key : scrubExactCredentialText(key, credential);
    try {
      Object.defineProperty(cleaned, publicKey, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: scrubExactCredentialValue(value[key], credential, context, depth + 1)
      });
    } catch {
      Object.defineProperty(cleaned, publicKey, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: publicCredentialRedaction
      });
    }
  }
  return cleaned;
}

function createProviderRuntimeSnapshot(connection, credential, configurationEpoch) {
  const metadata = {
    mode: connection.mode,
    profileId: connection.profileId,
    baseUrl: connection.baseUrl,
    models: [...(connection.models || [])],
    agentModels: [...(connection.agentModels || [])],
    imageModels: [...(connection.imageModels || [])],
    agentModel: connection.agentModel,
    agentModelPool: [...(connection.agentModelPool || [])],
    imageModel: connection.imageModel,
    imageModelPool: [...(connection.imageModelPool || [])],
    imageModelNotes: { ...(connection.imageModelNotes || {}) },
    modelKeyBindings: normalizeModelKeyBindings(connection.modelKeyBindings),
    modelDirectory: normalizeDirectory(connection.modelDirectory),
    modelsSource: connection.modelsSource === "manual" ? "manual" : "catalog",
    modelAdapters: normalizeAdapters(connection.modelAdapters),
    agentProvider: connection.agentProvider,
    reasoningEffort: connection.reasoningEffort,
    serviceTier: connection.serviceTier,
    fastMode: connection.fastMode,
    credentialEpoch: credential.epoch,
    configurationEpoch
  };
  const capturedApiKey = credential.apiKey;
  const capturedBaseUrl = connection.baseUrl;
  const capturedMode = connection.mode;
  const allowInsecureLan = connection.allowInsecureLan;

  Object.defineProperty(metadata, "authorizeRequestHeaders", {
    configurable: false,
    enumerable: false,
    writable: false,
    value(headers = {}) {
      const authorized = {};
      for (const [name, value] of validatedHeaderEntries(headers)) {
        const lowerName = name.toLowerCase();
        if (lowerName === "authorization") continue;
        if (capturedMode === "custom" && (lowerName === "cookie" || lowerName === "new-api-user")) continue;
        authorized[name] = value;
      }
      authorized.Authorization = `Bearer ${capturedApiKey}`;
      return authorized;
    }
  });
  Object.defineProperty(metadata, "endpoint", {
    configurable: false,
    enumerable: false,
    writable: false,
    value(endpoint) {
      return joinProviderEndpoint(capturedBaseUrl, endpoint, { allowInsecureLan });
    }
  });
  Object.defineProperty(metadata, "scrubPublicText", {
    configurable: false,
    enumerable: false,
    writable: false,
    value(value) {
      return scrubExactCredentialText(value, capturedApiKey);
    }
  });
  Object.defineProperty(metadata, "scrubPublicValue", {
    configurable: false,
    enumerable: false,
    writable: false,
    value(value) {
      return scrubExactCredentialValue(value, capturedApiKey);
    }
  });
  return Object.freeze(metadata);
}

class ConnectionRuntime {
  constructor(options = {}) {
    const credentialVault = options.credentialVault || createCredentialVault({
      safeStorage: options.safeStorage,
      filePath: options.credentialFilePath
    });
    if (!credentialVaultStates.has(credentialVault)) {
      securityError("INVALID_CREDENTIAL_VAULT", "凭证存储实例无效。");
    }
    const state = {
      credentialVault,
      connection: localConnectionState(),
      configurationEpoch: 0
    };
    connectionRuntimeStates.set(this, state);
    if (options.initialConnection?.mode && options.initialConnection.mode !== "local") {
      this.configureProvider(options.initialConnection);
    }
  }

  getPublicSnapshot() {
    const state = connectionRuntimeStates.get(this);
    const connection = state.connection;
    const credential = connection.mode === "local"
      ? normalizeCredentialStatus()
      : state.credentialVault.credentialStatus(connection.profileId);
    return createConnectionPublicSnapshot({
      ...connection,
      displayBaseUrl: connection.baseUrl,
      credential
    });
  }

  useLocal() {
    const state = connectionRuntimeStates.get(this);
    state.connection = localConnectionState();
    state.configurationEpoch += 1;
    return this.getPublicSnapshot();
  }

  configureProvider(input) {
    const state = connectionRuntimeStates.get(this);
    let previous = null;
    if (state.connection.mode === input?.mode) {
      const requestedProfileId = input?.profileId == null
        ? state.connection.profileId
        : normalizeProfileId(input.profileId);
      if (requestedProfileId === state.connection.profileId) previous = state.connection;
    }
    state.connection = normalizeProviderConfiguration(input, previous);
    state.configurationEpoch += 1;
    return this.getPublicSnapshot();
  }

  updateProviderState(patch = {}) {
    const state = connectionRuntimeStates.get(this);
    if (state.connection.mode === "local") {
      securityError("LOCAL_MODE_ACTIVE", "本地模式没有 Provider 状态。");
    }
    state.connection = normalizeProviderConfiguration(
      { ...patch, mode: state.connection.mode },
      state.connection
    );
    state.configurationEpoch += 1;
    return this.getPublicSnapshot();
  }

  setCredential(profileId, apiKey, options = {}) {
    const state = connectionRuntimeStates.get(this);
    const status = state.credentialVault.setCredential(profileId, apiKey, options);
    return state.connection.profileId === normalizeProfileId(profileId) ? this.getPublicSnapshot() : status;
  }

  clearCredential(profileId) {
    const state = connectionRuntimeStates.get(this);
    const status = state.credentialVault.clearCredential(profileId);
    return state.connection.profileId === normalizeProfileId(profileId) ? this.getPublicSnapshot() : status;
  }

  captureProviderSnapshot() {
    const state = connectionRuntimeStates.get(this);
    const connection = state.connection;
    if (
      connection.mode === "local" ||
      connection.phase !== "ready" ||
      !connection.agentModel ||
      !connection.models.includes(connection.agentModel)
    ) {
      securityError("CONNECTION_NOT_READY", "当前 AI Provider 尚未就绪。");
    }
    const credential = captureCredential(state.credentialVault, connection.profileId);
    return createProviderRuntimeSnapshot(connection, credential, state.configurationEpoch);
  }

  scrubPublicValue(value) {
    const state = connectionRuntimeStates.get(this);
    if (state.connection.mode === "local") return value;
    try {
      const credential = captureCredential(state.credentialVault, state.connection.profileId);
      return scrubExactCredentialValue(value, credential.apiKey);
    } catch (error) {
      if (error.code === "CREDENTIAL_NOT_CONFIGURED" || !state.credentialVault.credentialStatus(state.connection.profileId).configured) return value;
      throw error;
    }
  }

  captureProviderSnapshotForConfiguration(input = {}) {
    const state = connectionRuntimeStates.get(this);
    const connection = normalizeProviderConfiguration({ ...input, phase: "ready" }, null);
    if (!connection.agentModel || !connection.models.includes(connection.agentModel)) {
      securityError("CONNECTION_NOT_READY", "Provider 探测配置缺少有效模型。");
    }
    const credential = captureCredential(state.credentialVault, connection.profileId);
    return createProviderRuntimeSnapshot(connection, credential, state.configurationEpoch);
  }
}

function createConnectionRuntime(options = {}) {
  return new ConnectionRuntime(options);
}

module.exports = {
  CONNECTION_CONTRACT_VERSION,
  CONNECTION_ERROR_KINDS,
  CONNECTION_MODES,
  CONNECTION_PHASES,
  CREDENTIAL_STORAGE_KINDS,
  ConnectionRuntime,
  ConnectionSecurityError,
  CredentialVault,
  classifyHttpHostname,
  agentModelCapability,
  createConnectionPublicSnapshot,
  createConnectionRuntime,
  createCredentialVault,
  isImageGenerationModelId,
  joinProviderEndpoint,
  normalizeAgentProvider,
  normalizeAgentRuntimeOptions,
  normalizeModelKeyBindings,
  providerReasoningEffortForRequest,
  providerServiceTierForRequest,
  normalizeCustomBaseUrl,
  validateApiKey,
  validatedHeaderEntries,
  scrubExactCredentialText,
  scrubExactCredentialValue
};
