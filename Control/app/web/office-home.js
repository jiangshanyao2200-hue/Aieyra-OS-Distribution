// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Control/app/web/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: $; sources; controllers; colors; drafts; deskArea; rows; office; language; L; clock; reachable; live; assignColors; DEVICE_NAME; deviceName; since; SEAT_STATE; BASE; CHAIR; SCREENS; seatHash; equipment; deskArt; bubble; desk; layoutDesks; liftDesks; stationsPage; adapterLabels; isStationMessage; stationConversation; stationDetail; render; readHistory; sendToStation; get; readOffice; paintOffice; refresh; accessGuide; back; deskResize
// Impact: python -B scripts/code-atlas.py show Control/app/web/office-home.js
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import { esc, list, text, timestamp, normalize, humanLine } from './model.js';
import { updateHTML } from './dom.js';
import { stationColor, palette, linkStatusLabel, deviceKind, hostKind } from './station-model.js';
import { homeLayout, orderedMessages } from './office-home-model.js';
import { stationRows, latestSays } from './situation.js';
import { setupLinkAccessGuide } from './link-access-guide.js';

const $ = (selector) => document.querySelector(selector);
const sources = { snapshot: { value: null }, registry: { value: null } };
const controllers = new Set();
const colors = new Map();
const drafts = new Map();
let deskArea = null;
let rows = [], detail = null, polling = false, disposed = false, timer = null;
let office = null, officeError = false;
let language = 'zh';
try {
  if (localStorage.getItem('control-language') === 'en') language = 'en';
} catch {}
const L = (zh, en) => (language === 'en' ? en : zh);
const clock = (at, full = false) => {
  const n = timestamp(at);
  return Number.isFinite(n)
    ? new Intl.DateTimeFormat(
        language === 'en' ? 'en-GB' : 'zh-CN',
        full
          ? { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }
          : { hour: '2-digit', minute: '2-digit', hour12: false },
      ).format(n)
    : '';
};
const reachable = () =>
  !!sources.snapshot.value &&
  !sources.snapshot.error &&
  Date.now() - sources.snapshot.at < 180000 &&
  sources.snapshot.value.connection?.state === 'online';
const live = () => reachable() && !!sources.registry.value && !sources.registry.error;
function assignColors() {
  const used = new Set(colors.values());
  for (const s of [...rows].sort((a, b) => a.id.localeCompare(b.id))) {
    if (colors.has(s.id)) continue;
    let c = stationColor('registry:' + s.id);
    if (used.has(c)) c = palette.find((p) => !used.has(p)) || c;
    colors.set(s.id, c);
    used.add(c);
  }
}

const DEVICE_NAME = {
  pc: ['电脑', 'Computer'],
  server: ['服务器', 'Server'],
  phone: ['手机', 'Phone'],
};
const deviceName = (k) => DEVICE_NAME[k][language === 'en' ? 1 : 0];

function since(at) {
  const t = typeof at === 'number' ? at * (at < 1e12 ? 1000 : 1) : Date.parse(at || '');
  if (!Number.isFinite(t) || t <= 0) return '';
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 1) return L(' · 刚刚', ' · just now');
  if (m < 60) return L(` · ${m} 分钟前`, ` · ${m}m ago`);
  if (m < 1440) return L(` · ${Math.round(m / 60)} 小时前`, ` · ${Math.round(m / 60)}h ago`);
  return L(` · ${Math.round(m / 1440)} 天前`, ` · ${Math.round(m / 1440)}d ago`);
}

// 工位：原来的立体工位图（桌子、椅子、地面光环），桌上的设备按种类换（沿用之前 Link 云办公室的设备画法）：
// 电脑是显示器 + 键盘 + 一台主机箱（屏幕图案和主机上的识别刻痕按工位各不相同）；服务器是一台机柜；手机立在支架上。
const SEAT_STATE = {
  working: 'running',
  idle: 'idle',
  waiting: 'waiting_user',
  error: 'error',
  offline: 'offline',
  lost: 'lost',
  sync: 'offline',
};
const BASE =
  '<ellipse class="work-orbit" cx="0" cy="23" rx="69" ry="34"/><path class="desk-side" d="M-49-1 0 23 49-1V8L0 33-49 8Z"/><path class="desk-top" d="M-49-1 0-26 49-1 0 23Z"/><path class="desk-leg" d="M-41 11v21m82-21v21"/>';
