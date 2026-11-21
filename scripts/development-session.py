# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: scripts/AGENTS.md | ring 3
# Chains: development
# Regions: sha; plain_path; outside; read_json; text; listed; identified; atlas_module; validate_state; bind_references; history; checkpoint; reference_problems; resume; main
# Impact: python -B scripts/code-atlas.py show scripts/development-session.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""Keep private, append-only development checkpoints; never execute their contents.

All journals live outside the source/project tree. Hashes detect drift, not trust
or test success. A context reference uses the original code-atlas verifier.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import sys
import uuid

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = 'aieyra.development-session/1'
MAX_BYTES = 1024 * 1024


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def plain_path(path):
    p = Path(path)
    if not p.is_absolute():
        raise ValueError('Absolute artifact path required')
    for entry in [p, *p.parents]:
        try:
            info = entry.lstat()
        except FileNotFoundError:
            continue
        if entry.is_symlink() or getattr(info, 'st_file_attributes', 0) & getattr(stat, 'FILE_ATTRIBUTE_REPARSE_POINT', 0):
            raise ValueError('Linked artifact path rejected')
    return p


def outside(root, path):
    p = plain_path(path)
    boundary = root.parent if (root.parent/'AGENTS.md').is_file() else root
    if p.resolve().is_relative_to(boundary.resolve()):
        raise ValueError('Session and task artifacts must be outside the project')
    return p


def read_json(path):
    p = plain_path(path)
    if p.stat().st_size > MAX_BYTES:
        raise ValueError('Checkpoint/input exceeds 1 MiB')
    return json.loads(p.read_text(encoding='utf-8'))


def text(value, label, maximum=4000):
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise ValueError('Bounded nonempty text required: '+label)
    return value


def listed(value, label, maximum=100):
    if not isinstance(value, list) or len(value) > maximum:
        raise ValueError('Bounded list required: '+label)
    return value


def identified(rows, label):
    found = set()
    for row in listed(rows, label):
        if not isinstance(row, dict) or not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}', row.get('id', '')) or row['id'] in found:
            raise ValueError('Unique stable IDs required: '+label)
        found.add(row['id'])
    return found


