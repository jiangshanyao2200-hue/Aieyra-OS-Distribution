/* @file-map:start
文件: link/desktop/cloud-client.cjs
位置: 二环·桌面能力 | Electron生命周期、权限边界、本机服务、云账号与可诊断桌面模块。
约束: renderer通过preload白名单进入主进程，禁止开放任意IPC；启动失败先持久取证；关闭须收束服务租约和诊断
下游: link/desktop/development-download.cjs, link/desktop/request-gate.cjs, link/desktop/transfer-recovery.cjs
上游: AIDEBUG/cloud-recovery.test.cjs, AIDEBUG/multi-engineer.cjs, AIDEBUG/network-probe.test.cjs, link/desktop/login-window.cjs, link/desktop/main.cjs, link/desktop/visible-aidebug.cjs, link/desktop/workspace-aidebug.cjs
链路: governance
验证: AIDEBUG/cloud-recovery.test.cjs, AIDEBUG/multi-engineer.cjs, AIDEBUG/network-probe.test.cjs, tests/test_u81_runtime.py
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  hash | function
  fail | function
  CloudClient | class
  CloudClient.constructor | method
  CloudClient.restore | method
  CloudClient.recordDiagnostic | method
  CloudClient.persist | method
  CloudClient.state | method
  CloudClient.clear | method
  CloudClient.request | method
  CloudClient.performRequest | method
  CloudClient.performRequest.abort | function
  CloudClient.beginLogin | method
  CloudClient.downloadDevelopment | method
  CloudClient.downloadReleasedArtifact | method
  CloudClient.downloadBinary | method
  CloudClient.downloadBinary.active | function
  CloudClient.downloadBinary.diagnostic | method
  CloudClient.downloadBinary.request | method
  CloudClient.cancelLogin | method
  CloudClient.completeLogin | method
  CloudClient.cachedAccess | method
  CloudClient.applyAccess | method
  CloudClient.refresh | method
  CloudClient.logout | method
  CloudClient.verify | method
  CloudClient.lock | method
  CloudClient.call | method
  CloudClient.source | method
  CloudClient.source.active | function
  CloudClient.confirmLocal | method
  CloudClient.pairing | method
  CloudClient.preparePairing | method
  CloudClient.preparePairing.persist | function
  CloudClient.close | method
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ORIGIN = 'https://osupdate.aieyra.cn';
const ACCOUNT = 'https://api.aieyra.cn';
const /* @chain-region hash | calls: digest, update, crypto.createHash */ hash = value => crypto.createHash('sha256').update(value).digest('hex');
const /* @chain-region fail | calls: Object.assign, Error */ fail = (message, status = 400) => Object.assign(Error(message), { status });
const ROUTES = /^\/(?:elections(?:\/(?:vote|authorize|authorization|candidate|manage|management))?|engineering\/(?:updates(?:\/commit)?|overview|tasks|task|brief|events|repository|development|archive|manifest|file|reviews|workflow|verifications|compositions|releases(?:\/(?:proposals|propose|vote))?|release|handoffs|live\/(?:context|plan|conflicts|pheromones|rooms|room|drafts|draft|queue|sync))|access|apply|agents(?:\/revoke)?|discussions(?:\/(?:comment|like))?|board|members|votes|code(?:\/(?:file|archive))?|public\/events|goals(?:\/(?:nominate|vote))?|agendas(?:\/[a-f0-9]{32}(?:\/(?:publish|vote|comment|cancel|complete))?)?|keys(?:\/revoke)?|chat\/(?:messages|assets\/[a-f0-9]{32}|uploads(?:\/[a-f0-9]{32}\/(?:chunk|complete))?)|admin\/(?:elections\/resolve|engineering\/(?:promote|updates\/sync)|overview|applications(?:\/review)?|goals\/(?:establish|complete)|agendas\/(?:assign|remove)|comments\/remove|discussions\/remove|users\/(?:disable|moderate)|chat\/remove|settings))$/;

