/* @file-map:start
文件: link/office/web/office-home.js
位置: 一环·共享工位界面 | 工位页面与供shell/原生OS复用的模型、视觉和弹层规则。
约束: 共享原语优先复用，页面仅组装数据与事件；保持草稿、滚位和焦点，不在布局观察回调中重复同步写布局
下游: link/office/web/dom.js, link/office/web/link-access-guide.js, link/office/web/model.js, link/office/web/motion.mjs, link/office/web/office-home-model.js, link/office/web/pixel-office.js, link/office/web/situation.js, link/office/web/station-model.js, link/office/web/ticker.js, link/office/web/tooltip.mjs
上游: link/office/web/index.html
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: node --test link/office/tests/unit/*.mjs, AIDEBUG/live-review.cjs
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  $ | function
  canRefresh | function
  L | function
  icon | function
  clock | function
  reachable | function
  live | function
  actor | function
  state | function
  tickets | function
  assignColors | function
  deviceName | function
  since | function
  bubble | function
  desk | function
  layoutDesks | function
  placeDesks | function
  liftDesks | function
  liftDesks.apply | function
  stationsPage | function
  healEvents | function
  diagnostics | function
  ticketCard | function
  stationTasks | function
  stationTasks.by | function
  channel | function
  chatRecords | function
  messageIdentity | function
  messageAvatar | function
  groupMessage | function
  historyControls | function
  historyStatus | function
  groupChat | function
  taskPage | function
  loadHistory | function
  stationDetail | function
  ticketDetail | function
  ticketDetail.dependencyLabel | function
  messageDetail | function
  pageMarkup | function
  render | function
  openDetail | function
  back | function
  readTask | function
  selectPanel | function
  get | function
  readLan | function
  readOffice | function
  paintOffice | function
  refresh | function
  copyText | method
  dispose | method
  onclick | handler
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
import { setupLinkAccessGuide } from './link-access-guide.js';
import {
  esc,
  list,
  text,
  timestamp,
  normalize,
  taskRecordLabel,
  taskRecordState,
  humanLine,
} from './model.js';
import { updateHTML } from './dom.js';
import {
  stationColor,
  palette,
  wakeupDeliveryLabel,
  linkStatusLabel,
  lineLabel,
  hostKind,
  deviceKind,
  orderedTasks,
} from './station-model.js';
import { homeLayout, mergeTasks, recentTasks, orderedMessages, stationRosterPage } from './office-home-model.js';
import { pixelPortrait, pixelOfficeTables, recentCompletion } from './pixel-office.js';
import { situation, stationRows, latestSays, taskColumn } from './situation.js';
import { createTicker } from './ticker.js';
import { animateUI, cancelMotion, enterSurface } from './motion.mjs';
// 和 OS 同一份提示框；取不到也不影响页面。
void import('./tooltip.mjs').then((m) => m.setupTooltips(document)).catch(() => {});

// Link / 群聊 / 工单在同一背景内切换；原工位图、状态来源和详情继续共用。
// 所有面板仅GET读取，不取得Agent凭据、派工、发送或任务执行权限。
// OS 内嵌、独立 Link 与拖出窗口共用这一份；宿主可以推送云号池信息（window 事件 aieyra-host）。
const /* @chain-region $ | calls: document.querySelector */ $ = (s) => document.querySelector(s),
  sources = { snapshot: { value: null }, registry: { value: null } },
  controllers = new Set();
let deskArea = null, deskResizeFrame = 0;
let officeVisible = null;
const /* @chain-region canRefresh */ canRefresh = () => officeVisible ?? !document.hidden;
const roster = { query: '', status: 'all', page: 0 };
let rows = [],
  detail = null,
  polling = false,
  disposed = false,
  timer = null,
  lanCheckedAt = 0,
  lan = null,
  cloud = null;
let office = null,
  officeError = false;
const colors = new Map();
let showSituation = false;
try {
  const response = await (window.linkOfficeFetch || fetch)('/api/features', { signal: AbortSignal.timeout(2500) });
  if (response.ok) showSituation = (await response.json()).link_situation === true;
} catch {}
const panelNames = ['stations', 'chat', 'tasks'],
  panelViews = Object.fromEntries(panelNames.map((name) => [name, { detail: null, scroll: 0 }])),
  histories = Object.fromEntries(
    ['chat', 'tasks'].map((name) => [
      name,
      {
        history: false,
        loaded: false,
        busy: false,
        error: false,
        items: [],
        recent: [],
        before: null,
        next: null,
        more: false,
        trail: [],
        attempt: null,
        retention: null,
      },
    ]),
  );
let panel = 'stations',
  taskLimit = 10;
let language = 'zh',
  channelMode = 'simple';
