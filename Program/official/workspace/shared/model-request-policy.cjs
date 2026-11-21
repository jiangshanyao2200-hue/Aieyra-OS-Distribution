"use strict";

const { modelRequestPolicy } = require("./model-request-settings.mjs");

function modelRequestRateLimited(error) {
  const status = Number(error?.status || error?.statusCode || 0);
  const text = `${error?.code || ""} ${error?.message || error || ""}`;
  // Some Responses relays send a concurrency error inside an HTTP 200 stream.
  return status === 429 || /rate[_ -]?limit|too many requests|concurren(?:cy|t)[_ -]limit|too many concurrent|并发.{0,8}(?:超|满|限制)|限流|频率过高/i.test(text);
}

function modelRequestRetryable(error) {
  const status = Number(error?.status || error?.statusCode || 0);
  const text = `${error?.code || ""} ${error?.cause?.code || ""} ${error?.message || error || ""}`;
  if (/AbortError|cancelled|canceled|取消|登录.*失效|连接已切换|AUTH_SCOPE|PROVIDER_CHANGED/i.test(text)) return false;
  if ([400, 401, 402, 403, 404, 413, 422].includes(status) || /insufficient_quota|billing|permission|content_policy|max_output_tokens|context_length|额度不足|余额不足|参数.*无效/i.test(text)) return false;
  if ([408, 409, 425].includes(status) || status >= 500 || modelRequestRateLimited(error)) return true;
  return /timeout|timed.?out|超时|超过.*秒|没有返回新事件|ECONN|ENET|EHOST|EPIPE|EAI_AGAIN|socket|fetch failed|network|UND_ERR|NEW_API_(?:TIMEOUT|INVALID_SSE|STREAM_INCOMPLETE)|response.failed|server_error|temporarily|暂时不可用/i.test(text);
}

function waitForModelRetry(ms, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(signal.reason || Object.assign(new Error("任务已取消。"), { name: "AbortError" })); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}

// Retry one model request, never the enclosing task or its executed tools.
async function withModelRequestRetry(request, { settings, signal, onRetry, delay = waitForModelRetry } = {}) {
  const { modelMaxRetries } = modelRequestPolicy(settings);
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw signal.reason || Object.assign(new Error("任务已取消。"), { name: "AbortError" });
    try { return await request(attempt); }
    catch (error) {
      if (signal?.aborted || attempt >= modelMaxRetries || !modelRequestRetryable(error)) throw error;
      const retryAfter = Number(error?.retryAfterMs || 0);
      const delayMs = Math.min(60000, Math.max(retryAfter, Math.round(Math.min(15000, 1000 * 2 ** attempt) * (.85 + Math.random() * .3))));
      onRetry?.({ attempt: attempt + 1, maxRetries: modelMaxRetries, delayMs, error });
      await delay(delayMs, signal);
    }
  }
}

module.exports = { modelRequestPolicy, modelRequestRateLimited, modelRequestRetryable, withModelRequestRetry, waitForModelRetry };
