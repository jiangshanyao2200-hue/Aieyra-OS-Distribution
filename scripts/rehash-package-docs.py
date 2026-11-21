# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: scripts/AGENTS.md | ring 3
# Chains: module-local; query impact before editing
# Regions: refresh
# Impact: python -B scripts/code-atlas.py show scripts/rehash-package-docs.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""Refresh sha256/size of Markdown documents listed in official package manifests.

Documentation edits inside Program/Tool/Agent/SDK packages otherwise break the
package integrity check. Only `.md` entries are touched; code and data payloads
still require a deliberate manifest update. Rebuild Core afterwards (Tool and
Program packages are embedded).
"""
import argparse, hashlib, json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TREES = ('Agent/official', 'Program/official', 'SDK/examples', 'Tool')


def refresh(root=ROOT, write=False):
    changed = []
    for tree in TREES:
        for manifest in sorted((root / tree).rglob('manifest.json')):
            if 'node_modules' in manifest.parts:
                continue
            raw = manifest.read_text(encoding='utf-8')
            data = json.loads(raw)
            if data.get('schema') != 'aieyra.mod/1':
                continue
            dirty = False
            for name, meta in data.get('files', {}).items():
                if not name.endswith('.md'):
                    continue
                payload = (manifest.parent / name).read_bytes()
                digest = hashlib.sha256(payload).hexdigest()
                if meta.get('sha256') != digest or meta.get('size') != len(payload):
                    meta['sha256'], meta['size'] = digest, len(payload)
                    changed.append((manifest.parent / name).relative_to(root).as_posix())
                    dirty = True
            if dirty and write:
                indent = 2 if raw.startswith('{\n  ') else (1 if raw.startswith('{\n ') else None)
                manifest.write_text(json.dumps(data, ensure_ascii=False, indent=indent) + ('\n' if raw.endswith('\n') else ''), encoding='utf-8')
    return changed


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write', action='store_true', help='update manifests (default: report only)')
    args = parser.parse_args()
    rows = refresh(write=args.write)
    print(json.dumps({'ok': True, 'written': args.write, 'documents': rows}, ensure_ascii=False, indent=1))