const CHAIR =
  '<path class="seat-chair" d="M-11 27 2 20 18 28 5 35Z M-11 27v12l16 8 13-8V28"/><circle class="seat-signal" cx="42" cy="-3" r="3"/>';
const SCREENS = [
  'M3 4h21M3 8h14M3 12h9',
  'M3 3h9v10H3Z M15 3h9v4h-9Z M15 10h9',
  'M3 12V3m0 9h21M5 10l5-5 6 4 7-6',
];
function seatHash(id) {
  let h = 2166136261;
  for (const c of String(id)) h = Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0;
  return h;
}
function equipment(kind, hash) {
  if (kind === 'server')
    return `<g class="seat-equipment device-rack"><path class="monitor-back" d="M-23-58 10-42 10 9-23-7Z"/><path class="device-side" d="M10-42 24-49 24 2 10 9Z M-23-58-9-65 24-49 10-42Z"/>${[
      0, 1, 2, 3,
    ]
      .map(
        (i) =>
          `<path class="monitor-screen" d="M-18 ${-48 + i * 11} 5 ${-37 + i * 11}v7l-23-11Z"/><path class="device-vent" d="M-14 ${-43 + i * 11} 0 ${-36 + i * 11}"/><circle class="device-led" cx="2" cy="${-35 + i * 11}" r="1.1"/>`,
      )
      .join('')}<path class="keyboard" d="M-10 8 3 2 19 10 6 16Z"/></g>`;
  if (kind === 'phone')
    return '<g class="seat-equipment device-handheld"><path class="keyboard" d="M-12 4 1-3 18 5 5 12Z"/><path class="device-stand" d="M1-13v16m-7 2 7-4 7 4"/><path class="monitor-back" d="M-14-55 8-44V-7L-14-18Z"/><path class="monitor-screen" d="M-11-47 5-39v25l-16-8Z"/><path class="device-speaker" d="M-6-48 0-45"/><path class="device-app" d="M-8-38-3-35v5l-5-3Z M0-34 3-32.5v5L0-29Z M-8-28-3-25v5l-5-3Z"/><circle class="device-led" cx="-3" cy="-17" r="1.2"/></g>';
  const marks = Array.from(
    { length: 6 },
    (_, i) =>
      `<path class="device-identity-mark" opacity="${hash & (1 << i) ? '.9' : '.2'}" d="M${20 + i * 1.5} -6v3"/>`,
  ).join('');
  return `<g class="seat-equipment device-computer"><path class="monitor-back" d="M-25-43 13-25 13 4-25-14Z"/><path class="monitor-screen" d="M-20-35 8-21 8-4-20-18Z"/><g transform="matrix(1 .5 0 1 -20 -35)"><path class="device-screen-pattern" d="${SCREENS[hash % SCREENS.length]}"/></g><path class="keyboard" d="M-2 5 12-2 26 5 12 12Z"/><g class="device-tower"><path class="monitor-back" d="M18-27 30-21V2L18-4Z"/><path class="device-side" d="M30-21 36-24V-1L30 2Z M18-27 24-30 36-24 30-21Z"/><path class="device-vent" d="M21-19 27-16m-6 4 6 3"/><circle class="device-led" cx="25" cy="-4" r="1.1"/>${marks}</g></g>`;
}
const deskArt = (s, cls = '') =>
  `<svg${cls ? ` class="${cls}"` : ''} viewBox="-88 -74 176 145" aria-hidden="true"><g class="floor-seat seat-${SEAT_STATE[s.link.state] || 'idle'}">${BASE}${equipment(deviceKind(s.agent, s.name), seatHash(s.id))}${CHAIR}</g></svg>`;

