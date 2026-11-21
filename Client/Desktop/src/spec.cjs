// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: MAX_TOKENS_LIMIT; MAX_TOKENS_THINK; MAX_TOKENS_PLAIN; TOP_P_MIN; TOP_P_MAX; TEMP_MIN; TEMP_MAX; DEFAULT_BASE_URL; EFFORT_CANONICAL; EFFORT_ALIASES; EFFORTS; EFFORT_HELP; MODELS; LEGACY_MODEL_ALIASES; MODEL_IDS; lookupModel; GROUPS; FIELD_MAP; defaults; resetSettings; normalizedEffort; maskKey; validate; warnings; sanitize; buildRequest; buildResponsesRequest; requestPreview; renderSpec; truthy; isOn; evaluateRule; fieldState
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/spec.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// 参数规范：DeepSeek 官方思考控制；采样仅兼容读取旧配置。
//
// 这个文件是 Go 端 Core/types.go + Core/api.go 的镜像。两侧必须表达同一套语义：
// 界面只开放思考和上下文配置，请求由供应商使用默认采样。
//
// 改动此文件时，务必同步检查 Core/types.go 的 Validate / Warnings / Sanitize
// 以及 Core/api.go 的 BuildRequest。

'use strict';

// —— 官方常量（与 Core/types.go 对齐）——

const MAX_TOKENS_LIMIT = 393216; // 384K
const MAX_TOKENS_THINK = 65536; // 思考模式默认输出上限
const MAX_TOKENS_PLAIN = 8192; // 非思考模式默认输出上限
const TOP_P_MIN = 0.01;
const TOP_P_MAX = 1.0;
const TEMP_MIN = 0.0;
const TEMP_MAX = 2.0;
const DEFAULT_BASE_URL = 'https://api.deepseek.com';

// reasoning_effort 的合法取值，与 Go 端 types.go 的 ValidEfforts 一致。
//
// 分两段是有原因的：canonical 会原样发给 API，alias 是官方接受的别名，
// 发送前由 normalizedEffort 归一。sanitize（落盘清洗）与 validate（校验）
// 必须用同一份清单——分开各写一份就会漂移，ultra 曾经就是这样一边被接受、
// 一边被静默改回 high 的。
const EFFORT_CANONICAL = ['none', 'low', 'high', 'max'];
const EFFORT_ALIASES = ['minimal', 'medium', 'xhigh', 'ultra'];
const EFFORTS = [...EFFORT_CANONICAL, ...EFFORT_ALIASES];
const EFFORT_HELP = `${EFFORT_CANONICAL.join(' / ')}（别名 ${EFFORT_ALIASES.join(' / ')} 也接受）`;

// —— 官方模型清单（来源：/zh-cn/quick_start/pricing）——

const MODELS = [
  {
    id: 'deepseek-flash',
    name: 'DeepSeek Flash',
    version: 'DeepSeek-V4.1-Flash',
    vision: true,
    jsonMode: true,
    toolCalls: true,
    fim: true,
    concurrency: 2500,
    note: '支持图像理解，单价更低，日常首选',
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    version: 'DeepSeek-V4-Pro-0813',
    vision: false,
    jsonMode: true,
    toolCalls: true,
    fim: true,
    concurrency: 500,
    note: '不支持图像理解，推理更强',
  },
];

/** 已下线的旧模型名 → 现役替代。实测仍可调用（由在售模型接管）。 */
const LEGACY_MODEL_ALIASES = {
  'deepseek-chat': 'deepseek-flash',
  'deepseek-reasoner': 'deepseek-flash',
  'deepseek-v4-flash': 'deepseek-flash',
  'deepseek-v4-flash-vision-exp': 'deepseek-flash',
};

const MODEL_IDS = MODELS.map((m) => m.id);

function lookupModel(id) {
  return MODELS.find((m) => m.id === id) || null;
}

