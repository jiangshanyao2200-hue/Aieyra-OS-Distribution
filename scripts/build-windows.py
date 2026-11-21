# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: scripts/AGENTS.md | ring 3
# Chains: module-local; query impact before editing
# Regions: load; digest; tree; desktop_network_files; control_python; workspace_dependencies; os_files; link_files; browser_files; baseline; node; write_zip; installer_fonts; build_installer; build
# Impact: python -B scripts/code-atlas.py show scripts/build-windows.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""Build the clean Windows release from one verified staging build.

Outputs (in --out, which must not exist):
  AieyraOS-<v>-windows-x64.zip       full OS; every file listed in the signed Config/official-baseline.json
  AieyraOS-<v>-windows-x64-Setup.exe self-contained installer with the same signed payload
  With --previous-baseline: optional delta from an earlier signed full baseline.
  With --program-archives only: optional standalone Link and Browser archives.
  release-input.json                 input for cloud tools/publish.mjs
  receipt.json                       hashes, counts and checks

Private data never enters: sources come from the reviewed public inventory, and the
private Config/API/Prompt/Data files are outside it. The signing key is only referenced.
The native installer build uses fonttools with Brotli to prepare its desktop fonts.
"""
import argparse, base64, hashlib, importlib.util, json, os, re, subprocess, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEXT = {'.go', '.cjs', '.mjs', '.js', '.css', '.html', '.json', '.md', '.txt', '.ps1', '.cs', '.py', '.sql', '.svg', '.cmd', '.bat', '.rc', '.mod', '.sum', '.pem'}
TEXT_LIMIT, TEXTS_TOTAL = 64 * 1024, 12 * 1024 * 1024
WINDOWS_ARCHIVE_ENTRIES = 10_000
WINDOWS_FULL_BYTES = 2 ** 31
WINDOWS_DELTA_BYTES = 2 ** 30  # Accepted by previously installed update clients.
MODULE_LAUNCHERS = json.loads((ROOT / 'Client/Desktop/host/module-launchers.json').read_text(encoding='utf-8'))
EXECUTABLES = ('Aieyra OS.exe', 'Aieyra CLI.exe', *(name + '.exe' for name in MODULE_LAUNCHERS.values()), 'Link/app/runtime/link/aieyra-link.exe')
DESKTOP_NETWORK_PACKAGES = ('ssh2', 'asn1', 'bcrypt-pbkdf', 'tweetnacl', 'safer-buffer',
                            'socks', 'ip-address', 'smart-buffer')
# Workspace's browser code is already built into dist. The desktop service
# loads the Node entries of its production packages, including native codecs.
WORKSPACE_RENDERER_PACKAGES = {'@techstark/opencv-js', 'ag-psd', 'lucide-react', 'react', 'react-dom', 'scheduler'}
WORKSPACE_ALTERNATE_BUILDS = {
    'dayjs': {'esm'},
    'exceljs': {'dist'},
    'pdfjs-dist': {'legacy', 'web'},
    'underscore': {'amd'},
}
WORKSPACE_DEVELOPMENT_DIRS = {'test', 'tests', 'examples', 'benchmark', 'benchmarks', '.github', '.v8-cache'}
LINK_REQUIRED = ('Client/Desktop/host/main.cjs', 'Control/app/service/main.py', 'Control/app/runtime/python/python.exe', 'Control/app/web/situation.js', 'Client/Desktop/assets/link.ico',
                 'Core/platform/config-file.cjs', 'Theme/runtime/settings.cjs', 'Theme/official/default/appearance.css',
                 'Contracts/product-layout.json', 'Contracts/resources/prompts.cjs', 'Agent/official/definitions.cjs',
                 'Link/cloud/client/remote-link.mjs')


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / file)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()


def tree(base, prefix):
    """Every regular file under base, named prefix/relative with forward slashes."""
    out = {}
    for p in sorted(base.rglob('*')):
        if p.is_symlink():
            raise RuntimeError('链接文件不能进入发行包：' + str(p))
        if p.is_file() and '__pycache__' not in p.parts:
            out[prefix + '/' + p.relative_to(base).as_posix()] = p
    return out


def desktop_network_files(root):
    files = {}
    for package in DESKTOP_NETWORK_PACKAGES:
        prefix = 'Client/Desktop/node_modules/' + package
        files.update({name: file for name, file in tree(root / prefix, prefix).items()
                      if 'docs' not in name[len(prefix) + 1:].lower().split('/')})
    return files


def control_python(generated):
    """Link/Control service needs Python on a clean machine: reuse the locked search interpreter
    without its site-packages; its own ._pth adds Control/app/service (embedded Python ignores the script dir)."""
    base, out = ROOT / 'runtime/search', {}
    for p in sorted(base.iterdir()):
        if p.is_file() and p.name not in ('runtime-manifest.json', 'python313._pth'):
            out['Control/app/runtime/python/' + p.name] = p
    pth = generated / 'python313._pth'
    pth.write_bytes(b'python313.zip\r\n.\r\n../../service\r\n')
    out['Control/app/runtime/python/python313._pth'] = pth
    return out


def workspace_dependencies():
    """Locked production dependencies of the canvas storage, including Windows codecs."""
    base = ROOT / 'Program/official/workspace'
    lock = json.loads((base / 'package-lock.json').read_text(encoding='utf-8'))
    out = {}
    for name, meta in lock['packages'].items():
        if not name.startswith('node_modules/') or meta.get('dev'):
            continue
        dependency = name.rsplit('node_modules/', 1)[-1]
        if dependency in WORKSPACE_RENDERER_PACKAGES or dependency.startswith('@types/'):
            continue
        if 'win32' not in meta.get('os', ['win32']) or 'x64' not in meta.get('cpu', ['x64']):
            continue
        package = base / name
        if not package.is_dir():
            if meta.get('optional'):
                continue
            raise RuntimeError('Workspace dependency missing: ' + name)
        actual = json.loads((package / 'package.json').read_text(encoding='utf-8'))
        if actual.get('version') != meta.get('version'):
            raise RuntimeError('Workspace dependency version differs from lock: ' + name)
        prefix = 'Program/official/workspace/' + name
        excluded = WORKSPACE_DEVELOPMENT_DIRS | WORKSPACE_ALTERNATE_BUILDS.get(dependency, set())
        for target, file in tree(package, prefix).items():
            relative = file.relative_to(package)
            if relative.parts[0] in excluded or 'node_modules' in relative.parts:
                continue  # Nested packages are selected from their own lock entries.
            if file.name.endswith(('.map', '.d.ts', '.d.cts', '.d.mts')):
                continue
            out[target] = file
    return out


def os_files(staging, generated):
    privacy, runtime = load('privacy', 'public-privacy.py'), load('runtime_files', 'runtime-files.py')
    check = privacy.check_source(ROOT)
    if not check['ok']:
        raise RuntimeError('公共隐私检查未通过：' + json.dumps(check['failures'], ensure_ascii=False)[:2000])
    files = dict(runtime.runtime_files(privacy.source_files(ROOT)))
    for name in EXECUTABLES:
        p = staging / name
        if not p.is_file():
            raise RuntimeError('staging 缺少同批构建产物：' + name)
        files[name] = p
    files.update(tree(ROOT / 'Core/tools/runtime', 'Core/tools/runtime'))
    files.update(tree(ROOT / 'Client/Desktop/node_modules/electron', 'Client/Desktop/node_modules/electron'))
    files.update(desktop_network_files(ROOT))
    files.update(workspace_dependencies())
    files.update(tree(ROOT / 'runtime/search', 'runtime/search'))
    load('media_runtime', 'provision-media.py').verify(ROOT / 'runtime/media')
    files.update(tree(ROOT / 'runtime/media', 'runtime/media'))
    files.update(control_python(generated))
    # check_source has already verified the exact reviewed default prompt
    # hashes. Nonempty approved defaults are valid; private layers stay out.
    return privacy.development.prepare_paths(files, generated / 'os-documents')


def link_files(staging, full):
    """Standalone Link owns the same Core and desktop host without an OS entry."""
    runtime = load('link_runtime_files', 'runtime-files.py')
    layout = runtime.MODULE_LAYOUT
    keep = ('Client/Desktop/host/', 'Client/Desktop/src/', 'Client/Desktop/ui/', 'Client/Desktop/assets/', 'Client/Desktop/node_modules/electron/', 'Link/', 'Config/', 'Control/app/', 'Core/platform/')
    keep += ('Core/tools/runtime/', 'runtime/search/', 'runtime/media/')
    keep += tuple('Client/Desktop/node_modules/' + name + '/' for name in DESKTOP_NETWORK_PACKAGES)
    keep += tuple(name + '/' for name in layout['source_trees'])
    # full is the already reviewed public inventory. Shared modules and indexed
    # resources have the same ownership in standalone and embedded clients.
    extras = (set(layout['source_files']) - {'Install.bat'}) | runtime.DEVELOPMENT_FILES
    files = {n: p for n, p in full.items()
             if (n.startswith(keep) or n in extras or runtime.resources.public_prompt_name(n))
             and ('/test/' not in n or n in runtime.DEVELOPMENT_FILES)}
    files.update({'Aieyra Link.exe': staging / 'Aieyra Link.exe', 'LICENSE': ROOT / 'LICENSE', 'Client/Desktop/package.json': ROOT / 'Client/Desktop/package.json'})
    missing = [n for n in LINK_REQUIRED if n not in files]
    if missing:
        raise RuntimeError('独立 Link 包缺少运行文件：' + '、'.join(missing))
    return files


def browser_files(full):
    # The browser host lives in the shared OS runtime; its launcher opens only the browser window.
    return dict(full)


def baseline(files, version, sequence):
    rows, texts, used = {}, {}, 0
    for name, p in sorted(files.items()):
        rows[name] = {'sha256': digest(p), 'size': p.stat().st_size}
    # 三方合并的基准文本：先提示词与公共配置、界面样式，再其他小源码；总量受限。
    resources = load('baseline_resources', 'resources.py')
    rank = lambda n: (0 if n.startswith('Config/') or resources.public_prompt_name(n)
                      else 1 if n.startswith(('Client/Desktop/ui/', 'Theme/official/')) else 2, n)
    for name in sorted(files, key=rank):
        p = files[name]
        if p.suffix.lower() not in TEXT or rows[name]['size'] > TEXT_LIMIT or '/node_modules/' in name or name.startswith('runtime/'):
            continue
        try:
            text = p.read_bytes().decode('utf-8')
        except UnicodeDecodeError:
            continue
        if used + len(text.encode('utf-8')) > TEXTS_TOTAL:
            break
        texts[name] = text; used += len(text.encode('utf-8'))
    return {'schema': 'aieyra-os-baseline-v1', 'product': 'aieyra-os', 'version': version, 'sequence': sequence, 'files': rows, 'texts': texts}


def node(script, *args):
    result = subprocess.run(['node', '-e', script, *map(str, args)], capture_output=True, text=True, encoding='utf-8')
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or f'Node exited with status {result.returncode}')
    return result.stdout


SIGN = r'''
const fs=require('fs'),c=require('crypto');const [payloadFile,keyFile,pubFile,out,checker]=process.argv.slice(1);
const payload=fs.readFileSync(payloadFile),key=c.createPrivateKey(fs.readFileSync(keyFile));
const envelope={algorithm:'Ed25519',payload:payload.toString('base64'),signature:c.sign(null,payload,key).toString('base64')};
const pub=c.createPublicKey(fs.readFileSync(pubFile));
const checked=require(checker).verifySigned(envelope,pub,'baseline');
fs.writeFileSync(out,JSON.stringify(envelope));
console.log(JSON.stringify({files:Object.keys(checked.files).length,version:checked.version,sequence:checked.sequence}));
'''


def write_zip(target, files, extra=None, *, max_bytes=WINDOWS_FULL_BYTES):
    names = sorted(files)
    if len(names) + (1 if extra else 0) > WINDOWS_ARCHIVE_ENTRIES:
        raise RuntimeError(f'ZIP 条目超过客户端上限 {WINDOWS_ARCHIVE_ENTRIES}')
    total = sum(files[n].stat().st_size for n in names) + (len(extra[1]) if extra else 0)
    if total > max_bytes:
        raise RuntimeError(f'ZIP 解压总量 {total} 字节，超过客户端上限 {max_bytes} 字节')
    tmp = target.with_suffix('.tmp')
    with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED, allowZip64=False, compresslevel=6) as z:
        for n in names:
            info = zipfile.ZipInfo(n, date_time=(2026, 1, 1, 0, 0, 0)); info.compress_type = zipfile.ZIP_DEFLATED; info.external_attr = 0o644 << 16
            with open(files[n], 'rb') as src, z.open(info, 'w') as dst:
                for block in iter(lambda: src.read(1 << 20), b''):
                    dst.write(block)
        if extra:
            info = zipfile.ZipInfo(extra[0], date_time=(2026, 1, 1, 0, 0, 0)); info.compress_type = zipfile.ZIP_DEFLATED; info.external_attr = 0o644 << 16
            z.writestr(info, extra[1])
    os.replace(tmp, target)
    return {'name': target.name, 'size': target.stat().st_size, 'sha256': digest(target), 'entries': len(names) + (1 if extra else 0), 'uncompressed': total}


def installer_fonts(generated):
    try:
        from fontTools.ttLib import TTFont
        from fontTools.varLib.instancer import instantiateVariableFont
    except ImportError as exc:
        raise RuntimeError('安装器字体需要 fonttools[woff]') from exc

    fonts = ROOT / 'Client/Desktop/assets/fonts'
    resources = {}
    for name, source, family, weight in (
        ('inter', 'inter-variable', 'Aieyra Setup Inter', 480),
        ('noto', 'notosanssc-common', 'Aieyra Setup Noto Sans SC', 460),
    ):
        with TTFont(fonts / (source + '.woff2')) as font:
            axes = {axis.axisTag: axis.defaultValue for axis in font['fvar'].axes}
            axes['wght'] = weight
            instantiateVariableFont(font, axes, inplace=True)
            names = font['name']
            for name_id in (1, 2, 3, 4, 6, 16, 17):
                names.removeNames(nameID=name_id)
            for name_id, value in ((1, family), (2, 'Regular'), (3, family), (4, family),
                                   (6, family.replace(' ', ''))):
                names.setName(value, name_id, 3, 1, 0x409)
            font.flavor = None
            destination = generated / (name + '.ttf')
            font.save(destination)
        resources[destination.name] = destination
        resources[name + '-OFL.txt'] = fonts / ('inter-OFL.txt' if name == 'inter' else 'notosanssc-OFL.txt')
    return resources


def build_installer(target, archive, generated, public_key, version, sequence, test_build):
    framework = Path(os.environ['SystemRoot']) / 'Microsoft.NET/Framework64/v4.0.30319'
    compiler = framework / 'csc.exe'
    source = ROOT / 'Client/Installer'
    engine = generated / 'install-engine.exe'
    key = base64.b64encode(public_key.read_bytes()).decode('ascii')
    env = {**os.environ, 'GOOS': 'windows', 'GOARCH': 'amd64', 'GOMAXPROCS': '1', 'GOFLAGS': '-p=1'}
    subprocess.run(['go', 'build', '-trimpath', '-ldflags', f'-s -w -H=windowsgui -X main.trustedKey={key}',
                    '-o', str(engine), './cmd/aieyra-install'], cwd=ROOT / 'Core', env=env, check=True)
    release = generated / 'installer-release.json'
    release.write_text(json.dumps({'version': version, 'sequence': sequence, 'localTest': test_build}), encoding='utf-8')
    references = [framework / f for f in ('System.Web.Extensions.dll', 'System.Windows.Forms.dll', 'System.Xaml.dll')]
    references += [framework / 'WPF' / f for f in ('WindowsBase.dll', 'PresentationCore.dll', 'PresentationFramework.dll')]
    resources = {
        'Installer.xaml': source / 'Installer.xaml',
        'install.exe': engine,
        'release.json': release,
        'payload.zip': archive,
        'brand.png': ROOT / 'Client/Desktop/assets/os.png',
        **installer_fonts(generated),
    }
    temporary = target.with_name(target.stem + '.building.exe')
    subprocess.run([str(compiler), '/nologo', '/codepage:65001', '/target:winexe', '/platform:x64',
                    '/optimize+', f'/win32manifest:{source / "Installer.manifest"}',
                    f'/win32icon:{ROOT / "Client/Desktop/assets/os.ico"}', f'/out:{temporary}',
                    *(f'/reference:{f}' for f in references),
                    *(f'/resource:{file},{name}' for name, file in resources.items()),
                    str(source / 'Installer.cs'), str(source / 'HaloProgress.cs')], cwd=ROOT, check=True)
    os.replace(temporary, target)
    return {'name': target.name, 'size': target.stat().st_size, 'sha256': digest(target),
            'kind': 'installer', 'platform': 'win32', 'arch': 'x64', 'component': 'os'}


def build(staging, out, key, notes, program_archives=False, previous_baseline=None, source_commit=None,
          *, installer=True, test_public_key=None, source_revision=None):
    meta = json.loads((ROOT / 'scripts/release-metadata.json').read_text(encoding='utf-8'))
    version, sequence = meta['version'], meta['sequence']
    if source_commit is not None and not re.fullmatch(r'[a-f0-9]{40}(?:[a-f0-9]{24})?', source_commit):
        raise ValueError('Source commit must be a full Git object ID')
    if source_revision is not None and (not source_commit or not re.fullmatch(r'[a-f0-9]{64}', source_revision)):
        raise ValueError('Together builds require a source snapshot and its full Git commit')
    tag = f'{version}-r{sequence}'
    test_build = test_public_key is not None
    public_key = test_public_key if test_build else ROOT / 'Config/release.pub.pem'
    if test_build:
        tag = 'local-test-' + tag
    built = subprocess.run([str(staging / 'Aieyra OS.exe'), '-version'], capture_output=True, text=True, encoding='utf-8', errors='replace')
    if not re.search(r'(?<![\d.])' + re.escape(version) + r'(?![\d.])', built.stdout + built.stderr):
        raise RuntimeError('staging 程序版本与发行元数据不一致')
    out.mkdir(parents=True)
    generated = out / '.generated'; generated.mkdir()
    full = os_files(staging, generated)
    settings_name = 'Config/运行参数.json'
    release_settings = json.loads(full[settings_name].read_text(encoding='utf-8'))
    release_settings['official_updates_enabled'] = True
    settings_file = generated / 'release-settings.json'
    settings_file.write_text(json.dumps(release_settings, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    full[settings_name] = settings_file
    full['Config/release.pub.pem'] = public_key
    if len(full) >= WINDOWS_ARCHIVE_ENTRIES:
        raise RuntimeError(f'完整包清单有 {len(full)} 个文件，需为签名清单保留一个 ZIP 条目')
    current = baseline(full, version, sequence)
    payload = json.dumps(current, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    (out / 'baseline.payload.json').write_bytes(payload)
    signed = json.loads(node(SIGN, out / 'baseline.payload.json', key, public_key, out / 'official-baseline.json', ROOT / 'Client/Desktop/src/managed-update-files.cjs'))
    (out / 'baseline.payload.json').unlink()
    envelope = (out / 'official-baseline.json').read_bytes()
    artifacts = [
        dict(write_zip(out / f'AieyraOS-{tag}-windows-x64.zip', full, ('Config/official-baseline.json', envelope)), kind='portable', platform='win32', arch='x64', purpose='full', component='os'),
    ]
    if previous_baseline is not None:
        verifier = "const fs=require('node:fs'), f=require(process.argv[1]); console.log(JSON.stringify(f.verifySigned(JSON.parse(fs.readFileSync(process.argv[2],'utf8')),fs.readFileSync(process.argv[3]),'baseline')));"
        previous = json.loads(subprocess.check_output(['node', '-e', verifier, str(ROOT / 'Client/Desktop/src/managed-update-files.cjs'), str(previous_baseline), str(public_key)], encoding='utf-8'))
        if previous['sequence'] >= sequence:
            raise ValueError('Previous baseline sequence must be lower than the release sequence')
        changed = {name: file for name, file in full.items() if previous['files'].get(name) != current['files'][name]}
        target = out / f"AieyraOS-{tag}-windows-x64-from-{previous['sequence']}.zip"
        delta = write_zip(target, changed, ('Config/official-baseline.json', envelope), max_bytes=WINDOWS_DELTA_BYTES)
        if delta['size'] < artifacts[0]['size']:
            artifacts.append(dict(delta, kind='delta', platform='win32', arch='x64', component='os', fromSequence=previous['sequence']))
        else:
            target.unlink()
    if program_archives:
        artifacts.extend([
            dict(write_zip(out / f'AieyraLink-{tag}-windows-x64.zip', load('link_development_docs', 'development-docs.py').prepare_paths(link_files(staging, full), generated / 'link-documents')), kind='program', platform='win32', arch='x64', component='link'),
            dict(write_zip(out / f'AieyraBrowser-{tag}-windows-x64.zip', browser_files(full)), kind='program', platform='win32', arch='x64', component='browser'),
        ])
    if installer:
        artifacts.append(build_installer(out / f'AieyraOS-{tag}-windows-x64-Setup.exe', out / artifacts[0]['name'],
                                          generated, public_key, version, sequence, test_build))
    release_input = {'product': 'aieyra-os', 'channel': 'stable', 'id': f'os-{tag}', 'version': version, 'sequence': sequence,
                     'publishedAt': '', 'notes': notes,
                     'artifacts': [{'file': str(out / a['name']), **{k: a[k] for k in ('kind', 'platform', 'arch', 'purpose', 'component', 'fromSequence') if k in a}} for a in artifacts]}
    if source_commit:
        release_input['sourceCommit'] = source_commit
    if source_revision:
        release_input['sourceRevision'] = source_revision
    (out / 'release-input.json').write_text(json.dumps(release_input, ensure_ascii=False, indent=2), encoding='utf-8')
    receipt = {'version': version, 'sequence': sequence, 'local_test': test_build,
               'baseline': {**signed, 'texts': len(json.loads(payload)['texts']), 'sha256': hashlib.sha256(envelope).hexdigest()},
               'executables': {n: digest(staging / n) for n in EXECUTABLES}, 'artifacts': artifacts}
    (out / 'receipt.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding='utf-8')
    return receipt


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--build-root', '--staging', dest='staging', type=Path, default=Path(__file__).resolve().parent.parent, help='主工程构建产物目录')
    parser.add_argument('--out', type=Path, required=True, help='新的输出目录，必须不存在')
    parser.add_argument('--key', type=Path, required=True, help='发行签名私钥路径（只读取，不输出）')
    parser.add_argument('--notes', default='')
    parser.add_argument('--program-archives', action='store_true', help='额外输出独立Link/Browser包；默认只输出内置全部程序的OS ZIP')
    parser.add_argument('--previous-baseline', type=Path, help='Signed Config/official-baseline.json from the preceding Windows release')
    parser.add_argument('--source-commit', help='Full Git object ID of the release source')
    parser.add_argument('--source-revision', help='Together source snapshot used for this build')
    parser.add_argument('--skip-installer', action='store_true', help='仅生成 ZIP 制品')
    parser.add_argument('--test-public-key', type=Path, help='使用本机验收公钥，输出明确标记为 local-test')
    args = parser.parse_args()
    print(json.dumps(build(args.staging.resolve(), args.out.resolve(), args.key, args.notes, args.program_archives,
                           args.previous_baseline, args.source_commit, installer=not args.skip_installer,
                           test_public_key=args.test_public_key, source_revision=args.source_revision), ensure_ascii=False))