// 头顶气泡：这个工位最近一句人话，一直留到它下次发言；半小时以前的变淡。新的一句换一个 key，气泡就重新“冒”出来。
function bubble(say) {
  if (!say) return '';
  const old = Date.now() - (timestamp(say.at) || 0) > 1800000;
  return `<span class="seat-say" data-key="say-${esc(say.id)}" data-age="${old ? 'old' : 'new'}" title="${esc(clock(say.at, true))}"><span>${esc(say.text)}</span></span>`;
}
function desk(s, say) {
  const name = s.name || L('未命名工位', 'Unnamed station'),
    label = linkStatusLabel(s.link.state, language),
    line = s.link.state === 'offline' || s.link.state === 'lost' ? since(s.link.at) : '',
    meta = label + line,
    device = deviceKind(s.agent, name);
  return `<button class="home-seat" data-key="seat-${esc(s.id)}" data-seat="${esc(s.id)}" data-state="${esc(s.link.state)}" data-lead="${s.leader ? 'true' : 'false'}" data-device="${device}" style="--station-accent:${colors.get(s.id)}" aria-pressed="${detail?.id === s.id}" aria-controls="link-detail" aria-label="${esc(name + ' · ' + deviceName(device) + ' · ' + meta)}"${say ? ` aria-description="${esc(say.text)}"` : ''}>${bubble(say)}${deskArt(s)}<strong class="seat-name">${esc(name)}</strong><span class="seat-code">${esc(deviceName(device))}</span><span class="seat-status" data-state="${esc(s.link.state)}">${esc(meta)}</span></button>`;
}
function layoutDesks() {
  const grid = document.querySelector('.home-grid');
  if (!grid) return;
  const view = $('#link-view'),
    style = getComputedStyle(view),
    width =
      deskArea?.width ??
      view.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
    height =
      deskArea?.height ??
      view.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  if (width <= 0 || height <= 0) return;
  const g = homeLayout(rows.length, width, height);
  grid.style.setProperty('--columns', g.columns);
  grid.style.setProperty('--size', g.size + 'px');
  grid.style.setProperty('--gap', g.gap + 'px');
  liftDesks(grid, view);
}
// 工位按看得见的部分居中：每个工位上方留给气泡的空位和图形上方的留白不算，
// 否则单排工位总比左侧导航低一截。只在整排放得下时上移，且不超过上方空余，滚动时不裁掉气泡。
function liftDesks(grid, view) {
  grid.style.setProperty('--lift', '0px');
  const seats = [...grid.querySelectorAll('.home-seat')];
  if (!seats.length) return;
  const box = grid.getBoundingClientRect(),
    area = view.getBoundingClientRect(),
    style = getComputedStyle(view),
    free = box.top - area.top - parseFloat(style.paddingTop);
  if (box.height > area.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) || free <= 0) return;
  const tops = seats.map((s) => s.querySelector('svg > g')?.getBoundingClientRect().top).filter(Number.isFinite),
    bottoms = seats.map((s) => s.querySelector('.seat-status')?.getBoundingClientRect().bottom).filter(Number.isFinite);
  if (!tops.length || !bottoms.length) return;
  const lift = (Math.min(...tops) - box.top - (box.bottom - Math.max(...bottoms))) / 2;
  if (lift > 0) grid.style.setProperty('--lift', Math.round(Math.min(lift, free)) + 'px');
}
function stationsPage() {
  const says = latestSays(rows);
  const byActor = new Map(rows.map((seat) => [seat.actor_id, seat.id]));
  for (const delivery of list(sources.snapshot.value?.deliveries)) {
    const seat = byActor.get(delivery.target);
    const at = delivery.reply_at || delivery.updated_at;
    const time = timestamp(at);
    const reply = humanLine(delivery.reply, 60);
    if (seat && reply && time > Date.now() - 86400000 && time > (timestamp(says.get(seat)?.at) || 0))
      says.set(seat, { id: delivery.id, text: reply, at });
  }
  return rows.length
    ? `<div class="home-grid">${rows.map((s) => desk(s, says.get(s.id))).join('')}</div>`
    : `<p class="page-empty">${L(sources.registry.error ? '工位暂时无法读取，正在等待恢复。' : '等待工位接入', 'Waiting for workstations')}</p>`;
}

