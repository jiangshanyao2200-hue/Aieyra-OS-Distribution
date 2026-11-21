/* @file-map:start
文件: link/office/web/model.js
位置: 一环·共享工位界面 | 工位页面与供shell/原生OS复用的模型、视觉和弹层规则。
约束: 共享原语优先复用，页面仅组装数据与事件；保持草稿、滚位和焦点，不在布局观察回调中重复同步写布局
下游: 无已解析的项目内静态导入
上游: link/desktop/ui/work-status.mjs, link/office/web/office-home-model.js, link/office/web/office-home.js, link/office/web/pixel-office.js, link/office/web/situation.js, link/office/web/station-model.js
链路: 目录 CODEMAP.md → docs/CODE-MAP.json
验证: node --test link/office/tests/unit/*.mjs, AIDEBUG/live-review.cjs
目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
  text | function
  esc | function
  list | function
  normalize | function
  timestamp | function
  taskRecordState | function
  taskRecordLabel | function
  humanLine | function
维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
@file-map:end */
export const /* @chain-region text | calls: String */ text = (value) =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
export const /* @chain-region esc | calls: replace, text */ esc = (value) =>
  text(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export const /* @chain-region list | calls: Array.isArray, value.filter */ list = (value) =>
  Array.isArray(value) ? value.filter((v) => v && typeof v === 'object' && !Array.isArray(v)) : [];
export /* @chain-region normalize | calls: Array.isArray, Error, list, Object.fromEntries, map, result.messages.sort, Number.isFinite, timestamp */ function normalize(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid_snapshot');
  const result = { ...raw };
  for (const key of ['projects', 'agents', 'tasks', 'messages', 'resources', 'deliveries'])
    result[key] = list(raw[key]);
  for (const key of ['connection', 'governance', 'capabilities'])
    result[key] = raw[key] && typeof raw[key] === 'object' ? raw[key] : {};
  result.known = Object.fromEntries(
    ['projects', 'agents', 'tasks', 'messages', 'resources', 'deliveries'].map((k) => [
      k,
      Array.isArray(raw[k]),
    ]),
  );
  result.messages.sort((a, b) =>
    Number.isFinite(a.seq) && Number.isFinite(b.seq)
      ? a.seq - b.seq
      : (timestamp(a.created) || 0) - (timestamp(b.created) || 0),
  );
  return result;
}
export /* @chain-region timestamp | calls: Date, date.getTime */ function timestamp(value) {
  if (value === null || value === undefined || value === '') return NaN;
  const date =
    typeof value === 'number' ? new Date(value < 1e12 ? value * 1000 : value) : new Date(value);
  return date.getTime();
}
// Keep the center's original status intact; project the validity of its claim.
export /* @chain-region taskRecordState | calls: test, text, timestamp, Number.isFinite, Date.now */ function taskRecordState(task, reachable = true) {
  // 退回的工单回到待接，但证据里留着「退回：」——人看到的是「退回」。
  if (task?.status === 'planned' && /(^|\n)退回：/.test(text(task.evidence))) return 'returned';
  if (task?.status !== 'doing') return text(task?.status) || 'unknown';
  const lease = timestamp(task.lease_until);
  if (Number.isFinite(lease) && lease > 0 && lease <= Date.now()) return 'expired';
  if (!reachable || !text(task.owner) || !Number.isFinite(lease) || lease <= 0)
    return 'unconfirmed';
  return 'doing';
}
// 工单状态（Link 方案 4.4）：待接 → 进行中 → 待验收 → 完成 / 退回。
export /* @chain-region taskRecordLabel | calls: taskRecordState */ function taskRecordLabel(task, language = 'zh', reachable = true) {
  const labels = {
    doing: ['进行中', 'In progress'],
    expired: ['进行中 · 待核对', 'In progress · unconfirmed'],
    unconfirmed: ['进行中 · 待核对', 'In progress · unconfirmed'],
    planned: ['待接', 'Open'],
    pending: ['待接', 'Open'],
    blocked: ['有阻塞', 'Blocked'],
    delivered: ['待验收', 'Awaiting review'],
    accepted: ['完成', 'Done'],
    returned: ['退回', 'Returned'],
    cancelled: ['已关闭', 'Closed'],
    superseded: ['已合并', 'Merged'],
    unknown: ['未知', 'Unknown'],
  };
  return (labels[taskRecordState(task, reachable)] || labels.unknown)[language === 'en' ? 1 : 0];
}

// 群聊人话层（Link 方案 4.4）：每条消息只取开头一句人能听懂的话；完整正文属于内部频道。
// 约定：消息第一行写「人话：……」（或 say: …），群聊只显示这一句；其后是 AI 之间的完整内容。没写就退回取首句。
export /* @chain-region humanLine | calls: trim, replace, text, value.match, said.1.trim, join, slice, value.replace … */ function humanLine(body, limit = 80) {
  let value = text(body).replace(/\r/g, '').trim();
  const said = value.match(/^(?:人话|say)\s*[:：]\s*(.+)/i);
  if (said) {
    const line = said[1].trim();
    return [...line].length > limit ? [...line].slice(0, limit).join('') + '…' : line;
  }
  // 去掉开头的【标题】和 [标记] 这类给 AI 看的抬头。
  for (let i = 0; i < 3; i++) {
    const next = value.replace(/^(\[[^\]\n]{0,160}\]|【[^】\n]{0,160}】)\s*/, '');
    if (next === value) break;
    value = next;
  }
  const line = value.split('\n').map((x) => x.trim()).find(Boolean) || '';
  const sentence = (line.match(/^.*?[。！？!?](?=\s|$|[^。！？!?])/) || [line])[0].trim();
  return [...sentence].length > limit ? [...sentence].slice(0, limit).join('') + '…' : sentence;
}
