// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Control/app/web/AGENTS.md | ring 2
// Chains: module-local; query impact before editing
// Regions: text; esc; list; normalize; timestamp; taskRecordState; taskRecordLabel; humanLine
// Impact: python -B scripts/code-atlas.py show Control/app/web/model.js
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

export const text = (value) =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
export const esc = (value) =>
  text(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export const list = (value) =>
  Array.isArray(value) ? value.filter((v) => v && typeof v === 'object' && !Array.isArray(v)) : [];
export function normalize(raw) {
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
export function timestamp(value) {
  if (value === null || value === undefined || value === '') return NaN;
  const date =
    typeof value === 'number' ? new Date(value < 1e12 ? value * 1000 : value) : new Date(value);
  return date.getTime();
}
// Keep the center's original status intact; project the validity of its claim.
export function taskRecordState(task, reachable = true) {
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
export function taskRecordLabel(task, language = 'zh', reachable = true) {
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
export function humanLine(body, limit = 80) {
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
