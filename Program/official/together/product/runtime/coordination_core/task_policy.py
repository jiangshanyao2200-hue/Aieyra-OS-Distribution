"""Explicit sharing, execution handoff and stable work-order history."""
from __future__ import annotations

import base64
import json
import math
from .core import Fault, ident, text
from . import registry

ACTIONS = {'task-share', 'task-release', 'task-dispatch'}
ACTIVE = ('planned', 'doing', 'blocked')


def project_access(db, actor, project):
    if not db.execute('SELECT 1 FROM registered_projects WHERE id=?', (project,)).fetchone():
        raise Fault('unknown_project')
    if actor['role'] != 'owner' and actor['project'] not in (project, 'coordination'):
        raise Fault('project_scope_denied', 403)


def migrate(db):
    columns = {r[1] for r in db.execute('PRAGMA table_info(tasks)')}
    if not columns:
        return
    for name, kind in {'shareable': 'INTEGER NOT NULL DEFAULT 0',
                       'depends_on': "TEXT NOT NULL DEFAULT '[]'",
                       'handoff_by': 'TEXT', 'handoff_note': "TEXT NOT NULL DEFAULT ''",
                       'execution_epoch': 'INTEGER NOT NULL DEFAULT 0'}.items():
        if name not in columns:
            db.execute(f'ALTER TABLE tasks ADD COLUMN {name} {kind}')
    db.execute('''CREATE TABLE IF NOT EXISTS task_dispatches(
        id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tasks(id),
        task_version INTEGER NOT NULL,sender TEXT NOT NULL,target TEXT NOT NULL,
        state TEXT NOT NULL,updated REAL NOT NULL,native_session_id TEXT NOT NULL,
        binding_version INTEGER NOT NULL)''')
    db.execute('CREATE INDEX IF NOT EXISTS task_history_page ON tasks(project,updated DESC,id DESC)')


def public(row):
    value = dict(row)
    value['shareable'] = bool(value.get('shareable', False))
    deps = value.get('depends_on', '[]')
    value['depends_on'] = json.loads(deps) if isinstance(deps, str) else deps
    return value


def unresolved(db, task_id):
    return db.execute("SELECT 1 FROM task_dispatches WHERE task_id=? AND state IN ('submitting','notified','unknown') LIMIT 1", (task_id,)).fetchone()


def dependencies(db, task, values):
    if not isinstance(values, list) or len(values) > 32 or len(set(map(str, values))) != len(values):
        raise Fault('invalid_task_dependencies')
    values = [ident(v) for v in values]
    pending, seen = list(values), set()
    while pending:
        tid = pending.pop()
        if tid == task['id']:
            raise Fault('task_dependency_cycle', 409)
        if tid in seen:
            continue
        seen.add(tid)
        row = db.execute('SELECT project,depends_on FROM tasks WHERE id=?', (tid,)).fetchone()
        if not row or row['project'] != task['project']:
            raise Fault('task_dependency_missing', 409)
        pending.extend(json.loads(row['depends_on']))
    return values


