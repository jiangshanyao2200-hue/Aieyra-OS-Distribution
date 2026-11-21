# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: Control/app/service/AGENTS.md | ring 2
# Chains: module-local; query impact before editing
# Regions: migrate; mentions; public
# Impact: python -B scripts/code-atlas.py show Control/app/service/coordination_core/message_policy.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""Persist explicit actor mentions; never infer recipients from arbitrary body text."""
import json
from .core import Fault, ident


def migrate(database):
    columns = {row[1] for row in database.execute('PRAGMA table_info(messages)')}
    if columns and 'mentions' not in columns:
        database.execute("ALTER TABLE messages ADD COLUMN mentions TEXT NOT NULL DEFAULT '[]'")


def mentions(database, project, values):
    if not isinstance(values, list) or len(values) > 32:
        raise Fault('invalid_message_mentions')
    ids = [ident(value) for value in values]
    if len(set(ids)) != len(ids):
        raise Fault('invalid_message_mentions')
    for actor in ids:
        row = database.execute('SELECT project FROM actors WHERE id=? AND revoked=0', (actor,)).fetchone()
        if not row or project != 'coordination' and row['project'] not in (project, 'coordination'):
            raise Fault('message_mention_target_unavailable', 409)
    return json.dumps(ids)


def public(row):
    value = dict(row)
    value['mentions'] = json.loads(value.get('mentions', '[]'))
    return value