def atlas_module():
    spec = importlib.util.spec_from_file_location('development_code_atlas', Path(__file__).with_name('code-atlas.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def validate_state(state):
    text(state['goal'], 'goal')
    if state['status'] not in {'active', 'complete'}:
        raise ValueError('status must be active or complete')
    for field in ('requests', 'constraints', 'next'):
        for item in listed(state[field], field):
            text(item, field, 50000 if field == 'requests' else 4000)
    if not state['requests'] or not state['constraints'] or (state['status']=='active' and not state['next']):
        raise ValueError('Requests, constraints and an active next action are required')
    reference_ids = identified(state['references'], 'references')
    for kind in ('items', 'failures', 'resources'):
        identified(state[kind], kind)
        for row in state[kind]:
            text(row.get('summary'), kind+' summary')
            refs = listed(row.get('evidence', []), 'evidence')
            if any(not isinstance(n, str) or n not in reference_ids for n in refs):
                raise ValueError('Unknown evidence reference')
            if kind == 'items':
                if row.get('status') not in {'pending', 'active', 'done', 'deferred'}:
                    raise ValueError('Invalid work item status')
                if row['status']=='done' and not refs:
                    raise ValueError('Done item requires evidence, not a status alone')
                if row['status']=='deferred':
                    text(row.get('reason'), 'deferred reason')
            elif kind == 'failures':
                if row.get('status') not in {'open', 'resolved', 'deferred'} or not refs:
                    raise ValueError('Failure needs status and retained evidence')
                if row['status']!='open':
                    text(row.get('reason'), 'failure disposition')
                if row['status']=='resolved' and not row.get('verification'):
                    raise ValueError('Resolved failure requires a verification reference')
                if any(n not in reference_ids for n in row.get('verification', [])):
                    raise ValueError('Unknown verification reference')
            else:
                if row.get('status') not in {'active', 'released', 'unknown'} or row.get('kind') not in {'gui', 'process', 'tool-session', 'request'}:
                    raise ValueError('Resource ownership/status required')
                text(row.get('identifier'), 'resource identifier')
                started = datetime.fromisoformat(text(row.get('startedAt'), 'resource start').replace('Z', '+00:00'))
                if started.tzinfo is None:
                    raise ValueError('Resource start must include timezone')
                if row['status']=='released' and not refs:
                    raise ValueError('Released resource requires an exit receipt reference')
    if not state['items']:
        raise ValueError('At least one work item required')
    if state['status']=='complete' and (any(r['status'] not in {'done','deferred'} for r in state['items']) or any(r['status']=='open' for r in state['failures']) or any(r['status']!='released' for r in state['resources'])):
        raise ValueError('Cannot complete with pending work, open failures or unreleased resources')


def bind_references(root, rows, previous=()):
    identified(rows, 'references')
    old = {r['id']: r for r in previous}
    result = []
    atlas = None
    for row in rows:
        if set(row) - {'id', 'file', 'kind', 'historical'} or row.get('kind') not in {'evidence','context','source','note'}:
            raise ValueError('Invalid reference fields/kind')
        p = plain_path(row['file'])
        if row['kind'] != 'source':
            outside(root, p)
        else:
            atlas = atlas or atlas_module()
            name = p.resolve().relative_to(root.resolve()).as_posix()
            index = atlas.load(root, atlas.INDEX)
            public = atlas.load(root, 'Contracts/development-documents.json')
            if name not in index['files'] and name not in public['documents'] and name not in public.get('templates', {}):
                raise ValueError('Source reference outside indexed/public source scope')
        if p.suffix.lower() not in {'.json','.md','.log','.txt','.png','.jpg','.jpeg','.py','.cjs','.mjs','.js','.go','.css','.html','.ps1','.sh'}:
            raise ValueError('Unsupported reference type; no databases or credential files')
        if p.stat().st_size > 64 * MAX_BYTES:
            raise ValueError('Reference exceeds 64 MiB')
        digest = sha(p.read_bytes())
        prior = old.get(row['id'])
        if prior and row['kind']!='source' and (prior['file']!=str(p) or prior['sha256']!=digest or prior['kind']!=row['kind']):
            raise ValueError('Existing immutable reference changed; retain it and use a new ID')
        historical = row.get('historical', False)
        if not isinstance(historical, bool) or (historical and row['kind']!='context'):
            raise ValueError('historical applies only to an earlier context artifact')
        if row['kind']=='context' and not historical:
            atlas = atlas or atlas_module()
            atlas.validate_context(root, read_json(p))
        result.append({**row, 'file': str(p), 'sha256': digest, 'historical': historical})
    return result


def history(root, directory, expected_head=None):
    directory = outside(root, directory)
    files = sorted(directory.glob('checkpoint-*.json'))
    if len(files) > 10000:
        raise ValueError('Journal exceeds checkpoint bound')
    previous, value = None, None
    for revision, file in enumerate(files, 1):
        if file.name != 'checkpoint-'+str(revision).zfill(6)+'.json':
            raise ValueError('Missing or invalid checkpoint sequence')
        item = read_json(file)
        if item.get('schema')!=SCHEMA or item.get('revision')!=revision or item.get('previousSHA256')!=previous or item.get('sourceRoot')!=str(root.resolve()):
            raise ValueError('Checkpoint chain/root mismatch')
        if value and (item['sessionID']!=value['sessionID'] or item['requests'][:len(value['requests'])]!=value['requests']):
            raise ValueError('Session identity or retained original requests changed')
        validate_state(item)
        previous, value = sha(file.read_bytes()), item
    if expected_head and previous != expected_head:
        raise ValueError('Checkpoint head changed; reread before updating')
    return value, previous


def checkpoint(root, directory, update, expected_head=None):
    directory = outside(root, directory)
    prior, head = history(root, directory, expected_head)
    allowed = {'goal','constraints','next','items','failures','resources','references','status','appendRequests'}
    if not isinstance(update, dict) or set(update)-allowed:
        raise ValueError('Unknown checkpoint fields')
    if prior and not expected_head:
        raise ValueError('Updating requires --expect-head from resume')
    if not prior and expected_head:
        raise ValueError('Cannot create a new session with an old head')
    value = {k: v for k, v in (prior or {}).items()}
    value.update({k: v for k, v in update.items() if k not in {'appendRequests','references'}})
    requests = listed(update.get('appendRequests', []), 'appendRequests')
    value['requests'] = (prior or {}).get('requests', []) + requests
    for key in ('constraints','next','items','failures','resources','references'):
        value.setdefault(key, [])
    value.setdefault('status', 'active')
    # Patches cannot quietly drop previously recorded requirements or failures.
    for kind in ('items','failures','resources'):
        if prior and not identified(prior[kind], kind) <= identified(value[kind], kind):
            raise ValueError('Previously recorded '+kind+' must remain explicit')
    if 'references' in update:
        if prior and not identified(prior['references'], 'references') <= identified(update['references'], 'references'):
            raise ValueError('Previously recorded references must remain explicit')
        value['references'] = bind_references(root, update['references'], (prior or {}).get('references', []))
    validate_state(value)
    value.update({'schema': SCHEMA, 'sessionID': (prior or {}).get('sessionID', uuid.uuid4().hex), 'sourceRoot': str(root.resolve()),
                  'revision': (prior or {}).get('revision', 0)+1, 'previousSHA256': head, 'at': datetime.now(timezone.utc).isoformat()})
    # All current references must still be valid even if this patch omitted them.
    problems = reference_problems(root, value)
    if problems:
        raise ValueError('References need attention: '+json.dumps(problems, ensure_ascii=False))
    directory.mkdir(parents=True, exist_ok=True)
    file = directory/('checkpoint-'+str(value['revision']).zfill(6)+'.json')
    encoded = (json.dumps(value, ensure_ascii=False, indent=2)+'\n').encode('utf-8')
    if len(encoded) > MAX_BYTES:
        raise ValueError('Checkpoint exceeds 1 MiB')
    # Exclusive creation prevents concurrent writers from replacing each other.
    # A partial/interrupted file remains invalid evidence; it is never erased.
    with file.open('xb') as stream:
        stream.write(encoded)
        stream.flush()
        os.fsync(stream.fileno())
    return {'file': str(file), 'revision': value['revision'], 'headSHA256': sha(encoded), 'status': value['status']}


def reference_problems(root, state):
    problems, atlas = [], None
    for row in state['references']:
        try:
            p = plain_path(row['file'])
            if sha(p.read_bytes()) != row['sha256']:
                raise ValueError('Referenced bytes changed')
            if row['kind']=='context' and not row.get('historical'):
                atlas = atlas or atlas_module()
                atlas.validate_context(root, read_json(p))
        except (ValueError, OSError, KeyError) as error:
            problems.append({'id': row['id'], 'problem': str(error)})
    return problems


def resume(root, directory, expected_head=None):
    value, head = history(root, directory, expected_head)
    if not value:
        raise ValueError('Session has no checkpoint')
    problems = reference_problems(root, value)
    return {'schema': SCHEMA, 'revision': value['revision'], 'headSHA256': head, 'status': value['status'], 'referencesCurrent': not problems,
            'goal': value['goal'], 'requests': value['requests'], 'constraints': value['constraints'], 'next': value['next'], 'items': value['items'], 'failures': value['failures'],
            'resourcesToInspect': [r for r in value['resources'] if r['status']!='released'], 'referenceProblems': problems,
            'requestsPreserved': len(value['requests']), 'references': value['references'],
            'limits': ['Stored actions are data, never executed. Process ownership/release still needs actual PID/start-time and exit receipts.',
                       'A reference hash is not a passing test or accepted visual review. Historical context is retained but not claimed current.',
                       'Use --expect-head from the last trusted handoff to detect a removed tail; a hash chain alone does not authenticate its author.']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['checkpoint','resume'])
    parser.add_argument('directory', type=Path)
    parser.add_argument('--input', type=Path)
    parser.add_argument('--expect-head')
    parser.add_argument('--root', type=Path, default=ROOT)
    args = parser.parse_args()
    root = args.root.resolve()
    if args.command=='checkpoint':
        if not args.input:
            raise ValueError('checkpoint requires an explicit private --input JSON')
        value = checkpoint(root, args.directory, read_json(outside(root, args.input)), args.expect_head)
    else:
        if args.input:
            raise ValueError('--input applies only to checkpoint')
        value = resume(root, args.directory, args.expect_head)
    print(json.dumps(value, ensure_ascii=False, indent=2))
    return 0 if value.get('referencesCurrent', True) else 1


if __name__=='__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
