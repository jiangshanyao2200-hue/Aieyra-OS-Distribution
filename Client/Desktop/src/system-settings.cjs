// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: fs; path; crypto; cfg; spec; pool; capabilities; catalog; sessionModels; version; parameters; baseURL; redact; profiles; activate; snapshotActive; prepareUISettings; request; probe; createSystemSettings
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/system-settings.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// 原生界面与 Agent 共用配置入口；探测不保存凭据，写入要求匹配读取版本。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cfg = require('./config.cjs');
const spec = require('./spec.cjs');
const pool = require('./model-pool.cjs');
const capabilities = require('./model-capabilities.cjs');
const catalog = require('./model-catalog.cjs');
const sessionModels = require('./session-model.cjs');

const version = cfg.version;
const parameters = pool.parameters;
function baseURL(raw) {
  const u = new URL(String(raw || '').trim());
  if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw Error('接口地址必须为无凭据、无查询参数的 HTTPS 地址');
  if (u.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) throw Error('HTTP 仅允许本地回环地址');
  u.pathname = u.pathname.replace(/\/(responses|chat\/completions)\/?$/, '').replace(/\/+$/, '');
  return u.toString().replace(/\/+$/, '');
}
function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, k==='official_account'?{user:v?.user||null,selected_token_id:v?.selected_token_id||'',has_session:!!v?.session_cookies?.length}:/api_key/.test(k) ? (Array.isArray(v) ? v.map(spec.maskKey) : spec.maskKey(v)) : redact(v)]));
}
function profiles(s) {
  return pool.migrate(s).api_profiles.map(p=>({...p,...catalog.describe(p)}));
}
function activate(s, p) {
  return pool.activate(pool.migrate(s),p);
}
function snapshotActive(s) {
  s=pool.migrate(s);
  const id = s.active_profile || s.model;
  return {...s, api_profiles: profiles(s).map(p => p.id === id ? {...p, ...(s.model_pool_version===1?{}:{api_key:s.api_key,api_key_history:[...(s.api_key_history||[])]}), parameters: parameters(s)} : p)};
}
function prepareUISettings(current, draft) {
  if (!current.api_profiles?.length && !draft.active_profile) return draft;
  const source = snapshotActive(current);
  if (draft.active_profile && draft.active_profile !== current.active_profile) {
    const p = source.api_profiles.find(p => p.id === draft.active_profile);
    if (!p) throw Error('模型配置不存在，请重新读取');
    if (draft.model===p.model && draft.base_url===p.base_url && draft.api_protocol===p.api_protocol && draft.adapter===p.adapter) {
      return snapshotActive({...draft,api_profiles:source.api_profiles});
    }
    return activate({...draft, api_profiles: source.api_profiles}, p);
  }
  const p = source.api_profiles.find(p => p.id === (current.active_profile || current.model));
  if (p && (draft.model !== current.model || draft.base_url !== current.base_url || draft.api_protocol !== current.api_protocol || draft.adapter !== current.adapter)) throw Error('请使用当前模型配置选择器切换；新接口须先完成探测');
  return snapshotActive({...draft, api_profiles: source.api_profiles});
}
// 有凭据的请求不跟随重定向，不回传响应正文中的潜在密钥。
async function request(url, key, body, signal, session) {
  const response = await fetch(url, {method: body ? 'POST' : 'GET', redirect: 'error', signal,
    headers: {Authorization: `Bearer ${key}`, ...require('./api.cjs').providerSessionHeaders(url,session), ...(body ? {'Content-Type': 'application/json'} : {})},
    ...(body ? {body: JSON.stringify(body)} : {})});
  if (!response.ok) { const e = Error(`HTTP ${response.status}`); e.status = response.status; throw e; }
  const reader = response.body.getReader(); let size = 0; const chunks = [];
  for (;;) { const {done, value} = await reader.read(); if (done) break; size += value.length; if (size > 2 * 1024 * 1024) { await reader.cancel(); throw Error('响应超过 2 MiB'); } chunks.push(value); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Error('接口没有返回有效 JSON'); }
}
async function probe(payload, session='') {
  const providerSession=session||'aieyra-probe-'+crypto.randomUUID();
  const base = baseURL(payload.base_url);
  const key = String(payload.api_key || '').trim();
  if (!key || key.length > 4096) throw Error('需要有效接口密钥');
  if(['anthropic_messages','google_generate'].includes(payload.api_protocol))return require('../host/onboarding.cjs').probeNative({...payload,base_url:base,api_key:key},providerSession);
  const signal = AbortSignal.timeout(45000);
  const bases = [base];
  if (new URL(base).pathname === '/') bases.push(base + '/v1');
  const evidence = []; let discovered = [];
  for (const url of bases) {
    try {
      const list = await request(url + '/models', key, null, signal, providerSession);
      discovered = [...new Set((list.data || []).map(m => m.id).filter(x => typeof x === 'string' && x.length <= 200))].slice(0, 200);
      evidence.push({endpoint: url + '/models', ok: true, count: discovered.length});
    } catch (e) { evidence.push({endpoint: url + '/models', ok: false, error: e.status ? `HTTP ${e.status}` : '模型目录不可用'}); }
    if (!payload.model) continue;
    for (const protocol of payload.api_protocol ? [payload.api_protocol] : ['responses', 'chat_completions']) {
      if (!['responses', 'chat_completions'].includes(protocol)) throw Error('不支持该协议');
      const endpoint = url + (protocol === 'responses' ? '/responses' : '/chat/completions');
      const nonce = crypto.randomBytes(6).toString('hex');
      const fn = {name: 'aieyra_probe', description: 'Return the supplied token unchanged.', parameters: {type: 'object', properties: {token: {type: 'string', enum: [nonce]}}, required: ['token'], additionalProperties: false}};
      const challenge = crypto.randomBytes(16).toString('hex');
      const user = {role: 'user', content: `Call aieyra_probe with token ${nonce}. The tool will return a different secret value. After receiving the tool result reply with only that value.`};
      try {
        const body = protocol === 'responses'
          ? {model: payload.model, input: [user], tools: [{type: 'function', ...fn, strict: false}], tool_choice: 'auto', stream: false, store: false}
          : {model: payload.model, messages: [user], tools: [{type: 'function', function: {...fn, strict: false}}], tool_choice: 'auto', stream: false};
        const first = await request(endpoint, key, body, signal, providerSession);
        const calls = protocol === 'responses' ? first.output?.filter(i => i.type === 'function_call') : first.choices?.[0]?.message?.tool_calls;
        if (protocol === 'responses' ? first.status !== 'completed' || !first.id : first.choices?.length !== 1 || first.choices[0].finish_reason !== 'tool_calls') throw Error('响应未正常结束');
        if (!Array.isArray(calls) || calls.length !== 1) throw Error('函数调用数量不匹配');
        const item = calls[0];
        const call = protocol === 'responses' ? item : item?.function;
        const args = call && JSON.parse(call.arguments);
        const callID = protocol === 'responses' ? item.call_id : item.id;
        if (!call || call.name !== fn.name || !args || Array.isArray(args) || Object.keys(args).length !== 1 || args.token !== nonce || typeof callID !== 'string' || !callID.trim() || (protocol !== 'responses' && item.type !== 'function')) throw Error('函数调用未通过验证');
        const follow = protocol === 'responses'
          ? {...body, input: [user, ...first.output, {type: 'function_call_output', call_id: item.call_id, output: challenge}]}
          : {...body, messages: [user, first.choices[0].message, {role: 'tool', tool_call_id: item.id, content: challenge}]};
        const second = await request(endpoint, key, follow, signal, providerSession);
        if (protocol === 'responses' ? second.status !== 'completed' || !second.id || second.output?.some(i=>i.type==='function_call') : second.choices?.length !== 1 || second.choices[0].finish_reason !== 'stop' || second.choices[0].message?.tool_calls?.length) throw Error('工具往返未正常结束');
        const reply = protocol === 'responses' ? (second.output || []).flatMap(i => i.content || []).map(c => c.text || '').join('') : second.choices?.[0]?.message?.content;
        if (String(reply || '').trim() !== challenge) throw Error('函数结果回传未通过验证');
        evidence.push({endpoint, ok: true, tool_roundtrip: true});
        return {ok: true, base_url: url, api_protocol: protocol, model: payload.model, models: discovered, tool_calls: true, verified_options: {stream: false, tool_choice: 'auto', output_limit: 'provider_default', response_format: 'text'}, evidence};
      } catch (e) { evidence.push({endpoint, ok: false, error: e.status ? `HTTP ${e.status}` : '协议或工具往返验证未通过'}); }
    }
  }
  return {ok: !payload.model && discovered.length > 0, models: discovered, evidence, requires_model: !payload.model};
}