try {
  if (localStorage.getItem('control-language') === 'en') language = 'en';
  if (sessionStorage.getItem('link-channel') === 'raw') channelMode = 'raw';
} catch {}
const /* @chain-region L */ L = (zh, en) => (language === 'en' ? en : zh);
const paths = {
  back: '<path d="m14 5-7 7 7 7"/>',
  stations: '<circle cx="8" cy="12" r="5"/><circle cx="16" cy="12" r="5"/>',
  chat: '<path d="M20 11a8 8 0 0 1-8 8H5l-3 3V11a9 9 0 0 1 18 0Z"/><path d="M7 10h8m-8 4h5"/>',
  tasks: '<path d="M5 3h14v14l-4 4H5Z M14 21v-5h5M8 8h8m-8 4h6"/>',
};
const /* @chain-region icon */ icon = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
const /* @chain-region clock | calls: timestamp, Number.isFinite, format, Intl.DateTimeFormat */ clock = (at, full = false) => {
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
const /* @chain-region reachable | calls: Date.now */ reachable = () =>
  !!sources.snapshot.value &&
  !sources.snapshot.error &&
  Date.now() - sources.snapshot.at < 180000 &&
  sources.snapshot.value.connection?.state === 'online';
const /* @chain-region live | calls: reachable */ live = () => reachable() && !sources.registry.error;
const /* @chain-region actor | calls: find, list, L */ actor = (id) =>
  list(sources.snapshot.value?.agents).find((a) => a.id === id)?.name ||
  id ||
  L('未分配', 'Unassigned');
const /* @chain-region state | calls: taskRecordState, reachable */ state = (t) => taskRecordState(t, reachable());
const /* @chain-region tickets | calls: orderedTasks, reachable */ tickets = () => orderedTasks(sources.snapshot.value?.tasks, reachable());

/* @chain-region assignColors | calls: Set, colors.values, sort, a.id.localeCompare, colors.has, stationColor, used.has, palette.find … */ function assignColors() {
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
const /* @chain-region deviceName */ deviceName = (k) => DEVICE_NAME[k][language === 'en' ? 1 : 0];

/* @chain-region since | calls: Date.parse, Number.isFinite, Math.max, Math.round, Date.now, L */ function since(at) {
  const t = typeof at === 'number' ? at * (at < 1e12 ? 1000 : 1) : Date.parse(at || '');
  if (!Number.isFinite(t) || t <= 0) return '';
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 1) return L(' · 刚刚', ' · just now');
  if (m < 60) return L(` · ${m} 分钟前`, ` · ${m}m ago`);
  if (m < 1440) return L(` · ${Math.round(m / 60)} 小时前`, ` · ${Math.round(m / 60)}h ago`);
  return L(` · ${Math.round(m / 1440)} 天前`, ` · ${Math.round(m / 1440)}d ago`);
}

// 头顶气泡：这个工位最近一句人话，一直留到它下次发言；半小时以前的变淡。新的一句换一个 key，气泡就重新“冒”出来。
/* @chain-region bubble | calls: Date.now, timestamp, esc, say.peers.join, clock */ function bubble(say) {
  if (!say) return '';
  const old = Date.now() - (timestamp(say.at) || 0) > 1800000;
  const peers = say.peers?.length ? `<small>${esc('→ ' + say.peers.join(' · '))}</small>` : '';
  return `<span class="seat-say" data-key="say-${esc(say.id)}" data-age="${old ? 'old' : 'new'}" title="${esc(clock(say.at, true))}">${peers}<span>${esc(say.text)}</span></span>`;
}
/* @chain-region desk | calls: L, linkStatusLabel, since, lineLabel, deviceKind, recentCompletion, colors.get, esc … */ function desk(s, say) {
  const name = s.name || L('未命名工位', 'Unnamed station'),
    label = linkStatusLabel(s.link.state, language),
    line =
      s.link.state === 'offline' || s.link.state === 'lost'
        ? since(s.link.at)
        : ' · ' + lineLabel(s.line, language),
    meta = label + line,
    device = deviceKind(s.agent, name), completed = recentCompletion(s), accent = colors.get(s.id);
  const done = completed ? `<span class="pixel-completion" data-key="complete-${esc(completed.id)}">${L('已完成', 'Done')}</span>` : '';
  const portraitName=s.pixel_avatar?.name;
  const speech = say ? `<span class="pixel-speech" title="${esc(say.text)}">${bubble(say)}</span>` : '';
  return `<button type="button" class="home-seat" data-key="seat-${esc(s.id)}" data-seat="${esc(s.id)}" data-state="${esc(s.link.state)}" data-working="${s.status?.state === 'running'}" data-speaking="${!!say && Date.now() - timestamp(say.at) < 90000}" data-lead="${s.leader ? 'true' : 'false'}" data-device="${device}" style="--station-accent:${accent}" aria-label="${esc(name + ' · ' + deviceName(device) + ' · ' + meta)}"${say ? ` aria-description="${esc(say.text)}"` : ''}>${pixelPortrait(s, accent)}<span class="seat-copy"><strong class="seat-name">${esc(name)}</strong><span class="seat-status" data-state="${esc(s.link.state)}">${esc(['offline','lost'].includes(s.link.state)?label+line:label)}</span>${portraitName?`<span class="pixel-portrait-name">${esc(portraitName)}</span>`:''}${done}${speech}</span><span class="seat-chevron" aria-hidden="true"></span></button>`;
}
/* @chain-region layoutDesks | calls: requestAnimationFrame, placeDesks */ function layoutDesks() {
  if (disposed || deskResizeFrame) return;
  deskResizeFrame = requestAnimationFrame(() => {
    deskResizeFrame = 0;
    if (!disposed && !detail && panel === 'stations') placeDesks();
  });
}
/* @chain-region placeDesks | calls: document.querySelector, $, getComputedStyle, parseFloat, homeLayout, String, grid.style.getPropertyValue, grid.style.setProperty … */ function placeDesks() {
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
  const g = homeLayout(grid.childElementCount, width, height);
  for (const [key,value] of [['--columns',String(g.columns)],['--size',g.size+'px'],['--gap',g.gap+'px']])
    if (grid.style.getPropertyValue(key) !== value) grid.style.setProperty(key,value);
  liftDesks(grid, view);
}
// 按图形和状态文字的可见边界修正内容区中心；导航独立占底行。
// 只有整组放得下才修正，不移动溢出网格，保留气泡和首末行的可达性。
/* @chain-region liftDesks | calls: parseFloat, grid.style.getPropertyValue, grid.querySelectorAll, apply, grid.getBoundingClientRect, view.getBoundingClientRect, getComputedStyle, filter … */ function liftDesks(grid, view) {
  const previous = parseFloat(grid.style.getPropertyValue('--lift')) || 0;
  const /* @chain-region liftDesks.apply | calls: grid.style.getPropertyValue, grid.style.setProperty */ apply = lift => { const value = lift + 'px'; if (grid.style.getPropertyValue('--lift') !== value) grid.style.setProperty('--lift',value); };
  const seats = [...grid.querySelectorAll('.home-seat')];
  if (!seats.length) { apply(0); return; }
  const box = grid.getBoundingClientRect(),
    area = view.getBoundingClientRect(),
    style = getComputedStyle(view),
    free = box.top + previous - area.top - parseFloat(style.paddingTop);
  if (box.height > area.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) || free <= 0) { apply(0); return; }
  const tops = seats.map((s) => s.querySelector('svg > g')?.getBoundingClientRect().top).filter(Number.isFinite),
    bottoms = seats.map((s) => s.querySelector('.seat-status')?.getBoundingClientRect().bottom).filter(Number.isFinite);
  if (!tops.length || !bottoms.length) { apply(0); return; }
  const lift = (Math.min(...tops) - box.top - (box.bottom - Math.max(...bottoms))) / 2;
  const scale = window.devicePixelRatio || 1;
  apply(Math.round(Math.max(0, Math.min(lift, free)) * scale) / scale);
}
/* @chain-region stationsPage | calls: stationRosterPage, $, pages.querySelector, roster.query.trim, L, latestSays, Date.now, join … */ function stationsPage() {
  const page = stationRosterPage(rows, roster);
  roster.page = page.page;
  const pages = $('#station-pages');
  pages.hidden = page.pages < 2;
  pages.querySelector('[data-station-page="-1"]').disabled = page.page === 0;
  pages.querySelector('[data-station-page="1"]').disabled = page.page + 1 === page.pages;
  const pagination = pages.querySelector('output');
  const pageText = `${page.page + 1} / ${page.pages}`;
  if (pagination.textContent !== pageText) pagination.textContent = pageText;
  const result = $('#station-results');
  result.hidden = !roster.query.trim() && roster.status === 'all';
  const resultText = L(`${page.total} 个匹配`, `${page.total} matches`);
  if (result.textContent !== resultText) result.textContent = resultText;
  if (!page.items.length) {
    const text = rows.length ? L('没有匹配的工位', 'No matching stations') :
      sources.registry.error ? L('工位读取失败', 'Could not load stations') : L('等待工位接入', 'Waiting for workstations');
    return `<p class="page-empty">${text}</p>`;
  }
  const says = latestSays(page.items, Date.now(), rows);
  return `<div class="pixel-office" aria-label="${L('Agent 工位','Agent workstations')}">${pixelOfficeTables(page.items,sources.registry.value).map(table=>{
    const name=esc(table.name || L('工位','Workstations'));
    return `<section class="pixel-table" aria-label="${name}" data-key="project-${esc(table.seats[0].project || 'shared')}"><h3>${name}</h3><div class="pixel-seats">${table.seats.map(s=>desk(s,says.get(s.id))).join('')}</div></section>`;
  }).join('')}</div>`;
}

