# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: scripts/AGENTS.md | ring 3
# Chains: module-local; query impact before editing
# Regions: checked_path; validate
# Impact: python -B scripts/code-atlas.py show scripts/check-project-map.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""Validate the current module map against files, agreements and local doc links.

Reads declared public paths only; never opens Data, user work, credentials or SQLite.
It checks navigation consistency, not the truth of a module's implementation status.
"""
import argparse
import importlib.util
import json
import re
from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
MODULES = ('Core', 'Desktop', 'Control', 'Link', 'Contracts', 'API', 'Agent',
           'Client', 'Context', 'Halo', 'Program', 'SDK', 'Theme', 'Tool', 'AIDEBUG', 'scripts')
PRIVATE = {'Data', '工作目录', 'node_modules', '.git', '__pycache__'}
LINK = re.compile(r'!?\[[^\]\n]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\)')


def checked_path(root, name, directory=False):
    if not isinstance(name, str) or not name or '\\' in name or ':' in name:
        raise ValueError('invalid relative path')
    p = PurePosixPath(name)
    if p.is_absolute() or any(part in {'.', '..'} | PRIVATE for part in p.parts):
        raise ValueError('private or escaping path')
    current = root
    for part in p.parts:
        current /= part
        if current.is_symlink():
            raise ValueError('linked path')
    if not (current.is_dir() if directory else current.is_file()):
        raise ValueError('missing directory' if directory else 'missing file')
    return current


def validate(root=ROOT, document=None):
    root = Path(root).resolve()
    failures, checked_docs = [], set()
    try:
        doc = document if document is not None else json.loads((root / 'docs/工程地图.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {'ok': False, 'failures': ['docs/工程地图.json: missing or invalid JSON']}
    if not isinstance(doc, dict) or doc.get('schema') != 'aieyra.project-map/1' or not isinstance(doc.get('modules'), list) or not doc['modules']:
        return {'ok': False, 'failures': ['invalid project-map schema']}
    ids, paths = set(), set()
    unavailable = {}
    if doc.get('distribution', {}).get('kind') == 'public-source':
        spec = importlib.util.spec_from_file_location('map_privacy', Path(__file__).with_name('public-privacy.py'))
        privacy = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(privacy)
        inventory = privacy.source_files(root)
        expected = privacy.development.map_distribution(doc, inventory)
        if doc['distribution'] != expected:
            failures.append('map distribution does not match exported files')
        unavailable = expected['unavailable']
    manifest_path = root / 'Contracts/development-documents.json'
    templates = json.loads(manifest_path.read_text(encoding='utf-8'))['templates'] if manifest_path.is_file() else {}
    template_targets = {origin: target for target, origin in templates.items()}
    for index, item in enumerate(doc['modules']):
        label = f'modules[{index}]'
        if not isinstance(item, dict):
            failures.append(label + ': expected object'); continue
        mid = item.get('id')
        if not isinstance(mid, str) or not re.fullmatch(r'[a-z0-9][a-z0-9._-]*', mid) or mid in ids:
            failures.append(label + ': invalid or duplicate id')
        else:
            ids.add(mid); label = mid
        module_path = item.get('path')
        omitted = unavailable.get(mid, {}) if isinstance(mid, str) else {}
        try:
            omitted_module = isinstance(module_path, str) and bool(omitted) and item.get('agreement') in omitted['agreement'] and all(
                isinstance(item.get(field), list) and all(isinstance(name, str) and
                    (not name.startswith(module_path + '/') or name in omitted[field]) for name in item[field])
                for field in ('entries', 'documents'))
            try:
                checked_path(root, module_path, directory=True)
            except ValueError as error:
                if not (omitted_module and str(error) == 'missing directory'):
                    raise
            if module_path in paths: raise ValueError('duplicate module path')
            paths.add(module_path)
        except ValueError as error:
            failures.append(label + ': ' + str(error))
        if not isinstance(item.get('status'), str) or item['status'] not in {'active', 'compatibility', 'contract'}:
            failures.append(label + ': invalid status')
        if not isinstance(item.get('data_ownership'), str) or not item['data_ownership'].strip():
            failures.append(label + ': data ownership missing')
        agreement = item.get('agreement')
        if isinstance(module_path, str) and agreement != module_path + '/AGENTS.md':
            failures.append(label + ': agreement must belong to its module directory')
        for field in ('entries', 'documents', 'verification', 'pending', 'depends_on'):
            values = item.get(field)
            if not isinstance(values, list) or any(not isinstance(v, str) or not v.strip() for v in values):
                failures.append(label + ': invalid ' + field); continue
            if field in {'entries', 'verification'} and not values:
                failures.append(label + ': empty ' + field)
            if field in {'entries', 'documents'}:
                for value in values:
                    if value in omitted.get(field, []):
                        continue
                    try:
                        checked_path(root, value)
                        if value.endswith('.md'): checked_docs.add(value)
                    except ValueError as error:
                        failures.append(label + ': ' + value + ': ' + str(error))
        try:
            if agreement not in omitted.get('agreement', []):
                checked_path(root, agreement); checked_docs.add(agreement)
        except ValueError as error:
            failures.append(label + ': agreement: ' + str(error))
    for item in doc['modules']:
        if not isinstance(item, dict) or not isinstance(item.get('depends_on'), list): continue
        for dep in item['depends_on']:
            if isinstance(dep, str) and (dep not in ids or dep == item.get('id')):
                failures.append(str(item.get('id')) + ': unknown/self dependency ' + dep)
    for name in MODULES:
        if (root / name).is_dir() and not any(p == name or p.startswith(name + '/') for p in paths):
            failures.append(name + ': module absent from map')
    if (root / 'docs/工程地图.md').is_file(): checked_docs.add('docs/工程地图.md')
    for name in sorted(checked_docs):
        text = (root / name).read_text(encoding='utf-8')
        text = re.sub(r'```[^\n]*\n.*?```', '', text, flags=re.S)
        for match in LINK.finditer(text):
            target = match.group(1) or match.group(2)
            parts = urlsplit(target)
            if parts.scheme or parts.netloc or not parts.path: continue
            relative = (Path(template_targets.get(name, name)).parent / unquote(parts.path)).as_posix()
            # Normalize local ../ links while keeping traversal inside this project.
            candidate = root / relative
            try:
                cursor = root
                for part in Path(relative).parts:
                    cursor /= part
                    if cursor.is_symlink(): raise ValueError('linked doc ancestor')
                resolved = candidate.resolve().relative_to(root).as_posix()
                if candidate.is_symlink(): raise ValueError('linked doc target')
                checked_path(root, resolved, directory=candidate.is_dir())
            except (ValueError, OSError):
                failures.append(name + ': invalid local link ' + target)
    return {'ok': not failures, 'schema': doc['schema'], 'modules': len(doc['modules']),
            'documents_checked': len(checked_docs), 'failures': failures,
            'scope': 'declared module paths and local links; implementation/GUI acceptance is separate'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    args = parser.parse_args()
    result = validate(args.root)
    print(json.dumps(result, ensure_ascii=False))
    raise SystemExit(0 if result['ok'] else 1)