const adapterLabels = () => ({
  registered: L('已登记', 'Registered'),
  adapted: L('已适配', 'Adapted'),
  verified: L('收发已验证', 'Messaging verified'),
});

function isStationMessage(message, seat) {
  if (message.sender === seat.actor_id) return true;
  return list(message.mentions).some((entry) => (typeof entry === 'string' ? entry : entry?.actor_id || entry?.id) === seat.actor_id);
}

function stationConversation(seat, history) {
  const messages = orderedMessages([
    ...list(sources.snapshot.value?.messages).filter((message) => isStationMessage(message, seat)),
    ...history.items,
  ]).map((message) => ({
    id: 'station-' + message.id,
    who: rows.find((row) => row.actor_id === message.sender)?.name || message.sender_name || message.sender,
    at: message.created,
    body: message.body,
  }));
  const deliveryLabels = {
    pending: L('待投递', 'Pending'),
    sending: L('投递中', 'Delivering'),
    failed: L('投递失败', 'Delivery failed'),
    unknown: L('投递待确认', 'Delivery unconfirmed'),
  };
  for (const delivery of list(sources.snapshot.value?.deliveries)) {
    if (delivery.target !== seat.actor_id) continue;
    messages.push({
      id: delivery.id, who: L('我', 'You'), at: delivery.created_at, body: delivery.body,
      status: deliveryLabels[delivery.state],
    });
    if (delivery.reply) messages.push({
      id: delivery.id + '-reply', who: seat.name, at: delivery.reply_at || delivery.updated_at, body: delivery.reply,
    });
  }
  messages.sort((a, b) => (timestamp(a.at) || 0) - (timestamp(b.at) || 0));
  return messages.map((message) => `<article class="channel-raw" data-key="${esc(message.id)}"><p class="chat-who"><strong>${esc(message.who)}</strong><time>${esc(clock(message.at, true))}</time></p><p>${esc(message.body)}</p>${message.status ? `<p class="meta">${esc(message.status)}</p>` : ''}</article>`).join('');
}

