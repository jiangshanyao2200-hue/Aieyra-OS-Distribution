/* @file-map:start
文件: link/office/web/station-model.js
位置: 一环·共享工位界面 | 工位页面与供shell/原生OS复用的模型、视觉和弹层规则。
约束: 共享原语优先复用，页面仅组装数据与事件；保持草稿、滚位和焦点，不在布局观察回调中重复同步写布局
下游: link/office/web/model.js
上游: link/desktop/ui/work-status.mjs, link/office/tests/unit/station-model.test.mjs, link/office/web/office-home.js, link/office/web/situation.js, link/office/web/station-visual.mjs
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: link/office/tests/unit/station-model.test.mjs
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  stationColor | function
  fresh | function
  communicationCurrent | function
  executionReportedAt | function
  presence | function
  stations | function
  listStrings | function
  wakeupDeliveryLabel | function
  statusLabel | function
  orderedTasks | function
  linkStatus | function
  presenceStatus | function
  linkRuntime | function
  linkStatusLabel | function
  lineLabel | function
  deviceKind | function
  hostKind | function
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
import { list, text, timestamp, taskRecordState } from './model.js';

export const palette = [
  '#b5c788',
  '#91bed6',
  '#d4a28d',
  '#b6a3d5',
  '#81c6b3',
  '#d1bd7f',
  '#d698b4',
  '#92b29d',
  '#93a6d8',
  '#c2af98',
  '#a8ccbb',
  '#b4c5d0',
];
export /* @chain-region stationColor | calls: c.codePointAt */ function stationColor(id) {
  let hash = 0;
  for (const c of id) hash = (hash * 31 + c.codePointAt(0)) >>> 0;
  return palette[hash % palette.length];
}

export const /* @chain-region fresh | calls: Date.now, Number.isFinite, timestamp */ fresh = (at, now = Date.now(), age = 180000) =>
  Number.isFinite(timestamp(at)) && now - timestamp(at) <= age && timestamp(at) - now <= 60000;

export /* @chain-region communicationCurrent | calls: Date.now, timestamp, Number.isFinite */ function communicationCurrent(runtime, now = Date.now()) {
  if (runtime.bound !== true || runtime.stale === true) return false;
  if (runtime.session_state !== undefined && runtime.session_state !== 'connected') return false;
  // Native adapters may have independent execution evidence and no transport lease.
  if (runtime.lease_until !== undefined) {
    const lease = timestamp(runtime.lease_until);
    if (!Number.isFinite(lease) || lease <= now) return false;
  }
  return true;
}

// Execution evidence and transport leases have different lifetimes. A missing
// transport heartbeat says nothing about whether the native agent is working.
export /* @chain-region executionReportedAt | calls: Object.hasOwn */ function executionReportedAt(runtime = {}) {
  if (Object.hasOwn(runtime, 'runtime_reported_at')) return runtime.runtime_reported_at;
  // Older bridge snapshots used their transport heartbeat as last_activity_at.
  if (runtime.adapter === 'aieyra-agent/1') return null;
  return runtime.last_activity_at || runtime.observed_at;
}

export /* @chain-region presence | calls: Date.now, executionReportedAt, communicationCurrent, fresh, includes */ function presence(agent = {}, reachable = true, now = Date.now()) {
  const runtime = agent.runtime || {},
    at = executionReportedAt(runtime);
  if (reachable && communicationCurrent(runtime, now) && fresh(at, now)) {
    if (['running', 'busy'].includes(runtime.state))
      return { state: 'running', tone: 'active', at, source: runtime.evidence || 'agent_report' };
    if (['idle', 'paused', 'waiting_user', 'stopped'].includes(runtime.state))
      return {
        state: runtime.state,
        tone: runtime.state === 'waiting_user' ? 'attention' : 'quiet',
        at,
        source: runtime.evidence || 'agent_report',
      };
  }
  if (reachable && fresh(agent.last_seen, now))
    return { state: 'recent', tone: 'active', at: agent.last_seen, source: 'recorded_activity' };
  return { state: 'sync', tone: 'quiet', at: at || agent.last_seen, source: 'unconfirmed' };
}

