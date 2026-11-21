'use strict';

const SCHEMA = 'aieyra.center-status-log/1';
const LIMIT = 24;
const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));

function createStatusLog({ file, readJson, writeJson }) {
  const saved = readJson(file, { maxBytes: 32768 });
  const entries = saved?.status === 'valid' && saved.value?.schema === SCHEMA && Array.isArray(saved.value.entries)
    ? saved.value.entries.slice(-LIMIT).filter(row =>
      /^[a-z_]{1,32}$/.test(row?.id) && validTime(row.since) &&
      typeof row.name === 'string' && row.name.length <= 48 &&
      typeof row.detail === 'string' && row.detail.length <= 200 &&
      (row.resolvedAt === null || validTime(row.resolvedAt)))
    : [];
  let pending = Promise.resolve();

  function observe(checks, at) {
    let changed = false;
    for (const { id, name, state, detail } of checks) {
      const active = entries.findLast(row => row.id === id && !row.resolvedAt);
      if (state === 'attention' && !active) {
        entries.push({ id, name, detail, since: at, resolvedAt: null });
        changed = true;
      } else if (state === 'attention' && active.detail !== detail) {
        active.detail = detail;
        changed = true;
      } else if (active && (state === 'online' || state === 'idle')) {
        active.resolvedAt = at;
        changed = true;
      }
    }
    if (!changed) return;
    while (entries.length > LIMIT) {
      const oldestResolved = entries.findIndex(row => row.resolvedAt);
      entries.splice(Math.max(0, oldestResolved), 1);
    }
    const snapshot = entries.map(row => ({ ...row }));
    pending = pending.then(() => writeJson(file, { schema: SCHEMA, entries: snapshot })).catch(() => {});
  }

  return {
    observe,
    active: () => entries.filter(row => !row.resolvedAt).map(row => ({ ...row })),
    flush: () => pending,
  };
}

module.exports = { createStatusLog };
