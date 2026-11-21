# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: scripts/AGENTS.md | ring 3
# Chains: module-local; query impact before editing
# Regions: load; now; canonical; outside; file_identity; selected_sources; source_manifest; write_json; begin; verify; main
# Impact: python -B scripts/code-atlas.py show scripts/build-provenance.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""Freeze reviewed product sources for one build, without reading private data."""
import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import stat
import sys
import tempfile
import uuid

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = 'aieyra.build/1'
MODULE_LAUNCHERS = json.loads((ROOT / 'Client/Desktop/host/module-launchers.json').read_text(encoding='utf-8'))
ARTIFACTS = ('Aieyra OS.exe', 'Aieyra CLI.exe', *(name + '.exe' for name in MODULE_LAUNCHERS.values()))


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


privacy = load('build_public_privacy', 'public-privacy.py')
runtime = load('build_runtime_files', 'runtime-files.py')


def now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')


def outside(root, path):
    path = Path(path).resolve()
    if path.is_relative_to(root):
        raise ValueError('Build receipts must be outside the product source root')
    return path


def file_identity(root, path, *, capture=None):
    path = Path(path)
    if not path.is_relative_to(root):
        raise ValueError('Source inventory points outside the product root')
    for item in (path, *path.parents):
        if item == root:
            break
        attrs = getattr(item.lstat(), 'st_file_attributes', 0)
        if item.is_symlink() or attrs & getattr(stat, 'FILE_ATTRIBUTE_REPARSE_POINT', 0):
            raise ValueError('Build source is redirected: ' + path.relative_to(root).as_posix())
    before = path.stat()
    if not stat.S_ISREG(before.st_mode):
        raise ValueError('Build source is not a file: ' + path.relative_to(root).as_posix())
    if capture is not None and before.st_size > 1024 * 1024:
        raise ValueError('Package manifest exceeds size limit: ' + path.relative_to(root).as_posix())
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
            if capture is not None:
                capture.append(chunk)
                if sum(map(len, capture)) > 1024 * 1024:
                    raise ValueError('Package manifest exceeds size limit: ' + path.relative_to(root).as_posix())
    after = path.stat()
    if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (
            after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns):
        raise ValueError('Build source changed while reading: ' + path.relative_to(root).as_posix())
    return {'size': after.st_size, 'sha256': digest.hexdigest()}


def selected_sources(root):
    return runtime.runtime_files(privacy.source_files(root))


def source_manifest(root, *, check_packages=False):
    root = Path(root).resolve()
    selected = selected_sources(root)
    files, manifests = {}, {}
    for name, path in sorted(selected.items()):
        capture = [] if check_packages and name.endswith('/manifest.json') else None
        files[name] = {'source': path.relative_to(root).as_posix(),
                       **file_identity(root, path, capture=capture)}
        if capture is not None:
            manifests[name] = b''.join(capture)
    if selected != selected_sources(root):
        raise ValueError('Build source inventory changed while reading')
    result = {'source_digest': hashlib.sha256(canonical(files)).hexdigest(), 'files': files}
    if check_packages:
        # Reuse the export oracle and the hashes just collected. Manifest names
        # can only refer to this reviewed inventory; never collect extra paths.
        protected = privacy.development.exact_package_files(manifests, identity=files.get)
        result['package_payload_files'] = len(protected)
    return result


def write_json(path, value, *, initial=False):
    data = json.dumps(value, ensure_ascii=False, indent=2) + '\n'
    if initial:
        with path.open('x', encoding='utf-8', newline='\n') as stream:
            stream.write(data)
        return
    stage = path.with_name(path.name + '.tmp.' + uuid.uuid4().hex)
    try:
        with stage.open('x', encoding='utf-8', newline='\n') as stream:
            stream.write(data)
        stage.replace(path)
    finally:
        stage.unlink(missing_ok=True)


def begin(root=ROOT, receipt_dir=None):
    root = Path(root).resolve()
    directory = outside(root, receipt_dir or tempfile.gettempdir())
    source = source_manifest(root, check_packages=True)
    build_id = uuid.uuid4().hex
    if receipt_dir is None:
        directory = Path(tempfile.mkdtemp(prefix='aieyra-build-', dir=directory))
    else:
        directory.mkdir(parents=True, exist_ok=True)
    path = directory / ('build-' + build_id + '.json')
    value = {'schema': SCHEMA, 'status': 'prepared', 'root': str(root),
             'build_id': build_id, 'built_at': now(), **source}
    write_json(path, value, initial=True)
    return {key: value[key] for key in ('build_id', 'source_digest', 'built_at', 'package_payload_files')} | {'snapshot': str(path)}


def verify(root, snapshot, *, complete=False):
    root = Path(root).resolve()
    if Path(snapshot).is_symlink():
        raise ValueError('Build receipt is redirected')
    path = outside(root, snapshot)
    original = path.read_bytes()
    value = json.loads(original)
    if (value.get('schema') != SCHEMA or value.get('status') not in {'prepared', 'complete'}
            or value.get('root') != str(root)
            or not re.fullmatch(r'[a-f0-9]{32}', value.get('build_id', ''))
            or not re.fullmatch(r'[a-f0-9]{64}', value.get('source_digest', ''))
            or not re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ', value.get('built_at', ''))
            or not isinstance(value.get('files'), dict)
            or hashlib.sha256(canonical(value['files'])).hexdigest() != value['source_digest']):
        raise ValueError('Build receipt identity is invalid')
    current = source_manifest(root)
    if current['source_digest'] != value['source_digest']:
        changed = sorted(name for name in value['files'].keys() | current['files'].keys()
                         if value['files'].get(name) != current['files'].get(name))
        raise ValueError('Build sources changed: ' + ', '.join(changed[:20]))
    if complete:
        if value['status'] != 'prepared':
            raise ValueError('Build receipt is already complete')
        value['artifacts'] = {name: file_identity(root, root / name) for name in ARTIFACTS}
        # Recheck sources after hashing outputs; never report a mixed build complete.
        if source_manifest(root)['source_digest'] != value['source_digest']:
            raise ValueError('Build sources changed while collecting artifacts')
        value.update(status='complete', completed_at=now())
        if path.read_bytes() != original:
            raise ValueError('Build receipt changed during verification')
        write_json(path, value)
    return {'ok': True, 'status': value['status'], 'build_id': value['build_id'],
            'source_digest': value['source_digest'], 'built_at': value['built_at'],
            'files': len(value['files']), 'snapshot': str(path)}


def main(argv=None):
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, 'reconfigure'):
            stream.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='action', required=True)
    start = commands.add_parser('begin')
    start.add_argument('--root', type=Path, default=ROOT)
    start.add_argument('--receipt-dir', type=Path)
    check = commands.add_parser('verify')
    check.add_argument('--root', type=Path, default=ROOT)
    check.add_argument('--snapshot', type=Path, required=True)
    check.add_argument('--complete', action='store_true')
    args = parser.parse_args(argv)
    try:
        result = (begin(args.root, args.receipt_dir) if args.action == 'begin'
                  else verify(args.root, args.snapshot, complete=args.complete))
    except (OSError, ValueError) as error:
        parser.exit(1, str(error) + '\n')
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
