// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Link/cloud/client/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: BASE; ADMIN; FINAL; ID; SERVER_ID; HASH; positive; copy; aborted; tunnelIP; RemoteLinkError; fail; checkTransport; RemoteLinkClient; bindRemoteLogin
// Impact: python -B scripts/code-atlas.py show Link/cloud/client/remote-link.mjs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

// Shared New API client for OS/phone Link adapters. It owns no login, SSH key,
// model executor or deployment authority. All state is scoped to one login.
const BASE = '/api/aieyra/cloud-instances';
const ADMIN = '/api/aieyra/admin-servers';
const FINAL = new Set(['ready', 'cancelled', 'rejected']);
const ID = /^[A-Za-z0-9_-]{8,80}$/;
const SERVER_ID = /^[A-Za-z0-9_-]{1,80}$/;
const HASH = /^[a-f0-9]{64}$/;
const positive = value => Number.isSafeInteger(value) && value > 0;
const copy = value => structuredClone(value);
const aborted = () => new DOMException('账号或远程视图已变更。', 'AbortError');
const tunnelIP = value => {
  if (typeof value !== 'string' || value.length > 80) return false;
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)) return value.split('.').every(part => Number(part) <= 255);
  return /^[0-9a-f:]+$/i.test(value) && value.includes(':');
};

export class RemoteLinkError extends Error {
  constructor(code, message = code, status = 0) {
    super(message); this.name = 'RemoteLinkError'; this.code = code; this.status = status;
  }
}
const fail = (code, message) => { throw new RemoteLinkError(code, message); };

function checkTransport(value) {
  if (!value || typeof value !== 'object' || !['ssh', 'wireguard'].includes(value.mode)) fail('remote_transport_invalid');
  if (value.mode === 'wireguard') {
    if (![value.hub, value.server_id, value.peer_id].every(item => typeof item === 'string' && item.length > 0 && item.length <= 80) ||
        !SERVER_ID.test(value.hub) || !SERVER_ID.test(value.server_id) || !SERVER_ID.test(value.peer_id) || !tunnelIP(value.tunnel_address)) {
      fail('remote_transport_invalid');
    }
  } else if (value.server_id !== undefined &&
             (!SERVER_ID.test(value.server_id) || !tunnelIP(value.tunnel_address))) {
    fail('remote_transport_invalid');
  }
  return value;
}

export class RemoteLinkClient {
  #scope = null; #closed = false; #views = new Set();
  #resources = new Map(); #descriptors = new Map(); #plans = new Map();
  #intents = new Map(); #jobs = new Map(); #transport; #timeout; #base; #administrators;

  constructor({ origin = globalThis.location?.origin, basePath = '', transport, timeout = 35000, administratorServers = false } = {}) {
    const url = new URL(origin);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
        (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1'))) {
      fail('remote_origin_invalid', '远程 API 必须使用固定 HTTPS 来源。');
    }
    if (basePath && (!/^\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/.test(basePath) ||
        basePath.split('/').some(part => part === '.' || part === '..'))) fail('remote_base_path_invalid');
    if (!transport && globalThis.location?.origin !== url.origin) {
      fail('remote_native_transport_required', '跨来源宿主须使用既有账号的受限原生传输。');
    }
    if (!Number.isFinite(timeout) || timeout < 100 || timeout > 60000) fail('remote_timeout_invalid');
    this.origin = url.origin; this.#base = basePath; this.#timeout = timeout;
    this.#administrators = administratorServers === true;
    // Injected transports follow Fetch's Response contract and must preserve
    // the current human login, request method/body and AbortSignal.
    this.#transport = transport || globalThis.fetch.bind(globalThis);
  }