export /* @chain-region stations | calls: Date.now, Map, map, list, filter, text, sort, slice … */ function stations(registry, snapshot, reachable = true, now = Date.now()) {
  const actors = new Map(list(snapshot?.agents).map((a) => [a.id, a])),
    watchdogSeats = new Map(
      list(snapshot?.watchdog?.seats)
        .filter((seat) => text(seat.seat_id))
        .map((seat) => [seat.seat_id, seat]),
    ),
    wakeupChecks = list(snapshot?.wakeup_checks)
      .slice()
      .sort((a, b) => Number(b.created) - Number(a.created)),
    seen = new Set();
  const result = [];
  for (const seat of list(registry?.seats)) {
    if (
      !text(seat.id) ||
      !text(seat.actor_id) ||
      seen.has(seat.id) ||
      seat.membership_state === 'removed' ||
      ['removed', 'retired', 'archived'].includes(seat.desired_state)
    )
      continue;
    if (seat.station_binding?.seat_id && seat.station_binding.seat_id !== seat.id) continue;
    if (
      seat.membership_state !== 'active' &&
      seat.desired_state !== 'registered' &&
      seat.ownership !== 'external'
    )
      continue;
    seen.add(seat.id);
    const original = actors.get(seat.actor_id) || {},
      agent =
        original.runtime?.adapter === 'aieyra-agent/1' && original.runtime.seat_id !== seat.id
          ? { ...original, runtime: {} }
          : original,
      status = presence(agent, reachable, now);
    const messages = list(snapshot?.messages)
      .filter((m) => m.sender === seat.actor_id)
      .sort((a, b) => (timestamp(b.created) || 0) - (timestamp(a.created) || 0));
    const tasks = list(snapshot?.tasks).filter((t) => t.owner === seat.actor_id);
    const leader = list(registry?.governance).some(
      (g) =>
        g.active === true &&
        g.role === 'leader' &&
        g.actor_id === seat.actor_id &&
        (listStrings(g.projects).includes(seat.project) || listStrings(g.projects).includes('*')),
    );
    result.push({
      ...seat,
      agent,
      status,
      watchdog: watchdogSeats.get(seat.id) || null,
      wakeup_delivery: wakeupChecks.find((check) => check.seat_id === seat.id && check.target === seat.actor_id) || null,
      messages,
      tasks,
      leader,
      color: stationColor(seat.id),
    });
  }
  return result.sort(
    (a, b) =>
      Number(b.leader) - Number(a.leader) ||
      text(a.project).localeCompare(text(b.project)) ||
      text(a.id).localeCompare(text(b.id)),
  );
}
const /* @chain-region listStrings | calls: Array.isArray, value.filter */ listStrings = (value) =>
  Array.isArray(value) ? value.filter((x) => typeof x === 'string') : [];
export /* @chain-region wakeupDeliveryLabel */ function wakeupDeliveryLabel(check, language = 'zh', reachable = true) {
  if (!check) return '';
  const state = reachable ? check.state : 'unknown';
  return ({
    pending: ['待核验', 'Awaiting confirmation'],
    delivered: ['已送达', 'Delivered'],
    undelivered: ['未送达', 'Undelivered'],
    unknown: ['无法判断', 'Unknown'],
  }[state] || ['无法判断', 'Unknown'])[language === 'en' ? 1 : 0];
}
export /* @chain-region statusLabel */ function statusLabel(state, language = 'zh') {
  return ({
    running: ['正在工作', 'Working'],
    idle: ['待命', 'Ready'],
    paused: ['已暂停', 'Paused'],
    waiting_user: ['等待沟通', 'Awaiting input'],
    stopped: ['已停止', 'Stopped'],
    recent: ['近期有活动', 'Recent activity'],
    sync: ['等待状态更新', 'Awaiting update'],
  }[state] || ['等待状态更新', 'Awaiting update'])[language === 'en' ? 1 : 0];
}
export /* @chain-region orderedTasks | calls: sort, slice, list, taskRecordState, timestamp */ function orderedTasks(tasks, reachable) {
  const order = {
    blocked: 0,
    doing: 1,
    unconfirmed: 2,
    expired: 3,
    planned: 4,
    delivered: 5,
    accepted: 6,
  };
  return list(tasks)
    .slice()
    .sort(
      (a, b) =>
        (order[taskRecordState(a, reachable)] ?? 7) - (order[taskRecordState(b, reachable)] ?? 7) ||
        (timestamp(b.updated || b.updated_at) || 0) - (timestamp(a.updated || a.updated_at) || 0),
    );
}