/* @chain-region healEvents | calls: list */ function healEvents() {
  return list(sources.snapshot.value?.self_heal?.audit);
}
/* @chain-region diagnostics | calls: L, hostKind, deviceName, deviceKind, lineLabel, Date.now, parts.push, pop … */ function diagnostics(s) {
  const parts = [
    L('运行环境：', 'Host: ') + hostKind(s.name, s.agent?.presence),
    L('设备：', 'Device: ') + deviceName(deviceKind(s.agent, s.name)),
    L('连接：', 'Connection: ') + lineLabel(s.line, language),
  ];
  const runtime = s.agent?.runtime;
  const binding = s.station_binding;
  if (binding || runtime?.adapter === 'aieyra-agent/1') {
    const officeState = officeError ? L('暂不可读', 'Unavailable')
      : office ? L('在线', 'Online') : L('待确认', 'Unconfirmed');
    const snapshotFresh = !sources.snapshot.error && Date.now() - sources.snapshot.at < 180000;
    const sessionState = snapshotFresh && (!binding || runtime?.native_session_id === binding.native_session_id)
      ? runtime?.session_state : null;
    const transportState = {
      connected: L('已连接', 'Connected'),
      disconnected: L('已主动断开', 'Disconnected'),
      expired: L('租约已过期', 'Lease expired'),
      invalidated: L('工位绑定已失效', 'Station binding invalidated'),
      revoked: L('已撤销', 'Revoked'),
    }[sessionState] || L('待确认', 'Unconfirmed');
    const presence = snapshotFresh ? s.agent?.presence : null;
    const nativeState = presence?.source === 'native_host'
      ? presence.reason ? L('探测失败', 'Probe failed')
        : presence.state === 'offline' ? L('已归档', 'Archived') : L('可达', 'Reachable')
      : binding ? L('已绑定 · 可达性待确认', 'Bound · reachability unconfirmed')
        : L('待绑定', 'Unbound');
    parts.push(
      L('办公室服务', 'Office service') + ' · ' + officeState,
      L('工位传输', 'Station transport') + ' · ' + transportState,
      L('原生会话', 'Native session') + ' · ' + nativeState,
    );
  }
  const heal = healEvents()
    .filter((e) => e.actor_id === (s.agent?.id || s.id) && e.kind !== 'toggle')
    .pop();
  if (heal)
    parts.push(
      L('自愈：', 'Self-heal: ') +
        ({
          queued: L('已发「继续」', 'continue sent'),
          manual_required: L('需要人提醒', 'needs a nudge'),
          failed: L('没发出去', 'failed'),
          activity_observed: L('已恢复', 'recovered'),
        }[heal.result] || heal.result) +
        ' ' +
        clock(heal.at, true),
    );
  const keep = s.keepalive;
  if (keep && ['active', 'waiting_host', 'needs_attention'].includes(keep.state))
    parts.push(
      (keep.mode === 'resume'
        ? L('防中断保活：', 'Keepalive: ')
        : L('缓存保活：', 'Cache keepalive: ')) +
        L(
          `每${Math.round(keep.interval_seconds / 60)}分钟 · 已发${keep.fires}/${keep.max_fires}`,
          `every ${Math.round(keep.interval_seconds / 60)} min · ${keep.fires}/${keep.max_fires} sent`,
        ) +
        (keep.state === 'needs_attention' ? L(' · 需要处理', ' · needs attention') : ''),
    );
  if (s.link.at) parts.push(L('最近上报：', 'Last report: ') + clock(s.link.at, true));
  if (s.wakeup_delivery)
    parts.push(
      L('唤醒：', 'Wakeup: ') + wakeupDeliveryLabel(s.wakeup_delivery, language, reachable()),
    );
  if(!parts.length)return '';
  const attention=heal?.result==='manual_required'
    ?L('需要你提醒这个 Agent 继续工作。', 'This Agent needs a reminder to continue.')
    :heal?.result==='failed'?L('未能发送提醒，请查看连接诊断。', 'The reminder could not be sent. Check connection details.')
    :keep?.state==='needs_attention'?L('保活需要处理，请查看连接诊断。', 'Keepalive needs attention. Check connection details.') : '';
  return `${attention?`<p class="panel-notice" role="status">${attention}</p>`:''}<details class="connection-details" data-key="connection-details-${esc(s.id)}" data-preserve-open><summary>${L('连接与诊断', 'Connection details')}</summary>${parts.map(part=>`<p class="meta detail-diag">${esc(part)}</p>`).join('')}</details>`;
}

// —— 工单卡（工位详情里用） ——
const TICKET_TONE = {
  planned: 'open',
  pending: 'open',
  returned: 'warn',
  blocked: 'warn',
  doing: 'live',
  expired: 'warn',
  unconfirmed: 'warn',
  delivered: 'review',
  accepted: 'done',
  cancelled: 'muted',
  superseded: 'muted',
};
/* @chain-region ticketCard | calls: state, actor, L, rows.find, clock, esc, colors.get, taskRecordLabel … */ function ticketCard(t) {
  const st = state(t),
    who = actor(t.assignee || t.owner) || L('待安排', 'Unassigned'),
    seat = rows.find(
      (r) => r.agent?.id === (t.assignee || t.owner) || r.actor_id === (t.assignee || t.owner),
    ),
    when = clock(t.updated || t.updated_at || t.created, true);
  return `<button class="ticket" data-key="task-${esc(t.id)}" data-task="${esc(t.id)}" data-state="${esc(st)}" data-tone="${TICKET_TONE[st] || 'open'}" style="--station-accent:${seat ? colors.get(seat.id) : '#9aa3b2'}"><strong>${esc(t.title || t.id)}</strong>${t.scope ? `<span class="meta">${esc(t.scope)}</span>` : ''}<span class="ticket-foot"><span class="ticket-who"><i aria-hidden="true">${esc([...who][0] || '·')}</i><span>${esc(who)}</span></span>${when ? `<time>${esc(when)}</time>` : ''}<span class="ticket-chip">${esc(taskRecordLabel(t, language, reachable()))}</span></span></button>`;
}
/* @chain-region stationTasks | calls: filter, tickets, includes, L, join, groups.map, slice, by … */ function stationTasks(s) {
  const mine = tickets().filter(
    (t) =>
      [t.owner, t.assignee].includes(s.actor_id) || [t.owner, t.assignee].includes(s.agent?.id),
  );
  const groups = [
    ['doing', L('进行中', 'In progress')],
    ['review', L('待验收', 'To review')],
    ['open', L('待开始', 'Not started')],
    ['done', L('已完成', 'Done')],
  ];
  const /* @chain-region stationTasks.by | calls: mine.filter, taskColumn, reachable */ by = (id) => mine.filter((t) => taskColumn(t, reachable()) === id);
  const body = groups
    .map(([id, name]) => {
      const items = id === 'done' ? by('done').slice(0, 5) : by(id);
      return items.length
        ? `<div class="ticket-group" data-key="tg-${id}" data-group="${id}"><p class="ticket-group-name">${name}<b>${by(id).length}</b></p><div class="ticket-list">${items.map(ticketCard).join('')}</div></div>`
        : '';
    })
    .join('');
  return body || `<p class="meta">${L('暂无工单', 'No work orders')}</p>`;
}

