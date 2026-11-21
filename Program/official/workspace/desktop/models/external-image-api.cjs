const http = require("node:http");
const { createHash, randomBytes, timingSafeEqual } = require("node:crypto");

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_MAX_CONCURRENT = 2;
const DEFAULT_RATE_WINDOW_MS = 60_000;
const DEFAULT_RATE_MAX_REQUESTS = 60;

class ExternalImageApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "ExternalImageApiError";
    this.status = status;
    this.code = code;
  }
}

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function tokenDigest(value) {
  return createHash("sha256").update(String(value || ""), "utf8").digest();
}

function bearerToken(header) {
  const match = String(header || "").match(/^Bearer[ \t]+([^\s]+)$/i);
  return match ? match[1] : "";
}

function tokenMatches(expected, provided) {
  if (!expected || !provided) return false;
  return timingSafeEqual(tokenDigest(expected), tokenDigest(provided));
}

function loopbackAddress(value) {
  const address = String(value || "").trim().toLowerCase();
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function publicConnection(value) {
  const source = value && typeof value === "object" ? value : {};
  const credential = source.credential && typeof source.credential === "object" ? source.credential : {};
  return {
    mode: ["local", "official", "custom"].includes(source.mode) ? source.mode : "local",
    phase: ["local-ready", "disconnected", "connecting", "ready", "error"].includes(source.phase)
      ? source.phase
      : "disconnected",
    ai_ready: source.aiReady === true,
    profile_name: String(source.profileName || "").slice(0, 120),
    base_url: String(source.displayBaseUrl || "").slice(0, 2048),
    credential_configured: credential.configured === true,
    credential_persisted: credential.persisted === true,
    models: Array.isArray(source.models) ? source.models.map(String).filter(Boolean).slice(0, 2_000) : [],
    agent_models: Array.isArray(source.agentModels) ? source.agentModels.map(String).filter(Boolean).slice(0, 2_000) : [],
    image_models: Array.isArray(source.imageModels) ? source.imageModels.map(String).filter(Boolean).slice(0, 2_000) : [],
    agent_model: String(source.agentModel || "").slice(0, 240),
    image_model: String(source.imageModel || "").slice(0, 240),
    image_model_pool: Array.isArray(source.imageModelPool) ? source.imageModelPool.map(String).filter(Boolean).slice(0, 200) : []
  };
}

function publicOperationResult(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    ok: source.ok === true,
    ...(Array.isArray(source.models) ? { models: source.models.map(String).filter(Boolean).slice(0, 2_000) } : {}),
    ...(source.normalizedBaseUrl ? { normalized_base_url: String(source.normalizedBaseUrl).slice(0, 2048) } : {}),
    ...(source.connection ? { connection: publicConnection(source.connection) } : {}),
    ...(source.ok === true ? {} : { error: "连接操作未完成，请在 Aieyra Workspace 中检查配置。" })
  };
}

function jsonResponse(response, status, payload, extraHeaders = {}) {
  if (response.writableEnded) return;
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(body.length),
    "cache-control": "no-store",
    pragma: "no-cache",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "cross-origin-resource-policy": "same-origin",
    ...extraHeaders
  });
  response.end(body);
}

function errorPayload(code, message) {
  return {
    error: {
      type: "aieyra_external_api_error",
      code,
      message
    }
  };
}

function readJsonBody(request, maximumBytes) {
  const contentType = String(request.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new ExternalImageApiError(415, "unsupported_media_type", "请求体必须使用 application/json。 ");
  }
  const declaredLength = Number(request.headers["content-length"] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    request.resume();
    throw new ExternalImageApiError(413, "request_too_large", "请求体超过大小限制。 ");
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    request.on("aborted", () => fail(new ExternalImageApiError(400, "request_aborted", "请求已中止。")));
    request.on("error", () => fail(new ExternalImageApiError(400, "invalid_request", "无法读取请求体。")));
    request.on("data", (chunk) => {
      if (settled) return;
      total += chunk.length;
      if (total > maximumBytes) {
        request.pause();
        fail(new ExternalImageApiError(413, "request_too_large", "请求体超过大小限制。"));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (settled) return;
      settled = true;
      try {
        const text = Buffer.concat(chunks, total).toString("utf8");
        const parsed = text ? JSON.parse(text) : {};
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("object required");
        }
        resolve(parsed);
      } catch {
        reject(new ExternalImageApiError(400, "invalid_json", "请求体不是有效的 JSON object。"));
      }
    });
  });
}

