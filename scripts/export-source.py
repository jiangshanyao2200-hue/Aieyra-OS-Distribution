# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: scripts/AGENTS.md | ring 3
# Chains: module-local; query impact before editing
# Regions: export
# Impact: python -B scripts/code-atlas.py show scripts/export-source.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""Create a reviewed public checkout in a new directory, never copy private evidence."""
import argparse, hashlib, importlib.util, json
from pathlib import Path
spec=importlib.util.spec_from_file_location('privacy',Path(__file__).with_name('public-privacy.py'))
privacy=importlib.util.module_from_spec(spec);spec.loader.exec_module(privacy)

def export(destination, known_secrets=()):
    if destination.exists():raise ValueError('Destination must not exist')
    files={name:path.read_bytes() for name,path in privacy.source_files().items()}
    # Require every explicitly selected document before creating any destination.
    dict(privacy.development.source_files(strict=True))
    rules=privacy.policy();failures=[]
    for name,data in files.items():
        failures.extend({'path':name,'rule':rule} for rule in privacy.validate(name,data,rules,known_secrets))
    if failures:raise ValueError(json.dumps(failures))
    files, documentation = privacy.development.prepare(files)
    for name, data in files.items():
        failures.extend({'path':name,'rule':rule} for rule in privacy.validate(name,data,rules,known_secrets))
    if failures:raise ValueError(json.dumps(failures))
    destination.mkdir(parents=True)
    for name,data in files.items():
        target=destination/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
    assert all((destination/name).read_bytes()==data for name,data in files.items())
    return {'ok':True,'files':len(files),'documentation':documentation,'sha256':{name:hashlib.sha256(data).hexdigest() for name,data in sorted(files.items())}}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('destination',type=Path);parser.add_argument('--receipt',type=Path);args=parser.parse_args();result=export(args.destination)
    if args.receipt:args.receipt.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'ok':result['ok'],'files':result['files']}))