function stationDetail(view) {
  const seat = rows.find((row) => row.id === view.id);
  if (!seat) return `<p class="page-empty">${L('这个工位已不在列表里。', 'This station is gone.')}</p>`;
  const transcript = stationConversation(seat, view);
  const draft = drafts.get(seat.actor_id) || {};
  const runtime = seat.agent?.runtime;
  const canSend = live() && runtime?.bound === true && !!runtime.native_session_id;
  const adapter = office?.adapters?.find((row) => row.actor_id === seat.actor_id);
  const project = list(sources.registry.value?.projects).find((row) => row.id === seat.project);
  const info = [hostKind(seat.name, seat.agent?.presence), deviceName(deviceKind(seat.agent, seat.name)), project?.name || seat.project].filter(Boolean).join(' · ');
  const checked = adapterLabels()[adapter?.state];
  const lastSeen = clock(seat.link.at, true);
  return `<article class="detail station-detail" style="--station-accent:${colors.get(seat.id)}">
    <header class="detail-head">${deskArt(seat, 'detail-desk')}<div><h2>${esc(seat.name)}</h2><p class="meta">${esc(info)}</p><p class="station-presence" data-tone="${esc(seat.link.tone)}">${esc(linkStatusLabel(seat.link.state, language))}${checked ? ' · ' + esc(checked) : ''}</p></div></header>
    <div class="station-history-head"><h3>${L('对话', 'Conversation')}</h3>${lastSeen ? `<span class="meta">${L('最近上报', 'Last report')} <time>${esc(lastSeen)}</time></span>` : ''}</div>
    <div class="history-controls">${view.more ? `<button type="button" data-older ${view.loading ? 'disabled' : ''}>${view.error ? L('重试', 'Retry') : L('更早记录', 'Earlier messages')}</button>` : ''}<span class="meta" role="status">${view.loading ? L('正在读取记录…', 'Loading messages…') : view.error ? L('历史暂时无法读取', 'History unavailable') : ''}</span></div>
    <div class="station-transcript">${transcript || (!view.loading && !view.error ? `<p class="meta">${view.more ? L('近期暂无相关对话', 'No recent messages') : L('暂无对话', 'No messages yet')}</p>` : '')}</div>
    ${canSend || draft.text ? `<form class="station-compose" data-actor="${esc(seat.actor_id)}"><textarea data-persistent aria-label="${L('消息', 'Message')}" rows="2" maxlength="4000" ${draft.pending || draft.attempt ? 'readonly' : ''}>${esc(draft.text)}</textarea><button type="submit" ${(!canSend && !draft.attempt) || draft.pending ? 'disabled' : ''}>${draft.attempt && !draft.pending ? L('查询回执', 'Check receipt') : L('发送', 'Send')}</button></form>` : ''}
    <p class="meta station-send-status" role="status">${esc(draft.status || (!canSend ? L('工位暂时无法接收消息', 'Station cannot receive messages yet') : ''))}</p>
  </article>`;
}

function render(reset = false) {
  rows = stationRows(sources.registry.value, sources.snapshot.value, live());
  assignColors();
  paintOffice();
  const mark = $('#link-program-icon');
  const working = rows.some((seat) => seat.link.state === 'working');
  mark.dataset.working = String(working);
  mark.setAttribute('aria-label', working ? L('Link 工作中', 'Link working') : 'Link');
  const page = $('#link-detail');
  $('#link-board').dataset.selected = String(!!detail);
  $('#link-back').hidden = !detail;
  updateHTML($('#link-view'), stationsPage());
  updateHTML($('#link-detail-content'), detail ? stationDetail(detail) : `<p class="page-empty">${L('选择一个工位', 'Select a workstation')}</p>`);
  layoutDesks();
  if (reset) page.scrollTop = 0;
}

async function readHistory(view) {
  if (view.loading || !view.more) return;
  view.loading = true;
  view.error = false;
  render();
  try {
    const seat = rows.find((row) => row.id === view.id);
    if (!seat) return;
    for (let read = 0; read < 6 && view.more && detail === view; read++) {
      const path = '/api/chat-history' + (view.before ? '?before=' + view.before : '');
      const page = await get(path);
      if (!Array.isArray(page.messages) || typeof page.has_more !== 'boolean' ||
          (page.has_more && (!Number.isSafeInteger(page.next_before) || page.next_before <= 0 ||
            (view.before && page.next_before >= view.before)))) throw Error('invalid_history');
      if (detail !== view) return;
      const messages = page.messages.filter((message) => isStationMessage(message, seat));
      view.items.push(...messages);
      view.before = page.next_before;
      view.more = page.has_more;
      if (messages.length) break;
    }
  } catch {
    view.error = true;
  } finally {
    view.loading = false;
    if (!disposed && detail === view) render();
  }
}