// —— 字段定义 ——
//
// kind 决定渲染成什么控件：
//   text   单行文本（secret 为 true 时用密码框）
//   textarea 多行文本
//   number 数字步进
//   bool   开关
//   enum   分段选择
//   model  模型卡片选择
//   path   路径输入 + 打开按钮
//   action 按钮
//
// inactive(s) 返回 true 时该字段在当前配置下不生效，界面必须置灰并说明原因。
// note(s) 返回动态说明，用于解释"为什么置灰"或"当前实际生效值是多少"。

// inactiveRule / noteRule 是**声明式**规则而不是函数：
// 这些字段规范要经 IPC 传给渲染层，而结构化克隆不能传函数。
// 渲染层用同一套 evaluateRule 解释它们，因此两侧判断永远一致。

const GROUPS = [
  {
    id: 'api',
    title: 'API 连接',
    hint: '通往 DeepSeek 的链路',
    fields: [
      {
        key: 'api_key',
        label: 'API Key',
        kind: 'text',
        secret: true,
        help: 'sk- 开头。保存后写入配置文件，界面只显示脱敏形式。',
        placeholder: 'sk-...',
        noteRule: { computed: 'maskedKey' },
      },
      {
        key: 'base_url',
        label: 'Base URL',
        kind: 'text',
        help: 'OpenAI 兼容入口。Anthropic 格式为 https://api.deepseek.com/anthropic',
        placeholder: DEFAULT_BASE_URL,
        mono: true,
      },
      {
        key: 'user_id',
        label: '用户标识',
        kind: 'text',
        help: '官方参数 user_id，字符集 [a-zA-Z0-9-_]，影响 KVCache 隔离与调度。留空则不发送。',
        placeholder: '留空不发送',
        mono: true,
      },
      {
        key: 'request_timeout_seconds',
        label: '请求超时',
        kind: 'number',
        min: 10,
        max: 3600,
        step: 10,
        unit: '秒',
        help: '单次请求的最长等待时间。低于 10 秒会被重置为默认 300 秒。',
      },
    ],
  },
  {
    id: 'model',
    title: '模型与推理',
    hint: '选谁来说话，以及它想多深',
    fields: [
      { key: 'model', label: '模型', kind: 'model' },
      {
        key: 'thinking_type',
        label: '思考模式 thinking.type',
        kind: 'enum',
        options: [
          { value: 'enabled', label: '开启' },
          { value: 'disabled', label: '关闭' },
        ],
        help: '官方默认开启。开启后模型先输出思维链再作答；关闭则不会产生思考内容，'
          + '对话界面也就没有思考可显示（思考强度只在开启后生效）。',
        noteRule: { whenOff: 'thinking_type' },
      },
      {
        key: 'reasoning_effort',
        label: '思考强度',
        kind: 'enum',
        // 选项从 EFFORT_CANONICAL 生成：手写子集会漏掉 none（S1），
        // 磁盘上合法的 none 在界面上就没有选中项。
        options: EFFORT_CANONICAL.map((v) => ({ value: v, label: v })),
        help: '官方别名：minimal→low，medium/xhigh→high，ultra→max。none 仅兼容旧配置。',
        inactiveRule: { unlessEquals: { key: 'thinking_type', value: 'enabled' } },
        inactiveReason: '仅在思考模式下生效',
      },
      {
        key: 'max_tokens',
        label: '最大输出 max_tokens',
        kind: 'number',
        min: 0,
        max: MAX_TOKENS_LIMIT,
        step: 1024,
        zeroLabel: '服务端默认',
        help: `范围 1~${MAX_TOKENS_LIMIT}（384K）。0 表示交给服务端默认规则。`,
        noteRule: { computed: 'effectiveMaxTokens' },
      },
      {
        key: 'show_reasoning',
        label: '显示思考链',
        kind: 'bool',
        help: '从近期思考随机显示少量片段，快流跳过；工具或正文到达即隐藏，不等待显示完。',
      },
    ],
  },
  {
    id: 'request',
    title: '请求行为',
    hint: '怎么发出去',
    fields: [
      {
        key: 'stream',
        label: '流式输出 stream',
        kind: 'bool',
        help: '以 SSE 逐字返回。必须开启才能使用 stream_options。',
      },
      {
        key: 'stream_include_usage',
        label: '返回用量',
        kind: 'bool',
        help: '官方 stream_options.include_usage，在流式响应里附带 token 统计。',
        inactiveRule: { whenOff: 'stream' },
        inactiveReason: '需要先开启「流式输出」，否则官方会返回 400',
      },
      {
        key: 'response_format',
        label: '输出格式',
        kind: 'enum',
        options: [
          { value: 'text', label: 'text' },
          { value: 'json_object', label: 'json_object' },
        ],
        help: '官方 response_format。json_object 需在系统提示词中明确要求输出 JSON，否则可能一直输出空白直到截断。',
      },
      {key:'compact_percent',label:'自动压缩 Compact',kind:'number',min:0,max:90,step:5},
      {key:'compact_keep_turns',label:'保留原文 Keep Turns',kind:'number',min:1,max:20,step:1},
      {
        key: 'context_messages',
        label: '旧消息数（兼容）',
        kind: 'number',
        min: 0,
        max: 1000,
        step: 10,
        zeroLabel: '不裁剪',
        help: '仅保留旧配置值；不再裁剪历史。',
      },
    ],
  },
  {
    id: 'prompt',
    title: '提示词',
    hint: '它是谁',
    fields: [
      {
        key: 'prompt_dir',
        label: '提示词目录',
        kind: 'path',
        help: '外部提示词所在目录。留空表示按优先级自动查找。',
        noteRule: { computed: 'promptDir' },
      },
      {
        key: 'system_prompt',
        label: '系统提示词',
        kind: 'textarea',
        help: '作为 system 消息置于对话最前。留空表示使用外部提示词文件。',
        placeholder: '留空 = 使用 Prompt/ 目录下的外部提示词',
      },
    ],
  },
];

