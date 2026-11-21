// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/src/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: spec; cfg; api; pool; assertCloneable; createService; interaction; computer; handlers; updates; providers; rendererSettings; uiResult; system
// Impact: python -B scripts/code-atlas.py show Client/Desktop/src/service.cjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

'use strict';
// Electron 与内嵌 Terminal 页面共用的配置服务；参数校验和原子保存只有一份。
const spec=require('./spec.cjs');
const cfg=require('./config.cjs');
const api=require('./api.cjs');
const pool=require('./model-pool.cjs');
function assertCloneable(value, label) {
  try {
    structuredClone(value);
  } catch (err) {
    throw new Error(
      `${label} 含有无法通过 IPC 传递的内容（${err.message}）。`
      + '函数、Symbol、类实例都不能出现在 IPC 返回值里。',
    );
  }
  return value;
}


function createService(configFile,onWrite=()=>{}) {
const interaction=require('./agent-interaction.cjs').createInteraction(configFile);
const computer=require('./agent-computer.cjs').createComputer(configFile);
const handlers=Object.create(null);
let updates;
// Memory tools are served by Core/SettingsService. This settings process must
// never open another database or bypass the shared memory authorization.
handlers['agent:updates']=async payload=>{
 try{
  const params=payload?.arguments||{};
  if(!updates)updates=require('./managed-updates.cjs').createManagedUpdates({root:process.env.AIEYRA_ROOT||require('node:path').resolve(__dirname,'../../..')});
  return await updates.call(params);
 }catch(e){return {ok:false,error:String(e.message)};}
};
handlers['agent:browser']=async (payload,signal)=>{
 try{return await interaction.browser(String(payload?.session_id||''),payload?.arguments||{},signal);}
 catch(e){return {ok:false,error:String(e.message)};}
};
handlers['agent:computer']=async (payload,signal)=>{
 try{return await computer.call(String(payload?.session_id||''),payload?.arguments||{},signal);}
 catch(e){return {ok:false,error:String(e.message)};}
};
const providers=require('./provider-settings.cjs').createProviderSettings(fetch,configFile);
const rendererSettings=settings=>({...settings,official_account:{}});
const uiResult=settings=>({ok:true,settings:rendererSettings(providers.decorate(settings)),nativeFields:require('./native-config.cjs').fields(providers.decorate(settings))});
handlers['config:draft-state']=payload=>({ok:true,dirty:require('./settings-draft.cjs').dirty(payload.settings,payload.baseline,providers)});
handlers['provider:filter']=payload=>uiResult(payload.settings);
for(const action of ['select','discover','choose','add'])handlers['provider:'+action]=async payload=>{
 try {
  const current=cfg.load(configFile).settings;
  if(action==='discover'){const result=await providers.discover(payload.settings);return {...uiResult(result.settings),notice:result.notice};}
  return uiResult(providers[action](current,payload.settings,payload.id));
 } catch(e){return {ok:false,errors:[e.status? (payload?.settings?.language==='en-US'?'Model catalog request failed: ':'模型目录请求失败：')+'HTTP '+e.status : e.message==='fetch failed' ? (payload?.settings?.language==='en-US'?'Unable to reach provider; check your connection and retry':'无法连接供应商，请检查网络后重试') : String(e.message).split(String(payload?.settings?.api_key||'NON_SECRET')).join('[redacted]')]};}
};
for(const action of ['edit','select','apply','cancel','toggle','matrix','use','remove'])handlers['pool:'+action]=payload=>{
 try{return uiResult(providers.poolAction(payload.settings,action,payload.id));}catch(e){return {ok:false,errors:[e.message]};}
};
handlers['pool:test']=async payload=>{
 try{const s=pool.editDraft(providers.capture(payload.settings)),p=s.api_profiles.find(p=>p.id===payload.id);if(!p)throw Error('模型池中没有此模型');const active=pool.activate(s,p);pool.validate(active,true);const errors=spec.validate(active);if(errors.length)return {ok:false,errors};return {ok:true,result:await api.ping(active)};}catch(e){return {ok:false,errors:[e.apiError?'HTTP '+e.apiError.status+': '+(e.apiError.hint||'模型请求未成功'):e.message]};}
};
for(const mode of ['refresh','probe'])handlers['pool:'+mode]=async payload=>{
 try{const result=await providers.learn(payload.settings,payload.id,mode,payload.parameters);return result.ok?{...uiResult(result.settings),notice:result.notice,result:result.result}:result;}catch(e){return {ok:false,errors:[e.status?'HTTP '+e.status:e.message]};}
};
const system=require('./system-settings.cjs').createSystemSettings(configFile,onWrite,providers);
handlers['system:settings'] = async payload => {
 try { return await system.call(payload?.action,payload?.arguments||{},String(payload?.session_id||'')); }
 catch (e) {
  let message=String(e.message);const secrets=[];
  const collect=v=>{if(Array.isArray(v)){for(const x of v)collect(x);}else if(v&&typeof v==='object'){for(const [k,x]of Object.entries(v)){if(k==='session_cookies')secrets.push(...(Array.isArray(x)?x.map(c=>c.value):[]));else if(k==='api_key'||k==='api_key_history')secrets.push(...(Array.isArray(x)?x:[x]));else collect(x);}}};
  collect(payload?.arguments);try{collect(cfg.load(configFile).settings);}catch{}
  for(const key of secrets)if(typeof key==='string'&&key)message=message.split(key).join('[redacted]');
  return {ok:false,code:e.code,errors:[message]};
 }
};
handlers['system:choices'] = payload => system.choice(payload?.action,payload||{});
handlers['config:models'] = () => system.call('models');
handlers['config:draft-profile'] = payload => {
 try{return uiResult(providers.poolAction(payload.settings,'use',payload.id));}catch(e){return {ok:false,errors:[e.message]};}
};
/** 界面初始化所需的全部数据：字段规范 + 当前配置 + 提示词状态。 */
handlers['config:bootstrap'] = () => {
  const loaded = cfg.load(configFile);
  loaded.settings=providers.decorate(loaded.settings);
  configFile = loaded.file;
  onWrite(loaded.mtime);
  const prompt = cfg.promptStatus(loaded.settings.prompt_dir);

  // 每个字段当前的置灰/说明状态也一并算好：渲染层拿到就能直接画，
  // 同时它自己也能用同一套规则本地重算（规则是数据，不是函数）。
  const ctx = { resolvedPromptDir: prompt.dir };
  const fields = spec.renderSpec().map((g) => ({
    ...g,
    fields: g.fields.map((f) => ({
      ...f,
      state: spec.fieldState(f.key, loaded.settings, ctx),
    })),
  }));

  return assertCloneable({
    officialBaseURL: spec.DEFAULT_BASE_URL,
    file: configFile,
    exists: loaded.exists,
    mtime: loaded.mtime,
    version: loaded.version,
    settings: rendererSettings(loaded.settings),
    unknownKeys: Object.keys(loaded.unknown),
    groups: fields,
    models: spec.MODELS,
    defaults: spec.defaults(),
    nativeFields: require('./native-config.cjs').fields(loaded.settings),
    prompt,
    resolvedPromptDir: prompt.dir,
    limits: {
      maxTokens: spec.MAX_TOKENS_LIMIT,
      maxTokensThink: spec.MAX_TOKENS_THINK,
      maxTokensPlain: spec.MAX_TOKENS_PLAIN,
      maxTokensMaxEffort: 131072, // effort=max 时的服务端默认（与 Go EffectiveMaxTokens 一致）
      topPMin: 0.01,
      topPMax: 1,
      tempMin: 0,
      tempMax: 2,
    },
  }, 'config:bootstrap 的返回值');
};

/** 保存。返回落盘后的实际内容与提示词状态，供界面回填确认。 */
handlers['config:save'] = (payload) => {
  if (payload?.expected_version && payload.expected_version !== require('./system-settings.cjs').version(configFile)) return {ok:false,code:'version_conflict',errors:['配置已变化，请重新载入后保存']};
  let settings = { ...(payload && payload.settings) };
  const current = cfg.load(configFile).settings;
  settings.official_account=current.official_account;
  settings.user_connections=current.user_connections;
  settings.user_connection_drafts=current.user_connection_drafts;
  settings.aieyra_key_drafts=current.aieyra_key_drafts;
  try { settings = providers.prepare(current, settings); }
  catch (err) { return {ok:false,errors:[err.message]}; }
  delete settings.__resolvedPromptDir;

  // 允许移除最后一把 Key 并保存空配置；请求与测试连接仍严格要求 Key。
  const errs = spec.validate(settings, {requireKey:false});
  if (errs.length) {
    return { ok: false, errors: errs };
  }
  settings.api_key_history = cfg.rememberKey(settings, settings.api_key);

  try {
    const res = cfg.save(configFile, settings, payload?.expected_version);
    onWrite(res.mtime);
    const prompt = cfg.promptStatus(res.settings.prompt_dir);
    const viewSettings=providers.decorate({...res.settings,__matrix_model:payload?.settings?.__matrix_model});
    return {
      ok: true,
      file: res.file,
      mtime: res.mtime,
      version: res.version,
      settings: rendererSettings(viewSettings),
      nativeFields: require('./native-config.cjs').fields(viewSettings),
      prompt,
      warnings: spec.warnings(res.settings),
    };
  } catch (err) {
    return { ok: false, code: err.code, errors: [err.message] };
  }
};

/** 只校验不落盘，用于实时反馈。 */
handlers['config:validate'] = (settings) => {
  const s = { ...settings };
  delete s.__resolvedPromptDir;
  return { errors: spec.validate(s), warnings: spec.warnings(s) };
};

/** 请求体预览：让用户看到「到底会发什么」。 */
handlers['config:preview'] = (settings) => {
  const s = { ...settings };
  delete s.__resolvedPromptDir;
  return spec.requestPreview(s);
};

/** 测试连接。 */
handlers['api:ping'] = async (settings) => {
  if(settings.model_pool_version===1){try{const r=await providers.discover(settings);return {...uiResult(r.settings),result:{elapsedMs:0,models:r.settings.__models.length},notice:r.notice};}catch(e){return {ok:false,errors:[e.status?'HTTP '+e.status:'供应商目录连接失败，请检查网络与代理']};}}
  const s = { ...settings };
  delete s.__resolvedPromptDir;
  const errs = spec.validate(s);
  if (errs.length) return { ok: false, errors: errs };
  try {
    const r = await api.ping(s);
    return { ok: true, result: r };
  } catch (err) {
    return {
      ok: false,
      errors: [err.message],
      hint: s.adapter==='openai' ? (s.language==='en-US'?'Check this provider’s key, balance, model access and request parameters.':'请检查当前供应商的密钥、余额、模型权限和请求参数。') : (err.apiError && err.apiError.hint) || '',
      status: (err.apiError && err.apiError.status) || 0,
    };
  }
};

/** 列出模型。 */
handlers['api:models'] = async (settings) => {
  const s = { ...settings };
  delete s.__resolvedPromptDir;
  try {
    const list = await api.listModels(s);
    return { ok: true, models: list };
  } catch (err) {
    return {
      ok: false,
      errors: [err.message],
      hint: (err.apiError && err.apiError.hint) || '',
    };
  }
};

/** 重载提示词：重新读盘并返回各层状态。 */
handlers['prompt:reload'] = (dir) => {
  try {
    return { ok: true, prompt: cfg.promptStatus(dir) };
  } catch (err) {
    return { ok: false, errors: [err.message] };
  }
};

/** 恢复出厂参数（保留 Key 与提示词目录），不落盘，由用户确认后再保存。 */
handlers['config:reset'] = (current) => {
  try {
    return { ok: true, settings: spec.resetSettings(current) };
  } catch (err) {
    return { ok: false, errors: [err.message] };
  }
};


handlers['config:model'] = async (model) => {
 const state=system.read();
 try { return await system.call('switch',{id:model,expected_version:state.version}); } catch { return {ok:false,errors:['模型配置不存在']}; }
};
return {close(){updates?.close();interaction.close();computer.close();},call(method,payload,signal){
 if(!Object.hasOwn(handlers,method))throw new Error('未知操作');
 return require('./model-diagnostic-worker.cjs').withOwner(configFile,signal,()=>handlers[method](payload,signal));
},methods:Object.keys(handlers)};
}
module.exports={createService};