async function sendToStation(seat, draft) {
  const body = draft.text;
  if (!body?.trim() || draft.pending) return;
  const previous = draft.attempt;
  const native = seat.agent?.runtime?.native_session_id;
  if (!previous && (!live() || !seat.agent?.runtime?.bound || !native)) return;
  const { id } = draft.attempt ||= { id: crypto.randomUUID() };
  draft.pending = true;
  draft.status = previous ? L('正在查询原回执…', 'Checking receipt…') : L('正在发送…', 'Sending…');
  render();
  let delivery, rejected = false, submitted = false;
  if (!previous) {
    try {
      const { csrf } = await get('/api/session');
      submitted = true;
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Control-CSRF': csrf },
        body: JSON.stringify({ request_id: id, target: seat.actor_id, body, expected_native_session_id: native }),
        signal: AbortSignal.timeout(8000),
      });
      if (response.ok) delivery = (await response.json()).delivery;
      else if ([400, 401, 403, 409].includes(response.status)) rejected = true;
    } catch {}
  }
  if (!delivery && (submitted || previous)) {
    try { delivery = (await get('/api/deliveries/' + id)).delivery; } catch {}
  }
  draft.pending = false;
  if (delivery?.id === id && delivery.target === seat.actor_id && delivery.body === body) {
    draft.text = '';
    draft.attempt = null;
    draft.status = L('已收到投递回执', 'Delivery recorded');
    const input = $('#link-detail textarea');
    if (input?.closest('form').dataset.actor === seat.actor_id) input.value = '';
    await refresh();
  } else {
    if (rejected || (!submitted && !previous)) {
      draft.attempt = null;
      draft.status = L('消息未发送，草稿已保留', 'Message not sent. Draft retained.');
    } else {
      draft.status = L('投递待确认，原消息已保留', 'Delivery unconfirmed. Message retained.');
    }
  }
  if (!disposed) render();
}

async function get(path) {
  const controller = new AbortController();
  controllers.add(controller);
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const r = await fetch(path, { cache: 'no-store', signal: controller.signal });
    if (!r.ok) throw Error('read');
    return await r.json();
  } finally {
    clearTimeout(timeout);
    controllers.delete(controller);
  }
}
async function readOffice() {
  try {
    const value = await get('/api/office');
    if (value?.protocol !== 'aieyra-office/1') throw Error('shape');
    office = value;
    officeError = false;
  } catch {
    officeError = true;
  }
}
function paintOffice() {
  const online = !officeError && office?.cloud?.online === true;
  $('#link-counts').textContent = sources.registry.value ? String(rows.length) : '';
  const unknown = L('待确认', 'Unknown');
  const lanState =
    {
      disabled: L('未启用', 'disabled'),
      discovering: L('正在发现', 'discovering'),
      connected: L('已连接', 'connected'),
      online: L('在线', 'online'),
      ready: L('可发现', 'discoverable'),
      stopped: L('已停止', 'stopped'),
      waiting: L('等待发现', 'waiting'),
      idle: L('待连接', 'idle'),
    }[office?.lan?.state] || unknown;
  const labels = [
    ['local', L('本机', 'Local'), live() ? L('在线', 'Online') : unknown, live()],
    ['lan', 'LAN', !office || officeError ? unknown : lanState, !officeError && ['ready', 'online', 'connected'].includes(office?.lan?.state)],
    ['cloud', L('云 Link', 'Cloud Link'), !office || officeError ? unknown : online ? L('在线', 'Online') : L('未连接', 'Disconnected'), online],
  ];
  for (const [key, label, state, connected] of labels) {
    const node = $(`#link-status-${key}`);
    node.textContent = `${label} · ${state}`;
    node.dataset.online = String(connected);
  }
}
async function refresh() {
  if (polling || disposed) return;
  clearTimeout(timer);
  polling = true;
  await Promise.all([
    readOffice(),
    ...Object.keys(sources).map(async (key) => {
      try {
        const v = await get('/api/' + key);
        if (
          key === 'snapshot'
            ? !['agents', 'messages', 'tasks', 'resources', 'projects'].every((k) =>
                Array.isArray(v?.[k]),
              )
            : !Array.isArray(v?.seats) || !Array.isArray(v?.governance)
        )
          throw Error('shape');
        sources[key] = {
          value: key === 'snapshot' ? normalize(v) : v,
          at: Date.now(),
          error: false,
        };
      } catch {
        sources[key].error = true;
      }
    }),
  ]);
  if (disposed) return;
  polling = false;
  render();
  if (!document.hidden) timer = setTimeout(refresh, 8000);
}