/** 打平后的字段表，便于按 key 查找。 */
const FIELD_MAP = {};
for (const g of GROUPS) {
  for (const f of g.fields) {
    FIELD_MAP[f.key] = { ...f, group: g.id };
  }
}

/** 默认出厂配置：与 Go 端 Defaults() 一致。 */
function defaults() { return require('./resources.cjs').defaults(); }

/**
 * 恢复出厂参数，但保留凭据与提示词目录。
 *
 * 与 Go 端配置中心的 fReset 行为一致：Key 和提示词目录是用户好不容易填好的，
 * 「恢复默认值」不应该把它们一起抹掉。
 */
function resetSettings(current) {
  const cur = current || {};
  const d = defaults();
  d.api_key = typeof cur.api_key === 'string' ? cur.api_key : '';
  d.api_key_history = Array.isArray(cur.api_key_history) ? cur.api_key_history.slice() : [];
  d.prompt_dir = typeof cur.prompt_dir === 'string' ? cur.prompt_dir : '';
  for(const key of ['user_connections','user_connection_drafts','aieyra_key_drafts'])d[key]=structuredClone(cur[key]||{});
  return d;
}

/** 与 Go 端 EffectiveMaxTokens 一致。 */function effectiveMaxTokens(s) {
  if (s.max_tokens > 0) return s.max_tokens;
  if (s.thinking_type === 'enabled') {
    return s.reasoning_effort === 'max' ? 131072 : MAX_TOKENS_THINK;
  }
  return MAX_TOKENS_PLAIN;
}

/** 与 Go 端 NormalizedEffort 一致。 */
function normalizedEffort(s) {
  switch (s.reasoning_effort) {
    case 'minimal': return 'low';
    case 'medium':
    case 'xhigh': return 'high';
    case 'ultra': return 'max';
    default: return s.reasoning_effort;
  }
}

