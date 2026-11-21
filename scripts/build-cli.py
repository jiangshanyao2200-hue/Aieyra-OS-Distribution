# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: scripts/AGENTS.md | ring 3
# Chains: module-local; query impact before editing
# Regions: build
# Impact: python -B scripts/code-atlas.py show scripts/build-cli.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""Build standalone Aieyra CLI packages from the shared CORE, without Electron."""
import importlib.util
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import tarfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def build(platform, arch):
    version = re.search(r'var Version = "([^"]+)"', (ROOT / 'Core/host/app.go').read_text(encoding='utf-8')).group(1)
    directory = ROOT / 'build/cli' / (platform + '-' + arch)
    directory.mkdir(parents=True, exist_ok=True)
    name = 'Aieyra CLI.exe' if platform == 'windows' else 'aieyra-cli'
    executable = directory / name
    temporary = directory / ('.' + name + '.tmp')
    if temporary.exists():
        raise RuntimeError('Inspect unfinished CLI build before rebuilding: ' + str(temporary))
    env = {**os.environ, 'GOOS': platform, 'GOARCH': arch, 'CGO_ENABLED': '0'}
    subprocess.run([shutil.which('go'), '-C', str(ROOT / 'Core'), 'build', '-trimpath', '-ldflags',
                    '-s -w -X github.com/aieyra/aieyra-os/CORE/host.Version=' + version,
                    '-o', str(temporary), './cmd/aieyra-cli'], env=env, check=True)
    with temporary.open('rb') as stream:
        header = stream.read(64)
    if platform == 'windows':
        if header[:2] != b'MZ':
            raise RuntimeError('Expected Windows executable')
    elif len(header) != 64 or header[:6] != b'\x7fELF\x02\x01' or struct.unpack_from('<H', header, 18)[0] != {'amd64': 62, 'arm64': 183}[arch]:
        raise RuntimeError('Unexpected ELF architecture')
    os.replace(temporary, executable)
    distribution = ROOT / 'build/distribution/cli'
    distribution.mkdir(parents=True, exist_ok=True)
    extension = '.zip' if platform == 'windows' else '.tar.gz'
    archive = distribution / ('aieyra-cli-' + platform + '-' + arch + extension)
    archive_tmp = archive.with_name('.' + archive.name + '.tmp')
    files = {name: executable, 'README.md': ROOT / 'scripts/CLI-README.md', 'LICENSE': ROOT / 'LICENSE'}
    if platform != 'windows':
        files['install.sh'] = ROOT / 'scripts/install-cli.sh'
    resource_spec = importlib.util.spec_from_file_location('product_resources', ROOT/'scripts/resources.py')
    resources = importlib.util.module_from_spec(resource_spec); resource_spec.loader.exec_module(resources)
    files.update(resources.public_resource_files(ROOT))
    if platform == 'windows':
        with zipfile.ZipFile(archive_tmp, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as package:
            for entry, source in sorted(files.items()):
                package.write(source, 'aieyra-cli/' + entry)
    else:
        with tarfile.open(archive_tmp, 'w:gz', format=tarfile.PAX_FORMAT) as package:
            for entry, source in sorted(files.items()):
                info = package.gettarinfo(str(source), arcname='aieyra-cli/' + entry)
                info.uid = info.gid = 0
                info.uname = info.gname = ''
                info.mode = 0o755 if entry in {name, 'install.sh'} else 0o644
                with source.open('rb') as stream:
                    package.addfile(info, stream)
    os.replace(archive_tmp, archive)
    digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
    manifest = {'schema': 1, 'application_id': 'aieyra.cli', 'version': version, 'platform': platform,
                'architecture': arch, 'file': archive.name, 'bytes': archive.stat().st_size,
                'sha256': digest(archive), 'executable_sha256': digest(executable),
                'executable_bytes': executable.stat().st_size, 'entry': 'aieyra-cli/' + name,
                'runtime_dependencies': [], 'host_mode': 'cli', 'control_default': False,
                'validation': {'built_from_core': True, 'native_execution': 'pending'}}
    (distribution / ('aieyra-cli-' + platform + '-' + arch + '.json')).write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(manifest, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--platform', choices=['windows', 'linux', 'android'], default='linux')
    parser.add_argument('--arch', choices=['amd64', 'arm64'], default='amd64')
    args = parser.parse_args()
    if args.platform == 'android' and args.arch != 'arm64':
        parser.error('Android packages currently support arm64 only; amd64 requires an Android NDK toolchain.')
    build(args.platform, args.arch)
