// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Control/app/web/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: L; OFFLINE; COLUMN; taskColumn; stationRows; PLATFORM; platformOf; fresh; latestSays; situation
// Impact: python -B scripts/code-atlas.py show Control/app/web/situation.js
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

import { list, text, timestamp, humanLine, taskRecordState } from './model.js';
import { stations, linkStatus, orderedTasks, deviceKind } from './station-model.js';

// 态势感知（用户 2026-10-16）：Link 不再分标签页，工单、群聊、连接都打散成一行一行的“态势”，
// 在工位上方的字幕里轮播；用户离开 Link 页时，同样的字幕出现在 OS 顶栏的 Link 按钮里，独立 Link 窗口则在自己的标题栏里。
// Link 页面和 OS 宿主共用这一份规则（宿主直接 require 这个文件），所以三处说的是同一件事。

const L = (language, zh, en) => (language === 'en' ? en : zh);
const OFFLINE = ['offline', 'lost', 'sync'];
const COLUMN = {
  planned: 'open', pending: 'open', returned: 'open', blocked: 'open',
  doing: 'doing', expired: 'doing', unconfirmed: 'doing', delivered: 'review',
  accepted: 'done', cancelled: 'closed', superseded: 'closed',
};
export const taskColumn = (task, reachable) => COLUMN[taskRecordState(task, reachable)] || 'open';

// 工位行：与工位视图同一套判断（座位 + 会话在线状态 + 局域网）。
export function stationRows(registry, snapshot, live, lanNames = new Set(), now = Date.now()) {
  const watch = new Map(list(snapshot?.watchdog?.seats).map((s) => [s.seat_id, s]));
  return stations(registry, snapshot, live, now).map((s) => ({
    ...s,
    link: linkStatus(s.agent, live, now, watch.get(s.id)),
    line: lanNames.has(text(s.name).toLowerCase()) ? 'lan' : 'local',
  }));
}

// 系统：会话上报的平台优先，没有时按设备外形推断（电脑 Windows、服务器 Linux、手机安卓）。
const PLATFORM = [
  [/^(win|windows)/i, 'Windows', 'Windows'],
  [/^(linux|ubuntu|debian|centos|fedora|arch)/i, 'Linux', 'Linux'],
  [/^(android|termux)/i, '安卓', 'Android'],
  [/^(darwin|mac)/i, 'macOS', 'macOS'],
  [/^ios/i, 'iOS', 'iOS'],
];
export function platformOf(row, language = 'zh') {
  const reported = text(row.agent?.runtime?.platform || row.agent?.platform);
  for (const [re, zh, en] of PLATFORM) if (re.test(reported)) return L(language, zh, en);
  const kind = deviceKind(row.agent, row.name);
  return kind === 'server' ? 'Linux' : kind === 'phone' ? L(language, '安卓', 'Android') : 'Windows';
}

const fresh = (at, now, ms) => {
  const t = timestamp(at);
  return Number.isFinite(t) && now - t < ms;
};

// 每个工位最近一句人话（工位头顶的气泡）：24 小时内的才显示。
export function latestSays(rows, now = Date.now()) {
  const out = new Map();
  for (const s of rows) {
    const m = list(s.messages).find((x) => humanLine(x.body, 60));
    if (m && fresh(m.created, now, 86400000)) out.set(s.id, { id: text(m.id), text: humanLine(m.body, 60), at: m.created });
  }
  return out;
}

