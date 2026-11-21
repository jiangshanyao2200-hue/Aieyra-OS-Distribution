# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: scripts/AGENTS.md | ring 3
# Chains: module-local; query impact before editing
# Regions: digest; verify; install
# Impact: python -B scripts/code-atlas.py show scripts/provision-media.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""Install or verify the pinned Windows video runtime from a local archive.

No system PATH or global codec installation is changed. The source archive,
upstream license and build information remain associated with the runtime.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import uuid
import zipfile

ROOT = Path(__file__).resolve().parents[1]
LOCK = json.loads(Path(__file__).with_name('media-runtime.lock.json').read_text(encoding='utf-8'))


def digest(file):
    h = hashlib.sha256()
    with file.open('rb') as stream:
        for block in iter(lambda: stream.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()


def verify(target):
    if target.is_symlink():
        raise ValueError('Linked media runtime')
    receipt = json.loads((target / 'runtime-manifest.json').read_text(encoding='utf-8'))
    names = set(LOCK['files'].values())
    if receipt.get('lock') != LOCK or set(receipt.get('files', {})) != names:
        raise ValueError('Media runtime does not match the pinned lock')
    if {p.name for p in target.iterdir()} != names | {'runtime-manifest.json'}:
        raise ValueError('Media runtime contains missing or untracked files')
    for name, expected in receipt['files'].items():
        file = target / name
        if file.is_symlink() or not file.is_file() or digest(file) != expected:
            raise ValueError('Media runtime changed: ' + name)
    return receipt


def install(archive, target):
    if target.exists():
        return verify(target)
    if archive.is_symlink() or digest(archive) != LOCK['sha256']:
        raise ValueError('Media archive does not match the upstream SHA256')
    stage = target.with_name(target.name + '.install-' + uuid.uuid4().hex)
    stage.mkdir(parents=True)
    try:
        with zipfile.ZipFile(archive) as package:
            for member, name in LOCK['files'].items():
                entry = package.getinfo(LOCK['prefix'] + member)
                if entry.file_size > 128 << 20 or entry.is_dir():
                    raise ValueError('Invalid media runtime member: ' + member)
                with package.open(entry) as source, (stage / name).open('xb') as output:
                    shutil.copyfileobj(source, output)
        receipt = {'schema': 1, 'lock': LOCK,
                   'files': {name: digest(stage / name) for name in LOCK['files'].values()}}
        (stage / 'runtime-manifest.json').write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8')
        verify(stage)
        stage.rename(target)
        return receipt
    except BaseException:
        # Only the newly created, owned staging directory is removed.
        shutil.rmtree(stage)
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path)
    parser.add_argument('--target', type=Path, default=ROOT / 'runtime/media')
    parser.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    if not args.verify_only and not args.archive:
        parser.error('--archive is required for installation')
    receipt = verify(args.target) if args.verify_only else install(args.archive, args.target)
    print(json.dumps({'status': 'verified', 'version': LOCK['version'], 'files': len(receipt['files'])}))
