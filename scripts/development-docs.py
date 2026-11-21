# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: scripts/AGENTS.md | ring 3
# Chains: development
# Regions: linked; source_files; available; link_target; map_distribution; exact_package_files; project_markdown; prepare; document_contents; validate_paths; prepare_paths; validate
# Impact: python -B scripts/code-atlas.py show scripts/development-docs.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""Select explicit developer documents and describe public-source availability.

Never reads stage ledgers or follows Markdown links to collect more files.
The source map remains intact; only exported bytes carry distribution metadata.
"""
import argparse
import hashlib
import importlib.util
import json
import posixpath
import re
import stat
from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = json.loads((ROOT / 'Contracts/development-documents.json').read_text(encoding='utf-8'))
DOCUMENTS = frozenset(MANIFEST['documents']) | frozenset(MANIFEST['templates'])
LINK = re.compile(r'!?\[([^\]\n]*)\]\((?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\)')
FENCES = re.compile(r'(^[ \t]*```[^\n]*\n.*?^[ \t]*```[^\n]*(?:\n|$))', re.M | re.S)
MAP = 'docs/工程地图.json'
TEMPLATE_TARGETS = {origin: target for target, origin in MANIFEST['templates'].items()}
ENGINE_PREFIXES = ('Client/Desktop/node_modules/', 'Core/tools/runtime/', 'runtime/search/',
                   'Control/app/runtime/', 'Link/app/runtime/')


def linked(path):
    if not path.exists() and not path.is_symlink():
        return False
    attributes = getattr(path.lstat(), 'st_file_attributes', 0)
    return path.is_symlink() or bool(attributes & getattr(stat, 'FILE_ATTRIBUTE_REPARSE_POINT', 0))


def source_files(root=ROOT, strict=False):
    root = Path(root)
    exported = False
    map_path = root
    for part in PurePosixPath(MAP).parts:
        map_path /= part
        if linked(map_path):
            raise ValueError('development_document_symlink: ' + MAP)
    if map_path.is_file():
        document = json.loads(map_path.read_text(encoding='utf-8'))
        exported = document.get('distribution', {}).get('kind') == 'public-source'
    for name in sorted(DOCUMENTS):
        # An exported checkout's actual root navigation is authoritative. The
        # private workspace alone substitutes its reviewed public templates.
        origin = name if exported else MANIFEST['templates'].get(name, name)
        path = PurePosixPath(origin)
        if path.is_absolute() or '..' in path.parts or '\\' in origin or ':' in origin or path.suffix not in {'.md', '.json'}:
            raise ValueError('invalid development document path: ' + name)
        target = root
        for part in path.parts:
            target /= part
            if linked(target):
                raise ValueError('development_document_symlink: ' + name)
        if target.is_file():
            yield name, target
        elif strict:
            raise ValueError('development_document_missing: ' + name)


def available(name, files):
    return name in files or any(path.startswith(name.rstrip('/') + '/') for path in files)


def link_target(name, target):
    parts = urlsplit(target)
    if parts.scheme or parts.netloc or not parts.path:
        return None
    name = TEMPLATE_TARGETS.get(name, name)
    resolved = posixpath.normpath(posixpath.join(posixpath.dirname(name), unquote(parts.path)))
    if resolved == '..' or resolved.startswith('../') or resolved.startswith('/'):
        return ''
    return resolved


def map_distribution(document, files):
    return {
        'kind': 'public-source',
        'meaning': 'File availability only; implementation and acceptance status are unchanged.',
        'unavailable': {
            item['id']: {
                'entries': [name for name in item['entries'] if name not in files],
                'documents': [name for name in item['documents'] if name not in files],
                'agreement': [] if item['agreement'] in files else [item['agreement']],
            }
            for item in document['modules']
        },
    }


def exact_package_files(files, *, identity=None):
    """Check declared payloads using bytes or already measured source identities."""
    if identity is None:
        def identity(name):
            payload = files.get(name)
            return None if payload is None else {
                'size': len(payload), 'sha256': hashlib.sha256(payload).hexdigest()}
    protected = set()
    for name, data in files.items():
        if not name.endswith('/manifest.json'):
            continue
        manifest = json.loads(data)
        if manifest.get('schema') != 'aieyra.mod/1':
            continue
        protected.add(name)
        for relative, expected in manifest['files'].items():
            target = posixpath.join(posixpath.dirname(name), relative)
            actual = identity(target)
            if (actual is None or actual['size'] != expected['size']
                    or actual['sha256'] != expected['sha256']):
                raise ValueError('development_package_payload_mismatch: ' + target)
            protected.add(target)
    return protected


def project_markdown(name):
    return name.endswith('.md') and not name.startswith(ENGINE_PREFIXES)


def prepare(files):
    files = dict(files)
    protected = exact_package_files(files)
    document = json.loads(files[MAP])
    document['distribution'] = map_distribution(document, files)
    files[MAP] = (json.dumps(document, ensure_ascii=False, indent=2) + '\n').encode()
    unavailable = []
    for name, data in list(files.items()):
        if not project_markdown(name) or name in protected:
            continue
        chunks = FENCES.split(data.decode('utf-8-sig'))
        def replace(match):
            target = match.group(2) or match.group(3)
            resolved = link_target(name, target)
            if resolved is None or resolved and available(resolved, files):
                return match.group()
            unavailable.append({'document': name, 'target': target, 'source_path': resolved})
            label = match.group(1)
            return label + '（未随开发包提供：`' + (resolved or target).replace('`', '') + '`）'
        for index in range(0, len(chunks), 2):
            chunks[index] = LINK.sub(replace, chunks[index])
        files[name] = ''.join(chunks).encode()
    result = validate(files)
    if not result['ok']:
        raise ValueError(json.dumps(result, ensure_ascii=False))
    return files, {'documents': sum(name.endswith('.md') for name in files),
                   'unavailable_links': unavailable, 'map_modules': len(document['modules'])}


def document_contents(paths):
    """Read navigation and exact signed payloads from their selected origins."""
    content = {name: path.read_bytes() if project_markdown(name) or name.endswith('/manifest.json') or name == MAP else b''
               for name, path in paths.items()}
    for name, data in list(content.items()):
        if not name.endswith('/manifest.json'):
            continue
        manifest = json.loads(data)
        if manifest.get('schema') == 'aieyra.mod/1':
            for relative in manifest['files']:
                target = posixpath.join(posixpath.dirname(name), relative)
                if target in paths:
                    content[target] = paths[target].read_bytes()
    return content


def validate_paths(paths):
    content = document_contents(paths)
    document = json.loads(content[MAP])
    if document.get('distribution', {}).get('kind') == 'public-source':
        exact_package_files(content)
        return validate(content)
    rendered, _ = prepare(content)
    return validate(rendered)


def prepare_paths(paths, generated):
    """Render package documentation without loading platform engines into RAM."""
    paths = dict(paths)
    content = document_contents(paths)
    rendered, _ = prepare(content)
    for name, data in rendered.items():
        if data != content[name]:
            target = Path(generated) / name
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists():
                raise ValueError('generated development document already exists: ' + name)
            target.write_bytes(data)
            paths[name] = target
    return paths


def validate(files):
    failures = []
    try:
        document = json.loads(files[MAP])
        if document.get('schema') != 'aieyra.project-map/1' or not document.get('modules'):
            raise ValueError('schema')
        if document.get('distribution') != map_distribution(document, files):
            failures.append('map distribution does not match exported files')
    except (KeyError, TypeError, ValueError):
        failures.append('invalid exported project map')
    for name, data in files.items():
        if not project_markdown(name):
            continue
        chunks = FENCES.split(data.decode('utf-8-sig'))
        for index in range(0, len(chunks), 2):
            chunk = chunks[index]
            for match in LINK.finditer(chunk):
                target = match.group(2) or match.group(3)
                resolved = link_target(name, target)
                if resolved is not None and (not resolved or not available(resolved, files)):
                    failures.append(name + ': missing local link ' + target)
    return {'ok': not failures, 'failures': failures,
            'scope': 'exported navigation and declared file availability; not implementation acceptance'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    args = parser.parse_args()
    files = {}
    # Read only the public inventory; running this in a full workspace must not
    # traverse user data or load private stage documents.
    spec = importlib.util.spec_from_file_location('public_privacy', Path(__file__).with_name('public-privacy.py'))
    privacy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(privacy)
    paths = privacy.source_files(args.root)
    for name, path in paths.items():
        for current in [path, *path.parents]:
            if current == args.root:
                break
            if linked(current):
                raise ValueError('linked export file: ' + name)
    result = validate_paths(paths)
    print(json.dumps(result, ensure_ascii=False))
    raise SystemExit(0 if result['ok'] else 1)
