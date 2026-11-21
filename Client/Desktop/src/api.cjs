// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: spec; crypto; normalizeBaseUrl; endpointOf; hintFor; readError; providerSessionHeaders; postJson; ping; sample; requestModel; listModels
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/api.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// 设置测试客户端：与 Go 端 Core/api.go 对齐的协议与错误提示。
//
// 用于连接、参数和工具诊断；正式流式执行仍由 Go 客户端负责。
// 但错误分类与修复提示要跟 Go 端一致，否则同一把 Key 在两个程序里
// 会给出不同的解释，用户会以为是两个不同的问题。

'use strict';

const spec = require('./spec.cjs');
const crypto = require('node:crypto');

/** 容错：用户常把完整路径或 /v1 粘进 Base URL。 */
function normalizeBaseUrl(raw) {
  let base = String(raw || '').trim().replace(/\/+$/, '');
  base = base.replace(/\/(chat\/completions|responses)$/, '');
  if (/^https:\/\/api\.deepseek\.com\/v1$/.test(base)) base = base.replace(/\/v1$/, '');
  return base.replace(/\/+$/, '');
}

function endpointOf(baseUrl, protocol = 'responses') {
  return `${normalizeBaseUrl(baseUrl)}/${protocol==='chat_completions'?'chat/completions':protocol==='anthropic_messages'?'messages':'responses'}`;
}

/** 与 Go 端 APIError.Hint 对齐：常见错误码给出可操作的修复建议。 */
function hintFor(status, message) {
  const msg = String(message || '').toLowerCase();
  if (status === 403 && (msg.includes('country') || msg.includes('region') || msg.includes('territory'))) return '当前出口地区被供应商限制，请确认代理已开启并重试；必要时重新打开应用。';
  if (status === 401) return '鉴权失败：请检查 Key 是否完整、是否已被撤销。';
  if (status === 403 && msg.includes('free tier can only be used from within opencode')) return 'OpenCode 免费层限制为其官方客户端使用；此免费模型目前无法从 Aieyra 调用。';
  if (status === 403) return '供应商拒绝访问，请检查当前模型的使用权限。';
  if (status === 402) return '余额不足：请检查当前供应商的余额或订阅，必要时充值。';
  if (status === 422) return '参数非法：通常是 max_tokens 超出上限，或 temperature/top_p 越界。';
  if (status === 429) return '触发限速：请降低并发或稍后重试。';
  if (status === 400 && msg.includes('reasoning_content')) {
    return '缺少 reasoning_content：携带 tools 的请求必须完整回传历史思考内容。';
  }
  if (status === 400 && msg.includes('thinking')) {
    return 'thinking 参数不被接受：请核对当前模型的思考参数与接口协议。';
  }
  if (status === 400 && (msg.includes('model') || msg.includes('模型'))) {
    return '模型请求被拒绝：请核对供应商目录中的模型标识、当前可用性与参数。';
  }
  if (status === 404) {
    return '路径不存在：请核对当前供应商的 Base URL 与接口协议。';
  }
  if (status >= 500) return '服务端错误：官方建议稍后重试。';
  return '';
}

async function readError(resp) {
  let raw = '';
  try {
    raw = await resp.text();
  } catch { /* ignore */ }
  let message = raw.trim();
  let code = '';
  let type = '';
  try {
    const env = JSON.parse(raw);
    if (env && env.error) {
      message = env.error.message || message;
      code = env.error.code || '';
      type = env.error.type || '';
    }
  } catch { /* 非 JSON 就用原文 */ }
  return {
    status: resp.status,
    message,
    code,
    type,
    hint: hintFor(resp.status, message),
  };
}

function providerSessionHeaders(url,session){
 return new URL(url).hostname==='opencode.ai'?{'x-opencode-session':session||'aieyra-check-'+crypto.randomUUID()}:{};
}