const { RequestGate } = require('./request-gate.cjs');
/* @chain-region CloudClient */ class CloudClient {
  /* @chain-region CloudClient.constructor | calls: path.join, Set, restore */ constructor({ directory, safeStorage, changed = () => {}, fetchImpl = fetch, origin = ORIGIN, activity = () => {}, ephemeral = false }) {
    this.file = ephemeral ? null : path.join(directory, 'cloud-session.enc'); this.safeStorage = safeStorage;
    this.activity = activity; this.changed = changed; this.fetch = fetchImpl; this.origin = origin; this.session = null;
    this.grant = null; this.pending = null; this.generation = 0; this.active = 0; this.controllers = new Set();
    this.access = null; this.accessSession = null; this.accessAt = 0; this.refreshFlight = null;this.diagnostics=[];
    if(this.file)this.restore();
  }
  /* @chain-region CloudClient.restore | calls: safeStorage.isEncryptionAvailable, fs.existsSync, fs.statSync, JSON.parse, safeStorage.decryptString, fs.readFileSync, test, Date.now … */ restore() {
    try {
      if (!this.safeStorage.isEncryptionAvailable() || !fs.existsSync(this.file) || fs.statSync(this.file).size > 800000) return;
      const value = JSON.parse(this.safeStorage.decryptString(fs.readFileSync(this.file)));
      if (!/^[A-Za-z0-9_-]{43}$/.test(value.accessToken) || value.expiresAt <= Date.now() || !value.user?.id || crypto.createPrivateKey(value.privateKey).asymmetricKeyType !== 'ed25519') return;
      this.session = value;
    } catch { /* A corrupt/foreign DPAPI envelope only requires a fresh login. */ }
  }
  /* @chain-region CloudClient.recordDiagnostic | calls: diagnostics.push, diagnostics.shift, onDiagnostic */ recordDiagnostic(row){this.diagnostics.push(row);if(this.diagnostics.length>100)this.diagnostics.shift();this.onDiagnostic?.(row);}
  /* @chain-region CloudClient.persist | calls: safeStorage.isEncryptionAvailable, fs.mkdirSync, path.dirname, fs.writeFileSync, safeStorage.encryptString, JSON.stringify, fs.renameSync */ persist() {
    if (!this.file || !this.session || !this.safeStorage.isEncryptionAvailable()) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = this.file + '.tmp';
    fs.writeFileSync(temp, this.safeStorage.encryptString(JSON.stringify(this.session)), { mode: 0o600 });
    fs.renameSync(temp, this.file);
  }
  /* @chain-region CloudClient.state | calls: Date.now */ state() {
    if (this.grant && this.grant.expiresAt <= Date.now()) this.grant = null;
    return { signedIn: !!this.session && this.session.expiresAt > Date.now(), user: this.session?.user || null,
      adminUntil: this.session?.user?.role===100 ? this.session.expiresAt : 0, generation: this.generation };
  }
  /* @chain-region CloudClient.clear | calls: gate.reset, c.abort, fs.unlinkSync, changed, state */ clear() {
    this.gate?.reset();
    this.generation++; this.pending = null; this.session = null; this.grant = null;
    this.access = null; this.accessSession = null; this.accessAt = 0; this.refreshFlight = null;
    for (const c of this.controllers) c.abort();
    if(this.file)try { fs.unlinkSync(this.file); } catch {}
    this.changed(this.state());
  }
  /* @chain-region CloudClient.request | calls: RequestGate, hash, gate.run, performRequest */ request(route, payload, options = {}) {
    this.gate ||= new RequestGate();
    options = {credential: this.session, ...options};
    const key = this.generation + ':' + hash((options.credential || this.session)?.accessToken || '') + ':' + route + ':' + (options.admin ? this.grant?.token || '' : '') + ':' + (options.binary ? 'binary' : 'json');
    return this.gate.run(key, payload === undefined, () => this.performRequest(route, payload, options),
      route === '/api/v1/auth/logout', options.signal, options.deferThrottle);
  }
  /* @chain-region CloudClient.performRequest | calls: fail, URL, JSON.stringify, Buffer.byteLength, Date.now, Object.fromEntries, map, sort … */ async performRequest(route, payload, { credential = this.session, signed = true, admin = false, binary = false, progress, signal } = {}) {
    if (this.active >= 8) throw fail('请求正在处理中，请稍后再试。', 429);
    const url = new URL(route, this.origin);
    if (url.origin !== this.origin || url.username || url.password || url.hash) throw fail('请求地址无效。');
    const method = payload === undefined ? 'GET' : 'POST', raw = payload === undefined ? undefined : JSON.stringify(payload);
    const limit = url.pathname === '/api/v1/together/agent/site-content' ? 100000 : 32768;
    if (raw && Buffer.byteLength(raw) > limit) throw fail('请求内容过大。', 413);
    const headers = { accept: binary ? 'application/zip' : 'application/json', 'x-aieyra-os-client': '1' };
    if (raw) headers['content-type'] = 'application/json';
    if (credential) headers.authorization = 'Bearer ' + credential.accessToken;
    if (signed) {
      if (!credential || credential.expiresAt <= Date.now()) throw fail('请先登录。', 401);
      const query = Object.fromEntries([...url.searchParams.keys()].sort().map(k => [k, url.searchParams.getAll(k)]));
      const value = payload === undefined ? url.pathname.startsWith('/api/v1/together/') ? { query } : {} : payload;
      const time = String(Date.now()), nonce = crypto.randomBytes(24).toString('base64url');
      Object.assign(headers, { 'x-os-proof': '2', 'x-os-time': time, 'x-os-nonce': nonce,
        'x-os-signature': crypto.sign(null, Buffer.from(['aieyra-os-proof-v2', hash(credential.accessToken), method, url.pathname, time, nonce, hash(JSON.stringify(value))].join('\n')), credential.privateKey).toString('base64url') });
    }
    if (admin && credential?.user?.role !== 100) throw fail('需要超级管理员账号。', 403);
    const controller = new AbortController(), generation = this.generation;
    this.controllers.add(controller); this.active++; this.activity(1);
    const sourceTransfer=/\/engineering\/(?:archive|file)$/.test(url.pathname),started=Date.now(),requestId=crypto.randomUUID();let httpStatus=0,failureRecord,receivedBytes=0,expectedBytes;
    const /* @chain-region CloudClient.performRequest.abort | calls: controller.abort */ abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    const transfer=sourceTransfer||binary,watch=transfer?require('./transfer-recovery.cjs').watchStall(controller):null;
    const timer = transfer ? null : setTimeout(() => controller.abort(), method === 'GET' ? 20000 : 30000);
    try {
      const response = await this.fetch(url.href, { method, headers, body: raw, redirect: 'error', signal: controller.signal });
      httpStatus=response.status;
      expectedBytes=Number(response.headers.get('content-length'))||undefined;watch?.touch();if(sourceTransfer)progress?.(0,expectedBytes);
      const maximum = binary && response.ok ? 40 * 1024 * 1024 : sourceTransfer ? 24 * 1024 * 1024 : 16 * 1024 * 1024;
      const parts = []; let size = 0;
      for await (const chunk of response.body || []) { size += chunk.length;receivedBytes=size;watch?.touch(); if (size > maximum) { controller.abort(); throw fail('服务响应过大。', 502); } parts.push(chunk);if(sourceTransfer)progress?.(size,expectedBytes); }
      signal?.throwIfAborted();
      if (generation !== this.generation) throw fail('账号已切换，请重新读取。', 401);
      const bytes = Buffer.concat(parts);
      if (binary && response.ok) {
        const digest = response.headers.get('x-content-sha256'), revision = response.headers.get('x-source-revision');
        if (!/^[a-f0-9]{64}$/.test(digest || '') || hash(bytes) !== digest || !/^[a-f0-9]{64}$/.test(revision || '')) throw Object.assign(fail('源码摘要校验失败。', 502),{code:'source_checksum'});
        return { bytes, revision, digest };
      }
      let data;
      try {
        data = JSON.parse(bytes);
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error();
      } catch {
        if (![429, 502, 503, 504].includes(response.status)) throw fail('服务响应无效。', 502);
        data = {error: response.status === 429 ? '请求较多，请稍后重试。' : '服务暂不可用。'};
      }
      if (!response.ok) {
        if (signed && (response.status === 401 && url.pathname !== '/api/v1/moderation/verify' ||
            response.status === 403 && url.pathname === '/api/v1/together/access')) this.clear();
        if (response.status === 403 && admin) { this.grant = null; this.changed(this.state()); }
        const message = typeof data.error === 'string' && data.error.length <= 300 ? data.error : '请求未完成。';
        const retry = response.headers.get('retry-after');
        const headerWait = /^\s*\d+(?:\s*,\s*\d+)*\s*$/.test(retry || '')
          ? Math.max(...retry.split(',').map(Number))
          : Math.max(0, Math.ceil((Date.parse(retry) - Date.now()) / 1000)) || 0;
        const retryAfter = Math.min(3600, Math.max(headerWait, Number(data.retry_after) || 0));
        throw Object.assign(fail(message, response.status), {retryAfter,code:/^[a-z_]{1,60}$/.test(data.code||'')?data.code:undefined});
      }
      return data;
    } catch (error) {
      if (signal?.aborted) {
        failureRecord={code:'request_cancelled'};
        throw signal.reason;
      }
      const failure = error.status ? error : fail('暂时无法连接。', 503);
      failure.code ||= error.name==='AbortError'||error.name==='TimeoutError'?'request_timeout':httpStatus?'http_error':'network_error';
      if(sourceTransfer&&!error.status)failure.message=failure.code==='request_timeout'?'源码传输超时':'源码连接中断';
      failureRecord={code:failure.code,message:failure.message,cause:String(error.cause?.code||error.code||'').slice(0,80)};
      if (generation !== this.generation) throw fail('账号已切换，请重新读取。', 401);
      failure.outcomeUnknown = method === 'POST' && failure.status >= 500;
      if (failure.outcomeUnknown) failure.message = '提交结果尚未确认，请先核对记录；请勿重复提交。';
      throw failure;
    } finally {this.recordDiagnostic({at:new Date().toISOString(),requestId,route:url.pathname,method,status:httpStatus,duration:Date.now()-started,receivedBytes,expectedBytes,...(sourceTransfer?{offset:Number(url.searchParams.get('offset')),path:url.searchParams.get('path')||undefined}:{}),...failureRecord});clearTimeout(timer);watch?.close();signal?.removeEventListener('abort',abort); this.controllers.delete(controller); this.active--; this.activity(-1); }
  }
  /* @chain-region CloudClient.beginLogin | calls: fail, changed, state, crypto.generateKeyPairSync, toString, crypto.randomBytes, request, digest … */ async beginLogin({signal}={}) {
    if (this.pending) throw fail('登录窗口已打开。', 409);
    // A new login never inherits a management grant.
    this.grant = null; this.changed(this.state());
    const generation = this.generation, pair = crypto.generateKeyPairSync('ed25519'), verifier = crypto.randomBytes(32).toString('base64url');
    const result = await this.request('/api/v1/auth/start', { kind: 'desktop', challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }) }, { signed: false, credential: null, signal });
    const url = new URL(result.authorizationUrl);
    if (url.origin !== ACCOUNT || url.pathname !== '/aieyra/os/authorize' || url.searchParams.get('flow') !== result.flow || url.username || url.password) throw fail('登录授权地址无效。');
    if (generation !== this.generation) throw fail('登录已取消。');
    this.pending = { flow: result.flow, verifier, privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), generation, expires: Date.now() + 600000 };
    return url.href;
  }
  /* @chain-region CloudClient.downloadDevelopment | calls: test, Number.isSafeInteger, fail, downloadBinary, URLSearchParams */ async downloadDevelopment(artifact, target, progress=()=>{}, {signal}={}) {
    if(!/^[A-Za-z0-9._-]+\.zip$/.test(artifact?.file||'')||!/^[a-f0-9]{64}$/.test(artifact.sha256||'')||
       !Number.isSafeInteger(artifact.size)||artifact.size<1||artifact.size>2*1024**3)throw fail('下载信息无效。');
    return this.downloadBinary('/api/v1/together/download?'+new URLSearchParams({file:artifact.file}),artifact,target,progress,{signal});
  }
  /* @chain-region CloudClient.downloadReleasedArtifact | calls: test, Number.isSafeInteger, fail, URLSearchParams, downloadBinary */ downloadReleasedArtifact(release,artifact,target,progress,signal) {
    if(!/^[a-f0-9]{64}$/.test(release)||!/^[a-f0-9]{64}$/.test(artifact.sha256)||
       !Number.isSafeInteger(artifact.size)||artifact.size<1||artifact.size>512*1024**2)throw fail('下载信息无效。');
    const query=new URLSearchParams({release_id:release,sha256:artifact.sha256});
    return this.downloadBinary('/api/v1/together/engineering/artifact?'+query,artifact,target,progress,
      {signal,segmentBytes:2*1024**2,requireDigest:true});
  }
  /* @chain-region CloudClient.downloadBinary | calls: active, URL, Object.fromEntries, map, sort, url.searchParams.keys, url.searchParams.getAll, download … */ async downloadBinary(route,artifact,target,progress,{signal,segmentBytes,requireDigest}={}) {
    const credential=this.session,generation=this.generation;
    const /* @chain-region CloudClient.downloadBinary.active | calls: fail, Date.now */ active=()=>{if(signal?.aborted)throw fail('已取消',499);if(generation!==this.generation||credential!==this.session||!credential||credential.expiresAt<=Date.now())throw fail('请重新登录。',401);};active();
    const url=new URL(route,this.origin);
    const query=Object.fromEntries([...url.searchParams.keys()].sort().map(name=>[name,url.searchParams.getAll(name)]));
    return require('./development-download.cjs').download({artifact,target,fetchImpl:this.fetch,controllers:this.controllers,active,progress,signal,segmentBytes,requireDigest,
      /* @chain-region CloudClient.downloadBinary.diagnostic | calls: recordDiagnostic */ diagnostic:row=>this.recordDiagnostic(row),
      /* @chain-region CloudClient.downloadBinary.request | calls: String, Date.now, toString, crypto.randomBytes, crypto.sign, Buffer.from, join, hash … */ request:()=>{
        const time=String(Date.now()),nonce=crypto.randomBytes(24).toString('base64url');
        const headers={authorization:'Bearer '+credential.accessToken,'x-aieyra-os-client':'1','x-os-proof':'2','x-os-time':time,'x-os-nonce':nonce,
          'x-os-signature':crypto.sign(null,Buffer.from(['aieyra-os-proof-v2',hash(credential.accessToken),'GET',url.pathname,time,nonce,hash(JSON.stringify({query}))].join('\n')),credential.privateKey).toString('base64url')};
        return {url:url.href,headers};
      }});
  }

  /* @chain-region CloudClient.cancelLogin */ cancelLogin() { this.pending = null; }
  /* @chain-region CloudClient.completeLogin | calls: URL, Date.now, url.searchParams.getAll, url.searchParams.get, fail, request, signal.throwIfAborted, test … */ async completeLogin(location,{expectedUser,signal}={}) {
    const pending = this.pending, url = new URL(location);
    if (!pending || pending.expires < Date.now() || pending.generation !== this.generation || url.origin !== this.origin || url.pathname !== '/auth/desktop-callback' || url.searchParams.getAll('state').length !== 1 || url.searchParams.get('state') !== pending.flow || url.searchParams.getAll('code').length !== 1) throw fail('登录回调无效或已过期。', 401);
    this.pending = null;
    const result = await this.request('/api/v1/auth/exchange', { flow: pending.flow, verifier: pending.verifier, code: url.searchParams.get('code') }, { signed: false, credential: null, signal });
    signal?.throwIfAborted();
    if (pending.generation !== this.generation || !/^[A-Za-z0-9_-]{43}$/.test(result.accessToken || '') || !/^[1-9]\d*$/.test(result.user?.id || '') || !Number.isSafeInteger(result.expiresAt) || result.expiresAt <= Date.now()) throw fail('登录响应无效。', 401);
    if(expectedUser!==undefined&&String(result.user.id)!==String(expectedUser)){
      void this.request('/api/v1/auth/logout',{}, {credential:result,signed:false}).catch(()=>{});
      throw fail('云端账号与 OS 登录不一致。',401);
    }
    const old = this.session;
    this.session = { ...result, privateKey: pending.privateKey }; this.grant = null; this.generation++; this.persist();
    this.access = null; this.accessSession = null; this.accessAt = 0; this.refreshFlight = null;
    this.changed(this.state());
    if (old) void this.request('/api/v1/auth/logout', {}, { credential: old, signed: false }).catch(() => {});
    return this.refresh(signal);
  }
  /* @chain-region CloudClient.cachedAccess | calls: state */ cachedAccess() {
    return this.state().signedIn && this.accessSession === this.session ? this.access : null;
  }
  /* @chain-region CloudClient.applyAccess | calls: fail, Date.now, state, changed */ applyAccess(access, current) {
    if (this.session !== current) throw fail('账号已切换。', 401);
    current.user = { ...current.user, ...access.user, accountId: current.user.accountId || current.user.id, role: access.admin ? 100 : 1 };
    this.access = access; this.accessSession = current; this.accessAt = Date.now();
    const state = { ...this.state(), access };
    this.changed(state);
    return state;
  }
  /* @chain-region CloudClient.refresh | calls: state, signal.throwIfAborted, call, applyAccess */ async refresh(signal) {
    if (!this.state().signedIn) return this.state();
    signal?.throwIfAborted();
    if (this.refreshFlight && this.refreshSignal === signal) return this.refreshFlight;
    const current = this.session;
    const flight = (async () => {
      const access = await this.call('/access',undefined,{signal});
      signal?.throwIfAborted();
      return this.applyAccess(access,current);
    })();
    this.refreshFlight = flight;this.refreshSignal=signal;
    try { return await flight; }
    finally { if (this.refreshFlight === flight) {this.refreshFlight=null;this.refreshSignal=undefined;} }
  }
  /* @chain-region CloudClient.logout | calls: clear, catch, request, state */ async logout() {
    const old = this.session; this.clear();
    if (old) await this.request('/api/v1/auth/logout', {}, { credential: old, signed: false }).catch(() => {});
    return this.state();
  }
  /* @chain-region CloudClient.verify | calls: request, test, Date.now, fail, changed, state */ async verify(payload) {
    const allowed = payload?.challenge ? { challenge: payload.challenge, code: payload.code } : { password: payload?.password };
    const data = await this.request('/api/v1/moderation/verify', allowed);
    if (data.twoFactorRequired) return { twoFactorRequired: true, challenge: data.challenge };
    if (!/^[A-Za-z0-9_-]{43}$/.test(data.token || '') || data.expiresAt <= Date.now()) throw fail('管理验证响应无效。');
    this.grant = { token: data.token, expiresAt: data.expiresAt }; this.changed(this.state());
    return { expiresAt: data.expiresAt };
  }
  /* @chain-region CloudClient.lock | calls: changed, state, catch, request */ async lock() { this.grant = null; this.changed(this.state()); await this.request('/api/v1/moderation/lock', {}).catch(() => {}); return this.state(); }
  /* @chain-region CloudClient.call | calls: fail, URL, ROUTES.test, url.searchParams.get, request, url.pathname.startsWith, options.signal.throwIfAborted, applyAccess … */ async call(route, payload, options={}) {
    if (typeof route !== 'string' || route.length > 4096) throw fail('请求入口无效。');
    const url = new URL(route, this.origin);
    if (url.origin !== this.origin || url.hash || !ROUTES.test(url.pathname) || url.pathname === '/code/archive') throw fail('请求入口无效。');
    const generation=this.generation,current=this.session;
    const workspace=payload===undefined&&url.pathname==='/public/events'&&url.searchParams.get('view')==='workspace';
    try {
      const result=await this.request('/api/v1/together' + url.pathname + url.search, payload, {
        ...options, admin: url.pathname.startsWith('/admin/'), deferThrottle: workspace&&url.searchParams.get('scope')==='home',
      });
      if(workspace&&result.workspace?.access){
        options.signal?.throwIfAborted();
        this.applyAccess(result.workspace.access,current);
      }
      return result;
    }
    catch(error){
      if(payload&&error.outcomeUnknown&&generation===this.generation&&/^\/(?:elections\/vote|goals\/vote|agendas\/[a-f0-9]{32}\/vote)$/.test(route)){
        try {
          let matched=false;
          if(route==='/elections/vote'){
            const data=await this.call('/elections'),ballot=data.my_ballots?.[payload.role];
            if(data.cycle?.id===payload.cycle_id){
              const replacement=data.replacement;
              if(payload.action==='vote-recall')matched=replacement?.id===payload.id&&replacement.my_recall_vote===payload.choice;
              else if(payload.action==='vote-replacement')matched=replacement?.id===payload.id&&replacement.my_candidate===payload.candidate_id;
              else if(!payload.action)matched=data.my_ballots!==undefined&&(payload.candidate_id===null?!ballot:ballot?.candidate_id===payload.candidate_id&&ballot.reason===payload.reason?.trim());
            }
          }else{
            const item=route==='/goals/vote'?(await this.call('/goals')).candidates.find(c=>c.id===payload.candidate_id):(await this.call(route.slice(0,-5))).agenda;
            matched=!!item&&(payload.choice==='abstain'?(item.my_vote===null||item.my_vote==='abstain'):item.my_vote===payload.choice&&item.my_vote_reason===payload.reason?.trim());
          }
          if(generation===this.generation&&matched)return {ok:true,reconciled:true};
        }catch{/* Keep the original unknown outcome; never turn a failed read into a new write. */}
        error.message='暂未确认提交结果。请保留当前内容，恢复连接后先核对选票；不要重复提交。';
      }
      throw error;
    }
  }
  /* @chain-region CloudClient.source | calls: test, fail, require, active, request, includes, recover, backoff */ async source(revision) {
    if (!/^[a-f0-9]{64}$/.test(revision || '')) throw fail('源码版本无效。');
    const generation=this.generation,credential=this.session,{recover,backoff}=require('./transfer-recovery.cjs');let failures=0;
    const /* @chain-region CloudClient.source.active | calls: Date.now, fail */ active=()=>{if(generation!==this.generation||credential!==this.session||!credential||credential.expiresAt<=Date.now())throw fail('请重新登录。',401);};
    while(true){
      active();
      try{
        const result=await this.request('/api/v1/together/code/archive?revision='+revision,undefined,{binary:true});active();
        if(result.revision!==revision)throw fail('源码版本不匹配。');
        return result;
      }catch(error){active();if(![408,429,500,502,503,504].includes(error.status)||error.code==='source_checksum')throw error;await recover(backoff(++failures,error.retryAfter),active);}
    }
  }
  /* @chain-region CloudClient.confirmLocal | calls: inspect, request, Date.now, fail */ async confirmLocal(value, inspect) {
    const generation=this.generation;
    const local=await inspect();
    const body={id:value.id,actor_id:value.actor_id,session_id:local.id,lease_until:local.lease_until};
    const proof=await this.request('/api/v1/together/agents/local-challenge',body);
    const again=await inspect();
    if(generation!==this.generation||again.id!==local.id||again.lease_until<=Date.now()/1000)throw fail('本机连接已变化，请重新验证。',409);
    return this.request('/api/v1/together/agents/local-confirm',{id:value.id,actor_id:value.actor_id,session_id:local.id,proof:proof.proof});
  }
  /* @chain-region CloudClient.pairing | calls: JSON.stringify, Promise.reject, fail, finally, preparePairing */ pairing(options = {}) {
    const key=JSON.stringify([this.generation,!!options.create,!!options.rotate,options.replace||'',!!options.resume]);
    if(this.pairingFlight){if(this.pairingFlight.key===key)return this.pairingFlight.promise;return Promise.reject(fail('接入码请求正在处理。',409));}
    const promise=this.preparePairing(options).finally(()=>{if(this.pairingFlight?.promise===promise)this.pairingFlight=null;});
    this.pairingFlight={key,promise};return promise;
  }
  /* @chain-region CloudClient.preparePairing | calls: cachedAccess, refresh, fail, test, call, path.join, path.dirname, safeStorage.isEncryptionAvailable … */ async preparePairing(options = {}) {
    const generation = this.generation, access=this.cachedAccess() || (await this.refresh()).access;
    if (!access?.member) throw fail('需要已批准的开发者资格。', 403);
    const id = access.user.id;
    if (!/^[a-f0-9]{32}$/.test(id)) throw fail('账号身份无效。');
    const status = await this.call('/agents'), file = path.join(path.dirname(this.file), 'pairing-' + id + '.enc');
    let saved = null, pending = null, used = null;
    try {
      if (this.safeStorage.isEncryptionAvailable() && fs.statSync(file).size <= 8192) {
        const value = JSON.parse(this.safeStorage.decryptString(fs.readFileSync(file)));
        if (value.account === id && /^[A-Za-z0-9_-]{43}$/.test(value.pairing?.code || '') &&
          status.pairings?.some(p => p.id === value.pairing.pairing_id && !p.used && p.expires > Date.now()/1000)) saved = value.pairing;
        if(value.account===id && /^[A-Za-z0-9_-]{43}$/.test(value.pairing?.code||'') && status.pairings?.some(p=>p.id===value.pairing.pairing_id && p.used))used=value.pairing;
        if(value.account===id&&value.pending&&/^[A-Za-z0-9_-]{43}$/.test(value.pending.code||'')&&(!value.pending.created_at||value.pending.created_at+1800000>Date.now()))pending=value.pending;
      }
    } catch {}
    if (generation !== this.generation) throw fail('账号已切换。', 401);
    if (!options.create || saved && !options.rotate) return {pairing:saved};
    if (!this.safeStorage.isEncryptionAvailable()) throw fail('系统安全存储暂不可用，无法保存接入码。');
    const active=status.agents?.find(a=>!a.revoked&&a.expires>Date.now()/1000);
    const expired=active?.enrollment?.state==='expired';
    if(active&&!expired&&options.replace!==active.id&&!pending)return {pairing:options.resume?used:null,active};
    const /* @chain-region CloudClient.preparePairing.persist | calls: fs.mkdirSync, path.dirname, crypto.randomUUID, fs.writeFileSync, safeStorage.encryptString, JSON.stringify, fs.renameSync, fs.unlinkSync */ persist=value=>{
      fs.mkdirSync(path.dirname(file), {recursive:true});
      const temporary=file+'.'+crypto.randomUUID()+'.tmp';
      try{fs.writeFileSync(temporary,this.safeStorage.encryptString(JSON.stringify({account:id,...value})),{flag:'wx',mode:0o600});fs.renameSync(temporary,file);}
      finally{try{fs.unlinkSync(temporary);}catch{}}
    };
    if(pending && options.replace && pending.replace!==options.replace)throw fail('有未确认的接入码请求，请先恢复原请求。',409);
    pending ||= {code:crypto.randomBytes(32).toString('base64url'),replace:options.replace||(expired?active.id:''),created_at:Date.now()};
    persist({pending});
    let value;
    try{value=await this.request('/api/v1/together/agents/pair',{code:pending.code,replace:pending.replace});}
    catch(error){
      if(error.status!==410)throw error;
      // A definitive expiry permits fresh material; an unknown write keeps its original code.
      pending={code:crypto.randomBytes(32).toString('base64url'),replace:pending.replace,created_at:Date.now()};persist({pending});
      value=await this.request('/api/v1/together/agents/pair',{code:pending.code,replace:pending.replace});
    }
    if (generation !== this.generation) throw fail('账号已切换。', 401);
    if (!/^[A-Za-z0-9_-]{43}$/.test(value.code || '') || !/^[a-f0-9]{32}$/.test(value.pairing_id || '')) throw fail('接入响应无效。', 502);
    persist({pairing:value});
    return {pairing:value};
  }
  /* @chain-region CloudClient.close | calls: c.abort */ close() { this.grant = null; this.pending = null; for (const c of this.controllers) c.abort(); }
}
module.exports = { CloudClient, ORIGIN, ACCOUNT, ROUTES };