function normalizedImageRequest(body) {
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt || prompt.length > 32_000) {
    throw new ExternalImageApiError(400, "invalid_prompt", "prompt 必须为 1 至 32000 个字符。 ");
  }
  const count = body.n === undefined ? 1 : Number(body.n);
  if (!Number.isInteger(count) || count < 1 || count > 4) {
    throw new ExternalImageApiError(400, "invalid_count", "n 必须是 1 至 4 的整数。 ");
  }
  const responseFormat = body.response_format === undefined ? "b64_json" : String(body.response_format);
  if (responseFormat !== "b64_json") {
    throw new ExternalImageApiError(400, "unsupported_response_format", "仅支持 response_format=b64_json。 ");
  }
  const size = String(body.size || "1024x1024").trim();
  if (!/^(?:auto|\d{2,5}x\d{2,5})$/.test(size) || size.length > 24) {
    throw new ExternalImageApiError(400, "invalid_size", "size 格式无效。 ");
  }
  const quality = String(body.quality || "auto").trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,32}$/.test(quality)) {
    throw new ExternalImageApiError(400, "invalid_quality", "quality 格式无效。 ");
  }
  const model = String(body.model || "").trim();
  if (model.length > 240 || /[\u0000-\u001f\u007f]/.test(model)) {
    throw new ExternalImageApiError(400, "invalid_model", "model 格式无效。 ");
  }
  return {
    prompt,
    n: count,
    model,
    size,
    quality,
    response_format: "b64_json",
    ...(body.background === undefined ? {} : { background: String(body.background).slice(0, 32) }),
    ...(body.output_format === undefined ? {} : { output_format: String(body.output_format).slice(0, 32) }),
    ...(body.output_compression === undefined ? {} : { output_compression: Number(body.output_compression) })
  };
}