async function postJson(url, apiKey, body, timeoutMs, protocol,session) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent':'AieyraOS/0.1.24',
        ...providerSessionHeaders(url,session),
        ...(protocol==='anthropic_messages'?{'x-api-key':apiKey,'anthropic-version':'2023-06-01'}:{}),
        ...(protocol==='google_generate'?{'x-goog-api-key':apiKey}:{}),
        Authorization: `Bearer ${String(apiKey || '').trim()}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
      redirect: 'error',
    });
    if (!resp.ok) {
      const err = await readError(resp);
      const e = new Error(err.message || `HTTP ${resp.status}`);
      e.apiError = err;
      throw e;
    }
    let size=0;const chunks=[];for await(const chunk of resp.body){size+=chunk.length;if(size>4*1024*1024)throw Error('响应超过4MiB');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (err) {
    if (err.name === 'AbortError') {
      const e = new Error(`请求超时（${Math.round(timeoutMs / 1000)} 秒）`);
      e.apiError = { status: 0, message: e.message, hint: '请检查网络、代理或供应商响应状态。' };
      throw e;
    }
    if (err.apiError) throw err;
    const e = new Error(`网络请求失败：${err.message}`);
    e.apiError = {
      status: 0,
      message: e.message,
      hint: '检查网络连通性、代理设置，以及 Base URL 是否写对。',
    };
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 测试连接。
 *
 * 用 max_tokens=1 的最小请求验证 Key、Base URL、模型名三者，
 * 比单独请求 /models 更接近真实调用链路。
 */
async function ping(settings) {
  const url = settings.api_protocol==='google_generate'? normalizeBaseUrl(settings.base_url)+'/models/'+encodeURIComponent(settings.model)+':generateContent' : endpointOf(settings.base_url,settings.api_protocol);
  const budget=Number(settings.model_options?.reasoning_budget)||0;
  if(budget>3840)throw Error('当前思考预算超过短测试上限；请暂时设为 3840 或以下后测试');
  const limit=settings.api_profiles?.find(p=>p.id===settings.active_profile)?.output_limit||4096;
  const output=settings.adapter==='openai'?Math.min(limit,settings.max_tokens||4096,Math.max(1024,budget+256)):1;
  if(budget&&output<=budget)throw Error('测试输出上限必须大于思考预算');
  const body = spec.buildRequest({...settings,max_tokens:output,...(settings.adapter==='openai'?{}:{thinking_type:'disabled',temperature:0,response_format:'text'})},[{role:'user',content:'Reply with OK in one short sentence.'}],false);
  const started = Date.now();
  const reply = await requestModel(settings, body);
  if((!settings.api_protocol||settings.api_protocol==='responses') && !['completed','incomplete'].includes(reply.status))throw new Error('Responses 未返回有效终止状态');
  if(settings.api_protocol==='anthropic_messages' && (!reply.id||!reply.stop_reason||!Array.isArray(reply.content)))throw Error('Messages response is incomplete');
  if(settings.api_protocol==='google_generate' && !reply.candidates?.[0]?.finishReason)throw Error('Google response is incomplete');
  if(settings.api_protocol==='chat_completions' && !reply.choices?.[0]?.finish_reason)throw Error('Chat response is incomplete');
  return {
    ok: true,
    endpoint: settings.api_profiles?.find(p=>p.id===settings.active_profile)?.adapter_package?undefined:url,
    model: settings.model,
    elapsedMs: Date.now() - started,
  };
}

// Matrix参数探测保留被测参数，只限制测试输出，不读取个人提示词。
async function sample(settings){
 const base=normalizeBaseUrl(settings.base_url),protocol=settings.api_protocol;
 const url=protocol==='google_generate'?base+'/models/'+encodeURIComponent(settings.model)+':generateContent':endpointOf(base,protocol);
 const body=spec.buildRequest(settings,[{role:'user',content:settings.response_format==='json_object'?'Return a JSON object with ok:true.':'Reply OK, briefly.'}],false);
 const started=Date.now();const data=await requestModel(settings,body,Math.min(20000,(settings.request_timeout_seconds||20)*1000));
 if(protocol==='responses'&&!['completed','incomplete'].includes(data.status)||protocol==='chat_completions'&&!data.choices?.[0]?.finish_reason||protocol==='anthropic_messages'&&!data.stop_reason||protocol==='google_generate'&&!data.candidates?.[0]?.finishReason)throw Error('探测响应不完整');
 return {ok:true,elapsedMs:Date.now()-started};
}

async function requestModel(settings,body,timeoutMs=72000){
 if(settings.api_profiles?.find(p=>p.id===settings.active_profile)?.adapter_package)return require('./model-diagnostic-worker.cjs').request(settings,body,timeoutMs);
 const base=normalizeBaseUrl(settings.base_url),protocol=settings.api_protocol;
 const url=protocol==='google_generate'?base+'/models/'+encodeURIComponent(settings.model)+':generateContent':endpointOf(base,protocol);
 const key=require('./runtime-credential.cjs').keyFor(settings);
 try{return await postJson(url,key,body,timeoutMs,protocol,settings.__diagnostic_session);}catch(e){
  if(key){e.message=String(e.message).replaceAll(key,'[redacted]');if(e.apiError)for(const k of ['message','hint','code','type'])if(typeof e.apiError[k]==='string')e.apiError[k]=e.apiError[k].replaceAll(key,'[redacted]');}throw e;
 }
}

/** 列出模型（官方 /models 接口），用于确认 Key 有效。 */
async function listModels(settings) {
  const base = normalizeBaseUrl(settings.base_url);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const resp = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${String(settings.api_key || '').trim()}` },
      signal: ctrl.signal,
      redirect: 'error',
    });
    if (!resp.ok) {
      const err = await readError(resp);
      const e = new Error(err.message || `HTTP ${resp.status}`);
      e.apiError = err;
      throw e;
    }
    const data = await resp.json();
    return (data && data.data) || [];
  } catch (err) {
    if (err.name === 'AbortError') {
      const e = new Error('请求超时');
      e.apiError = { status: 0, message: '请求超时', hint: '' };
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  providerSessionHeaders,
  normalizeBaseUrl,
  endpointOf,
  hintFor,
  ping,
  sample,
  requestModel,
  listModels,
  requestPreview: spec.requestPreview,
};