document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
$('#app').innerHTML = `
  <main id="main" class="link-page link-workstations" tabindex="-1" aria-label="Link">
    <header class="link-top">
      <div class="link-brand"><span id="link-program-icon" role="img" aria-label="Link"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="m9 15 6-6M10 7l2-2a5 5 0 0 1 7 7l-2 2M14 17l-2 2a5 5 0 0 1-7-7l2-2"/></svg></span><h1>Aieyra Link</h1></div>
      <div class="link-status-strip" aria-label="${L('连接状态', 'Connection status')}"><span id="link-status-local"></span><span id="link-status-lan"></span><span id="link-status-cloud"></span></div>
      <div class="link-toolbar"><button id="link-join" type="button">${L('复制接入信息', 'Copy access info')}</button><span id="link-copy-status" role="status"></span></div>
    </header>
    <section id="link-copy-fallback" hidden><textarea readonly rows="6" aria-label="${L('接入信息', 'Access information')}"></textarea><button type="button">${L('关闭', 'Close')}</button></section>
    <div id="link-board" data-selected="false">
      <section class="link-gallery" aria-labelledby="link-stations-heading"><header><h2 id="link-stations-heading">${L('工位', 'Workstations')}</h2><span id="link-counts"></span></header><div id="link-view" class="link-view" tabindex="0"></div></section>
      <section id="link-detail" class="link-inspector" aria-label="${L('工位详情', 'Workstation details')}" tabindex="-1"><button id="link-back" class="link-back" type="button" hidden>${L('返回工位', 'Back to workstations')}</button><div id="link-detail-content"></div></section>
    </div>
  </main>`;
const accessGuide = setupLinkAccessGuide({
  button: $('#link-join'), status: $('#link-copy-status'), fallback: $('#link-copy-fallback'), language,
  project: () => rows.find((seat) => seat.id === detail?.id)?.project,
});


function back() {
  const previous = detail;
  detail = null;
  render();
  const view = $('#link-view');
  view.scrollTop = previous.scroll;
  ([...view.querySelectorAll('[data-seat]')].find((button) => button.dataset.seat === previous.id) || view).focus();
}

$('#main').addEventListener('click', (event) => {
  if (event.target.closest('#link-back') && detail) return back();
  if (event.target.closest('[data-older]') && detail) return void readHistory(detail);
  const seat = event.target.closest('[data-seat]');
  if (!seat) return;
  if (detail?.id === seat.dataset.seat) return;
  detail = { id: seat.dataset.seat, scroll: $('#link-view').scrollTop, items: [], before: null, more: true };
  render(true);
  $('#link-detail').focus();
  void readHistory(detail);
});
$('#link-detail').addEventListener('input', (event) => {
  const form = event.target.closest('.station-compose');
  if (!form) return;
  const actor = form.dataset.actor;
  if (!drafts.has(actor)) drafts.set(actor, {});
  drafts.get(actor).text = event.target.value;
});
$('#link-detail').addEventListener('submit', (event) => {
  if (!event.target.matches('.station-compose')) return;
  event.preventDefault();
  const actor = event.target.dataset.actor;
  const seat = rows.find((row) => row.actor_id === actor && row.id === detail?.id);
  if (seat && drafts.has(actor)) void sendToStation(seat, drafts.get(actor));
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && detail && $('#link-copy-fallback').hidden) back();
});
window.addEventListener('resize', layoutDesks);
const deskResize = new ResizeObserver(([entry]) => {
  deskArea = entry.contentRect;
  if (!disposed) layoutDesks();
});
deskResize.observe($('#link-view'));
window.addEventListener('pagehide', () => {
  disposed = true;
  deskResize.disconnect();
  accessGuide.dispose();
  clearTimeout(timer);
  controllers.forEach((controller) => controller.abort());
});
document.addEventListener('visibilitychange', () => {
  clearTimeout(timer);
  if (!document.hidden) void refresh();
});
render();
void refresh();