/** 与 Go 端 MaskKey 一致：只留前 4 后 4。 */
function maskKey(k) {
  const t = String(k || '').trim();
  if (!t) return '（未设置）';
  if (t.length <= 8) return '*'.repeat(t.length);
  return `${t.slice(0, 4)}${'*'.repeat(8)}${t.slice(-4)}`;
}

/** 校验：返回错误文案数组，空数组表示通过。顺序与 Go 端 Validate 一致。 */
function validate(s, {requireKey=true}={}) {
  const errs = [];
  try {require('./model-pool.cjs').validate(s,requireKey);}catch(e){errs.push(e.message);}
  if (s.language && !['zh-CN','en-US'].includes(s.language)) errs.push('language: zh-CN / en-US');
  if (s.adapter && !['deepseek','openai'].includes(s.adapter)) errs.push('adapter: deepseek / openai');
  if (s.adapter === 'openai' && (!String(s.model || '').trim() || !Number.isInteger(s.model_context_window) || s.model_context_window < 8192)) errs.push('通用模型需要模型名称和有效上下文窗口');
  if (s.api_protocol && !['responses','chat_completions','anthropic_messages','google_generate'].includes(s.api_protocol)) errs.push('api_protocol 仅支持 responses / chat_completions / anthropic_messages / google_generate');
  if (requireKey && !String(s.api_key || '').trim()) errs.push('API Key 为空，请填写后再保存');
  const base = String(s.base_url || '').trim();
  if (!base) errs.push('Base URL 为空');
  else if (!/^https?:\/\//.test(base)) errs.push('Base URL 必须以 http:// 或 https:// 开头');
  // 与 Go 端 Validate 一致：明文 http 只允许本地回环（Bearer Key 会裸奔）。
  else if (/^http:\/\//.test(base)) {
    const host = base.replace(/^http:\/\//, '').split(/[/:?]/)[0].toLowerCase();
    if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
      errs.push(`Base URL 为明文 http（${base}）：只允许 localhost/127.0.0.1，自建网关请用 https 或本地代理`);
    }
  }

  if (s.adapter !== 'openai' && !lookupModel(s.model)) {
    const alt = LEGACY_MODEL_ALIASES[s.model];
    if (alt) errs.push(`${s.model} 是已下线的旧模型名，请改用 ${alt}`);
    else errs.push(`未知模型 ${s.model}，可选：${MODEL_IDS.join(' / ')}`);
  }

  const mt = Number(s.max_tokens);
  if (!Number.isFinite(mt) || mt < 0 || mt > MAX_TOKENS_LIMIT) {
    errs.push(`max_tokens 需在 0~${MAX_TOKENS_LIMIT} 之间（0 表示使用服务端默认值）`);
  }
  const t = Number(s.temperature);
  if (!Number.isFinite(t) || t < TEMP_MIN || t > TEMP_MAX) {
    errs.push(`temperature 需在 ${TEMP_MIN}~${TEMP_MAX} 之间`);
  }
  const p = Number(s.top_p);
  if (!Number.isFinite(p) || p < TOP_P_MIN || p > TOP_P_MAX) {
    errs.push(`top_p 需大于 0 且不超过 ${TOP_P_MAX}`);
  }
  if (!['enabled', 'disabled'].includes(s.thinking_type)) {
    errs.push('thinking.type 只能是 enabled 或 disabled');
  }
  if (!EFFORTS.includes(s.reasoning_effort)) {
    errs.push(`reasoning_effort 只能是 ${EFFORT_HELP}`);
  }
  if (!['text', 'json_object'].includes(s.response_format)) {
    errs.push('response_format 只能是 text 或 json_object');
  }
  const to = Number(s.request_timeout_seconds);
  if (!Number.isFinite(to) || to < 10) errs.push('请求超时至少 10 秒');
  else if (to > 3600) errs.push('请求超时至多 3600 秒');
  const cm = Number(s.context_messages);
  if (!Number.isFinite(cm) || cm < 0) errs.push('上下文消息数不能为负数');
  else if (cm > 1000) errs.push('上下文消息数至多 1000 条');
  const cp = Number(s.compact_percent), kt = Number(s.compact_keep_turns);
  if(!Number.isInteger(s.context_working_tokens)||s.context_working_tokens<8192||s.context_working_tokens>1000000)errs.push('工作上下文预算需在 8192–1000000 tokens');
  if(!Number.isInteger(s.memory_surface_tokens)||s.memory_surface_tokens<256||s.memory_surface_tokens>3000)errs.push('表层记忆预算需在 256–3000 tokens');
  for(const key of ['memory_enabled','dreams_enabled'])if(typeof s[key]!=='boolean')errs.push('记忆与梦境设置必须为开关');
  if (!Number.isInteger(cp) || (cp !== 0 && (cp < 25 || cp > 90))) errs.push('自动压缩阈值应为 25–90%，或 0 关闭');
  if (!Number.isInteger(kt) || kt < 1 || kt > 20) errs.push('保留原文轮次应为 1–20');
  return errs;
}

/** 提示（不阻塞保存）：官方语义导致"调了但没效果"的情况，必须如实告知。 */
function warnings(s) {
  const out = [];
  if(s.adapter==='openai')return out;
  if (s.response_format === 'json_object') {
    out.push('JSON 模式需在系统提示词中明确要求输出 JSON，否则可能持续输出空白直至截断');
  }
  if (Number(s.max_tokens) === 0) {
    out.push(`max_tokens 未设置，将由服务端决定（本地估计 ${effectiveMaxTokens(s)}，仅供显示）`);
  }
  if (s._migratedModel) {
    out.push(`模型 ${s._migratedModel} 已下线，已自动迁移为 ${s.model}（保存后生效）`);
  }
  if (!String(s.api_key || '').trim()) {
    out.push('尚未配置 API Key，无法发起对话');
  }
  return out;
}

/** 自愈：把越界值夹回合法范围。与 Go 端 Sanitize 一致，且同样不用文案回填提示词。 */
function sanitize(s) {
  // 先归一空白，再判空。校验那边是看 trim 后的值的，若这里不归一，
  // "  https://api.deepseek.com  " 会通过校验、原样落盘，再被 Go 端拒掉
  // ——同一份配置两个程序给出相反结论。
  if (typeof s.base_url === 'string') s.base_url = s.base_url.trim();
  if (typeof s.model === 'string') s.model = s.model.trim();
  if (typeof s.prompt_dir === 'string') s.prompt_dir = s.prompt_dir.trim();
  if (!s.base_url) s.base_url = DEFAULT_BASE_URL;
  // 与 Go 端 Sanitize 一致：旧模型名自动迁移，但留下 _migratedModel，
  // 让 warnings 能响亮提示，而不是静默改掉用户输入。
  // _migratedModel 以下划线开头：config.cjs 保存时只落盘已知字段，它不会进文件。
  if (!s.model) s.model = 'deepseek-flash';
  else if (s.adapter !== 'openai' && !lookupModel(s.model)) {
    if (LEGACY_MODEL_ALIASES[s.model]) {
      if (!s._migratedModel) s._migratedModel = s.model;
      s.model = LEGACY_MODEL_ALIASES[s.model];
    } else {
      s.model = 'deepseek-flash';
    }
  }

  const num = (v, lo, hi, dflt) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return dflt;
    return Math.min(Math.max(n, lo), hi);
  };
  s.temperature = num(s.temperature, TEMP_MIN, TEMP_MAX, 1);
  s.top_p = num(s.top_p, TOP_P_MIN, TOP_P_MAX, 1);
  s.max_tokens = Math.round(num(s.max_tokens, 0, MAX_TOKENS_LIMIT, 0));
  s.context_messages = Math.round(num(s.context_messages, 0, 1000, 40));
  s.compact_percent = Number(s.compact_percent ?? 90);
  s.context_working_tokens=Number(s.context_working_tokens??200000);
  if(!Number.isInteger(s.context_working_tokens)||s.context_working_tokens<8192||s.context_working_tokens>1000000)s.context_working_tokens=200000;
  s.memory_surface_tokens=Number(s.memory_surface_tokens??1500);
  if(!Number.isInteger(s.memory_surface_tokens)||s.memory_surface_tokens<256||s.memory_surface_tokens>3000)s.memory_surface_tokens=1500;
  for(const key of ['memory_enabled','dreams_enabled'])if(typeof s[key]!=='boolean')s[key]=true;
  // 模型连接的角色键：磁盘上的坏值回到默认；引用是否仍在模型池由 model-pool.cjs 清理。
  for(const key of ['matrix_alternates','image_profiles'])s[key]=Array.isArray(s[key])?[...new Set(s[key].filter(v=>typeof v==='string'&&v&&v.length<=200))].slice(0,16):[];
  for(const key of ['vision_profile','execution_profile','video_profile'])if(typeof s[key]!=='string')s[key]='';
  // Vaya、Cota 的工具：没写就用默认（不落盘）；写了就是字符串数组。
  for(const key of ['vision_tools','execution_tools']){if(s[key]===null||s[key]!==undefined&&!Array.isArray(s[key]))delete s[key];else if(Array.isArray(s[key]))s[key]=[...new Set(s[key].filter(v=>typeof v==='string'&&v.length<=40))].slice(0,16);}
  if(typeof s.collaboration_enabled!=='boolean')s.collaboration_enabled=true;
  for(const key of ['vision_enabled','execution_enabled'])if(typeof s[key]!=='boolean')delete s[key];
  delete s.workspace_profile;
  s.image_profiles=s.image_profiles.slice(0,1);
  s.image_generation_enabled=s.image_profiles.length>0;
  if (!Number.isInteger(s.compact_percent) || (s.compact_percent !== 0 && (s.compact_percent < 25 || s.compact_percent > 90))) s.compact_percent = 90;
  s.compact_keep_turns = Number(s.compact_keep_turns ?? 4);
  if (!Number.isInteger(s.compact_keep_turns) || s.compact_keep_turns < 1 || s.compact_keep_turns > 20) s.compact_keep_turns = 4;

  // 超时与 Go 端一致：低于下界不是"夹到 10"，而是重置为默认 300。
  // 这两者行为不同——夹到 10 会让请求几乎必然超时，等于把配置改坏。
  const to = Number(s.request_timeout_seconds);
  if (!Number.isFinite(to) || to < 10) s.request_timeout_seconds = 300;
  else if (to > 3600) s.request_timeout_seconds = 3600;

  if (!['enabled', 'disabled'].includes(s.thinking_type)) s.thinking_type = 'enabled';
  if (!EFFORTS.includes(s.reasoning_effort)) {
    s.reasoning_effort = 'high';
  }
  if (!['text', 'json_object'].includes(s.response_format)) s.response_format = 'text';
  if (typeof s.stream !== 'boolean') s.stream = true;
  if (typeof s.show_reasoning !== 'boolean') s.show_reasoning = true;
  if (typeof s.include_usage !== 'boolean' && typeof s.stream_include_usage !== 'boolean') {
    s.stream_include_usage = true;
  }
  if (!Array.isArray(s.api_key_history)) s.api_key_history = [];
  return s;
}

