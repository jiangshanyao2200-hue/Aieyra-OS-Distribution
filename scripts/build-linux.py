# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: scripts/AGENTS.md | ring 3
# Chains: module-local; query impact before editing
# Regions: build
# Impact: python -B scripts/code-atlas.py show scripts/build-linux.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""Build the current Linux CLI from the same CORE as the desktop."""
import importlib.util
import argparse, hashlib, json, os, re, shutil, struct, subprocess, tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def build(arch,existing=None):
    version = re.search(r'var Version = "([^"]+)"', (ROOT/'Core/host/app.go').read_text(encoding='utf-8')).group(1)
    directory = ROOT/'build'/('linux-'+arch)
    directory.mkdir(parents=True, exist_ok=True)
    executable = directory/'aieyra-os'
    temporary = directory/'.aieyra-os.tmp'
    if temporary.exists():
        raise RuntimeError('Unfinished build exists; inspect it before rebuilding')
    env = {**os.environ, 'GOOS':'linux', 'GOARCH':arch, 'CGO_ENABLED':'0'}
    if existing:
        shutil.copyfile(existing,temporary)
    else:
        subprocess.run([shutil.which('go'), '-C', str(ROOT/'Core'), 'build', '-trimpath', '-ldflags',
                        '-s -w -X github.com/aieyra/aieyra-os/CORE/host.Version='+version, '-o', str(temporary), './cmd/aieyra-os'], env=env, check=True)
    with temporary.open('rb') as f:
        header = f.read(64)
    machine = {'amd64': 62, 'arm64': 183}[arch]
    if len(header) != 64 or header[:6] != b'\x7fELF\x02\x01' or struct.unpack_from('<H', header, 18)[0] != machine:
        raise RuntimeError('Expected a 64-bit Linux ELF for '+arch)
    os.replace(temporary, executable)
    distribution = ROOT/'build/distribution'
    distribution.mkdir(parents=True, exist_ok=True)
    archive = distribution/('aieyra-os-linux-'+arch+'.tar.gz')
    archive_tmp = archive.with_suffix('.tmp')
    files = {'aieyra-os':executable, 'install.sh':ROOT/'scripts/install-linux.sh', 'README.md':ROOT/'scripts/LINUX-README.md'}
    resource_spec = importlib.util.spec_from_file_location('product_resources', ROOT/'scripts/resources.py')
    resources = importlib.util.module_from_spec(resource_spec); resource_spec.loader.exec_module(resources)
    files.update(resources.public_resource_files(ROOT))
    with tarfile.open(archive_tmp,'w:gz',format=tarfile.PAX_FORMAT) as package:
        for name,p in sorted(files.items()):
            info=package.gettarinfo(str(p),arcname='aieyra-os/'+name)
            info.uid=info.gid=0; info.uname=info.gname=''; info.mode=0o755 if name in {'aieyra-os','install.sh'} else 0o644
            with p.open('rb') as f: package.addfile(info,f)
    os.replace(archive_tmp,archive)
    digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
    manifest={'schema':1,'application_id':'aieyra.os','version':version,'platform':'linux','architecture':arch,
              'file':archive.name,'bytes':archive.stat().st_size,'sha256':digest(archive),
              'executable_sha256':digest(executable),'executable_bytes':executable.stat().st_size,
              'entry':'aieyra-os/aieyra-os','dependencies':[],
              'permissions':['user-selected-workspace-files','user-authorized-shell','configured-model-network','private-session-state'],
              'commands':{'install':'sh install.sh','start':'aieyra-os chat','status':'aieyra-os sessions','serve':'aieyra-os serve','uninstall':'sh install.sh --uninstall'},
              'validation':{'built_from_core':not bool(existing),'imported_build':bool(existing),'native_execution':'pending'}}
    (distribution/('aieyra-os-linux-'+arch+'.json')).write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(manifest,ensure_ascii=False))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--arch',choices=['amd64','arm64'],default='amd64')
    parser.add_argument('--executable',type=Path,help='Import a separately verified build of this exact source')
    args=parser.parse_args()
    build(args.arch,args.executable)