// 发言记录：一个频道，两种看法——简约（人话，像群聊）、详情（AI 之间的完整原文）。展开后右侧切换。
/* @chain-region channel | calls: reverse, slice, list, L, colors.get, join, items.map, esc … */ function channel(s) {
  const items = list(s.messages).slice(0, 24).reverse();
  const mode = channelMode,
    who = s.name || L('未命名工位', 'Unnamed station'),
    accent = colors.get(s.id);
  const lines = items.length
    ? items
        .map((m) =>
          mode === 'raw'
            ? `<article class="channel-raw" data-key="ch-raw-${esc(m.id)}"><time>${esc(clock(m.created, true))}</time><p>${esc(m.body)}</p></article>`
            : `<article class="channel-say" data-key="ch-say-${esc(m.id)}" style="--station-accent:${accent}"><span class="chat-avatar" aria-hidden="true">${esc([...who][0] || '·')}</span><div><p class="chat-who"><strong>${esc(who)}</strong><time>${esc(clock(m.created, true))}</time></p><p class="chat-say">${esc(humanLine(m.body, 200) || '…')}</p></div></article>`,
        )
        .join('')
    : `<p class="meta">${L('暂无发言', 'No messages')}</p>`;
  return `<details class="channel" data-preserve-open data-mode="${mode}"><summary>${icon('back')}<span>${L('发言记录', 'Messages')}</span><b>${items.length}</b></summary><div class="channel-mode" role="radiogroup" aria-label="${L('看法', 'View')}"><button type="button" role="radio" data-channel="simple" aria-checked="${mode === 'simple'}">${L('简约', 'Simple')}</button><button type="button" role="radio" data-channel="raw" aria-checked="${mode === 'raw'}">${L('详情', 'Detailed')}</button></div><div class="channel-body" data-key="ch-${mode}">${lines}</div></details>`;
}

/* @chain-region chatRecords | calls: orderedMessages, list */ function chatRecords() {
  return orderedMessages([...list(sources.snapshot.value?.messages), ...histories.chat.items]);
}
/* @chain-region messageIdentity | calls: rows.find, text, find, list, L, colors.get */ function messageIdentity(m) {
  const seat = rows.find((s) => s.actor_id === m.sender || s.agent?.id === m.sender),
    name =
      seat?.name ||
      text(m.sender_name) ||
      list(sources.snapshot.value?.agents).find((a) => a.id === m.sender)?.name ||
      L('未知工位', 'Unknown station');
  return { seat, name, accent: seat ? colors.get(seat.id) : '#9aa3b2' };
}
/* @chain-region messageAvatar | calls: esc, pixelPortrait, colors.get, icon */ function messageAvatar(identity) {
  return identity.seat
    ? `<button type="button" class="group-avatar" data-seat="${esc(identity.seat.id)}" aria-label="${esc(identity.name)}">${pixelPortrait(identity.seat,colors.get(identity.seat.id))}</button>`
    : `<span class="group-avatar" aria-hidden="true">${icon('stations')}</span>`;
}
/* @chain-region groupMessage | calls: messageIdentity, text, records.get, esc, humanLine, L, Array.isArray, join … */ function groupMessage(m, records) {
  const identity = messageIdentity(m),
    original = text(m.reply_to) ? records.get(m.reply_to) : null,
    reference = !text(m.reply_to)
      ? ''
      : original
        ? `<button class="group-quote" data-message="${esc(original.id)}">${esc(messageIdentity(original).name)} · ${esc(humanLine(original.body, 100))}</button>`
        : `<span class="group-quote">${L('引用的发言在更早记录中', 'The quoted message is in earlier history')}</span>`,
    mentions = Array.isArray(m.mentions) ? m.mentions : [],
    mentioned = mentions
      .map((entry) => {
        const id = typeof entry === 'string' ? entry : text(entry?.actor_id || entry?.id),
          seat = rows.find((s) => s.actor_id === id || s.agent?.id === id),
          name =
            seat?.name ||
            list(sources.snapshot.value?.agents).find((a) => a.id === id)?.name ||
            (typeof entry === 'object' ? text(entry?.name) : '');
        return name ? `<span class="group-mention">@${esc(name)}</span>` : '';
      })
      .join('');
  return `<article class="group-message" data-key="message-${esc(m.id)}" style="--station-accent:${identity.accent}">${messageAvatar(identity)}<div class="group-message-body"><p class="chat-who"><strong>${esc(identity.name)}</strong><time>${esc(clock(m.created, true))}</time></p>${reference}<p class="group-say">${esc(humanLine(m.body, 240) || '…')}</p>${mentioned ? `<p class="group-mentions">${mentioned}</p>` : ''}<details class="group-original" data-key="original-${esc(m.id)}" data-preserve-open><summary>${L('原文', 'Original')}</summary><p>${esc(m.body)}</p></details></div></article>`;
}
/* @chain-region historyControls | calls: L */ function historyControls(kind) {
  const h = histories[kind],
    disabled = h.busy ? ' disabled' : '';
  return `<div class="history-controls">${h.trail.length ? `<button data-history-newer="${kind}"${disabled}>${L('较新记录', 'Newer')}</button>` : ''}${h.more ? `<button data-history-older="${kind}"${disabled}>${L('更早记录', 'Earlier')}</button>` : ''}${h.loaded && !h.more ? `<span class="meta">${L('没有更早的记录了', 'Beginning of available history')}</span>` : ''}</div>`;
}
/* @chain-region historyStatus | calls: L */ function historyStatus(kind) {
  const h = histories[kind];
  if (h.busy)
    return `<p class="panel-notice" role="status">${L('正在读取记录…', 'Loading records…')}</p>`;
  return h.error
    ? `<p class="panel-notice" role="status">${L('记录读取失败', 'Could not load records.')} <button data-history-retry="${kind}">${L('重试', 'Retry')}</button></p>`
    : '';
}
/* @chain-region groupChat | calls: slice, orderedMessages, Map, map, chatRecords, L, historyStatus, historyControls … */ function groupChat() {
  const h = histories.chat,
    items = h.history ? h.items : orderedMessages(sources.snapshot.value?.messages).slice(-50),
    records = new Map(chatRecords().map((m) => [m.id, m]));
  return `<section class="group-page" aria-label="${L('群聊', 'Group chat')}" aria-busy="${h.busy}"><header class="panel-head"><h2>${L('群聊', 'Group chat')}</h2><button data-history="chat">${h.history ? L('近期消息', 'Recent messages') : L('历史', 'History')}</button></header>${h.history ? `<p class="meta">${h.retention ? L(`最近 ${h.retention} 小时的记录`, `Last ${h.retention} hours`) : L('历史消息', 'Message history')}</p>` : ''}${historyStatus('chat')}${h.history ? historyControls('chat') : ''}<div class="group-messages">${items.map((m) => groupMessage(m, records)).join('') || (!h.busy && !h.error ? `<p class="meta">${L('暂无发言', 'No messages')}</p>` : '')}</div></section>`;
}
/* @chain-region taskPage | calls: Set, h.items.map, mergeTasks, filter, list, ids.has, recentTasks, records.slice … */ function taskPage() {
  const h = histories.tasks,
    ids = new Set(h.items.map((t) => t.id)),
    records = h.history
      ? mergeTasks(
          h.items,
          list(sources.snapshot.value?.tasks).filter((t) => ids.has(t.id)),
        )
      : recentTasks([...h.recent, ...list(sources.snapshot.value?.tasks)], 20),
    items = h.history ? records : records.slice(0, taskLimit);
  return `<section class="workorders-page" aria-label="${L('工单', 'Work orders')}" aria-busy="${h.busy}"><header class="panel-head"><h2>${L('工单', 'Work orders')}</h2><button data-history="tasks">${h.history ? L('近期工单', 'Recent orders') : L('历史', 'History')}</button></header><button data-show-chat>${L('查看交流', 'View conversation')}</button>${historyStatus('tasks')}${h.history ? historyControls('tasks') : ''}<div class="ticket-board">${items.map(ticketCard).join('')}</div>${!items.length && !h.busy && !h.error ? `<p class="meta">${h.unregistered ? L('暂无工单', 'No work orders') : L('暂无工单', 'No work orders')}</p>` : ''}${!h.history && taskLimit === 10 && records.length > 10 ? `<button class="panel-more" data-more-tasks>${L('显示更多近期工单', 'Show more recent orders')}</button>` : ''}</section>`;
}

