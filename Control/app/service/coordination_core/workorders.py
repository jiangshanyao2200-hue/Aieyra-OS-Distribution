# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: Control/app/service/AGENTS.md | ring 2
# Chains: module-local; query impact before editing
# Regions: migrate; departed; actor; create_fields; arranger; write
# Impact: python -B scripts/code-atlas.py show Control/app/service/coordination_core/workorders.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""Work orders (工单) on top of center tasks (docs/工位与协同.md Link 4.4, 2026-10-15).

A work order is a task with who opened it, who it is for, a one-line request and
an acceptance standard. Any agent may open one; the project leader (or the
human owner) arranges them: reassign, merge, close, return or accept.
"""
from __future__ import annotations

from .core import Fault, text, ident
from . import registry
from . import task_policy

ACTIONS = {'task-assign', 'task-close', 'task-merge', 'task-return'}
OPEN = ('planned', 'doing', 'blocked', 'delivered')
COLUMNS = {
    'creator': "TEXT",
    'assignee': "TEXT",
    'request': "TEXT NOT NULL DEFAULT ''",
    'acceptance': "TEXT NOT NULL DEFAULT ''",
    'merged_into': "TEXT",
    'note': "TEXT NOT NULL DEFAULT ''",
}


def migrate(d):
    # 新装时 tasks 表在 init 里才建；init 建完会再调一次。
    have = {row[1] for row in d.execute('PRAGMA table_info(tasks)')}
    if not have:
        return
    for name, kind in COLUMNS.items():
        if name not in have:
            d.execute(f'ALTER TABLE tasks ADD COLUMN {name} {kind}')


def departed(d, owner):
    """The owner left the office (actor revoked); its execution can be taken over."""
    return bool(owner) and bool(d.execute('SELECT 1 FROM actors WHERE id=? AND revoked=1', (owner,)).fetchone())


def actor(d, value):
    oid = ident(value)
    if not d.execute('SELECT 1 FROM actors WHERE id=? AND revoked=0', (oid,)).fetchone():
        raise Fault('assignee_missing', 404)
    return oid


def create_fields(d, a, b):
    """Extra columns for task-create; all optional so old clients keep working."""
    assignee = actor(d, b['assignee']) if b.get('assignee') else None
    return {
        'creator': a['id'],
        'assignee': assignee,
        'request': text(b.get('request', ''), 400, empty=True),
        'acceptance': text(b.get('acceptance', ''), 600, empty=True),
    }


def arranger(d, a, t):
    """Leader/deputy of the project, the human owner, or whoever opened the order."""
    return registry.manager(d, a, t['project']) or t['creator'] == a['id']


def write(d, a, action, b, now):
    oid = ident(b.get('id'))
    t = d.execute('SELECT * FROM tasks WHERE id=?', (oid,)).fetchone()
    if not t:
        raise Fault('task_missing', 404)
    t = dict(t)
    if type(b.get('version')) is not int or b['version'] != t['version']:
        raise Fault('version_conflict', 409)
    if not arranger(d, a, t):
        raise Fault('arranger_required', 403)
    note = text(b.get('note', ''), 400, empty=True)
    if action in ('task-close', 'task-merge'):
        if task_policy.unresolved(d, oid):
            raise Fault('task_dispatch_unresolved', 409)
        if t['owner'] and t['status'] in ('doing', 'blocked') and not departed(d, t['owner']):
            raise Fault('task_execution_handoff_required', 409)
    if action == 'task-assign':
        if t['status'] not in OPEN:
            raise Fault('task_closed', 409)
        assignee = actor(d, b.get('assignee'))
        if task_policy.unresolved(d, oid):
            raise Fault('task_dispatch_unresolved', 409)
        if t['owner'] and t['owner'] != assignee and t['status'] in ('doing', 'blocked') and not departed(d, t['owner']):
            raise Fault('task_execution_handoff_required', 409)
        # The responsible worker releases execution before any reassignment.
        status = 'planned' if t['status'] in ('doing', 'blocked') and t['owner'] != assignee else t['status']
        d.execute(
            'UPDATE tasks SET assignee=?,owner=CASE WHEN ?=\'planned\' THEN NULL ELSE owner END,'
            'lease_until=CASE WHEN ?=\'planned\' THEN 0 ELSE lease_until END,status=?,note=?,version=version+1,updated=? WHERE id=?',
            (assignee, status, status, status, note, now, oid),
        )
    elif action == 'task-close':
        if t['status'] not in OPEN:
            raise Fault('task_closed', 409)
        d.execute("UPDATE tasks SET status='cancelled',lease_until=0,note=?,version=version+1,updated=? WHERE id=?", (note, now, oid))
    elif action == 'task-merge':
        target = ident(b.get('into'))
        other = d.execute('SELECT project,status FROM tasks WHERE id=?', (target,)).fetchone()
        if target == oid or not other or other['project'] != t['project'] or other['status'] not in OPEN:
            raise Fault('merge_target_invalid', 409)
        if t['status'] not in OPEN:
            raise Fault('task_closed', 409)
        d.execute(
            "UPDATE tasks SET status='superseded',merged_into=?,lease_until=0,note=?,version=version+1,updated=? WHERE id=?",
            (target, note, now, oid),
        )
    elif action == 'task-return':
        if t['status'] != 'delivered':
            raise Fault('task_not_delivered', 409)
        d.execute(
            "UPDATE tasks SET status='planned',owner=NULL,lease_until=0,note=?,evidence=evidence||?,version=version+1,updated=? WHERE id=?",
            (note, '\n退回：' + (note or '未写原因'), now, oid),
        )
    return task_policy.public(d.execute('SELECT * FROM tasks WHERE id=?', (oid,)).fetchone())