function createSystemSettings(file, onWrite = () => {}, providers=require('./provider-settings.cjs').createProviderSettings(fetch,file)) {
  const onboarding=require('../host/onboarding.cjs').createOnboarding((action,p,session)=>call(action,p,session),file);
  const verified = new Map();
  const host = crypto.randomUUID(); const choiceFile = file + '.choices.json';
  function choiceStore(change) {
    return cfg.withWriteLock(choiceFile, undefined, () => {
      const items = fs.existsSync(choiceFile) ? JSON.parse(fs.readFileSync(choiceFile, 'utf8')) : [];
      for (const item of items) if (item.state === 'pending' && Date.now() - item.created >= 600000) item.state = 'expired';
      const kept = items.filter(item => Date.now() - item.created < 86400000);
      const result = change(kept);
      const tmp = choiceFile + '.' + crypto.randomUUID() + '.tmp';
      try { fs.writeFileSync(tmp, JSON.stringify(kept), {mode:0o600}); fs.renameSync(tmp,choiceFile); }
      finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
      return result;
    });
  }
  const publicChoice = item => item ? Object.fromEntries(Object.entries(item).filter(([k])=>!['host','claim','session'].includes(k))) : {state:'expired'};
  const read = (session='') => {
    const loaded=cfg.load(file),global=pool.migrate(loaded.settings),selection=sessionModels.read(file,session);
    let s=global,selectionError='';
    if(selection.profile_id){
      const profile=global.api_profiles.find(p=>p.id===selection.profile_id);
      if(!profile||profile.enabled===false)selectionError='会话模型不存在或已禁用，请重新选择；未回退到默认模型';
      else s=activate(global,profile);
    }
    const visible={...Object.fromEntries(Object.keys(spec.defaults()).map(k=>[k,s[k]])),subconscious_profile:s.subconscious_profile,compact_at_tokens:s.compact_at_tokens};
    return {ok:true,version:loaded.version,session_version:selection.version,selection_scope:selection.profile_id?'session':'default',default_profile:global.active_profile,effective_profile:selection.profile_id||global.active_profile,session_error:selectionError,settings:redact({...visible,api_profiles:profiles(s)}),models:profiles(s).filter(p=>p.enabled!==false).map(({id,name,model})=>({id,name,model}))};
  };
  const save = (s, expected) => {
    if (!expected || expected !== version(file)) return {ok: false, code: 'version_conflict', errors: ['配置已变化，请重新读取后修改'], version: version(file)};
    pool.clearSubconscious(s);
    try {pool.validate(s);} catch(e){return {ok:false,errors:[e.message]};}
    const errors = spec.validate(s, {requireKey: false}); if (errors.length) return {ok: false, errors};
    try { const r = cfg.save(file, s, expected); onWrite(r.mtime); return read(); }
    catch (e) { if (!['version_conflict','config_busy'].includes(e.code)) throw e; return {ok:false,code:e.code,errors:[e.message],version:version(file)}; }
  };
  const recovery=require('./connection-recovery.cjs').createRecovery(file,save);
  const selfSettings=require('./self-settings.cjs').createSelfSettings({file,save,redact,onWrite});
  const roleProfiles=require('./role-profile.cjs').createRoleProfile(file);
  const connection=require('../host/connection.cjs').createConnection(file,read,save,recovery);
  // 设置 · 模型三页（Aieyra API / 供应商 / 模型连接）走 pool + op；没有 op 时仍是原来的只读池。
  const setup=require('./model-setup.cjs').createModelSetup({file,providers,connection,save,version,load:()=>providers.hydrate(cfg.load(file).settings)});
  async function call(action, p = {}, session = '') {
    if(action==='role_profile')return roleProfiles.call(p);
    if(['schema','inspect','validate','apply','restore','diagnostics'].includes(action))return selfSettings.call(action,p);
    if(action==='os_appearance_read')return require('./os-appearance.cjs').createAppearanceStore(file).read();
    if(action==='os_appearance_update')return require('./os-appearance.cjs').createAppearanceStore(file).update(p.patch,p.expected_version);
    if(action.startsWith('onboarding_')){
      const result=await onboarding(action,p,session);
      if(action==='onboarding_catalog'&&result.ok)return {...result,models:catalog.rows({provider:result.provider,base_url:p.base_url},result.models)};
      return result;
    }
    let s = providers.hydrate(cfg.load(file).settings);
    if(action==='connection_recovery')return {...recovery.status(),version:version(file)};
    if(action==='connection_restore')return recovery.restore(s,p.expected_version);
    if(['connection_draft','response_test','response_save'].includes(action))return connection(action,p,session,s);
    if(action==='connections')return {ok:true,version:version(file),config_file:file,connections:s.provider_connections.map(c=>({id:c.id,name:c.name||c.provider,provider:c.provider,base_url:c.base_url,has_key:!!c.api_key,key_count:c.api_key_history.length,user_slot:c.user_slot||null,model_count:s.api_profiles.filter(m=>m.connection_id===c.id).length,request_timeout_seconds:c.request_timeout_seconds}))};
    if(action==='connection_update'){
      return save(require('./agent-connections.cjs').update(s,p),p.expected_version);
    }
    if(action==='connection_remove')return save(require('./agent-connections.cjs').remove(s,p),p.expected_version);
    if(action==='catalog'||action==='catalog_add'){
      const c=s.provider_connections.find(c=>c.id===p.connection_id);if(!c)throw Error('供应商连接不存在，请先读取connections');
      let draft=providers.select(s,s,c.provider,c.id);
      if(p.refresh===true)draft=(await providers.discover(draft,{refresh:true})).settings;
      if(action==='catalog_add'){draft=providers.add(s,draft,p.model);return save(providers.prepare(s,draft),p.expected_version);}
      let list=draft.__models.filter(m=>(!p.free_only||m.free===true)&&(!p.query||(m.id+' '+m.name).toLowerCase().includes(String(p.query).toLowerCase())));
      const offset=Math.max(0,Math.floor(Number(p.offset)||0)),limit=Math.min(100,Math.max(1,Math.floor(Number(p.limit)||30)));
      return {ok:true,version:version(file),connection_id:c.id,total:list.length,offset,models:list.slice(offset,offset+limit),fetched_at:draft.__catalog_updated_at,notice:draft.__catalog_notice};
    }
    if(action==='capabilities_refresh'||action==='parameters_probe'){
      if(!p.expected_version||p.expected_version!==version(file))return {ok:false,code:'version_conflict',errors:['配置已变化，请重新读取后修改'],version:version(file)};
      const result=await providers.learn(s,p.id,action==='capabilities_refresh'?'refresh':'probe',p.parameters,p.descriptors);
      if(!result.ok)return result;
      const saved=save(providers.prepare(s,result.settings),p.expected_version);return {...saved,probe:result.result,notice:result.notice};
    }
    if(action==='matrix'){const models=profiles(s);return {ok:true,version:version(file),matrix_profile:s.matrix_profile,subconscious_profile:s.subconscious_profile,active_profile:s.active_profile,models:redact(models),selected:redact(models.find(x=>x.id===(p.id||s.matrix_profile)))};}
    if(action==='model_adapter_update'){
      const profile=s.api_profiles.find(x=>x.id===p.id);if(!profile)throw Error('模型池中没有此模型');
      const choice=p.selection;
      if(choice!==null&&(!choice||typeof choice!=='object'||Array.isArray(choice)||Object.keys(choice).some(k=>!['id','digest'].includes(k))||typeof choice.id!=='string'||choice.id.length>160||!/^[a-z][a-z0-9_-]*(?:\.[a-z0-9_-]+)+$/.test(choice.id)||!/^[a-f0-9]{64}$/.test(choice.digest)))throw Error('API适配包标识无效');
      if(choice===null)delete profile.adapter_package;else profile.adapter_package=structuredClone(choice);
      return save(pool.synchronize(providers.hydrate(s)),p.expected_version);
    }
    if(action==='model_test'){const profile=s.api_profiles.find(x=>x.id===p.id);if(!profile)throw Error('模型池中没有此模型');return {ok:true,result:await require('./api.cjs').ping(pool.activate(s,profile))};}
    if(action==='model_diagnostics')return require('./model-diagnostics.cjs').diagnose(s,p.id,p.mode);
    if(action==='pool_action'){if(!['toggle','matrix','main','subconscious','use','remove'].includes(p.operation))throw Error('无效模型池操作');return save(pool.synchronize(pool.action(s,p.operation,p.id)),p.expected_version);}
    if (action === 'read') return read(session);
    if (action === 'appearance_read') return require('./appearance-settings.cjs').read();
    if (action === 'appearance_update') return require('./appearance-settings.cjs').update(p.patch,p.expected_version);
    if (action === 'models') {const current=read(session);return {ok:true,models:current.models,active_profile:current.effective_profile,matrix_profile:s.matrix_profile,default_profile:current.default_profile,selection_scope:current.selection_scope,session_version:current.session_version,session_error:current.session_error};}
    if (action === 'pool' && p.op) return setup(p, session, s);
    if (action === 'pool') {const setupView=require('./model-setup.cjs').view(s);return {ok:true,version:version(file),models:redact(profiles(s)).map(m=>({...m,source:setupView.models.find(x=>x.id===m.id)?.source,kind:pool.kindOf(m)})),matrix_profile:s.matrix_profile,subconscious_profile:s.subconscious_profile,active_profile:s.active_profile,roles:setupView.roles,connections:setupView.connections};}
    if (action === 'model_update' || action === 'matrix_update') {
      const i=s.api_profiles.findIndex(x=>x.id===p.id);if(i<0)throw Error('模型池中没有此模型');
      s.api_profiles[i]=capabilities.edit(s.api_profiles[i],{...p.parameters,...Object.fromEntries(['context_window','compact_at_tokens'].filter(k=>Object.hasOwn(p,k)).map(k=>[k,p[k]]))});
      if(typeof p.enabled==='boolean')s.api_profiles[i].enabled=p.enabled;
      if(p.matrix){if(!s.api_profiles[i].enabled)throw Error('请先启用模型');s.matrix_profile=p.id;s.active_profile=p.id;}
      if(p.role!==undefined||p.roles!==undefined)pool.assignRoles(s,p.id,p);
      if(!s.api_profiles.some(x=>x.id===s.matrix_profile&&x.enabled))s.matrix_profile='';
      return save(pool.synchronize(s),p.expected_version);
    }
    if (action === 'probe') {
      const input = {...p};
      if(p.connection_id){const c=s.provider_connections.find(c=>c.id===p.connection_id);if(!c)throw Error('连接不存在');input.base_url||=c.base_url;if(!input.api_key){if(baseURL(input.base_url)!==c.base_url)throw Error('新地址需要对应密钥');input.api_key=c.api_key;}}
      if (p.profile_id) {
        const profile = profiles(s).find(x => x.id === p.profile_id); if (!profile) throw Error('模型配置不存在');
        input.base_url ||= profile.base_url; input.model ||= profile.model;
        if (!input.api_key) {
          if (new URL(baseURL(input.base_url)).origin !== new URL(baseURL(profile.base_url)).origin) return {ok:false,code:'credential_origin_mismatch',errors:['复用密钥仅允许原站点；新站点请明确提供该站点密钥']};
          input.api_key = s.provider_connections.find(c=>c.id===profile.connection_id)?.api_key||'';
        }
      }
      for (const [id, proof] of verified) if (proof.expires < Date.now()) verified.delete(id);
      if (verified.size >= 64) throw Error('探测过多，请等待旧探测过期');
      const result = await probe(input,session);
      if (result.ok && result.tool_calls) {
        const id = crypto.randomUUID(); verified.set(id, {...result, session, connection_id:input.connection_id,api_key: input.api_key, expires: Date.now() + 600000});
        result.probe_id = id;
      }
      return result;
    }
    if (action === 'configure') {
      const proof = verified.get(p.probe_id);
      if (!proof || proof.session !== session || proof.expires < Date.now()) return {ok: false, errors: ['先在本会话探测并通过工具往返验证，再使用有效 probe_id 保存']};
      const id = String(p.id || '').trim(); if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(id)) throw Error('配置标识只能含字母、数字、点、横线、下划线');
      const window = Number(p.context_window); if (!Number.isInteger(window) || window < 8192 || window > 10000000) throw Error('请提供经过核实的上下文窗口，范围 8192–10000000');
      if (p.adapter === 'deepseek') throw Error('探测使用通用协议；基础 DeepSeek 配置已内置，无需指定专用适配器');
      const profile = {id, name: String(p.name || proof.model).slice(0, 120), model: proof.model, base_url: proof.base_url, api_key: proof.api_key, api_key_history:[proof.api_key], api_protocol: proof.api_protocol, adapter: 'openai', context_window: window, tool_calls: true, vision: false, parameters: parameters({...spec.defaults(), stream:false, stream_include_usage:false, max_tokens:0}), verified_options:proof.verified_options};
      profile.connection_id=proof.connection_id||pool.connectionID(profile);profile.provider=require('./provider-settings.cjs').identity(profile);profile.enabled=true;
      profile.parameter_specs=capabilities.specs(profile.provider,{id:profile.model,api_protocol:profile.api_protocol,output_limit:capabilities.bundled.providers[profile.provider]?.[profile.model]?.limit?.output||8192});
      const previousConnection=s.provider_connections.find(c=>c.id===profile.connection_id);
      const keyHistory=[...new Set([profile.api_key,...previousConnection?.api_key_history||[],previousConnection?.api_key].filter(Boolean))];
      if(keyHistory.length>8)throw Error('此连接已保存 8 把密钥，请先整理历史；未覆盖任何已有密钥');
      const connections=s.provider_connections.filter(c=>c.id!==profile.connection_id).concat({...previousConnection,id:profile.connection_id,provider:profile.provider,base_url:profile.base_url,api_key:profile.api_key,api_key_history:keyHistory,request_timeout_seconds:s.request_timeout_seconds});
      delete profile.api_key;delete profile.api_key_history;
      const all = snapshotActive(s).api_profiles; const index = all.findIndex(x => x.id === id);
      if(index>=0&&all[index].model===profile.model&&all[index].base_url===profile.base_url&&all[index].api_protocol===profile.api_protocol){profile.parameters=all[index].parameters;profile.parameter_specs=all[index].parameter_specs;}
      if (index < 0) all.push(profile); else all[index] = profile;
      if (all.length > 64) throw Error('最多保存 64 个模型配置');
      if(p.context_source)profile.context_window_source=p.context_source;
      const next = {...s, api_profiles: all,provider_connections:connections,...(p.matrix===true?{matrix_profile:id}:{})};
      return save(p.activate || s.active_profile === id ? activate(next, profile) : next, p.expected_version);
    }
    if (action === 'switch') {
      if(p.scope!==undefined&&!['session','global'].includes(p.scope))throw Error('scope 仅支持 session 或 global');
      if(p.scope==='session'&&!session)throw Error('会话切换需要 session_id');
      if(session&&p.scope!=='global'){
        if(p.reset!==true&&(typeof p.id!=='string'||!p.id))throw Error('请选择模型或明确 reset:true 恢复默认');
        const result=sessionModels.select(file,session,p.reset===true?'':p.id,p.expected_version,p.expected_session_version);
        return result.ok?read(session):result;
      }
      const all = snapshotActive(s).api_profiles; const profile = all.find(x => x.id === p.id); if (!profile) throw Error('模型配置不存在');
      return save(activate({...s, api_profiles: all}, profile), p.expected_version);
    }
    if (action === 'remove') {
      if ((s.active_profile || s.model) === p.id) throw Error('请先切换到其他模型，再删除当前配置');
      return save({...s,matrix_profile:s.matrix_profile===p.id?'':s.matrix_profile, api_profiles: profiles(s).filter(x => x.id !== p.id)}, p.expected_version);
    }
    if (action === 'update') {
      const allowed = new Set(['language', 'request_timeout_seconds', 'show_reasoning', 'compact_percent', 'compact_keep_turns', 'context_working_tokens','memory_enabled','dreams_enabled','memory_surface_tokens','system_prompt', 'prompt_dir']);
      for (const k of Object.keys(p.patch || {})) if (!allowed.has(k)) throw Error('不可修改的设置字段：' + k);
      if(p.patch?.request_timeout_seconds!==undefined){const c=s.provider_connections.find(c=>c.id===s.api_profiles.find(x=>x.id===s.active_profile)?.connection_id);if(c)c.request_timeout_seconds=p.patch.request_timeout_seconds;}
      return save(pool.synchronize(snapshotActive({...s, ...p.patch})), p.expected_version);
    }
    if (action === 'choose_model') {
      const presentation=require('./window-presentation.cjs').mode(p.presentation);
      if (process.env.AIEYRA_SETTINGS_HOST !== '1') return {ok: false, code: 'host_unavailable', errors: ['当前没有原生设置窗口，用户可在下拉菜单选择模型']};
      if (!session) return {ok:false,errors:['模型选择必须属于一个聊天会话']};
      const id = crypto.randomUUID(); const options = profiles(s).filter(p=>p.enabled!==false).map(({id, name, model}) => ({id, name, model}));
      return choiceStore(items => {
        const existing = items.find(i=>i.session===session && i.state==='pending');
        if (existing) {
          if(p.presentation!==undefined){
            existing.presentation=presentation;
            // 撤销窗口持有的claim，旧状态轮询会收起对话框；迟到的答案不能保存。
            if(presentation==='display')delete existing.claim;
          }
          return {ok:true,request_id:existing.id,state:'pending',presentation:existing.presentation||'display',options:existing.options};
        }
        if (items.length>=256) return {ok:false,errors:['选择请求过多，请稍后重试']};
        items.push({id, host, session, title: String(p.title || '').slice(0,200), options, version: version(file), session_version:sessionModels.read(file,session).version, state: 'pending',presentation, created: Date.now()});
        return {ok: true, request_id: id, state: 'pending',presentation,options,instruction: presentation==='display'?'Selection prepared without opening a modal. Call choose_model with presentation=interactive when user input is needed.':'Wait for user choice. Do not select on behalf of the user.'};
      });
    }
    if (action === 'choice_result' || action === 'choice_cancel') return choiceStore(items => {
      const item = items.find(i=>i.id===p.request_id && i.session===session);
      if (item?.state==='pending' && (action==='choice_cancel' || item.host!==host)) item.state=action==='choice_cancel'?'cancelled':'expired';
      return {ok:true,...publicChoice(item)};
    });
    throw Error('未知系统设置操作');
  }
  async function choice(method, p = {}) {
    if (method === 'pending') return choiceStore(items=>({ok:true,requests:items.filter(i=>i.host===host && i.state==='pending' && !i.claim && i.presentation==='interactive').map(publicChoice)}));
    if (method === 'status') return choiceStore(items=>({ok:true,...publicChoice(items.find(i=>i.id===p.request_id&&i.host===host&&i.claim===p.claim))}));
    if (method === 'claim') return choiceStore(items=>{
      const item=items.find(i=>i.id===p.request_id && i.host===host && i.state==='pending');
      if (!item || item.presentation!=='interactive' || item.claim || !p.claim) return {ok:false};
      item.claim=String(p.claim); return {ok:true,...publicChoice(item)};
    });
    if (method !== 'answer') throw Error('未知选择操作');
    // 配置保存和结果状态都为同步操作；持有选择锁时没有网络等待。
    return choiceStore(items=>{
      const item=items.find(i=>i.id===p.request_id && i.host===host && i.state==='pending');
      if (!item || item.presentation!=='interactive' || !item.claim || item.claim!==p.claim) return {ok:false,errors:['选择请求已过期、取消或由另一窗口处理']};
      if (p.cancel) {item.state='cancelled'; return {ok:true};}
      if (!item.options.some(x=>x.id===p.id)) throw Error('无效模型选择');
      const s=snapshotActive(cfg.load(file).settings); const profile=s.api_profiles.find(x=>x.id===p.id);
      let result=profile?sessionModels.select(file,item.session,p.id,item.version,item.session_version):{ok:false,code:'version_conflict'};
      if(result.ok)result=read(item.session);
      item.state=result.ok?'selected':'conflict'; if (result.ok) item.selected=p.id;
      return result;
    });
  }
  return {call, choice, read, profiles: () => profiles(cfg.load(file).settings)};
}
module.exports = {createSystemSettings, version, profiles, activate, snapshotActive, prepareUISettings, redact, baseURL, probe, parameters};