def claim(db, actor, task, body, now):
    pending = db.execute("SELECT * FROM task_dispatches WHERE task_id=? AND state IN ('submitting','notified','unknown')", (task['id'],)).fetchall()
    dispatch_id = body.get('dispatch_id')
    if pending or dispatch_id:
        row = db.execute('SELECT * FROM task_dispatches WHERE id=?', (ident(dispatch_id),)).fetchone() if dispatch_id else None
        if (not row or row['task_id'] != task['id'] or row['target'] != actor['id']
                or row['state'] not in ('submitting', 'notified', 'unknown')
                or type(body.get('dispatch_version')) is not int or type(body.get('binding_version')) is not int
                or row['task_version'] != body.get('dispatch_version')
                or row['native_session_id'] != body.get('native_session_id')
                or row['binding_version'] != body.get('binding_version')):
            raise Fault('task_dispatch_ack_required', 409)
    for tid in json.loads(task['depends_on']):
        dependency = db.execute('SELECT status FROM tasks WHERE id=?', (tid,)).fetchone()
        if not dependency or dependency['status'] != 'accepted':
            raise Fault('task_dependency_not_accepted', 409)
    # An expired communication/task lease does not prove the native writer stopped.
    if task['owner'] and task['owner'] != actor['id']:
        raise Fault('task_execution_handoff_required', 409)
    if task['assignee'] and task['assignee'] != actor['id']:
        if not (task['shareable'] and task['handoff_by'] and task['status'] == 'planned'
                and not task['owner'] and task['lease_until'] == 0):
            raise Fault('task_assigned_elsewhere', 409)
        if unresolved(db, task['id']):
            raise Fault('task_dispatch_unresolved', 409)
    if task['shareable'] and task['handoff_by'] and not task['owner']:
        if db.execute("SELECT 1 FROM tasks WHERE owner=? AND id!=? AND status IN ('doing','blocked') LIMIT 1", (actor['id'], task['id'])).fetchone():
            raise Fault('sharing_worker_not_idle', 409)
        if db.execute("SELECT 1 FROM task_dispatches WHERE target=? AND task_id!=? AND state IN ('submitting','notified','unknown') LIMIT 1", (actor['id'], task['id'])).fetchone():
            raise Fault('sharing_worker_dispatch_pending', 409)
    if dispatch_id:
        db.execute("UPDATE task_dispatches SET state='claimed',updated=? WHERE id=?", (now, dispatch_id))


def write(db, actor, action, body, now):
    task = db.execute('SELECT * FROM tasks WHERE id=?', (ident(body.get('id')),)).fetchone()
    if not task:
        raise Fault('task_missing', 404)
    project_access(db, actor, task['project'])
    if type(body.get('version')) is not int or ((action != 'task-dispatch' or body.get('state') == 'submitting') and body['version'] != task['version']):
        raise Fault('version_conflict', 409)
    if action == 'task-dispatch':
        if not registry.manager(db, actor, task['project']):
            raise Fault('task_dispatch_leader_required', 403)
        did, state = ident(body.get('dispatch_id')), body.get('state')
        if state not in ('submitting', 'notified', 'unknown', 'not_sent'):
            raise Fault('invalid_task_dispatch_state')
        old = db.execute('SELECT * FROM task_dispatches WHERE id=?', (did,)).fetchone()
        if not old:
            if state != 'submitting' or task['status'] != 'planned' or task['owner'] or not task['assignee']:
                raise Fault('task_dispatch_not_prepared', 409)
            if unresolved(db, task['id']):
                raise Fault('task_dispatch_unresolved', 409)
            native = ident(body.get('native_session_id'))
            binding = body.get('binding_version')
            if type(binding) is not int or binding < 1:
                raise Fault('invalid_dispatch_binding')
            db.execute('INSERT INTO task_dispatches VALUES(?,?,?,?,?,?,?,?,?)', (did, task['id'], task['version'], actor['id'], task['assignee'], state, now, native, binding))
        else:
            if (old['task_id'], old['sender'], old['task_version']) != (task['id'], actor['id'], body['version']):
                raise Fault('task_dispatch_identity_changed', 409)
            # A native claim can beat the sender's completion receipt. Never undo it.
            if old['state'] == 'claimed':
                return public(task)
            if old['state'] != 'submitting' or state == 'submitting':
                raise Fault('task_dispatch_query_original', 409)
            db.execute('UPDATE task_dispatches SET state=?,updated=? WHERE id=?', (state, now, did))
        return public(task)
    if task['status'] not in ACTIVE:
        raise Fault('task_closed', 409)
    responsible = task['owner'] or task['assignee'] or task['creator']
    if responsible != actor['id']:
        raise Fault('task_responsible_worker_required', 403)
    if action == 'task-share':
        if type(body.get('shareable')) is not bool:
            raise Fault('invalid_task_shareable')
        deps = dependencies(db, task, body.get('depends_on', json.loads(task['depends_on'])))
        if task['owner'] and deps != json.loads(task['depends_on']):
            raise Fault('release_before_changing_dependencies', 409)
        db.execute('UPDATE tasks SET shareable=?,depends_on=?,version=version+1,updated=? WHERE id=?', (body['shareable'], json.dumps(deps), now, task['id']))
    else:
        if body.get('quiescent') is not True:
            raise Fault('task_quiescent_ack_required', 409)
        if unresolved(db, task['id']):
            raise Fault('task_dispatch_unresolved', 409)
        note = text(body.get('evidence'), 1500)
        db.execute("UPDATE tasks SET status='planned',owner=NULL,lease_until=0,handoff_by=?,handoff_note=?,version=version+1,updated=? WHERE id=?", (actor['id'], note, now, task['id']))
    return public(db.execute('SELECT * FROM tasks WHERE id=?', (task['id'],)).fetchone())