// input：{ registry, snapshot, live, lan, cloud, now, language }
// 返回 { items, platforms, cloud, rows }；items 按轮播顺序排好，每条 { key, kind, tone, text, who? }。
export function situation({ registry, snapshot, live = true, lan = null, cloud = null, now = Date.now(), language = 'zh' } = {}) {
  const lanNames = new Set(list(lan?.devices).filter((d) => d.online).map((d) => text(d.name).toLowerCase()));
  const rows = registry && snapshot ? stationRows(registry, snapshot, live, lanNames, now) : [];
  const items = [];
  const name = (s) => text(s.name) || L(language, '未命名工位', 'Unnamed station');
  const byActor = new Map(rows.map((s) => [s.actor_id, s]));
  const who = (id) => {
    const s = byActor.get(id) || rows.find((r) => r.id === id || r.agent?.id === id);
    return s ? name(s) : list(snapshot?.agents).find((a) => a.id === id)?.name || '';
  };

  // 1. 需要人的事永远排最前。
  if (snapshot && !live) items.push({ key: 'alert-offline', kind: 'alert', tone: 'warn', text: L(language, 'Link 服务暂时连不上，正在自动重试', 'Link is unreachable; retrying') });
  for (const s of rows.filter((r) => r.link.state === 'waiting'))
    items.push({ key: 'wait-' + s.id, kind: 'alert', tone: 'warn', who: name(s), text: L(language, `${name(s)} 在等你回复`, `${name(s)} is waiting for you`) });
  for (const s of rows.filter((r) => r.link.state === 'error'))
    items.push({ key: 'err-' + s.id, kind: 'alert', tone: 'alert', who: name(s), text: L(language, `${name(s)} 出错了，点开工位看看`, `${name(s)} hit an error`) });
  for (const e of list(snapshot?.self_heal?.audit).filter((e) => e.kind === 'continue' && fresh(e.at, now, 1800000)).slice(-2)) {
    const w = who(e.actor_id) || L(language, '一个工位', 'A station');
    const said = { queued: L(language, `${w} 中断了，已自动发「继续」`, `${w} stalled; sent "continue"`), manual_required: L(language, `${w} 中断了，需要你提醒一句「继续」`, `${w} stalled; please nudge it`), failed: L(language, `${w} 中断了，自动「继续」没发出去`, `${w} stalled; auto-continue failed`) }[e.result];
    if (said) items.push({ key: 'heal-' + text(e.actor_id) + '-' + text(e.at), kind: 'alert', tone: e.result === 'queued' ? 'calm' : 'warn', who: w, text: said });
  }

  // 2. 刚刚的发言：最近 10 分钟内的两条。
  const speech = list(snapshot?.messages)
    .map((m) => ({ m, at: timestamp(m.created) || 0, line: humanLine(m.body, 60) }))
    .filter((x) => x.line && now - x.at < 600000)
    .sort((a, b) => b.at - a.at)
    .slice(0, 2);
  for (const { m, line } of speech) {
    const w = who(m.sender) || L(language, '有人', 'Someone');
    items.push({ key: 'say-' + text(m.id), kind: 'speech', tone: 'live', who: w, text: `${w}：${line}` });
  }

  // 3. 工位在做什么：正在工作的工位，配上它手上的工单。
  const reachable = live;
  const tasks = orderedTasks(snapshot?.tasks, reachable);
  const working = rows.filter((r) => r.link.state === 'working');
  for (const s of working.slice(0, 3)) {
    const t = tasks.find((t) => (t.owner === s.actor_id || t.assignee === s.actor_id) && taskColumn(t, reachable) === 'doing');
    items.push({
      key: 'doing-' + s.id,
      kind: 'doing',
      tone: 'live',
      who: name(s),
      text: t ? L(language, `${name(s)} 正在做「${text(t.title || t.id)}」`, `${name(s)} is on "${text(t.title || t.id)}"`) : L(language, `${name(s)} 正在工作`, `${name(s)} is working`),
    });
  }

  // 4. 工位总览。
  const count = (fn) => rows.filter(fn).length;
  const online = count((r) => !OFFLINE.includes(r.link.state)),
    waiting = count((r) => r.link.state === 'waiting');
  items.push({
    key: 'stations',
    kind: 'stations',
    tone: 'calm',
    text: !rows.length
      ? L(language, '还没有工位接入', 'No stations yet')
      : [
          working.length ? L(language, `${working.length} 个工位在工作`, `${working.length} working`) : '',
          waiting ? L(language, `${waiting} 个在等你`, `${waiting} waiting`) : '',
          online - working.length - waiting > 0 ? L(language, `${online - working.length - waiting} 个待机`, `${online - working.length - waiting} idle`) : '',
          rows.length - online ? L(language, `${rows.length - online} 个离线`, `${rows.length - online} offline`) : '',
        ].filter(Boolean).join(' · ') || L(language, `${rows.length} 个工位`, `${rows.length} stations`),
  });

  // 5. 工单总览。
  const cols = { open: 0, doing: 0, review: 0, done: 0 };
  const today = new Date(now).toDateString();
  for (const t of tasks) {
    const c = taskColumn(t, reachable);
    if (c === 'done') {
      const at = timestamp(t.updated || t.updated_at || t.created);
      if (Number.isFinite(at) && new Date(at).toDateString() === today) cols.done++;
    } else if (c in cols) cols[c]++;
  }
  items.push({
    key: 'tasks',
    kind: 'tasks',
    tone: 'calm',
    text:
      cols.open + cols.doing + cols.review + cols.done
        ? L(language, '工单 · ', 'Work orders · ') +
          [
            cols.doing ? L(language, `进行中 ${cols.doing}`, `${cols.doing} in progress`) : '',
            cols.review ? L(language, `待验收 ${cols.review}`, `${cols.review} to review`) : '',
            cols.open ? L(language, `待接单 ${cols.open}`, `${cols.open} open`) : '',
            cols.done ? L(language, `今天完成 ${cols.done}`, `${cols.done} done today`) : '',
          ].filter(Boolean).join(' · ')
        : L(language, '暂无工单', 'No work orders'),
  });

  // 6. 连接。
  const lanOnline = list(lan?.devices).filter((d) => d.online).length;
  items.push({
    key: 'link',
    kind: 'link',
    tone: cloud?.ready ? 'live' : 'calm',
    text: [
      cloud ? (cloud.ready ? L(language, `云 ${cloud.id} 已就绪`, `Cloud ${cloud.id} ready`) : L(language, `云 ${cloud.id} 连接中`, `Cloud ${cloud.id} connecting`)) : L(language, '本机运行', 'Local'),
      lanOnline ? L(language, `局域网 ${lanOnline} 台设备在线`, `${lanOnline} LAN devices`) : '',
      rows.length ? L(language, `${online}/${rows.length} 个工位在线`, `${online}/${rows.length} online`) : '',
    ].filter(Boolean).join(' · '),
  });

  // 右上角：按系统统计 活跃/总数。
  const platforms = new Map();
  for (const s of rows) {
    const p = platformOf(s, language),
      row = platforms.get(p) || { name: p, active: 0, total: 0 };
    row.total++;
    if (!OFFLINE.includes(s.link.state)) row.active++;
    platforms.set(p, row);
  }
  const order = ['安卓', 'Android', 'Windows', 'Linux', 'macOS', 'iOS'];
  return {
    items,
    rows,
    cloud: cloud || null,
    platforms: [...platforms.values()].sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name)),
  };
}
