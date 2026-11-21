'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const categories = new Set(['renderer_crash', 'child_crash', 'unexpected_exit', 'core_unavailable', 'execution_error', 'update_error', 'program_error']);
const execution = new Set(['program_error', 'execution_error']);
const versionPattern = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const privateText = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]|[a-z]:[\\/]|\\\\|\/(?:home|Users|private|var|mnt)\/|https?:\/\/|\b[^\s@]+@[^\s@]+\.[^\s@]+|\b(?:Bearer|Basic)\s+\S+|-----BEGIN |\bsk-[\w-]{16,}|(?:api[_-]?key|password|secret|access_token)\s*[=:]\s*\S+/i;
const hash = text => createHash('sha256').update(text).digest('hex');
const hour = 3600000;

function createIssueReports({ directory, root, version, client, confirm, accountStatus = client.status, now = Date.now }) {
  fs.mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(path.join(directory, 'issue-reports.sqlite'));
  db.exec('PRAGMA busy_timeout=5000; PRAGMA secure_delete=ON; BEGIN IMMEDIATE');
  try {
    const old = db.prepare('PRAGMA table_info(reports)').all();
    const migrate = old.length && !old.some(column => column.name === 'intent');
    if (migrate) db.exec('ALTER TABLE reports RENAME TO old_reports');
    db.exec(`CREATE TABLE IF NOT EXISTS reports (
      id TEXT NOT NULL, owner TEXT NOT NULL, origin TEXT NOT NULL, category TEXT NOT NULL, version TEXT NOT NULL,
      details TEXT NOT NULL, event_key TEXT NOT NULL, created INTEGER NOT NULL, state TEXT NOT NULL,
      topic TEXT NOT NULL, intent TEXT NOT NULL, PRIMARY KEY(owner,id), UNIQUE(owner,event_key));
      CREATE TABLE IF NOT EXISTS preferences (id INTEGER PRIMARY KEY, enabled INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (pid INTEGER PRIMARY KEY, owner TEXT NOT NULL, version TEXT NOT NULL);`);
    if (migrate) db.exec("INSERT INTO reports SELECT *, '' FROM old_reports; DROP TABLE old_reports");
    db.exec('CREATE INDEX IF NOT EXISTS reports_owner ON reports(owner,state,created); COMMIT');
  } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }

  let consent = false;
  try { consent = fs.readFileSync(path.join(root, '.aieyra-privacy-consent'), 'utf8') === '2026-11-22'; }
  catch (error) { if (error.code !== 'ENOENT') { db.close(); throw error; } }
  const enabled = () => Boolean(db.prepare('SELECT enabled FROM preferences WHERE id=1').get()?.enabled ?? consent);
  const owner = () => {
    const account = accountStatus();
    return account?.signedIn && account.user?.id ? hash(String(account.user.id)) : '';
  };
  let timer, flight, activeAbort, closed = false, lastOwner, nextAttempt = 0, failures = 0;
  let marked = false;

  function store(account, origin, category, build, key, details = '', id = randomUUID(), intent = '') {
    if (!account || !categories.has(category) || !versionPattern.test(build)) return;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM reports WHERE created<?').run(now() - 30 * 24 * hour);
      db.prepare(`INSERT OR IGNORE INTO reports
        SELECT ?,?,?,?,?,?,?,?,'pending','',? WHERE
        (SELECT count(*) FROM reports WHERE owner=? AND state='pending')<100`)
        .run(id, account, origin, category, build, details, key, now(), intent, account);
      const row = db.prepare('SELECT id,intent FROM reports WHERE owner=? AND event_key=?').get(account, key);
      db.exec('COMMIT');
      return row;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }

  function schedule() {
    if (closed || timer || flight || !owner()) return;
    timer = setTimeout(() => {
      timer = undefined;
      void flush().catch(() => { nextAttempt = now() + 60000; schedule(); });
    }, Math.max(50, nextAttempt - now()));
    timer.unref();
  }

  async function flush() {
    if (closed || flight || now() < nextAttempt) return flight;
    const account = owner();
    if (!account) return;
    db.prepare('DELETE FROM reports WHERE created<?').run(now() - 30 * 24 * hour);
    const row = db.prepare("SELECT * FROM reports WHERE owner=? AND state='pending' ORDER BY created,rowid LIMIT 1").get(account);
    if (!row) return;
    const controller = new AbortController();
    activeAbort = controller;
    const payload = { requestId: row.id, source: row.origin, category: row.category, version: row.version };
    if (row.details) Object.assign(payload, { details: row.details, confirmed: true });
    flight = Promise.resolve().then(async () => {
      if (controller.signal.aborted || account !== owner()) return;
      try {
        const result = await client.reportIssue(account, payload, controller.signal);
        if (controller.signal.aborted || closed) return;
        if (result?.requestId !== row.id || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(result.topic)) throw Error('反馈回执无效');
        db.prepare("UPDATE reports SET state='sent',topic=?,details='' WHERE id=? AND owner=?").run(result.topic, row.id, account);
        failures = 0;
      } catch (error) {
        if (controller.signal.aborted || closed) return;
        if ([400,403,409,413,422].includes(error.status)) {
          db.prepare("UPDATE reports SET state='rejected',details='' WHERE id=? AND owner=?").run(row.id, account);
        } else {
          failures++;
          nextAttempt = now() + Math.max(Math.min(300000, 5000 * 2 ** Math.min(failures - 1, 6)), error.retryAfterMs || 0);
        }
      }
    }).finally(() => { flight = null; activeAbort = null; schedule(); });
    return flight;
  }

  function system(category, identity = '') {
    if (closed || !enabled() || !categories.has(category)) return;
    const account = owner();
    if (!account) return;
    const key = hash([category, version, identity || Math.floor(now() / hour)].join('\n'));
    if (!db.prepare('SELECT 1 FROM reports WHERE owner=? AND event_key=?').get(account, key)) {
      store(account, 'center', category, version, key);
      schedule();
    }
  }

  function accountChanged() {
    if (closed) return;
    const account = owner();
    if (lastOwner !== account) {
      activeAbort?.abort();
      clearTimeout(timer); timer = undefined;
      nextAttempt = 0; failures = 0; lastOwner = account;
      if (marked) db.prepare('DELETE FROM sessions WHERE pid=?').run(process.pid);
      marked = false;
    }
    if (account && enabled() && !marked) {
      for (const previous of db.prepare('SELECT * FROM sessions WHERE owner=?').all(account)) {
        if (previous.pid !== process.pid) {
          try { process.kill(previous.pid, 0); continue; }
          catch (error) { if (error.code !== 'ESRCH') continue; }
        }
        store(account, 'center', 'unexpected_exit', previous.version, 'exit:' + randomUUID());
        db.prepare('DELETE FROM sessions WHERE pid=? AND owner=?').run(previous.pid, account);
      }
      db.prepare('INSERT OR REPLACE INTO sessions VALUES(?,?,?)').run(process.pid, account, version);
      marked = true;
    }
    schedule();
  }

  function preference(value) {
    if (value === undefined) return enabled();
    if (typeof value !== 'boolean') throw Error('反馈设置无效');
    db.prepare('INSERT OR REPLACE INTO preferences VALUES(1,?)').run(Number(value));
    if (!value) {
      activeAbort?.abort();
      db.exec("DELETE FROM reports WHERE state='pending' AND details=''; DELETE FROM sessions");
      marked = false;
    }
    accountChanged();
    return value;
  }

  function receipt(id) {
    const row = db.prepare('SELECT id,state,topic FROM reports WHERE owner=? AND id=?').get(owner(), String(id));
    if (!row) throw Error('未找到本账号的反馈回执');
    return row;
  }

  async function report(p, fromAgent) {
    const account = owner();
    if (!account || closed) throw Error('请先登录 Aieyra OS');
    const category = p.category || 'execution_error', id = p.request_id;
    if (!execution.has(category) || typeof id !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(id)) throw Error('执行反馈编号或类别无效');
    const details = p.content ?? '';
    if (typeof details !== 'string' || details.length > 1200 || (details && (!details.trim() || privateText.test(details)))) throw Error('公开说明须在 1200 字以内，请移除私人路径、账号、凭据与链接');
    const key = 'eyra:' + id, intent = hash(JSON.stringify([category, details]));
    const prior = db.prepare('SELECT intent FROM reports WHERE owner=? AND event_key=?').get(account, key);
    if (!prior) {
      if (details ? !(fromAgent ? await confirm(details) : p.confirmed === true) : !enabled()) throw Error('请在中枢确认公开反馈');
      if (closed || owner() !== account) throw Error('登录账号已变化');
      const stored = store(account, 'eyra', category, version, key, details, id, intent);
      if (!stored) throw Error('反馈队列已满或编号已使用');
      if (stored.intent && stored.intent !== intent) throw Error('该反馈编号已用于其他内容');
    } else if (prior.intent && prior.intent !== intent) throw Error('该反馈编号已用于其他内容');
    await flush();
    if (closed || owner() !== account) throw Error('登录账号已变化');
    return receipt(id);
  }

  const unsubscribe = client.subscribe(accountChanged);
  accountChanged();
  return { system, preference, report, receipt, flush, accountChanged, async close() {
    closed = true; clearTimeout(timer); unsubscribe(); activeAbort?.abort();
    await flight;
    if (marked) db.prepare('DELETE FROM sessions WHERE pid=?').run(process.pid);
    db.close();
  } };
}

module.exports = { createIssueReports };