// Link 方案 4.6：45 秒内收到过上报才算在线；主动下线才是「离线」，原因不明的沉默是「失联」。
export const REPORT_WINDOW_MS = 45000;
export /* @chain-region linkStatus | calls: Date.now, presenceStatus, timestamp, Number.isFinite, presence, linkRuntime, includes */ function linkStatus(agent = {}, reachable = true, now = Date.now(), lifecycle = null) {
  if (!reachable) return { state: 'sync', tone: 'quiet' };
  const viaPresence = presenceStatus(agent.presence);
  const r = agent.runtime || {},
    observed = timestamp(r.observed_at),
    lease = timestamp(r.lease_until),
    heard = Number.isFinite(observed) && now - observed <= REPORT_WINDOW_MS && observed - now <= 60000;
  if (lifecycle?.state === 'offline') return { state: 'offline', tone: 'dim', at: lifecycle.last_activity_at };
  if (agent.presence?.source === 'native_host' && viaPresence && timestamp(agent.presence.at) >= now - REPORT_WINDOW_MS)
    return viaPresence;
  if (r.session_state === undefined && r.bound === true && r.stale === false) {
    // 原生观测（没有传输租约）：沿用它自己的新鲜度。
    const p = presence(agent, reachable, now);
    if (p.state !== 'sync' && p.state !== 'recent') return linkRuntime(p.state, p.at);
  }
  if (r.session_state === 'connected' && heard && !(Number.isFinite(lease) && lease * (lease < 1e12 ? 1000 : 1) <= now)) {
    if (lifecycle?.state === 'error') return { state: 'error', tone: 'alert', at: lifecycle.last_error_at };
    if (r.state === 'unknown') return { state: 'sync', tone: 'quiet', at: r.observed_at };
    return linkRuntime(r.state || r.last_reported_state, r.observed_at);
  }
  // 传输租约断了不等于人走了：站点客户端每次调用完就断开，看原生会话本身（native_presence）。
  if (viaPresence) return viaPresence;
  if (['disconnected', 'revoked', 'invalidated'].includes(r.session_state) || !r.session_state)
    return { state: 'offline', tone: 'dim', at: r.observed_at || agent.last_seen };
  return { state: 'lost', tone: 'dim', at: r.observed_at || agent.last_seen };
}
/* @chain-region presenceStatus */ function presenceStatus(p) {
  if (!p || typeof p !== 'object') return null;
  if (p.state === 'running') return { state: 'working', tone: 'active', at: p.at };
  if (p.state === 'idle') return { state: 'idle', tone: 'quiet', at: p.at };
  if (p.state === 'error') return { state: 'error', tone: 'alert', at: p.at };
  if (p.state === 'waiting_user') return { state: 'waiting', tone: 'attention', at: p.at };
  if (p.state === 'unknown') return { state: 'sync', tone: 'quiet', at: p.at };
  if (p.state === 'stale') return { state: 'lost', tone: 'dim', at: p.at };
  if (p.state === 'offline') return { state: 'offline', tone: 'dim', at: p.at };
  return null;
}
/* @chain-region linkRuntime | calls: includes */ function linkRuntime(state, at) {
  if (['running', 'busy'].includes(state)) return { state: 'working', tone: 'active', at };
  if (state === 'waiting_user') return { state: 'waiting', tone: 'attention', at };
  if (['error', 'failed', 'blocked'].includes(state)) return { state: 'error', tone: 'alert', at };
  return { state: 'idle', tone: 'quiet', at };
}
export /* @chain-region linkStatusLabel */ function linkStatusLabel(state, language = 'zh') {
  return ({
    working: ['工作中', 'Working'],
    idle: ['空闲', 'Idle'],
    waiting: ['等待你回复', 'Awaiting your reply'],
    error: ['执行出错', 'Execution error'],
    offline: ['离线', 'Offline'],
    lost: ['失联', 'Unreachable'],
    sync: ['等待状态更新', 'Awaiting update'],
  }[state] || ['等待状态更新', 'Awaiting update'])[language === 'en' ? 1 : 0];
}
// 线路：本机直连 17930 为「本机」，经局域网配对的设备为「LAN」，云办公室为「云」。
export /* @chain-region lineLabel */ function lineLabel(line, language = 'zh') {
  return ({ local: ['本机', 'Local'], lan: ['LAN', 'LAN'], cloud: ['云', 'Cloud'] }[line] || ['本机', 'Local'])[
    language === 'en' ? 1 : 0
  ];
}
// 设备（用户 2026-10-16）：Windows 电脑、Linux 服务器、手机（Termux）三种，各有自己的立体工位图。
// 工位上报了平台就按平台；没有时按名字里的字样判断；都没有时是这台 Windows 电脑。
export /* @chain-region deviceKind | calls: toLowerCase, text, test */ function deviceKind(agent = {}, name = '') {
  const platform = text(agent?.runtime?.platform || agent?.platform || '').toLowerCase(),
    value = text(name).toLowerCase();
  if (/android|termux/.test(platform) || /phone|手机|android|termux/.test(value)) return 'phone';
  if (/linux|darwin/.test(platform) || /server|服务器|linux|ubuntu|debian|cloud|云端|vps/.test(value)) return 'server';
  return 'pc';
}
export /* @chain-region hostKind | calls: toLowerCase, text, value.includes, test */ function hostKind(name = '', presence = null) {
  if (presence?.host === 'codex') return 'Codex';
  if (presence?.host === 'claude') return 'Claude';
  const value = text(name).toLowerCase();
  if (value.includes('claude')) return 'Claude';
  if (value.includes('codex')) return 'Codex';
  if (value.includes('eyra')) return 'Eyra';
  if (/phone|手机|android|termux/.test(value)) return '手机';
  if (value.includes('cli')) return 'CLI';
  return 'Agent';
}
