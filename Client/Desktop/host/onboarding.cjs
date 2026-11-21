// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/host/AGENTS.md | ring 1
// Chains: module-local; query impact before editing
// Regions: crypto; providers; cfg; api; createOnboarding; probeNative
// Impact: python -B scripts/code-atlas.py show Client/Desktop/host/onboarding.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// Onboarding is a narrow client of the authoritative settings service. It
// stores no second configuration and returns neither saved nor temporary keys.
const crypto = require('node:crypto');
const providers = require('../src/provider-settings.cjs');
const cfg = require('../src/config.cjs');
const api = require('../src/api.cjs');

function createOnboarding(call, file) {
  const catalogs = new Map();
  const store=require('../src/catalog-store.cjs').createStore(file);
  const keyOf = (session, base, key) =>
    crypto
      .createHash('sha256')
      .update(session + '\0' + base + '\0' + key)
      .digest('hex');
  return async function (action, p, session) {
    if(action==='onboarding_preferences'){
      const keys=['context_working_tokens','compact_percent','compact_keep_turns','memory_enabled','memory_surface_tokens','dreams_enabled'];
      if(p.patch&&Object.keys(p.patch).some(k=>!keys.includes(k)))throw Error('不可修改的上下文设置');
      const r=await call(p.patch?'update':'read',p.patch?{patch:p.patch,expected_version:p.expected_version}:{},session);
      if(!r.ok)return {ok:false,code:r.code,errors:r.errors};
      return {ok:true,version:r.version,settings:Object.fromEntries(keys.map(k=>[k,r.settings[k]]))};
    }
    if (action === 'onboarding_status')
      return {
        ok: true,
        providers: [
          ...providers.PROVIDERS,
          { id: 'custom', name: '第三方 / 中转接口', base_url: '' },
        ],
        ...(await call('models', {}, session)),
      };
    if(action==='onboarding_draft')return call('connection_draft',p,session);
    if(action==='onboarding_save')return call('response_save',p,session);
    if(action==='onboarding_recovery')return call('connection_recovery',p,session);
    if(action==='onboarding_restore')return call('connection_restore',p,session);
    if(action==='onboarding_parameters'){
      const caps=require('../src/model-capabilities.cjs');
      const base=require('../src/system-settings.cjs').baseURL(p.base_url);
      if(p.user_slot==='bailian')require('../src/bailian.cjs').assertEndpoint(base);
      const saved=require('../src/model-pool.cjs').migrate(cfg.load(file).settings);
      const prior=saved.api_profiles.find(x=>x.id===p.profile_id&&x.base_url===base&&x.model===p.model&&x.api_protocol===p.api_protocol);
      const key=p.api_key||require('./connection.cjs').savedConnection(saved,p,base)?.api_key||'';
      const row=(catalogs.get(keyOf(session,base,key))?.rows||store.get('catalog:'+providers.catalogID({base_url:base,api_key:key}))?.models||[]).find(m=>m.id===p.model);
      const profile=prior||require('./connection.cjs').draftProfile({...p,api_protocol:p.api_protocol||row?.api_protocol,base_url:base,parameters:{}},row||{});
      return {ok:true,api_protocol:profile.api_protocol,parameter_specs:caps.forProfile(profile),fields:caps.fields(profile,'zh-CN'),parameters:require('./connection.cjs').visibleParameters(profile)};
    }
    const base = require('../src/system-settings.cjs').baseURL(p.base_url),
      saved = require('../src/model-pool.cjs').migrate(cfg.load(file).settings),
      prior = saved.api_profiles.find(x=>x.id===p.profile_id&&x.base_url===base),
      key = String(p.api_key || require('./connection.cjs').savedConnection(saved,p,base)?.api_key || '');
    if (!key || key.length > 4096 || /[\r\n]/.test(key))
      throw Error('请输入有效密钥');
    const identity = providers.identity({ base_url: base });
    if(p.user_slot==='bailian')require('../src/bailian.cjs').assertEndpoint(base);
    const cacheID = keyOf(session, base, key);
    for (const [id, c] of catalogs)
      if (c.expires < Date.now()) catalogs.delete(id);
    if (action === 'onboarding_catalog') {
      if (catalogs.size >= 64) throw Error('待配置连接过多，请稍后重试');
      let rows,
        notice = '';
      try {
        const data = await providers.jsonRequest(base + (identity==='openrouter'?'/models/user':'/models'), key);
        if (identity === 'custom')
          rows = providers.normalizeCustomCatalog(data);
        else rows = providers.normalizeCatalog(identity, data);
      } catch (error) {
        return {
          ok: false,
          errors: [
            error.status
              ? '模型目录请求失败：HTTP ' + error.status
              : '无法读取模型目录；可手动填写模型标识后验证',
          ],
          models: [],
          manual: true,
        };
      }
      if(rows.length>5000)throw Error('模型目录过大，请让 Matrix 分批获取');
      rows = rows
        .map((m) => ({
          id: m.id,
          name: m.name || m.id,
          context_window: Number.isInteger(m.context_window)
            ? m.context_window
            : null,
          api_protocol: m.api_protocol || null,
          protocol_source:m.protocol_source||'provider_catalog',
          context_window_source:m.context_window_source||'provider_catalog',
          available: m.available !== false,
          reason: m.reason || '',
          parameter_specs: m.parameter_specs || [],
          output_limit:m.output_limit||0,
          tool_calls:m.tool_calls===true,
          free:m.free===true,
          reasoning:m.reasoning===true,
        }));
      catalogs.set(cacheID, { expires: Date.now() + 600000, rows });
      store.put('catalog:'+providers.catalogID({base_url:base,api_key:key}),{models:rows,fetched_at:new Date().toISOString()});
      if(p.user_slot)require('../src/user-connections.cjs').cache(file,p.user_slot,{base_url:base,api_key:key,model:p.model});
      if(identity==='opencode')notice='免费标记来自目录；部分模型仅允许 OpenCode 官方客户端，检测响应以实际权限为准。';
      return { ok: true, models: rows, provider: identity, notice };
    }
    if(action==='onboarding_test'){
      const row=(catalogs.get(cacheID)?.rows||store.get('catalog:'+providers.catalogID({base_url:base,api_key:key}))?.models||[]).find(m=>m.id===p.model);
      const protocol=p.api_protocol||row?.api_protocol||'responses';
      const result=await call('response_test',{...p,api_protocol:protocol,api_key:key,catalog_row:row},session);
      // Retry an alternate wire only when the selected endpoint does not exist or is not implemented.
      if(p.auto_protocol===true&&require('../src/native-protocols.cjs').endpointMissing(result)&&['responses','chat_completions'].includes(protocol))return call('response_test',{...p,api_protocol:protocol==='responses'?'chat_completions':'responses',api_key:key,catalog_row:row},session);
      return result;
    }
    if (action !== 'onboarding_connect') throw Error('未知接入操作');
    if (typeof p.model !== 'string' || !p.model.trim() || p.model.length > 200)
      throw Error('请选择或填写模型标识');
    const row = catalogs.get(cacheID)?.rows.find((m) => m.id === p.model);
    const protocol = row?.api_protocol || undefined;
    const expectedVersion = p.expected_version || cfg.version(file);
    const proof = await call(
      'probe',
      {
        base_url: base,
        api_key: key,
        model: p.model,
        ...(protocol ? { api_protocol: protocol } : {}),
      },
      session,
    );
    if (!proof.ok || !proof.tool_calls)
      return {
        ...proof,
        ok: false,
        errors: ['模型尚未通过真实工具往返验证，请检查模型与接口'],
      };
    const context = row?.context_window;
    const known =
      Number.isInteger(context) && context >= 8192 && context <= 10000000;
    const id =
      'matrix-' +
      crypto
        .createHash('sha256')
        .update(base + '\0' + p.model)
        .digest('hex')
        .slice(0, 20);
    const result = await call(
      'configure',
      {
        probe_id: proof.probe_id,
        id,
        name: row?.name || p.model,
        context_window: known ? context : 8192,
        context_source: known
          ? row.context_window_source || 'provider_catalog'
          : 'conservative_client_budget',
        activate: true,
        matrix: true,
        expected_version: expectedVersion,
      },
      session,
    );
    return {
      ...result,
      model_id: id,
      protocol: proof.api_protocol,
      tool_roundtrip: proof.tool_calls,
      context_source: known ? row.context_window_source || 'provider_catalog' : 'conservative_client_budget',
      notice: known
        ? '连接与工具往返已验证'
        : '接口未提供可信上下文上限，暂以 8192 的客户端预算启动；由模型自检继续核实。',
    };
  };
}