/**
 * 与 Go 端 BuildRequest 一致：构造真正会发出去的请求体。
 *
 * 旧采样值不会发送；思考控制仍遵循当前协议的官方字段。
 */
function buildRequest(s, messages, stream) {
  if (s.api_protocol==='anthropic_messages'||s.api_protocol==='google_generate') return require('./native-protocols.cjs').buildRequest(s,messages,stream);
  if (!s.api_protocol || s.api_protocol==='responses') return buildResponsesRequest(s,messages,stream);
  if(new URL(s.base_url).hostname==='opencode.ai')messages=messages.map(({name,...message})=>message);
  const req = {
    model: s.model,
    messages,
    stream: !!stream,
  };
  if (s.adapter === 'openai') { if(new URL(s.base_url).hostname==='openrouter.ai')req.provider={require_parameters:true}; if(stream&&s.stream_include_usage)req.stream_options={include_usage:true}; if (s.max_tokens > 0) req.max_tokens = s.max_tokens; if (s.response_format === 'json_object') req.response_format = {type:'json_object'}; return require('./model-capabilities.cjs').apply(s,req); }
  const thinking = { type: s.thinking_type };
  if (s.thinking_type === 'enabled') {
    const effort = normalizedEffort(s);
    thinking.reasoning_effort = effort;
    req.reasoning_effort = effort;
  }
  req.thinking = thinking;

  if (Number(s.max_tokens) > 0) req.max_tokens = Number(s.max_tokens);
  if (s.response_format === 'json_object') req.response_format = { type: 'json_object' };
  if (String(s.user_id || '').trim()) req.user_id = String(s.user_id).trim();
  if (stream && s.stream_include_usage) req.stream_options = { include_usage: true };

  return require('./parameter-descriptors.cjs').apply(s,req);
}