/* @chain-region loadHistory | calls: render, URLSearchParams, query.set, String, get, Number.isSafeInteger, Array.isArray, items.some … */ async function loadHistory(kind, before = null, trail = [], history = true) {
  const h = histories[kind];
  if (!h || h.busy || disposed) return;
  h.busy = true;
  h.error = false;
  h.history = history;
  h.attempt = { before, trail: [...trail], history };
  if (panel === kind) render();
  try {
    const query = new URLSearchParams(kind === 'tasks' ? { project: 'os', limit: '20' } : {});
    if (before !== null) query.set('before', String(before));
    const result = await get(
        `/api/${kind === 'tasks' ? 'task-history' : 'chat-history'}${query.size ? '?' + query : ''}`,
      ),
      items = kind === 'tasks' ? result.items : result.messages,
      cursor = kind === 'tasks' ? result.next_cursor : result.next_before,
      validCursor =
        kind === 'tasks'
          ? typeof cursor === 'string' && cursor.length > 0 && cursor.length <= 4096
          : Number.isSafeInteger(cursor) && cursor > 0;
    if (
      !Array.isArray(items) ||
      items.length > (kind === 'tasks' ? 20 : 100) ||
      items.some(
        (item) => !item || typeof item !== 'object' || Array.isArray(item) || !text(item.id),
      ) ||
      typeof result.has_more !== 'boolean' ||
      (result.has_more && (!validCursor || String(cursor) === String(before))) ||
      (kind === 'chat' && result.has_more && before !== null && cursor >= before) ||
      (kind === 'chat' && items.some((item) => !Number.isSafeInteger(item.seq) || item.seq <= 0))
    )
      throw Error('history_shape');
    if (disposed) return;
    h.items = kind === 'tasks' ? mergeTasks([], items) : orderedMessages(items);
    h.unregistered = kind === 'tasks' && result.registered === false;
    if (kind === 'tasks' && before === null) h.recent = h.items;
    h.before = before;
    h.trail = [...trail];
    h.next = result.has_more ? cursor : null;
    h.more = result.has_more;
    h.retention =
      Number.isFinite(result.retention_hours) && result.retention_hours > 0
        ? result.retention_hours
        : null;
    h.loaded = true;
  } catch {
    if (!disposed) h.error = true;
  } finally {
    h.busy = false;
    if (!disposed && panel === kind) render();
  }
}

// 工位详情：没有卡片底和遮罩，内容直接铺在页面上。
/* @chain-region stationDetail | calls: rows.find, L, humanLine, includes, colors.get, pixelPortrait, esc, linkStatusLabel … */ function stationDetail(id) {
  const s = rows.find((r) => r.id === id) || detail?.record;
  if (!s)
    return `<p class="page-empty">${L('这个工位已不在列表里。', 'This station is gone.')}</p>`;
  const latest = s.messages?.[0],
    doing = latest ? humanLine(latest.body, 160) : '',
    online = !['offline', 'lost'].includes(s.link.state),
    accent = colors.get(s.id);
  return `<article class="detail station-detail" style="--station-accent:${accent}"><header class="detail-head">${pixelPortrait(s,accent)}<div><h2 tabindex="-1">${esc(s.name || L('未命名工位', 'Unnamed station'))}</h2><p class="meta">${esc(linkStatusLabel(s.link.state, language))}${
    online ? '' : esc(since(s.link.at))
  }${s.leader ? ' · ' + L('负责人', 'Lead') : ''}</p></div></header><h3>${L('最新动态', 'Latest activity')}</h3><p>${
    doing
      ? esc(doing) + ` <time class="meta">${esc(clock(latest.created, true))}</time>`
      : L('暂时没有动态', 'No recent activity')
  }</p><h3>${L('工单', 'Work orders')}</h3>${stationTasks(s)}${diagnostics(s)}${channel(s)}</article>`;
}
/* @chain-region ticketDetail | calls: mergeTasks, filter, list, L, Array.isArray, t.depends_on.filter, esc, taskRecordLabel … */ function ticketDetail(id) {
  const t = mergeTasks(
    detail?.record ? [detail.record] : [],
    list(sources.snapshot.value?.tasks).filter((t) => t.id === id),
  )[0];
  if (!t)
    return `<p class="page-empty" role="status">${detail?.loading ? L('正在读取工单…', 'Loading work order…') : L('这张工单暂时无法读取。', 'This work order is unavailable.')}${detail?.error ? ` <button class="panel-more" data-retry-task>${L('重试', 'Retry')}</button>` : ''}</p>`;
  const dependencies = Array.isArray(t.depends_on)
      ? t.depends_on.filter((id) => typeof id === 'string' && id)
      : null,
    /* @chain-region ticketDetail.dependencyLabel | calls: find, list */ dependencyLabel = (id) =>
      [...list(sources.snapshot.value?.tasks), ...histories.tasks.items].find(
        (row) => row.id === id,
      )?.title || id;
  return `<article class="detail"><h2>${esc(t.title || t.id)}</h2><p class="meta">${esc(taskRecordLabel(t, language, reachable()))} · ${esc(clock(t.updated || t.updated_at, true))}</p><dl class="facts"><dt>${L('范围', 'Scope')}</dt><dd>${esc(t.scope || '—')}</dd><dt>${L('编号', 'ID')}</dt><dd>${esc(t.id)}</dd><dt>${L('负责人', 'Assignee')}</dt><dd>${esc(actor(t.assignee || t.owner) || L('未指定', 'Unassigned'))}</dd><dt>${L('记录人', 'Recorded by')}</dt><dd>${esc(actor(t.creator || t.created_by || t.dispatcher) || '—')}</dd>${
    t.owner && t.assignee && t.owner !== t.assignee
      ? `<dt>${L('正在做', 'Working')}</dt><dd>${esc(actor(t.owner))}</dd>`
      : ''
  }${t.merged_into ? `<dt>${L('并入', 'Merged into')}</dt><dd>${esc(t.merged_into)}</dd>` : ''}${typeof t.shareable === 'boolean' ? `<dt>${L('分担', 'Sharing')}</dt><dd>${t.shareable ? L('可分担', 'Shareable') : L('不可分担', 'Not shareable')}</dd>` : ''}${dependencies ? `<dt>${L('依赖', 'Dependencies')}</dt><dd>${dependencies.length ? dependencies.map((id) => `<button class="dependency-link" data-task="${esc(id)}">${esc(dependencyLabel(id))}</button>`).join('') : L('无', 'None')}</dd>` : ''}${text(t.handoff_by) ? `<dt>${L('交接人', 'Handed off by')}</dt><dd>${esc(actor(t.handoff_by))}</dd>` : ''}${text(t.handoff_note) ? `<dt>${L('交接说明', 'Handoff note')}</dt><dd>${esc(t.handoff_note)}</dd>` : ''}</dl>${detail?.loading ? `<p class="meta" role="status">${L('正在核对最新记录…', 'Checking the latest record…')}</p>` : ''}${detail?.error ? `<p class="panel-notice" role="status">${L('状态暂未更新', 'Status is out of date.')} <button data-retry-task>${L('重试', 'Retry')}</button></p>` : ''}<h3>${L('要求', 'Request')}</h3><p class="evidence">${esc(t.request || t.description || t.summary || t.title)}</p><h3>${L('验收标准', 'Acceptance')}</h3><p class="evidence">${esc(text(t.acceptance) || L('未写明', 'Not stated'))}</p>${
    text(t.evidence)
      ? `<h3>${L('结果与证据', 'Results and evidence')}</h3><p class="evidence">${esc(text(t.evidence))}</p>`
      : ''
  }${text(t.note) ? `<p class="meta">${L('备注：', 'Note: ')}${esc(text(t.note))}</p>` : ''}</article>`;
}