function createExternalImageApi(options = {}) {
  const dependencies = options.dependencies && typeof options.dependencies === "object" ? options.dependencies : {};
  const maximumBodyBytes = positiveInteger(options.maximumBodyBytes, DEFAULT_MAX_BODY_BYTES, 8 * 1024 * 1024);
  const maximumConcurrent = positiveInteger(options.maximumConcurrent, DEFAULT_MAX_CONCURRENT, 16);
  const rateWindowMs = positiveInteger(options.rateWindowMs, DEFAULT_RATE_WINDOW_MS, 60 * 60_000);
  const rateMaxRequests = positiveInteger(options.rateMaxRequests, DEFAULT_RATE_MAX_REQUESTS, 10_000);
  const now = typeof options.now === "function" ? options.now : Date.now;
  const tokenFactory = typeof options.tokenFactory === "function"
    ? options.tokenFactory
    : () => randomBytes(32).toString("base64url");
  let token = String(tokenFactory() || "");
  if (token.length < 32) throw new Error("External image API token factory returned an unsafe token.");
  let server = null;
  let port = 0;
  let activeRequests = 0;
  const requestControllers = new Set();
  const rateBuckets = new Map();

  const baseUrl = () => port ? `http://127.0.0.1:${port}` : "";
  const allowedHost = () => port ? `127.0.0.1:${port}` : "";

  function rotateToken() {
    const next = String(tokenFactory() || "");
    if (next.length < 32) throw new Error("External image API token factory returned an unsafe token.");
    token = next;
    for (const controller of requestControllers) {
      controller.abort(new Error("Aieyra external image API token rotated."));
    }
    return true;
  }

  function revealToken() {
    return token;
  }

  function pruneRateBuckets(timestamp = now()) {
    for (const [source, entries] of rateBuckets) {
      const recent = entries.filter((entry) => timestamp - entry < rateWindowMs);
      if (recent.length) rateBuckets.set(source, recent);
      else rateBuckets.delete(source);
    }
  }

  function consumeRate(source) {
    const timestamp = now();
    pruneRateBuckets(timestamp);
    const entries = rateBuckets.get(source) || [];
    if (entries.length >= rateMaxRequests) return false;
    entries.push(timestamp);
    rateBuckets.set(source, entries);
    return true;
  }

  function validateBoundary(request) {
    const source = String(request.socket?.remoteAddress || "");
    if (!loopbackAddress(source)) {
      throw new ExternalImageApiError(403, "loopback_required", "仅允许本机调用。 ");
    }
    if (String(request.headers.host || "").trim().toLowerCase() !== allowedHost()) {
      throw new ExternalImageApiError(421, "invalid_host", "Host 与本机接口地址不匹配。 ");
    }
    const origin = String(request.headers.origin || "").trim();
    if (origin && origin !== baseUrl()) {
      throw new ExternalImageApiError(403, "invalid_origin", "Origin 不受信任。 ");
    }
    if (!consumeRate(source.toLowerCase())) {
      throw new ExternalImageApiError(429, "rate_limit_exceeded", "请求过于频繁，请稍后重试。 ");
    }
    return origin;
  }

  function authenticate(request) {
    if (!tokenMatches(token, bearerToken(request.headers.authorization))) {
      throw new ExternalImageApiError(401, "invalid_token", "Bearer 令牌无效。 ");
    }
  }

  async function authorized(operation, context) {
    if (typeof dependencies.authorize !== "function") return operation();
    return dependencies.authorize(operation, context);
  }

  async function route(request, response, context) {
    const requestUrl = new URL(String(request.url || "/"), baseUrl());
    if (requestUrl.search) throw new ExternalImageApiError(404, "not_found", "接口不存在。 ");
    const pathname = requestUrl.pathname;
    const method = String(request.method || "GET").toUpperCase();

    if ((method === "GET" && pathname === "/v1/aieyra/tools") || (method === "POST" && ["/v1/aieyra/tools", "/v1/aieyra/matrix"].includes(pathname))) {
      if (typeof dependencies.matrix !== "function") throw new ExternalImageApiError(503, "matrix_unavailable", "Matrix API 尚未就绪。");
      const body = method === "GET" ? { name: "toolbox" } : await readJsonBody(request, maximumBodyBytes);
      const payload = pathname.endsWith("/matrix") ? { windowId: body.windowId, name: "call_tool", arguments: { name: "matrix.converse", arguments: body } } : body;
      const result = await authorized(() => dependencies.matrix(payload, context), { ...context, endpoint: pathname });
      return jsonResponse(response, result?.ok === false ? 400 : 200, result);
    }

    if (method === "GET" && pathname === "/health") {
      const connection = publicConnection(await authorized(
        () => dependencies.getConnection?.(),
        { ...context, endpoint: pathname }
      ));
      return jsonResponse(response, 200, {
        status: "ok",
        service: "aieyra-image-router",
        version: 1,
        configured: connection.ai_ready && connection.credential_configured && Boolean(connection.image_model),
        model_count: connection.image_models.length
      });
    }

    if (method === "GET" && pathname === "/v1/models") {
      const connection = publicConnection(await authorized(
        () => dependencies.getConnection?.(),
        { ...context, endpoint: pathname }
      ));
      const models = [...new Set(connection.image_models.length
        ? connection.image_models
        : connection.image_model_pool)].filter(Boolean);
      return jsonResponse(response, 200, {
        object: "list",
        data: models.map((id) => ({ id, object: "model", created: 0, owned_by: "aieyra-router" }))
      });
    }

    if (method === "GET" && pathname === "/v1/aieyra/connection") {
      const connection = publicConnection(await authorized(
        () => dependencies.getConnection?.(),
        { ...context, endpoint: pathname }
      ));
      return jsonResponse(response, 200, { connection });
    }

    if (method === "POST" && pathname === "/v1/images/generations") {
      const body = normalizedImageRequest(await readJsonBody(request, maximumBodyBytes));
      if (typeof dependencies.generateImage !== "function") {
        throw new ExternalImageApiError(503, "image_router_unavailable", "生图路由尚未就绪。 ");
      }
      const result = await authorized(
        () => dependencies.generateImage(body, context),
        { ...context, endpoint: pathname }
      );
      const data = Array.isArray(result?.data) ? result.data.map((item) => ({
        b64_json: String(item?.b64_json || ""),
        ...(item?.revised_prompt ? { revised_prompt: String(item.revised_prompt).slice(0, 32_000) } : {})
      })).filter((item) => item.b64_json) : [];
      if (!data.length) throw new ExternalImageApiError(502, "empty_image_response", "图片服务没有返回有效图片。 ");
      return jsonResponse(response, 200, { created: Math.floor(now() / 1000), data });
    }

    if (method === "POST" && pathname === "/v1/aieyra/connection/test") {
      const body = await readJsonBody(request, maximumBodyBytes);
      const result = await authorized(
        () => dependencies.testCustomConnection?.(body, context),
        { ...context, endpoint: pathname }
      );
      return jsonResponse(response, result?.ok === true ? 200 : 400, publicOperationResult(result));
    }

    if (method === "PUT" && pathname === "/v1/aieyra/connection/custom") {
      const body = await readJsonBody(request, maximumBodyBytes);
      const result = await authorized(
        () => dependencies.saveCustomConnection?.(body, context),
        { ...context, endpoint: pathname }
      );
      return jsonResponse(response, result?.ok === true ? 200 : 400, publicOperationResult(result));
    }

    if (method === "PATCH" && pathname === "/v1/aieyra/models") {
      const body = await readJsonBody(request, maximumBodyBytes);
      const result = await authorized(
        () => dependencies.selectModels?.(body, context),
        { ...context, endpoint: pathname }
      );
      return jsonResponse(response, result?.ok === true ? 200 : 400, publicOperationResult(result));
    }

    throw new ExternalImageApiError(404, "not_found", "接口不存在。 ");
  }

  async function handleRequest(request, response) {
    let origin = "";
    let controller = null;
    try {
      origin = validateBoundary(request);
      if (String(request.method || "").toUpperCase() === "OPTIONS") {
        response.writeHead(204, {
          "cache-control": "no-store",
          "access-control-allow-origin": origin || baseUrl(),
          "access-control-allow-methods": "GET, POST, PUT, PATCH, OPTIONS",
          "access-control-allow-headers": "authorization, content-type",
          "access-control-max-age": "0",
          vary: "Origin"
        });
        response.end();
        return;
      }
      authenticate(request);
      if (activeRequests >= maximumConcurrent) {
        throw new ExternalImageApiError(429, "concurrency_limit_exceeded", "当前调用已满，请稍后重试。 ");
      }
      activeRequests += 1;
      controller = new AbortController();
      requestControllers.add(controller);
      request.once("aborted", () => controller.abort(new Error("External API client disconnected.")));
      const headers = origin ? { "access-control-allow-origin": origin, vary: "Origin" } : {};
      const originalWriteHead = response.writeHead.bind(response);
      response.writeHead = (statusCode, statusMessageOrHeaders, possibleHeaders) => {
        if (typeof statusMessageOrHeaders === "string") {
          return originalWriteHead(statusCode, statusMessageOrHeaders, { ...headers, ...(possibleHeaders || {}) });
        }
        return originalWriteHead(statusCode, { ...headers, ...(statusMessageOrHeaders || {}) });
      };
      await route(request, response, {
        signal: controller.signal,
        request_id: randomBytes(12).toString("hex"),
        source: String(request.socket?.remoteAddress || "loopback")
      });
    } catch (error) {
      const known = error instanceof ExternalImageApiError;
      const code = known ? error.code : String(error?.code || "internal_error").toLowerCase() === "workspace_activation_required"
        ? "workspace_activation_required"
        : "internal_error";
      const status = known ? error.status : code === "workspace_activation_required" ? 403 : 500;
      const message = known
        ? error.message.trim()
        : code === "workspace_activation_required"
          ? "Aieyra Workspace 授权已失效。"
          : "请求未完成，请在 Aieyra Workspace 中检查连接配置。";
      jsonResponse(response, status, errorPayload(code, message), { connection: "close" });
    } finally {
      if (controller) {
        requestControllers.delete(controller);
        activeRequests = Math.max(0, activeRequests - 1);
      }
    }
  }

  async function start() {
    if (server?.listening) return status();
    server = http.createServer((request, response) => void handleRequest(request, response));
    server.requestTimeout = 90_000;
    server.headersTimeout = 10_000;
    server.keepAliveTimeout = 5_000;
    server.maxHeadersCount = 64;
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        server?.removeListener("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server?.removeListener("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen({ host: "127.0.0.1", port: 0, exclusive: true });
    });
    const address = server.address();
    port = address && typeof address === "object" ? Number(address.port) : 0;
    if (!port) {
      await stop();
      throw new Error("External image API failed to acquire a loopback port.");
    }
    return status();
  }

  async function stop() {
    const activeServer = server;
    server = null;
    port = 0;
    for (const controller of requestControllers) {
      controller.abort(new Error("Aieyra external image API stopped."));
    }
    requestControllers.clear();
    activeRequests = 0;
    rateBuckets.clear();
    if (!activeServer) return;
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      activeServer.close(finish);
      activeServer.closeIdleConnections?.();
      const timer = setTimeout(() => {
        activeServer.closeAllConnections?.();
        finish();
      }, 1_000);
      timer.unref?.();
    });
  }

  function status() {
    return {
      running: Boolean(server?.listening && port),
      baseUrl: baseUrl(),
      host: "127.0.0.1",
      port,
      requiresToken: true,
      maximumBodyBytes,
      maximumConcurrent,
      rateWindowMs,
      rateMaxRequests,
      activeRequests
    };
  }

  function callingPrompt({ includeToken = false } = {}) {
    const endpoint = baseUrl() || "http://127.0.0.1:<port>";
    const authorization = includeToken ? `Authorization: Bearer ${token}` : "Authorization: Bearer <AIEYRA_SESSION_TOKEN>";
    return [
      "通过本机 Aieyra Workspace Agent API 操作程序、配置模型、管理项目并与 Matrix 协作。",
      `Base URL: ${endpoint}`,
      authorization,
      "先调用 GET /health，再 GET /v1/aieyra/tools 获取工具名和说明。POST /v1/aieyra/tools，body={name:'open_tool',arguments:{name:'settings.read'}} 按需读取参数；body={name:'call_tool',arguments:{name:'settings.read',arguments:{}}} 执行。同一套工具供 Matrix 与外部 Agent 使用。",
      "projects.list/create 获得 Matrix 项目 ID；POST /v1/aieyra/matrix，body={operation:'send',projectId,conversationId,prompt,model} 启动任务；同一会话用 status 每 2 秒查询、reply 回答问题、interrupt 停止、compact 压缩、history 读取。工具输出和产物需要独立核验后再发反馈。多个窗口时提供 windowId。",
      "模型连接使用 connection.status/test/configure/activate/adapter；已保存的 profiles 可直接切换，activate=false 仅保存。图片模型用 GET /v1/models。",
      "用 POST /v1/images/generations，JSON 至少包含 prompt，可选 model、size、quality、n，response_format 固定为 b64_json。",
      "若未配置模型，先让用户在 Aieyra Workspace 的“AI 与连接”完成配置；只有用户明确提供供应商 URL 和 Key 时，才可调用 /v1/aieyra/connection/test 与 /v1/aieyra/connection/custom。",
      "不得打印、记录或转发 Bearer 令牌及供应商 Key；结果只使用 data[].b64_json。"
    ].join("\n");
  }

  function skillText() {
    return [
      "---",
      "name: aieyra-image-router",
      "description: Operate Aieyra Workspace through its local Agent API: tools, model settings, projects, Matrix conversations, and images.",
      "---",
      "",
      "# Aieyra Image Router",
      "",
      "Use when the user asks an agent to use or configure Aieyra Workspace.",
      "",
      "1. Ask the user to copy the current 调用提示词 from AI 与连接 > 外部 API and provide it for this session. It contains the current Base URL and temporary Bearer token; never persist, print, or export that token.",
      "2. Call `GET /health`, then `GET /v1/models`.",
      "3. Call `POST /v1/images/generations` with OpenAI-compatible JSON. Use `response_format: \"b64_json\"`.",
      "4. Treat `data[].b64_json` as the only image output. Never expect or expose local filesystem paths.",
      "5. If no image model is configured, ask the user to configure Aieyra official login or a custom provider in the desktop app.",
      "6. Only with explicit user-provided provider credentials may you call the Aieyra connection configuration endpoints. Never save credentials outside Aieyra Workspace.",
      "",
      "## Endpoints",
      "",
      "- `GET /health`",
      "- `GET /v1/aieyra/tools` — tool names and descriptions",
      "- `POST /v1/aieyra/tools` — toolbox / open_tool / call_tool, shared with Matrix",
      "- `POST /v1/aieyra/matrix` — send / status / reply / interrupt / compact / history / conversations",
      "",
      "Discover the inputSchema with open_tool before call_tool. Start with workspace.observe and projects.list. Create a Matrix project with projects.create if needed. Reuse projectId and conversationId across turns; poll status no faster than every 2 seconds. Inspect requests for questions, send reply with requestId and answers. Verify actual outputs before giving follow-up feedback. connection.status includes saved profiles; connection.activate switches without exposing credentials. Detailed calling examples:",
      callingPrompt(),
      "- `GET /v1/models`",
      "- `POST /v1/images/generations`",
      "- `GET /v1/aieyra/connection`",
      "- `POST /v1/aieyra/connection/test`",
      "- `PUT /v1/aieyra/connection/custom`",
      "- `PATCH /v1/aieyra/models`",
      "",
      `Current runtime address when exported: ${baseUrl() || "not running"}`,
      "The port and Bearer token change with the desktop process. This exported skill never contains the token; obtain a fresh 调用提示词 from the user for each session."
    ].join("\n");
  }

  return {
    start,
    stop,
    status,
    rotateToken,
    revealToken,
    callingPrompt,
    skillText
  };
}

module.exports = {
  DEFAULT_MAX_BODY_BYTES,
  DEFAULT_MAX_CONCURRENT,
  DEFAULT_RATE_MAX_REQUESTS,
  DEFAULT_RATE_WINDOW_MS,
  ExternalImageApiError,
  createExternalImageApi,
  publicConnection
};