function buildResponsesRequest(s,messages,stream) {
  const req={model:s.model,input:messages.map(m=>({type:'message',role:m.role,content:m.content})),stream:!!stream,reasoning:{effort:s.thinking_type==='enabled'?normalizedEffort(s):'none'}};
  if (s.adapter === 'openai') { delete req.reasoning; req.store=false; if(new URL(s.base_url).hostname==='opencode.ai'||/^gpt-/.test(String(s.model).replace(/^openai\//,'')))req.include=['reasoning.encrypted_content']; if(s.max_tokens>0)req.max_output_tokens=s.max_tokens; if(s.response_format==='json_object')req.text={format:{type:'json_object'}}; return require('./model-capabilities.cjs').apply(s,req); }
  if(Number(s.max_tokens)>0)req.max_output_tokens=Number(s.max_tokens);
  if(s.response_format==='json_object')req.text={format:{type:'json_object'}};
  if(String(s.user_id||'').trim())req.user=String(s.user_id).trim();
  return require('./parameter-descriptors.cjs').apply(s,req);
}

/** 请求体预览：给界面展示"到底会发什么"，与 buildRequest 用同一份逻辑。 */
function requestPreview(s) {
  const msgs = [];
  const sys = String(s.system_prompt || '').trim() || '（来自外部提示词文件）';
  msgs.push({ role: 'system', content: sys });
  msgs.push({ role: 'user', content: '（你的消息）' });
  return buildRequest(s, msgs, !!s.stream);
}

/**
 * 渲染层需要的规范：**只含可结构化克隆的数据**。
 *
 * IPC 不能传函数——Electron 的结构化克隆会直接抛
 * "An object could not be cloned"。所以字段的置灰与说明都不能用闭包，
 * 必须降级成声明式规则，由 evaluateRule 在两侧解释。
 *
 * 好处不只是能传过去：规则变成数据后，渲染层在用户切开关时可以本地实时
 * 判断置灰，不需要为每次交互往返一次主进程。
 */
function renderSpec() {
  return GROUPS.map((g) => ({
    id: g.id,
    title: g.title,
    hint: g.hint,
    fields: g.fields.map((f) => ({
      key: f.key,
      label: f.label,
      kind: f.kind,
      help: f.help || '',
      placeholder: f.placeholder || '',
      mono: !!f.mono,
      secret: !!f.secret,
      unit: f.unit || '',
      zeroLabel: f.zeroLabel || '',
      min: f.min,
      max: f.max,
      step: f.step,
      decimals: f.decimals,
      options: f.options || null,
      inactiveRule: f.inactiveRule || null,
      inactiveReason: f.inactiveReason || '',
      noteRule: f.noteRule || null,
    })),
  }));
}

/**
 * 解释一条规则。
 *
 * 支持的形态：
 *   { whenOff: 'stream' }        该字段为假值（false/0/''/null）时置灰
 *   { whenOn: 'stream' }         该字段为真值（true/1/'enabled'）时置灰
 *   { whenEquals: { key, value } }     该字段等于指定值时置灰
 *   { unlessEquals: { key, value } }   该字段不等于指定值时置灰
 *   { always: '文案' }            恒为提示
 *   { computed: 'effectiveMaxTokens' | 'promptDir' | 'maskedKey' }
 *
 * 为什么要区分 whenOff 与 whenOn：省电开关是布尔（false/true），
 * 而 thinking_type 是字符串枚举（'enabled'/'disabled'），
 * **两个值都是非空字符串**。用单一的"真假值"判断处理枚举，
 * 'disabled' 会被当成"开着"，置灰逻辑整个反掉。
 */
function truthy(v) {
  return !(v === false || v === 0 || v === '' || v === null || v === undefined);
}

function isOn(v) {
  return v === true || v === 1 || v === 'enabled' || v === 'on';
}

function evaluateRule(rule, s, ctx) {
  if (!rule) return { active: true, text: '' };
  if (rule.always) return { active: true, text: rule.always };
  // 枚举必须走等值比较：'enabled'/'disabled' 都是非空字符串，
  // 任何基于"真假值"的判断都会把 'disabled' 当成开着，置灰逻辑整个反掉。
  if (rule.whenEquals) {
    return { active: s[rule.whenEquals.key] !== rule.whenEquals.value, text: '' };
  }
  if (rule.unlessEquals) {
    return { active: s[rule.unlessEquals.key] === rule.unlessEquals.value, text: '' };
  }
  if (rule.whenOff) return { active: truthy(s[rule.whenOff]), text: '' };
  if (rule.whenOn) return { active: !isOn(s[rule.whenOn]), text: '' };
  if (rule.computed) {
    switch (rule.computed) {
      case 'effectiveMaxTokens':
        return { active: true, text: `当前按官方默认规则生效：${effectiveMaxTokens(s)}` };
      case 'promptDir': {
        const dir = (ctx && ctx.resolvedPromptDir) || s.prompt_dir || '';
        return { active: true, text: `实际读取：${dir || '（未解析）'}` };
      }
      case 'maskedKey':
        return { active: true, text: maskKey(s.api_key) };
      default:
        return { active: true, text: '' };
    }
  }
  return { active: true, text: '' };
}

/** 一次算出指定字段当前的渲染附加信息，供渲染层直接使用。 */
function fieldState(key, s, ctx) {
  const f = FIELD_MAP[key];
  if (!f) return { inactive: false, note: '', noteKind: 'info' };
  const inact = evaluateRule(f.inactiveRule, s, ctx);
  const note = evaluateRule(f.noteRule, s, ctx);
  let noteKind = 'info';
  if (!inact.active) noteKind = 'warn';
  else if (s.thinking_type === 'enabled' && key === 'top_p' && Number(s.top_p) < 0.95) noteKind = 'warn';
  return {
    inactive: !inact.active,
    note: !inact.active ? (f.inactiveReason || '') : note.text,
    noteKind,
  };
}

module.exports = {
  MAX_TOKENS_LIMIT,
  MAX_TOKENS_THINK,
  MAX_TOKENS_PLAIN,
  DEFAULT_BASE_URL,
  EFFORTS,
  MODELS,
  MODEL_IDS,
  LEGACY_MODEL_ALIASES,
  GROUPS,
  FIELD_MAP,
  lookupModel,
  defaults,
  resetSettings,
  effectiveMaxTokens,
  normalizedEffort,
  maskKey,
  validate,
  warnings,
  sanitize,
  buildRequest,
  buildResponsesRequest,
  requestPreview,
  renderSpec,
  evaluateRule,
  fieldState,
};