/* @chain-region messageDetail | calls: L, messageIdentity, messageAvatar, esc, clock */ function messageDetail() {
  const m = detail.record;
  if (!m)
    return `<p class="page-empty">${L('该发言不在当前记录中。', 'This message is not in the current records.')}</p>`;
  const identity = messageIdentity(m);
  return `<article class="detail"><header class="detail-head">${messageAvatar(identity)}<div><h2>${esc(identity.name)}</h2><p class="meta">${esc(clock(m.created, true))}</p></div></header><p class="evidence">${esc(m.body)}</p></article>`;
}

/* @chain-region pageMarkup | calls: stationDetail, ticketDetail, messageDetail, groupChat, taskPage, stationsPage */ function pageMarkup() {
  if (detail?.type === 'station') return stationDetail(detail.id);
  if (detail?.type === 'task') return ticketDetail(detail.id);
  if (detail?.type === 'message') return messageDetail();
  if (panel === 'chat') return groupChat();
  if (panel === 'tasks') return taskPage();
  return stationsPage();
}

/* @chain-region render | calls: paintOffice, situation, live, stationRows, $, rows.filter, L, summary.querySelector … */ function render(options = {}) {
  paintOffice();
  const view = showSituation
    ? situation({
        registry: sources.registry.value,
        snapshot: sources.snapshot.value,
        live: live(),
        lan,
        cloud,
        language,
      })
    : { rows: stationRows(sources.registry.value, sources.snapshot.value, live()), items: [] };
  rows = view.rows;
  const summary = $('#link-station-overview');
  summary.hidden = panel !== 'stations' || !!detail;
  $('#station-controls').hidden = summary.hidden || (rows.length < 2 && !roster.query && roster.status === 'all');
  const working = rows.filter(row => row.link.state === 'working').length;
  const counts = rows.length
    ? [L(`${rows.length} 个工位`, `${rows.length} stations`), ...(working ? [L(`${working} 个工作中`, `${working} working`)] : [])]
    : [];
  summary.querySelector('span').textContent = counts.join(' · ');
  assignColors();
  ticker.update(
    showSituation && (sources.snapshot.value || sources.registry.value) ? view.items : [],
  );
  $('#link-back').hidden = !detail;
  const page = $('#link-view'),
    top = page.scrollTop;
  page.dataset.page = detail ? detail.type : panel;
  page.setAttribute('aria-labelledby', 'link-tab-' + panel);
  for (const tab of document.querySelectorAll('[data-panel]')) {
    tab.hidden = false;
    const active = tab.dataset.panel === panel;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
  }
  const indicators = '.home-seat[data-state],.ticket[data-state]';
  const previous = options.reset || document.hidden ? null
    : new Map([...page.querySelectorAll(indicators)].map(node => [node.dataset.key, node.dataset.state]));
  updateHTML(page, pageMarkup());
  if (previous && live()) {
    const changed = [...page.querySelectorAll(indicators)].filter(node =>
      previous.has(node.dataset.key) && previous.get(node.dataset.key) !== node.dataset.state);
    for (const node of changed.slice(0, 6)) {
      const target = node.querySelector('.seat-status,.ticket-chip');
      if (target) animateUI(target, [
        { opacity: .65, filter: 'brightness(1.65)' },
        { opacity: 1, filter: 'brightness(1)' },
      ], { key: 'status', duration: 650 });
    }
  }
  if (!detail && panel === 'stations') layoutDesks();
  // 进详情从右滑入、返回从左滑入：一眼看出是同一页里的前进后退，不是弹窗。
  const enter = page.dataset.enter;
  delete page.dataset.enter;
  page.scrollTop = Number.isFinite(options.top) ? options.top : options.reset ? 0 : top;
  if (options.reset && enter) enterSurface(page,enter==='in'?1:-1);
}
/* @chain-region openDetail | calls: $, find, mergeTasks, list, chatRecords, rows.find, target.closest, render … */ function openDetail(type, id, target = document.activeElement) {
  $('#link-view').dataset.enter = 'in';
  const record =
    type === 'task'
      ? mergeTasks(histories.tasks.items, [
          ...histories.tasks.recent,
          ...list(sources.snapshot.value?.tasks),
        ]).find((t) => t.id === id)
      : type === 'message'
        ? chatRecords().find((m) => m.id === id)
        : rows.find((row) => row.id === id);
  const opener = target?.closest?.('#link-view [data-key]');
  detail = {
    type,
    id,
    record,
    from: detail,
    scroll: $('#link-view').scrollTop,
    opener: opener?.dataset.key || '',
  };
  render({ reset: true });
  if (type === 'task') readTask(detail);
  if (type === 'station') $('#link-view .station-detail h2')?.focus({preventScroll:true});
}
/* @chain-region back | calls: $, render, find, page.querySelectorAll, target.matches, focus */ function back() {
  $('#link-view').dataset.enter = 'out';
  const top = detail?.scroll || 0,
    opener = detail?.opener;
  detail = detail?.from || null;
  render({ reset: true, top });
  const page = $('#link-view'),
    target = opener
      ? [...page.querySelectorAll('[data-key]')].find((n) => n.dataset.key === opener)
      : null;
  if (target && !target.matches('button,a,summary,[tabindex]')) target.tabIndex = -1;
  (target || page).focus({ preventScroll: true });
}
/* @chain-region readTask | calls: render, get, URLSearchParams, Error, mergeTasks */ async function readTask(view) {
  if (view?.type !== 'task' || view.loading || disposed) return;
  view.loading = true;
  view.error = false;
  render();
  try {
    const task = await get('/api/task?' + new URLSearchParams({ id: view.id }));
    if (!task || task.id !== view.id || typeof task.status !== 'string') throw Error('task_shape');
    if (!disposed) view.record = mergeTasks(view.record ? [view.record] : [], [task])[0];
  } catch {
    if (!disposed) view.error = true;
  } finally {
    view.loading = false;
    if (!disposed && detail === view) render();
  }
}
/* @chain-region selectPanel | calls: panelNames.includes, $, map, view.querySelectorAll, Math.sign, panelNames.indexOf, cancelMotion, render … */ function selectPanel(name) {
  if (!panelNames.includes(name) || name === panel) return;
  const view = $('#link-view');
  panelViews[panel] = {
    detail,
    scroll: view.scrollTop,
    open: [...view.querySelectorAll('details[data-preserve-open][open]')].map((d) => d.dataset.key),
  };
  const direction=Math.sign(panelNames.indexOf(name)-panelNames.indexOf(panel));
  cancelMotion($('#link-tab-'+panel+' .ui-rail-icon'),'panel-selection');
  panel = name;
  detail = panelViews[panel].detail;
  view.dataset.enter=direction>0?'in':'out';
  render({ reset: true, top: panelViews[panel].scroll });
  animateUI($('#link-tab-'+name+' .ui-rail-icon'),[
    {opacity:.52,translate:`${direction*3}px 0`},
    {opacity:1,translate:'0 0'},
  ],{key:'panel-selection',duration:200});
  const reopen = panelViews[panel].open || [];
  if (reopen.length) {
    for (const d of view.querySelectorAll('details[data-preserve-open]'))
      if (reopen.includes(d.dataset.key)) d.open = true;
    view.scrollTop = panelViews[panel].scroll || 0;
  }
  if (
    name === 'tasks' &&
    !histories.tasks.loaded &&
    !histories.tasks.busy &&
    !histories.tasks.error
  )
    loadHistory('tasks', null, [], false);
}