def dispatch(database, actor, query):
    if set(query) != {'id', 'dispatch_id'} or any(len(v) != 1 for v in query.values()):
        raise Fault('invalid_task_dispatch_query')
    task_id, dispatch_id = ident(query['id'][0]), ident(query['dispatch_id'][0])
    task = database.execute('SELECT project FROM tasks WHERE id=?', (task_id,)).fetchone()
    if not task:
        raise Fault('task_missing', 404)
    project_access(database, actor, task['project'])
    row = database.execute('SELECT * FROM task_dispatches WHERE id=? AND task_id=?', (dispatch_id, task_id)).fetchone()
    if not row:
        raise Fault('task_dispatch_missing', 404)
    if actor['id'] not in (row['sender'], row['target']) and not registry.manager(database, actor, task['project']):
        raise Fault('task_dispatch_access_denied', 403)
    return dict(row)


def history(db, actor, query):
    if set(query) - {'project', 'limit', 'before'} or any(len(v) != 1 for v in query.values()):
        raise Fault('invalid_task_history_query')
    project = ident(query.get('project', [actor['project']])[0])
    # A fresh office has no project until a station joins; for the owner that
    # is an empty history, not a failure. Query shape is still validated.
    unregistered = actor['role'] == 'owner' and not db.execute('SELECT 1 FROM registered_projects WHERE id=?', (project,)).fetchone()
    if not unregistered:
        project_access(db, actor, project)
    raw_limit = query.get('limit', ['20'])[0]
    if not isinstance(raw_limit, str) or not raw_limit.isascii() or not raw_limit.isdecimal() or not 1 <= int(raw_limit) <= 20:
        raise Fault('invalid_task_history_limit')
    limit = int(raw_limit)
    clauses, args = ['project=?'], [project]
    cursor = query.get('before', [None])[0]
    if cursor is not None:
        try:
            if not isinstance(cursor, str) or len(cursor) > 400:
                raise ValueError()
            decoded = json.loads(base64.b64decode(cursor + '=' * (-len(cursor) % 4), altchars=b'-_', validate=True))
            if not isinstance(decoded, list) or len(decoded) != 3 or decoded[0] != project:
                raise ValueError()
            at, tid = decoded[1:]
            if type(at) not in (float, int) or not math.isfinite(at) or at < 0:
                raise ValueError()
            ident(tid)
        except (ValueError, TypeError, Fault):
            raise Fault('invalid_task_history_cursor') from None
        clauses.append('(updated<? OR (updated=? AND id<?))'); args.extend([at, at, tid])
    if unregistered:
        return {'items': [], 'next_cursor': None, 'has_more': False, 'registered': False}
    rows = db.execute('SELECT * FROM tasks WHERE ' + ' AND '.join(clauses) + ' ORDER BY updated DESC,id DESC LIMIT ?', (*args, limit + 1)).fetchall()
    page, more = rows[:limit], len(rows) > limit
    before = base64.urlsafe_b64encode(json.dumps([project, page[-1]['updated'], page[-1]['id']], separators=(',', ':')).encode()).decode().rstrip('=') if more else None
    return {'items': [public(row) for row in page], 'next_cursor': before, 'has_more': more}