  setAccount(account) {
    if (this.#closed) fail('remote_client_closed');
    if (account && (!positive(account.userID) || typeof account.sessionKey !== 'string' ||
        !account.sessionKey || account.sessionKey.length > 128)) fail('remote_account_invalid');
    if (this.#scope && account?.userID === this.#scope.userID && account.sessionKey === this.#scope.sessionKey) return;
    this.#scope?.abort.abort();
    for (const dispose of this.#views) { try { dispose(); } catch { /* Revoke the other views even if one host fails. */ } }
    this.#views.clear(); this.#resources.clear(); this.#descriptors.clear(); this.#plans.clear();
    this.#intents.clear(); this.#jobs.clear();
    this.#scope = account ? { userID: account.userID, sessionKey: account.sessionKey, abort: new AbortController() } : null;
  }

  // The host callback destroys its WebView/iframe and clears its displayed
  // resource data. On a same-origin iframe it may first send account-ended.
  registerView(dispose) {
    this.#current();
    if (typeof dispose !== 'function') fail('remote_view_invalid');
    this.#views.add(dispose);
    return () => this.#views.delete(dispose);
  }

  close() { if (!this.#closed) { this.setAccount(null); this.#closed = true; } }
  #current() { if (!this.#scope || this.#closed) fail('remote_login_required', '请先登录 Aieyra。'); return this.#scope; }
  #check(scope) { if (scope !== this.#scope || scope.abort.signal.aborted || this.#closed) throw aborted(); }
  #endViews() {
    for (const dispose of this.#views) { try { dispose(); } catch { /* Other views still need revocation. */ } }
    this.#views.clear();
  }
  #resource(id) {
    this.#current();
    if (!positive(id) || !this.#resources.has(id)) fail('remote_resource_not_discovered');
    return this.#resources.get(id);
  }
  #descriptor(id) {
    this.#resource(id);
    const value = this.#descriptors.get(id);
    if (!value) fail('remote_descriptor_required', '请先读取此服务器的连接能力。');
    return value;
  }
  #path(id) { return `${this.#resource(id).resource_scope === 'administrator_server' ? ADMIN : BASE}/${id}`; }

  async #call(path, method = 'GET', body, scope = this.#current()) {
    this.#check(scope);
    const abort = new AbortController();
    const cancel = () => abort.abort();
    scope.abort.signal.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(cancel, this.#timeout);
    try {
      const response = await this.#transport(this.origin + this.#base + path, {
        method, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: abort.signal,
        headers: { 'Content-Type': 'application/json', 'New-Api-User': String(scope.userID) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      this.#check(scope);
      const value = await response.json();
      this.#check(scope);
      if (abort.signal.aborted) throw aborted();
      if (!response.ok || value?.success !== true) {
        const error = new RemoteLinkError(value?.code || 'remote_request_failed', value?.message || '远程操作未完成。', response.status);
        if (response.status === 401) this.setAccount(null);
        throw error;
      }
      return value.data;
    } finally {
      clearTimeout(timer); scope.abort.signal.removeEventListener('abort', cancel);
    }
  }

  async discover() {
    const scope = this.#current();
    if (this.#administrators) {
      try {
        const result = await this.#call(ADMIN, 'GET', undefined, scope);
        this.#check(scope);
        if (!Array.isArray(result?.items) || result.total !== result.items.length || !['active', 'none'].includes(result.state)) fail('remote_resource_list_invalid');
        this.#endViews(); this.#resources.clear(); this.#descriptors.clear(); this.#plans.clear();
        for (const item of result.items) {
          if (!positive(item?.id) || item.owner_id !== scope.userID || item.resource_scope !== 'administrator_server' || this.#resources.has(item.id)) fail('remote_resource_list_invalid');
          this.#resources.set(item.id, copy(item));
        }
        return {state: result.state, resources: copy([...this.#resources.values()])};
      } catch (error) {
        // Ordinary users retain the subscription path. Authentication and
        // transport failures remain visible; they never imply an empty list.
        if (error.status !== 403) throw error;
      }
    }
    const entitlement = await this.#call(BASE + '/remote-entitlement', 'GET', undefined, scope);
    this.#check(scope);
    if (!['active', 'none', 'awaiting_delivery', 'expired', 'unavailable'].includes(entitlement?.state)) fail('remote_entitlement_invalid');
    this.#endViews();
    this.#resources.clear(); this.#descriptors.clear(); this.#plans.clear();
    if (entitlement.state !== 'active') return { state: entitlement.state, resources: [] };
    const items = [];
    for (let page = 1; page <= 100; page++) {
      const result = await this.#call(BASE + '/self?page=' + page, 'GET', undefined, scope);
      if (!Array.isArray(result?.items) || !Number.isSafeInteger(result.total) || result.total < 0) fail('remote_resource_list_invalid');
      items.push(...result.items);
      if (items.length >= result.total) break;
      if (!result.items.length || page === 100) fail('remote_resource_list_incomplete');
    }
    this.#check(scope);
    for (const item of items) if (positive(item?.id) && item.owner_id === scope.userID && !item.root_only) this.#resources.set(item.id, copy(item));
    return { state: 'active', resources: copy([...this.#resources.values()]) };
  }

  async describe(id) {
    this.#resource(id);
    const scope = this.#current();
    const value = await this.#call(`${this.#path(id)}/remote`, 'GET', undefined, scope);
    this.#check(scope);
    if (!positive(value?.revision) || !positive(value.generation) || !value.binding || !value.remote) fail('remote_descriptor_invalid');
    if (value.transport === undefined) value.transport = { mode: 'ssh' };
    checkTransport(value.transport);
    const old = this.#descriptors.get(id);
    if (old && (old.revision !== value.revision || old.generation !== value.generation)) this.#plans.delete(id);
    this.#descriptors.set(id, copy(value));
    return copy(value);
  }

  async #operation(id, action, body) {
    const descriptor = this.#descriptor(id);
    return this.#call(`${this.#path(id)}/remote`, 'POST', { action, body, revision: descriptor.revision, generation: descriptor.generation });
  }

  async sessions(id) {
    const descriptor = this.#descriptor(id);
    const result = await this.#operation(id, 'sessions', {});
    if (!Array.isArray(result?.sessions)) fail('remote_session_list_invalid');
    for (const session of result.sessions) {
      if (!ID.test(session?.id) || (descriptor.transport.server_id !== undefined &&
          session.server_id !== descriptor.transport.server_id)) {
        fail('remote_session_identity_invalid');
      }
    }
    return copy(result);
  }

  async prepare(id, components) {
    const descriptor = this.#descriptor(id);
    const scope = this.#current();
    if (!descriptor.binding.deploy_allowed) fail('remote_deploy_forbidden');
    if (this.#intents.has(id)) fail('remote_submission_unconfirmed', '请先核对原部署任务。');
    if (!Array.isArray(components) || !components.length || components.length > 2 ||
        components.some(name => !['codex', 'eyra'].includes(name)) || new Set(components).size !== components.length) fail('remote_components_invalid');
    const plan = await this.#operation(id, 'plan', { components });
    this.#check(scope);
    if (!ID.test(plan?.plan_id) || !HASH.test(plan.plan_hash) || !Number.isFinite(plan.expires_at) ||
        plan.expires_at * 1000 <= Date.now()) fail('remote_plan_invalid');
    this.#plans.set(id, { plan: copy(plan), descriptor: copy(descriptor) });
    return copy(plan);
  }

  async deploy(id, consent) {
    const descriptor = this.#descriptor(id), offered = this.#plans.get(id);
    if (this.#intents.has(id)) fail('remote_submission_unconfirmed', '请核对原任务，或以原提交标识重试。');
    if (!offered || consent?.consent !== true || consent.plan_id !== offered.plan.plan_id || consent.plan_hash !== offered.plan.plan_hash ||
        offered.plan.expires_at * 1000 <= Date.now() || offered.descriptor.revision !== descriptor.revision ||
        offered.descriptor.generation !== descriptor.generation) fail('remote_consent_required', '请查看当前部署计划并明确同意。');
    const intent = { revision: descriptor.revision, generation: descriptor.generation, plan_id: consent.plan_id,
      plan_hash: consent.plan_hash, consent: true, idempotency_key: crypto.randomUUID() };
    this.#intents.set(id, intent); // Keep the original key before any write.
    return this.#submit(id, intent);
  }

  async #submit(id, intent) {
    const scope = this.#current();
    const job = await this.#call(`${this.#path(id)}/remote-deployments`, 'POST', intent);
    const result = this.#remember(scope, id, job);
    this.#intents.delete(id); this.#plans.delete(id);
    return result;
  }

  // Only called by an explicit host action after read-only recovery. This
  // preserves the original consent and key; it never creates another plan.
  retrySubmission(id, consent) {
    this.#descriptor(id);
    const intent = this.#intents.get(id);
    if (!intent || consent?.consent !== true || consent.plan_hash !== intent.plan_hash) fail('remote_consent_required');
    return this.#submit(id, intent);
  }

  #remember(scope, id, value) {
    this.#check(scope);
    const job = { ...copy(value), job_id: value?.job_id || value?.id, state: value?.state || value?.status,
      event: value?.event ?? value?.receipt_version ?? 0 };
    if (!ID.test(job.job_id) || !HASH.test(job.plan_hash) || !['accepted', 'preflight', 'installing', 'verifying', 'ready', 'needs_attention', 'cancelled', 'rejected'].includes(job.state) ||
        !Number.isSafeInteger(job.event) || job.event < 0) fail('remote_job_receipt_invalid');
    const key = `${id}:${job.job_id}`, previous = this.#jobs.get(key);
    if (previous && (previous.event > job.event || FINAL.has(previous.state))) return copy(previous);
    this.#jobs.set(key, job);
    return copy(job);
  }

  async recover(id) {
    this.#descriptor(id);
    const scope = this.#current();
    const result = await this.#call(`${this.#path(id)}/remote-deployments`);
    this.#check(scope);
    if (!Array.isArray(result?.jobs)) fail('remote_job_list_invalid');
    const jobs = result.jobs.map(value => this.#remember(scope, id, value));
    const intent = this.#intents.get(id);
    const original = intent && jobs.find(job => job.plan_id === intent.plan_id && job.plan_hash === intent.plan_hash);
    if (original) { this.#intents.delete(id); this.#plans.delete(id); }
    return { jobs, originalJob: original || null, submissionUnconfirmed: this.#intents.has(id) };
  }

  async job(id, jobID) {
    this.#descriptor(id); if (!ID.test(jobID)) fail('remote_job_invalid');
    const scope = this.#current();
    return this.#remember(scope, id, await this.#call(`${this.#path(id)}/remote-deployments/${jobID}`));
  }

  async resume(id, jobID, consent) {
    const descriptor = this.#descriptor(id), job = this.#jobs.get(`${id}:${jobID}`);
    if (!descriptor.binding.deploy_allowed || !job || FINAL.has(job.state) || consent?.consent !== true || consent.plan_hash !== job.plan_hash) fail('remote_consent_required');
    const scope = this.#current();
    return this.#remember(scope, id, await this.#call(`${this.#path(id)}/remote-deployments/${jobID}`, 'POST', { action: 'resume', consent: true, plan_hash: job.plan_hash }));
  }

  async cancel(id, jobID) {
    this.#descriptor(id); if (!ID.test(jobID) || !this.#jobs.has(`${id}:${jobID}`)) fail('remote_job_invalid');
    const scope = this.#current();
    return this.#remember(scope, id, await this.#call(`${this.#path(id)}/remote-deployments/${jobID}`, 'POST', { action: 'cancel' }));
  }

  terminalURL(id, sessionID = crypto.randomUUID()) {
    this.#descriptor(id); if (!ID.test(sessionID)) fail('remote_session_invalid');
    if (this.#resource(id).resource_scope === 'administrator_server') fail('remote_native_transport_required', '管理员终端请通过宿主的受限传输打开。');
    const query = new URLSearchParams({ instance: String(id), user: String(this.#current().userID), session: sessionID });
    return `${this.origin}${this.#base}/api/aieyra/link-assets/terminal.html?${query}`;
  }

  baotaURL(id) {
    const panel = this.#descriptor(id).remote.baota;
    if (panel?.state !== 'registered') return null;
    const url = new URL(panel.url);
    if (url.protocol !== 'https:' || url.username || url.password) fail('remote_panel_invalid');
    return url.href;
  }
}

// Adapt an existing, server-verified login event source. Reading/discovery does
// not consent to deployment. sessionKey is an opaque per-login epoch, no token.
export function bindRemoteLogin(client, { current, subscribe, onDiscovery, onError = () => {} }) {
  let version = 0, stopped = false;
  const changed = account => {
    if (stopped) return;
    const revision = ++version;
    client.setAccount(account);
    onDiscovery({ state: account ? 'loading' : 'signed_out', resources: [] });
    if (account) void client.discover().then(value => {
      if (!stopped && version === revision) onDiscovery(value);
    }).catch(error => { if (!stopped && version === revision && error.name !== 'AbortError') onError(error); });
  };
  const unsubscribe = subscribe(changed);
  changed(current());
  return () => { stopped = true; version++; unsubscribe(); client.close(); };
}