/* @chain-region get | calls: AbortController, controllers.add, setTimeout, controller.abort, Error, r.json, clearTimeout, controllers.delete */ async function get(path) {
  const controller = new AbortController();
  controllers.add(controller);
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const r = await (window.linkOfficeFetch || fetch)(path, { cache: 'no-store', signal: controller.signal });
    if (!r.ok) throw Error('read');
    return await r.json();
  } finally {
    clearTimeout(timeout);
    controllers.delete(controller);
  }
}
/* @chain-region readLan | calls: Date.now, get */ async function readLan() {
  if (Date.now() - lanCheckedAt < 30000) return;
  lanCheckedAt = Date.now();
  try {
    lan = (await get('/api/link'))?.auto_lan || null;
  } catch {}
}
/* @chain-region readOffice | calls: get, Error */ async function readOffice() {
  try {
    const value = await get('/api/office');
    if (value?.protocol !== 'aieyra-office/1') throw Error('shape');
    office = value;
    officeError = false;
  } catch {
    officeError = true;
  }
}
let reportedCloud;
/* @chain-region paintOffice | calls: $, catch, window.linkPresentation.reportConnection, String, L, updateHTML, join, map … */ function paintOffice() {
  const status = $('#link-connection');
  if (!status) return;
  const online = !officeError && office?.cloud?.online === true;
  if (window.linkPresentation?.embedded) {
    const current = officeError ? 'unavailable' : !office ? 'unknown' : online ? 'online' : 'offline';
    if (reportedCloud !== current) {
      reportedCloud = current;
      void window.linkPresentation.reportConnection(current).catch(() => {});
    }
  }
  status.dataset.online = String(online);
  status.title = officeError
    ? L('连接状态暂不可用', 'Connection status unavailable')
    : online
      ? L('云服务在线；工位接入需单独验证', 'Cloud reachable; station access verified separately')
      : L('云服务未连接', 'Cloud disconnected');
  $('#link-counts').textContent =
    office && !officeError
      ? L(
          `${office.stations} 个工位${office.devices>0?' · '+office.devices+' 个设备':''}`,
          `${office.stations} stations${office.devices>0?' · '+office.devices+' devices':''}`,
        )
      : L('正在读取连接', 'Reading connections');
  $('#link-join').disabled = !office?.join || officeError;
  const states = {
    registered: L('等待 Agent 完成接入', 'Awaiting Agent setup'),
    adapted: L('等待验证消息收发', 'Awaiting messaging checks'),
    verified: L('消息收发已验证', 'Messaging verified'),
  };
  updateHTML(
    $('#link-adapters'),
    (office?.adapters || [])
      .map(
        (a) =>
          `<li data-key="${esc(a.actor_id)}"><span>${esc(a.name)}</span><small>${esc(hostKind(a.host))} · ${states[a.state] || states.registered}</small><details data-key="checks-${esc(a.actor_id)}" data-preserve-open><summary>${L('收发检查详情', 'Messaging check details')}</summary><p>${L('本人收发：', 'Self messaging: ')}${a.checks?.self ? L('已通过', 'Passed') : L('未验证', 'Not verified')}</p><p>${L('接收他方消息：', 'Receiving from peers: ')}${a.checks?.peer_in ? L('已通过', 'Passed') : L('未验证', 'Not verified')}</p><p>${L('向他方发送消息：', 'Sending to peers: ')}${a.checks?.peer_out ? L('已通过', 'Passed') : L('未验证', 'Not verified')}</p><p>${L('宿主类型：', 'Host type: ')}${esc(a.host)}</p></details></li>`,
      )
      .join('') ||
      `<li>${L('暂无接入', 'No agents connected')}</li>`,
  );
  const lanState =
    {
      disabled: L('未启用', 'disabled'),
      discovering: L('正在发现', 'discovering'),
      connected: L('已连接', 'connected'),
      online: L('在线', 'online'),
      waiting: L('等待发现', 'waiting'),
      idle: L('待连接', 'idle'),
      unknown: L('未知', 'unknown'),
    }[office?.lan?.state] || L('待发现', 'pending');
  $('#link-network').textContent = officeError
    ? L('连接状态暂不可用', 'Connection status unavailable')
    : L(
        `本地已连接 · 局域网 ${lanState} · 云服务 ${online ? '在线' : '未连接'}`,
        `Local connected · LAN ${lanState} · Cloud ${online ? 'online' : 'disconnected'}`,
      );
}
/* @chain-region refresh | calls: clearTimeout, Promise.all, readLan, readOffice, map, Object.keys, get, every … */ async function refresh() {
  if (polling || disposed) return;
  clearTimeout(timer);
  polling = true;
  await Promise.all([
    readLan(),
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
  if (canRefresh()) timer = setTimeout(refresh, 8000);
}

document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
$('#app').innerHTML =
  `<main id="main" class="link-page" tabindex="-1" aria-label="Link"><nav id="link-tabs" class="link-tabs" role="tablist" aria-orientation="horizontal" aria-label="${L('Link视图', 'Link views')}">${panelNames.map((name) => `<button id="link-tab-${name}" class="ui-rail-button" role="tab" data-panel="${name}" aria-controls="link-view" aria-selected="${name === panel}" tabindex="${name === panel ? 0 : -1}"><i class="ui-rail-icon">${icon(name)}</i><span class="ui-rail-label">${name === 'stations' ? L('工位', 'Stations') : name === 'chat' ? L('群聊', 'Agent chat') : L('工单', 'Orders')}</span></button>`).join('')}</nav><header class="link-top"><div id="link-station-overview"><h1>${L('Agent 工位', 'Agent stations')}</h1><span></span></div><button id="link-back" class="link-back" hidden>${icon('back')}<span>${L('返回', 'Back')}</span></button><div id="link-ticker" class="link-ticker" hidden></div><div class="link-connection-summary" hidden><span id="link-counts"></span><button id="link-connection" type="button" popovertarget="link-connections" aria-label="${L('连接与加入', 'Connections and joining')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 17a4 4 0 0 1-1-8 6 6 0 0 1 11-2 5 5 0 0 1 1 10H6Z"/><circle cx="18" cy="18" r="3"/></svg></button></div></header><aside id="link-connections" popover aria-label="${L('连接与加入', 'Connections and joining')}"><h2>${L('连接与加入', 'Connections and joining')}</h2><p id="link-network"></p><button id="link-join" type="button">${L('复制一行加入说明', 'Copy joining instructions')}</button><p id="link-copy-status" role="status"></p><h3>${L('工位接入检查', 'Station connection checks')}</h3><ul id="link-adapters"></ul></aside><section id="link-view" class="link-view" role="tabpanel" aria-labelledby="link-tab-stations" tabindex="0"></section></main>`;
const ticker = createTicker($('#link-ticker'));
$('#link-station-overview').insertAdjacentHTML('afterend', `<div id="station-controls" class="station-controls" hidden>
 <input id="station-search" type="search" maxlength="120" aria-label="${L('搜索工位','Search stations')}" placeholder="${L('搜索工位','Search stations')}">
 <select id="station-filter" aria-label="${L('工位状态','Station status')}">
  <option value="all">${L('全部状态', 'All states')}</option>
  ${['working', 'waiting', 'idle', 'error', 'offline', 'lost', 'sync'].map((state) => `<option value="${state}">${linkStatusLabel(state, language)}</option>`).join('')}
 </select>
 <output id="station-results" aria-live="polite" hidden></output>
 <nav id="station-pages" aria-label="${L('工位分页','Station pages')}" hidden>
  <button type="button" data-station-page="-1" aria-label="${L('前一页工位','Previous station page')}" title="${L('前一页工位','Previous station page')}">${icon('back')}</button>
  <output aria-live="polite"></output>
  <button type="button" data-station-page="1" aria-label="${L('后一页工位','Next station page')}" title="${L('后一页工位','Next station page')}">${icon('back')}</button>
 </nav>
</div>`);
if(window.linkPresentation?.embedded){
  document.documentElement.dataset.osHost='';
  const connection=document.querySelector('.link-connection-summary');
  const popover=$('#link-connections');
  $('#link-network').after($('#link-counts'));
  $('#link-join').hidden=true;
  const guide=setupLinkAccessGuide({
    parent:connection,language,
    /* @chain-region copyText | calls: window.linkPresentation.copy, Error */ copyText:async text=>{
      const result=await window.linkPresentation.copy(text);
      if(!result.ok)throw Error(result.error);
    },
  });
  const stopActions=window.linkPresentation.onAction(action=>{
    if(['stations','chat','tasks'].includes(action))document.querySelector('[data-panel="'+action+'"]').click();
    if(action==='connections')popover.togglePopover();
    if(action==='guide'){
      if(popover.matches(':popover-open'))popover.hidePopover();
      guide.open();
    }
  });
  window.addEventListener('pagehide',()=>{
    stopActions();
    guide.dispose();
  },{once:true});
}
$('#station-search').addEventListener('input', (event) => {
  roster.query = event.currentTarget.value;
  roster.page = 0;
  render({ reset: true });
});
$('#station-filter').addEventListener('change', (event) => {
  roster.status = event.currentTarget.value;
  roster.page = 0;
  render({ reset: true });
});
const accessGuide = {/* @chain-region dispose */ dispose(){}};
/* @chain-region onclick | calls: navigator.clipboard.writeText, $, L */ $('#link-join').onclick = async () => {
  if (!office?.join || officeError) return;
  try {
    await navigator.clipboard.writeText(office.join);
    $('#link-copy-status').textContent = L(
      '已复制',
      'Copied',
    );
  } catch {
    $('#link-copy-status').textContent = office.join;
  }
};

// 宿主（OS / 独立 Link）推送的云号池状态：{ cloud: { id, ready } | null }。
window.addEventListener('aieyra-host', (e) => {
  if (typeof e.detail?.features?.link_situation === 'boolean') {
    showSituation = e.detail.features.link_situation;
  }
  const next = e.detail?.cloud;
  const value =
    next && typeof next.id === 'string' && next.id
      ? { id: next.id.slice(0, 16), ready: next.ready === true }
      : null;
  if (JSON.stringify(value) === JSON.stringify(cloud) && !e.detail?.features) return;
  cloud = value;
  render();
});

$('#main').addEventListener('click', (e) => {
  if (e.target.closest('#link-back')) return back();
  const seat = e.target.closest('button[data-seat]');
  if (seat) return openDetail('station', seat.dataset.seat, seat);
  const stationPage = e.target.closest('[data-station-page]');
  if (stationPage) {
    roster.page += Number(stationPage.dataset.stationPage);
    render({ reset: true });
    if (stationPage.disabled) $('#station-pages button:enabled')?.focus({ preventScroll: true });
    return;
  }
  if (e.target.closest('[data-show-chat]')) return selectPanel('chat');
  const tab = e.target.closest('[data-panel]');
  if (tab) return selectPanel(tab.dataset.panel);
  const history = e.target.closest('[data-history]');
  if (history) {
    const kind = history.dataset.history,
      h = histories[kind];
    if (h.history) {
      h.history = false;
      return render({ reset: true });
    }
    if (h.loaded) {
      h.history = true;
      return render({ reset: true });
    }
    return loadHistory(kind);
  }
  const older = e.target.closest('[data-history-older]');
  if (older) {
    const kind = older.dataset.historyOlder,
      h = histories[kind];
    return loadHistory(kind, h.next, [...h.trail, h.before]);
  }
  const newer = e.target.closest('[data-history-newer]');
  if (newer) {
    const kind = newer.dataset.historyNewer,
      h = histories[kind];
    return loadHistory(kind, h.trail.at(-1), h.trail.slice(0, -1));
  }
  const retry = e.target.closest('[data-history-retry]');
  if (retry) {
    const kind = retry.dataset.historyRetry,
      attempt = histories[kind].attempt;
    return loadHistory(kind, attempt.before, attempt.trail, attempt.history);
  }
  if (e.target.closest('[data-more-tasks]')) {
    taskLimit = 20;
    return render();
  }
  if (e.target.closest('[data-retry-task]')) return readTask(detail);
  const message = e.target.closest('[data-message]');
  if (message) return openDetail('message', message.dataset.message);
  const mode = e.target.closest('[data-channel]');
  if (mode) {
    channelMode = mode.dataset.channel === 'raw' ? 'raw' : 'simple';
    try {
      sessionStorage.setItem('link-channel', channelMode);
    } catch {}
    return render();
  }
  const task = e.target.closest('[data-task]');
  if (task) return openDetail('task', task.dataset.task);
});
document.addEventListener('keydown', (e) => {
  const tab = e.target.closest?.('[data-panel]');
  if (tab && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
    e.preventDefault();
    const available = panelNames;
    const index = available.indexOf(tab.dataset.panel),
      next =
        e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? available.length - 1
            : (index + (e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 1) + available.length) %
              available.length;
    selectPanel(available[next]);
    $('#link-tab-' + available[next]).focus();
    return;
  }
  if (e.key === 'Escape' && detail) {
    e.preventDefault();
    back();
  }
});
window.addEventListener('resize', () => {
  if (!detail && panel === 'stations') layoutDesks();
});
// 原生拆放、容器变宽及滚动条出现也会改变可用空间，不必等新快照或窗口 resize。
const deskResize = new ResizeObserver(([entry]) => {
  // contentRect 保留缩放后的小数；clientWidth 会向整像素取整，可能把末位挤到下一行。
  deskArea = entry.contentRect;
  if (!disposed && !detail && panel === 'stations') layoutDesks();
});
deskResize.observe($('#link-view'));
const stopPresentation=window.linkPresentation?.subscribe(({visible,motion,enter})=>{
  const wasVisible = canRefresh();
  officeVisible = visible === true;
  document.body.dataset.visible=String(visible);
  document.documentElement.dataset.motion=motion?'full':'reduced';
  if(enter)enterSurface($('#link-view'));
  if (!officeVisible) clearTimeout(timer);
  else if (!wasVisible) void refresh();
});
window.addEventListener('pagehide', () => {
  stopPresentation?.();
  disposed = true;
  deskResize.disconnect();
  cancelAnimationFrame(deskResizeFrame);
  ticker.dispose();
  accessGuide.dispose();
  clearTimeout(timer);
  controllers.forEach((c) => c.abort());
});
document.addEventListener('visibilitychange', () => {
  if (officeVisible !== null) return;
  clearTimeout(timer);
  if (canRefresh()) void refresh();
});
render();
refresh();