// Native probes use the shared HTTP/protocol sender and validate both halves
// of a nonce challenge. A catalog flag or HTTP 200 alone never counts as proof.
async function probeNative(p, session) {
  const token = crypto.randomBytes(6).toString('hex'),
    challenge = crypto.randomBytes(16).toString('hex');
  const schema = {
    type: 'object',
    properties: { token: { type: 'string', enum: [token] } },
    required: ['token'],
    additionalProperties: false,
  };
  const text =
    'Call aieyra_probe with token ' +
    token +
    '. After receiving the tool result reply only with that result.';
  const s = { ...p, __diagnostic_session: session };
  let first, second, reply;
  if (p.api_protocol === 'anthropic_messages') {
    const body = {
      model: p.model,
      max_tokens: 1024,
      stream: false,
      messages: [{ role: 'user', content: text }],
      tools: [
        {
          name: 'aieyra_probe',
          description: 'Return the token',
          input_schema: schema,
        },
      ],
    };
    first = await api.requestModel(s, body);
    const calls = first.content?.filter((v) => v.type === 'tool_use');
    const c = calls?.[0];
    if (
      first.stop_reason !== 'tool_use' ||
      calls?.length !== 1 ||
      !c.id ||
      c.name !== 'aieyra_probe' ||
      c.input?.token !== token ||
      Object.keys(c.input).length !== 1
    )
      throw Error('原生工具调用未通过验证');
    second = await api.requestModel(s, {
      ...body,
      messages: [
        ...body.messages,
        { role: 'assistant', content: first.content },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: c.id, content: challenge },
          ],
        },
      ],
    });
    if (
      second.stop_reason !== 'end_turn' ||
      second.content?.some((v) => v.type === 'tool_use')
    )
      throw Error('原生工具往返未完整结束');
    reply = second.content
      ?.filter((v) => v.type === 'text')
      .map((v) => v.text)
      .join('');
  } else if (p.api_protocol === 'google_generate') {
    const body = {
      contents: [{ role: 'user', parts: [{ text }] }],
      tools: [
        {
          functionDeclarations: [
            {
              name: 'aieyra_probe',
              description: 'Return the token',
              parameters: schema,
            },
          ],
        },
      ],
    };
    first = await api.requestModel(s, body);
    const candidate = first.candidates?.[0],
      calls = candidate?.content?.parts?.filter((v) => v.functionCall),
      c = calls?.[0]?.functionCall;
    if (
      first.candidates?.length !== 1 ||
      candidate.finishReason !== 'STOP' ||
      calls?.length !== 1 ||
      c.name !== 'aieyra_probe' ||
      c.args?.token !== token ||
      Object.keys(c.args).length !== 1
    )
      throw Error('原生工具调用未通过验证');
    second = await api.requestModel(s, {
      ...body,
      contents: [
        ...body.contents,
        candidate.content,
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: c.name,
                response: { result: challenge },
              },
            },
          ],
        },
      ],
    });
    if (
      second.candidates?.length !== 1 ||
      second.candidates[0].finishReason !== 'STOP' ||
      second.candidates[0].content?.parts?.some((v) => v.functionCall)
    )
      throw Error('原生工具往返未完整结束');
    reply = second.candidates[0].content?.parts
      ?.map((v) => v.text || '')
      .join('');
  } else throw Error('不支持的原生协议');
  if (String(reply || '').trim() !== challenge)
    throw Error('原生工具结果回传不匹配');
  return {
    ok: true,
    base_url: p.base_url,
    api_protocol: p.api_protocol,
    model: p.model,
    tool_calls: true,
    verified_options: {
      stream: false,
      tool_choice: 'auto',
      output_limit: 'probe_1024',
      response_format: 'text',
    },
    evidence: [{ endpoint: p.base_url, ok: true, tool_roundtrip: true }],
  };
}
module.exports = { createOnboarding, probeNative };
