// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: assert; os; path; fs; spec; cfg; api; pass; fail; t; section; base; tmpDir; tmpCfg; promptTmpDir; ensTmpDir; srcDir; preloadSrc; mainSrc; channelsOf; goTypesSrc; goStringSlice
// Impact: python -B scripts/code-atlas.py show Client/Desktop/test/spec.test.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// 配置逻辑自测：不启动 Electron，直接验证 spec.cjs / config.cjs。
//
// 为什么需要：这个界面的价值全在「参数语义正确」。如果校验和置灰规则错了，
// 界面再好看也是错的。Go 端同类规则有测试锁着，这里必须有对应的一份。
//
// 运行：node test/spec.test.cjs

'use strict';

const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const spec = require('../src/spec.cjs');
const cfg = require('../src/config.cjs');
const api = require('../src/api.cjs');

let pass = 0;
let fail = 0;

function t(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`  ✔ ${name}`);
  } catch (err) {
    fail += 1;
    console.log(`  ✖ ${name}\n      ${err.message}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

// —— 出厂配置 ——

section('出厂配置');

t('默认配置除 Key 外应通过校验', () => {
  const s = spec.defaults();
  const errs = spec.validate(s);
  assert.deepStrictEqual(errs, ['API Key 为空，请填写后再保存']);
  s.api_key = 'sk-test';
  assert.deepStrictEqual(spec.validate(s), []);
});

t('系统提示词出厂必须为空（程序不内嵌基准提示词）', () => {
  assert.strictEqual(spec.defaults().system_prompt, '');
  assert.strictEqual(spec.defaults().prompt_dir, '');
});

t('默认模型为 deepseek-flash，思考模式默认开启', () => {
  assert.strictEqual(spec.defaults().model, 'deepseek-flash');
  assert.strictEqual(spec.defaults().thinking_type, 'enabled');
});

// —— 越界校验 ——

section('越界校验');

const base = () => ({ ...spec.defaults(), api_key: 'sk-test' });

t('max_tokens 超上限被拦', () => {
  const s = base();
  s.max_tokens = spec.MAX_TOKENS_LIMIT + 1;
  assert.ok(spec.validate(s).some((e) => e.includes('max_tokens')));
});

t('temperature 越界被拦', () => {
  const s = base();
  s.temperature = 2.5;
  assert.ok(spec.validate(s).some((e) => e.includes('temperature')));
});

t('top_p 为 0 被拦', () => {
  const s = base();
  s.top_p = 0;
  assert.ok(spec.validate(s).some((e) => e.includes('top_p')));
});

t('Base URL 缺协议被拦', () => {
  const s = base();
  s.base_url = 'api.deepseek.com';
  assert.ok(spec.validate(s).some((e) => e.includes('http')));
});

t('旧模型名给出替代建议', () => {
  const s = base();
  s.model = 'deepseek-chat';
  const errs = spec.validate(s);
  assert.ok(errs.some((e) => e.includes('deepseek-flash')), `实际：${errs}`);
});

t('未知模型列出可选值', () => {
  const s = base();
  s.model = 'gpt-4';
  assert.ok(spec.validate(s).some((e) => e.includes('deepseek-flash')));
});

// —— 自愈 ——

section('自愈');

t('脏配置能被夹回合法范围', () => {
  const s = {
    api_key: 'sk-test',
    model: 'deepseek-chat',
    temperature: -5,
    top_p: 9,
    max_tokens: spec.MAX_TOKENS_LIMIT + 100,
    thinking_type: '???',
    reasoning_effort: '???',
    request_timeout_seconds: -1,
    context_messages: -3,
  };
  spec.sanitize(s);
  assert.strictEqual(s.model, 'deepseek-flash');
  assert.strictEqual(s.temperature, 0);
  assert.strictEqual(s.top_p, 1);
  assert.strictEqual(s.max_tokens, spec.MAX_TOKENS_LIMIT);
  assert.strictEqual(s.thinking_type, 'enabled');
  assert.strictEqual(s.request_timeout_seconds, 300);
  assert.strictEqual(s.context_messages, 0);
  assert.deepStrictEqual(spec.validate(s), []);
});

t('自愈不用文案回填提示词', () => {
  const s = base();
  s.system_prompt = '';
  spec.sanitize(s);
  assert.strictEqual(s.system_prompt, '');
});

// —— 置灰规则（与官方文档对齐）——

section('置灰规则');

t('所有思考模式均不展示温度或采样配置', () => {
  assert.strictEqual(spec.FIELD_MAP.temperature, undefined);
  assert.strictEqual(spec.FIELD_MAP.top_p, undefined);
  assert(!spec.renderSpec().flatMap(g=>g.fields).some(f=>['temperature','top_p'].includes(f.key)));
});

t('非思考模式也不发送旧温度配置', () => {
  const s = base();
  s.thinking_type = 'disabled';
  s.temperature = 0.7;
  assert.strictEqual(spec.buildRequest(s,[],false).temperature,undefined);
});

t('非思考模式下 reasoning_effort 被标记为不生效', () => {
  const s = base();
  s.thinking_type = 'disabled';
  assert.strictEqual(spec.fieldState('reasoning_effort', s).inactive, true);
});

t('枚举型开关的置灰判断必须基于取值而不是真假值', () => {
  // 回归测试：thinking_type 是 'enabled'/'disabled'，两个都是非空字符串。
  // 若规则只用"真假值"判断，'disabled' 会被当成开着，置灰逻辑整个反掉。
  const s = base();
  s.thinking_type = 'disabled';
  assert.strictEqual(
    spec.evaluateRule(spec.FIELD_MAP.reasoning_effort.inactiveRule, s).active,
    false,
    'thinking_type=disabled 时 reasoning_effort 应置灰',
  );
  s.thinking_type = 'enabled';
  assert.strictEqual(
    spec.evaluateRule(spec.FIELD_MAP.reasoning_effort.inactiveRule, s).active,
    true,
    'thinking_type=enabled 时 reasoning_effort 应可用',
  );
});

t('关闭流式后 stream_include_usage 被标记为不生效', () => {
  const s = base();
  s.stream = false;
  assert.strictEqual(spec.fieldState('stream_include_usage', s).inactive, true);
  s.stream = true;
  assert.strictEqual(spec.fieldState('stream_include_usage', s).inactive, false);
});

// —— 请求体构造（最关键）——

section('请求体构造');

t('思考模式不发送 temperature', () => {
  const s = base();
  s.thinking_type = 'enabled';
  s.temperature = 0.3;
  const r = spec.buildRequest(s, [{ role: 'user', content: 'hi' }], true);
  assert.strictEqual(r.temperature, undefined, '不应携带 temperature');
  assert.deepStrictEqual(r.reasoning, {effort:spec.defaults().reasoning_effort});
  assert.strictEqual(r.thinking,undefined);
  assert.strictEqual(r.reasoning_effort,undefined);
});

t('思考模式下旧 top_p 不进入请求', () => {
  const s = base();
  s.thinking_type = 'enabled';
  s.top_p = 0.5;
  const r = spec.buildRequest(s, [], true);
  assert.strictEqual(r.top_p, undefined);
});

t('非思考模式不发送 temperature 或 top_p', () => {
  const s = base();
  s.thinking_type = 'disabled';
  s.temperature = 0.7;
  s.top_p = 0.2;
  const r = spec.buildRequest(s, [], false);
  assert.strictEqual(r.temperature, undefined);
  assert.strictEqual(r.top_p, undefined);
});

t('非流式请求不带 stream_options', () => {
  const s = base();
  const r = spec.buildRequest(s, [], false);
  assert.strictEqual(r.stream_options, undefined);
  assert.strictEqual(r.stream, false);
});

t('Responses 自动报告用量，不发送 stream_options', () => {
  const s = base();
  s.stream_include_usage = true;
  const r = spec.buildRequest(s, [], true);
  assert.strictEqual(r.stream_options,undefined);
  s.api_protocol='chat_completions';
  assert.deepStrictEqual(spec.buildRequest(s,[],true).stream_options,{include_usage:true});
});

t('请求体永不包含已废弃参数', () => {
  const s = base();
  const r = spec.buildRequest(s, [], true);
  const json = JSON.stringify(r);
  for (const banned of ['frequency_penalty', 'presence_penalty']) {
    assert.ok(!json.includes(banned), `不应包含 ${banned}`);
  }
});

t('max_tokens 为 0 时不发送该字段', () => {
  const s = base();
  s.max_tokens = 0;
  const r = spec.buildRequest(s, [], true);
  assert.strictEqual(r.max_output_tokens, undefined);
  assert.strictEqual(r.max_tokens, undefined);
});

t('json_object 格式被正确映射', () => {
  const s = base();
  s.response_format = 'json_object';
  const r = spec.buildRequest(s, [], true);
  assert.deepStrictEqual(r.text, {format:{ type: 'json_object' }});
  assert.strictEqual(r.response_format,undefined);
});

t('user_id 留空时不发送', () => {
  const s = base();
  s.user_id = '';
  assert.strictEqual(spec.buildRequest(s, [], true).user, undefined);
  s.user_id = 'user-1';
  assert.strictEqual(spec.buildRequest(s, [], true).user, 'user-1');
});

// —— 生效上限推导 ——

section('生效上限推导');

t('按官方规则推导默认输出上限', () => {
  const s = spec.defaults();
  s.max_tokens = 0;
  s.thinking_type = 'enabled';
  s.reasoning_effort = 'high';
  assert.strictEqual(spec.effectiveMaxTokens(s), spec.MAX_TOKENS_THINK);
  s.reasoning_effort = 'max';
  assert.strictEqual(spec.effectiveMaxTokens(s), 131072);
  s.thinking_type = 'disabled';
  assert.strictEqual(spec.effectiveMaxTokens(s), spec.MAX_TOKENS_PLAIN);
  s.max_tokens = 1234;
  assert.strictEqual(spec.effectiveMaxTokens(s), 1234);
});

t('思考强度别名被归一化', () => {
  const s = spec.defaults();
  const cases = { minimal: 'low', low: 'low', medium: 'high', high: 'high', xhigh: 'high', max: 'max', ultra: 'max' };
  for (const [input, want] of Object.entries(cases)) {
    s.reasoning_effort = input;
    assert.strictEqual(spec.normalizedEffort(s), want, `${input} 应归一化为 ${want}`);
  }
});

// —— IPC 可序列化（关键回归）——

section('IPC 可序列化');

t('字段规范必须能被结构化克隆', () => {
  // 回归测试：inactive/note 曾经是函数，导致 IPC 抛
  // "An object could not be cloned"，整个界面加载不出来。
  const specData = spec.renderSpec();
  assert.doesNotThrow(() => structuredClone(specData));
  for (const g of specData) {
    for (const f of g.fields) {
      assert.strictEqual(typeof f.inactiveRule === 'function', false, `${f.key} 不应含函数`);
      assert.strictEqual(typeof f.noteRule === 'function', false, `${f.key} 不应含函数`);
    }
  }
});

t('bootstrap 载荷整体可克隆', () => {
  const s = base();
  const ctx = { resolvedPromptDir: 'D:/p' };
  const payload = {
    settings: s,
    groups: spec.renderSpec().map((g) => ({
      ...g,
      fields: g.fields.map((f) => ({ ...f, state: spec.fieldState(f.key, s, ctx) })),
    })),
    models: spec.MODELS,
    defaults: spec.defaults(),
    prompt: { dir: 'D:/p', layers: [], text: '', chars: 0 },
  };
  assert.doesNotThrow(() => structuredClone(payload));
});

t('fieldState 正确处理置灰与说明', () => {
  const s = base();
  s.thinking_type = 'enabled';
  s.top_p = 0.5;
  const ctx = { resolvedPromptDir: 'D:/p' };

  const thinking = spec.fieldState('reasoning_effort', s, ctx);
  assert.strictEqual(thinking.inactive, false);

  const dir = spec.fieldState('prompt_dir', s, ctx);
  assert.ok(dir.note.includes('D:/p'), `实际：${dir.note}`);
});

// —— 提示 ——

section('提示');

t('思考模式不再显示已移除温度的提示', () => {
  const s = base();
  s.thinking_type = 'enabled';
  assert.ok(!spec.warnings(s).some((w) => w.includes('temperature')));
});

t('旧 top_p 不再显示抬升提示', () => {
  const s = base();
  s.thinking_type = 'enabled';
  s.top_p = 0.5;
  assert.ok(!spec.warnings(s).some((w) => w.includes('0.95')));
});

t('非思考模式不显示采样配置提示', () => {
  const s = base();
  s.thinking_type = 'disabled';
  assert.ok(!spec.warnings(s).some((w) => w.includes('top_p')));
});

// —— Key 脱敏 ——

section('Key 脱敏');

t('脱敏不泄露中段', () => {
  const real = 'sk-9' + '0'.repeat(27) + '739a';
  const masked = spec.maskKey(real);
  assert.ok(!masked.includes('00000000'), '不应泄露中段');
  assert.ok(masked.startsWith('sk-9'));
  assert.ok(masked.endsWith('739a'));
});

t('短 Key 整体打码', () => {
  assert.ok(!spec.maskKey('short').includes('short'));
});

t('空 Key 返回占位文案', () => {
  assert.strictEqual(spec.maskKey(''), '（未设置）');
});

// —— Base URL 容错 ——

section('Base URL 容错');

t('把完整路径粘进 Base URL 也能用', () => {
  const cases = {
    'https://api.deepseek.com': 'https://api.deepseek.com/responses',
    'https://api.deepseek.com/': 'https://api.deepseek.com/responses',
    'https://api.deepseek.com/v1': 'https://api.deepseek.com/responses',
    'https://api.deepseek.com/chat/completions': 'https://api.deepseek.com/responses',
  };
  for (const [input, want] of Object.entries(cases)) {
    assert.strictEqual(api.endpointOf(input), want, `${input} 应规整为 ${want}`);
  }
});

// —— 错误提示 ——

section('错误提示');

t('常见错误码给出可操作建议', () => {
  const cases = [
    [401, '', 'Key'],
    [402, '', '充值'],
    [429, '', '限速'],
    [400, 'reasoning_content is required', 'reasoning_content'],
    [400, 'Model Not Exist', '供应商目录'],
    [400, 'Model is unavailable', '当前可用性'],
    [404, '', '当前供应商'],
  ];
  for (const [status, msg, want] of cases) {
    assert.ok(api.hintFor(status, msg).includes(want), `HTTP ${status} 应提示 ${want}`);
  }
});

// —— 文件读写 ——

section('文件读写');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aieyra-cfg-'));
const tmpCfg = path.join(tmpDir, 'config.json');

t('不存在时返回出厂配置且不报错', () => {
  const r = cfg.load(tmpCfg);
  assert.strictEqual(r.exists, false);
  assert.strictEqual(r.settings.model, 'deepseek-flash');
});

t('保存后可完整往返', () => {
  const s = { ...spec.defaults(), api_key: 'sk-roundtrip-1234', model: 'deepseek-v4-pro', thinking_type: 'disabled', temperature: 0.42 };
  cfg.save(tmpCfg, s);
  const r = cfg.load(tmpCfg);
  assert.strictEqual(r.exists, true);
  assert.strictEqual(r.settings.model, 'deepseek-v4-pro');
  assert.strictEqual(r.settings.thinking_type, 'disabled');
  assert.strictEqual(r.settings.temperature, 0.42);
  assert.strictEqual(r.settings.api_key, 'sk-roundtrip-1234');
});

t('保存会保留本界面不认识的字段', () => {
  const raw = JSON.parse(fs.readFileSync(tmpCfg, 'utf8'));
  raw.some_future_field = { keep: true };
  raw.another = 42;
  fs.writeFileSync(tmpCfg, JSON.stringify(raw));
  const r = cfg.load(tmpCfg);
  assert.deepStrictEqual(Object.keys(r.unknown).sort(), ['another', 'some_future_field']);
  r.settings.model = 'deepseek-flash';
  cfg.save(tmpCfg, r.settings);
  const after = JSON.parse(fs.readFileSync(tmpCfg, 'utf8'));
  assert.deepStrictEqual(after.some_future_field, { keep: true });
  assert.strictEqual(after.another, 42);
});

t('损坏的配置会抛出而不是静默覆盖', () => {
  fs.writeFileSync(tmpCfg, '{ not json');
  assert.throws(() => cfg.load(tmpCfg), /解析失败/);
  assert.throws(
    () => cfg.save(tmpCfg, { ...spec.defaults(), api_key: 'sk-test' }),
    /为避免覆盖原内容/
  );
  assert.strictEqual(fs.readFileSync(tmpCfg, 'utf8'), '{ not json');
});

t('不把界面内部字段写进配置文件', () => {
  fs.writeFileSync(tmpCfg, JSON.stringify(spec.defaults()));
  const s = { ...spec.defaults(), api_key: 'sk-x', __resolvedPromptDir: 'D:/whatever' };
  cfg.save(tmpCfg, s);
  const after = JSON.parse(fs.readFileSync(tmpCfg, 'utf8'));
  assert.ok(!('__resolvedPromptDir' in after), '内部字段不应落盘');
});

t('Key 历史去重且只留最近 8 个', () => {
  let hist = [];
  for (let i = 0; i < 12; i += 1) hist = cfg.rememberKey({ api_key_history: hist }, `sk-key-${i}`);
  assert.strictEqual(hist.length, 8);
  assert.strictEqual(hist[0], 'sk-key-11');
  const again = cfg.rememberKey({ api_key_history: hist }, 'sk-key-11');
  assert.strictEqual(again.length, 8, '重复的 Key 不应撑大历史');
  assert.strictEqual(again[0], 'sk-key-11');
});

// —— 提示词 ——

section('提示词');

// 临时目录用完必须删：这三个 mkdtemp 若只建不删，跑一次 selftest 就永久
// 在系统 %TEMP% 里留下一个 aieyra-* 目录，多跑几次就是几十个垃圾目录。
let promptTmpDir = '';
let ensTmpDir = '';

t('提示词文件与顺序和 Go 装载器一致', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../../Core/prompt.go'), 'utf8');
  const ids = [...source.match(/func LayerIDs\(\) \[\]string \{ return \[\]string\{([^}]+)\}/)[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const definitions = new Map([...source.matchAll(/(PromptFile\w+)\s*=\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]));
  const layers = new Map([...source.matchAll(/case "([^"]+)":\s*return (PromptFile\w+), "([^"]+)", true/g)].map((m) => [m[1], { id: m[1], file: definitions.get(m[2]), title: m[3] }]));
  assert.deepStrictEqual(cfg.PROMPT_FILES, ids.map((id) => layers.get(id)));
});

t('基础层在前，缺失默认与空层跳过并统计字数', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aieyra-prompt-'));
  promptTmpDir = dir;
  fs.writeFileSync(path.join(dir, '思考方式.txt'), '\uFEFF<!-- 给人看的说明 -->\r\n先查证再执行。\r\n');
  fs.writeFileSync(path.join(dir, '自我.txt'), '我是测试。\n');
  fs.writeFileSync(path.join(dir, '工作.txt'), '');
  fs.writeFileSync(path.join(dir, '边界.txt'), '');
  const st = cfg.promptStatus(dir, path.join(dir, 'no-defaults'));
  assert.deepStrictEqual(st.layers.map((l) => l.id), ['self', 'work', 'boundary', 'thinking']);
  assert.strictEqual(st.layers[3].title, '思考方式');
  assert.strictEqual(st.layers[3].empty, false);
  assert.strictEqual(st.layers[1].empty, true);
  assert.strictEqual(st.text, '## 人格与沟通\n\n我是测试。\n\n## 思考方式\n\n先查证再执行。');
  assert.strictEqual(st.chars, [...st.text].length);
  assert.ok(st.text.includes('## 人格与沟通'));
  assert.ok(st.text.includes('我是测试'));
  assert.ok(!st.text.includes('## 执行与工作'), '空层不应输出标题');
});

t('文件头的说明注释不进入提示词', () => {
  const raw = '<!-- 这是给人看的 -->\n\n正文内容\n';
  assert.strictEqual(cfg.normalizePrompt(raw), '正文内容');
});

t('promptStatus 的缺层来源与 Core canonical 默认目录一致', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aieyra-default-origin-'));
  try {
    const status=cfg.promptStatus(dir);
    // 第 81 轮 R46：公共边界层出厂为空，其余三层有默认内容。
    assert.ok(status.layers.every(layer=>layer.source==='default'&&layer.empty===false));
    assert.ok(status.layers.every(layer=>layer.path===require('../src/resources.cjs').promptPath('Matrix/默认/'+layer.file)));
    assert.deepEqual(fs.readdirSync(dir),[]);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

t('promptStatus 只读：缺层不创建文件、不改动已有文件', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aieyra-ens-'));
  ensTmpDir = root;
  const dir = path.join(root, 'Prompt');
  // 目录故意不建：缺失应如实报告，不顺手创建目录或文件。
  const st = cfg.promptStatus(dir, path.join(root, 'no-defaults'));
  assert.strictEqual(st.layers.length, 4);
  assert.ok(st.layers.every((l) => l.empty), '缺失的层应显示为空');
  assert.strictEqual(st.chars, 0);
  assert.ok(!fs.existsSync(dir), '提示词目录不该被程序创建');

  // 已有文件必须原样保留，连换行都不能动。
  fs.mkdirSync(dir, { recursive: true });
  const selfPath = path.join(dir, cfg.PROMPT_FILES.find((l) => l.id === 'self').file);
  const raw = '我是测试人格。\n\n第二段。\n';
  fs.writeFileSync(selfPath, raw);
  const legacy = cfg.promptStatus(dir, path.join(root, 'no-defaults'));
  assert.strictEqual(legacy.layers[3].empty, true, '没有新文件的旧目录仍可使用');
  assert.strictEqual(legacy.text, '## 人格与沟通\n\n' + raw.trim());
  assert.ok(!fs.existsSync(path.join(dir, '思考方式.txt')), '不能偷偷补建新层');
  assert.strictEqual(fs.readFileSync(selfPath, 'utf8'), raw, '已有提示词不得被改写');
});

t('落盘的 base_url / model / prompt_dir 去掉首尾空白', () => {
  const s = spec.sanitize({
    ...spec.defaults(),
    base_url: '  https://api.example.com/v1  ',
    model: ' deepseek-v4-pro ',
    prompt_dir: '  D:/MyPrompts  ',
  });
  assert.strictEqual(s.base_url, 'https://api.example.com/v1');
  assert.strictEqual(s.model, 'deepseek-v4-pro');
  assert.strictEqual(s.prompt_dir, 'D:/MyPrompts');
});

t('reasoning_effort 接受 ultra，且不会被 sanitize 静默回退', () => {
  // 曾经 Validate 认 ultra、sanitize 不认：填 ultra 保存再打开就变成 high，
  // 中间一句提示都没有。两个清单现在共用一份，所以逐档对照。
  for (const e of ['none', 'low', 'high', 'max', 'minimal', 'medium', 'xhigh', 'ultra']) {
    const s = spec.sanitize({ ...spec.defaults(), api_key: 'sk-test', reasoning_effort: e });
    assert.strictEqual(s.reasoning_effort, e, `sanitize 不该改掉合法档位 ${e}`);
    assert.deepStrictEqual(spec.validate(s), [], `${e} 应当是合法配置`);
  }
  for (const bad of ['ultra2', 'ULTRA', ' low', 'extreme']) {
    const s = spec.sanitize({ ...spec.defaults(), api_key: 'sk-test', reasoning_effort: bad });
    assert.strictEqual(s.reasoning_effort, 'high', `非法档位 ${bad} 应回落为 high`);
    assert.deepStrictEqual(spec.validate(s), [], '回落后的配置应当合法');
  }
});

// —— 恢复出厂参数 ——

section('恢复出厂参数');

t('恢复默认但保留 Key 与提示词目录', () => {
  const cur = {
    ...spec.defaults(),
    api_key: 'sk-keep-1234',
    api_key_history: ['sk-keep-1234', 'sk-old'],
    prompt_dir: 'D:/MyPrompts',
    model: 'deepseek-v4-pro',
    temperature: 1.9,
    thinking_type: 'disabled',
  };
  const r = spec.resetSettings(cur);
  assert.strictEqual(r.api_key, 'sk-keep-1234', 'Key 不该被抹掉');
  assert.strictEqual(r.prompt_dir, 'D:/MyPrompts', '提示词目录不该被抹掉');
  assert.deepStrictEqual(r.api_key_history, ['sk-keep-1234', 'sk-old']);
  assert.strictEqual(r.model, 'deepseek-flash', '模型应回到出厂值');
  assert.strictEqual(r.temperature, 1.0);
  assert.strictEqual(r.thinking_type, 'enabled');
});

t('空输入不抛异常', () => {
  const r = spec.resetSettings(undefined);
  assert.strictEqual(r.api_key, '');
  assert.deepStrictEqual(r.api_key_history, []);
  assert.strictEqual(r.model, 'deepseek-flash');
});

t('返回的历史数组不与出厂配置共享引用', () => {
  const a = spec.resetSettings({});
  a.api_key_history.push('sk-should-not-leak');
  assert.deepStrictEqual(spec.defaults().api_key_history, [], '出厂配置被改脏了');
});

// —— IPC 通道对齐 ——

section('主进程与 preload 的 IPC 通道必须对齐');

const srcDir = path.join(__dirname, '..', 'src');
const preloadSrc = fs.readFileSync(path.join(srcDir, 'preload.cjs'), 'utf8');
const mainSrc = fs.readFileSync(path.join(srcDir, 'main.cjs'), 'utf8');

function channelsOf(src, re) {
  const out = new Set();
  for (const m of src.matchAll(re)) out.add(m[1]);
  return out;
}

t('界面调用的每个 invoke 通道都有 ipcMain.handle', () => {
  const exposed = channelsOf(preloadSrc, /ipcRenderer\.invoke\(\s*'([^']+)'/g);
  const handled = channelsOf(mainSrc, /ipcMain\.handle\(\s*'([^']+)'/g);
  // 共享配置服务动态注册；使用真实导出的白名单验证，避免只数源码字符串。
  assert.ok(mainSrc.includes('for (const method of service.methods)'));
  const service = require('../src/service.cjs').createService(path.join(os.tmpdir(), 'unused-config.json'));
  for (const method of service.methods) handled.add(method);
  assert.ok(exposed.size >= 8, `应能解析出通道名，实际只有 ${exposed.size} 个`);

  // 这条断言来自一次真实事故：删「打开外部目录」功能时，
  // 顺手把 win:action 和 config:reset 两个处理器也删了，而验证脚本只数了
  // 标题栏按钮的个数、从没点过它们，于是窗口变成「点不动也关不掉」。
  const missing = [...exposed].filter((c) => !handled.has(c));
  assert.deepStrictEqual(missing, [],
    `这些通道被界面调用却没有主进程处理器：${missing.join(', ')}`);
});

t('主进程发出的事件 preload 有监听', () => {
  const sent = channelsOf(mainSrc, /webContents\.send\(\s*'([^']+)'/g);
  const listened = channelsOf(preloadSrc, /ipcRenderer\.on\(\s*'([^']+)'/g);
  assert.ok(sent.size >= 1, '应能解析出主进程发出的事件');
  const orphan = [...sent].filter((c) => !listened.has(c));
  assert.deepStrictEqual(orphan, [], `主进程会发但没人监听：${orphan.join(', ')}`);
});

// —— 与 Go 端的取值清单对齐 ——

section('与 Go 端共用的取值清单不许漂移');

const goTypesSrc = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'Core', 'types.go'), 'utf8',
);

/** 从 Go 源码里抠出一个字符串切片字面量的值。 */
function goStringSlice(src, varName) {
  const re = new RegExp(`var\\s+${varName}\\s*=\\s*\\[\\]string\\{([^}]*)\\}`);
  const m = src.match(re);
  assert.ok(m, `没能从 Core/types.go 解析出 ${varName}（变量被改名或挪走了？）`);
  return [...m[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]);
}

t('reasoning_effort 的合法取值与 Go 端一致', () => {
  // 这条来自一次真实缺陷：Validate 认 ultra，Sanitize 不认，
  // 于是 ultra 保存后无声无息变成 high。根因是同一份清单被抄了两遍。
  const want = [
    ...goStringSlice(goTypesSrc, 'effortsCanonical'),
    ...goStringSlice(goTypesSrc, 'effortsAliases'),
  ];
  assert.deepStrictEqual(spec.EFFORTS, want,
    'Client/Desktop/src/spec.cjs 的 EFFORTS 与 Core/types.go 的 efforts* 不一致');
  assert.ok(want.includes('ultra'), 'ultra 必须在清单里，否则会被静默改掉');
});

t('配置文件候选顺序与 Go 端 ConfigCandidates 一致', () => {
  // 两个程序读写同一份 config.json，「找哪个文件」只能有一个事实来源。
  // 曾经 JS 端漏了「当前工作目录」这一条，于是同一个工作目录下
  // 两个程序会认到不同的配置：界面里改完保存，终端里读到的还是旧的。
  const p = require('../src/paths.cjs');
  const got = p.configCandidates();
  const user = p.userConfigPath();
  assert.strictEqual(got[0], path.join(p.appRoot(), 'Data', 'Config', 'config.json'));
  assert.strictEqual(got[1], path.join(p.appRoot(), 'Config', 'config.json'));
  assert.strictEqual(got[2], path.join(path.dirname(process.execPath), 'config.json'));
  assert.strictEqual(got[3], user);
  assert.strictEqual(got[4], path.join(process.cwd(), 'config.json'));

  const goAppSrc = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'Core', 'host', 'app.go'), 'utf8',
  );
  const fn = goAppSrc.match(/func ConfigCandidates\(\)[^{]*\{([\s\S]*?)\n\}/);
  assert.ok(fn, '没能从 Core/host/app.go 解析出 ConfigCandidates');
  const body = fn[1];
  const at = [
    body.indexOf('filepath.Dir(exe)'),
    body.indexOf('agent.UserConfigPath()'),
    body.indexOf('os.Getwd()'),
  ];
  assert.ok(at.every((i) => i >= 0), `Go 端的三个候选没能全部找到：${at}`);
  assert.deepStrictEqual(at, [...at].sort((a, b) => a - b),
    'Go 端候选顺序必须是 exe 同级 → 用户配置 → 工作目录');
});

// —— 清理 ——

fs.rmSync(tmpDir, { recursive: true, force: true });
for (const d of [promptTmpDir, ensTmpDir]) {
  if (d) fs.rmSync(d, { recursive: true, force: true });
}

console.log(`\n${pass} 通过, ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
