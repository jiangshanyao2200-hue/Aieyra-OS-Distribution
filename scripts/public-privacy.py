# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: scripts/AGENTS.md | ring 3
# Chains: module-local; query impact before editing
# Regions: address_is_example; digest; policy; declared_source_part; module_source_name; module_sources; source_files; validate; check_source; check_history
# Impact: python -B scripts/code-atlas.py show scripts/public-privacy.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""Fail closed at public source/package boundaries; never include matched values."""
from pathlib import Path, PurePosixPath
import argparse, base64, hashlib, importlib.util, ipaddress, json, os, re, stat, subprocess
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]
POLICY = ROOT / 'scripts/public-privacy-policy.json'
RESOURCE_SPEC = importlib.util.spec_from_file_location('product_resources', Path(__file__).with_name('resources.py'))
resources = importlib.util.module_from_spec(RESOURCE_SPEC)
RESOURCE_SPEC.loader.exec_module(resources)
DEVELOPMENT_SPEC = importlib.util.spec_from_file_location('development_docs', Path(__file__).with_name('development-docs.py'))
development = importlib.util.module_from_spec(DEVELOPMENT_SPEC)
DEVELOPMENT_SPEC.loader.exec_module(development)
MODULE_LAYOUT = json.loads((ROOT / 'Contracts/product-layout.json').read_text(encoding='utf-8'))
GROUPS = ('Core', 'Client/Desktop/src', 'Client/Desktop/renderer','Client/Desktop/ui','Client/Desktop/host', 'Client/Desktop/assets',
          'Client/Desktop/test', 'CLOUD', 'scripts', '.github')
EXTRAS = ('Client/Desktop/package.json', 'Client/Desktop/package-lock.json', 'Config/release.pub.pem',
          'Client/Desktop/README.md', 'Client/Desktop/tools/check.cjs', 'Client/Desktop/tools/ensure-electron.cjs',
          'Client/Desktop/tools/print-paths.cjs', '.gitignore', 'LICENSE')
BLOCKED = {'.git', '__pycache__', 'evidence', 'history', 'sessions', 'memory', '.runtime',
           'test-output', 'aidebug', 'docs', 'control', 'alpha-secrets'}
TEXT = {'', '.go', '.mod', '.sum', '.cmd', '.ps1', '.bat', '.cs', '.cjs', '.mjs', '.js', '.py', '.json',
        '.md', '.rc', '.txt', '.sql', '.svg', '.css', '.html', '.yml', '.yaml', '.pem', '.toml', '.sh', '.service', '.ts', '.tsx'}
BINARIES = {'.png', '.ico', '.icns', '.webp', '.woff2', '.wav', '.jpg', '.jpeg'}
EXAMPLE_USERS = {'example', 'user', 'private', 'test', 'fixture', 'username', 'runner'}
EXAMPLE_ROOTS = {'path', 'private', 'projects', 'project', 'fixtures', 'windows', 'temp',
                 'tmp', 'test', 'tests', 'example', 'absolute', 'untrusted'}
SECRET = re.compile(rb'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9_-]{24,}|AKIA[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{15,})|-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----')
WINDOWS = re.compile(r'(?<![\w\\])([A-Za-z]):[\\/]+([^\s"\'<>`|]+)')
HOME = re.compile(r'(?<![\w:/])/(?:Users|home)/([A-Za-z0-9_.-]+)(?:[/\\]|\b)')
OPERATIONS = re.compile(r'(?<![\w:/])/(?:root|srv|opt)/([A-Za-z0-9_.-]+)(?:[/\\]|\b)')
STATION = re.compile(r'\b(?:agent-[a-f0-9]{16}|ext-(?:seat|host|adapter)-[a-f0-9]{24}|station-[a-z0-9_.-]+-[a-f0-9]{32}|01[0-9a-f]{6}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b', re.I)
EMAIL = re.compile(r'[A-Za-z0-9_.+%-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}')
# Our own service hosts: only the reviewed client-facing ones may ship; internal
# relays, panels and origin names stay private even though clients reach the public ones.
SERVICE_HOST = re.compile(r'(?<![\w-])((?:[a-z0-9-]+\.)*aieyra\.cn)(?![\w-])', re.I)
# Server-side programs never ship; only their client protocol pieces do.
SERVER_TREES = ('Control/app/cloud/', 'Link/cloud/')
SERVER_CLIENT_FILES = {'Link/cloud/protocol.py', 'Link/cloud/desktop_owner.py', 'Link/cloud/client/remote-link.mjs'}
DOCUMENTATION_NETWORKS = tuple(ipaddress.ip_network(x) for x in ('192.0.2.0/24','198.51.100.0/24','203.0.113.0/24','2001:db8::/32'))

def address_is_example(address):
    if getattr(address, 'ipv4_mapped', None):return address_is_example(address.ipv4_mapped)
    return address.is_loopback or address.is_unspecified or any(address in network for network in DOCUMENTATION_NETWORKS if address.version==network.version)

def digest(data): return hashlib.sha256(data).hexdigest()
def policy(): return json.loads(POLICY.read_text(encoding='utf-8'))
# The reviewed client-facing hosts are a product fact, so ad-hoc rule sets inherit them.
PUBLIC_SERVICE_HOSTS = frozenset(policy()['public_service_hosts'])

# 只选择模块软件源码，共享库和全部运行资料永不进入更新或公开包。
MODULE_GROUPS = ('Control/app/service', 'Control/app/web', 'Link/app/link-core', 'Editor/src') + tuple(MODULE_LAYOUT['source_trees'])
MODULE_EXTRAS = ('Control/app/scripts/control.py', 'Control/app/scripts/agent-client.py',
                 'Control/app/scripts/agent-adapter.py',
                 'Control/app/scripts/task_delegation.py',
                 'Control/app/scripts/agent-station.py', 'Control/app/scripts/enroll-agent.py',
                 'Control/app/scripts/station-transfer.py', 'Control/app/config/release-public.pem',
                 'Control/app/LICENSE', 'Link/app/LICENSE', 'Editor/package.json',
                 'Editor/package-lock.json', 'Editor/NOTICE', 'Editor/scripts/os-only.mjs',
                 'Editor/desktop/main.cjs') + tuple(MODULE_LAYOUT['source_files'])
MODULE_PRIVATE = {'data', 'runtime', 'build', 'node_modules', '__pycache__', '.git',
                  'history', 'sessions', 'memory', 'evidence', 'test-output', '私有数据', '共享库', '.codex'}
MODULE_ROOTS = {PurePosixPath(name).parts[0].casefold() for name in (*MODULE_GROUPS, *MODULE_EXTRAS)}
RUNTIME_BOOTSTRAP = {'Client/Desktop/update-bootstrap/' + name for name in
                     ('cli.exe', 'LICENSE', 'create-launchers.ps1', 'CLI-README.md')}

def declared_source_part(parts, index):
    # Only the exact declared source directory is exempt, never its private children.
    return (parts[index] in {'runtime', 'history'}
            and '/'.join(parts[:index + 1]) in MODULE_LAYOUT['source_trees'])

def module_source_name(name):
    path=PurePosixPath(name)
    if resources.tool_manual_sidecar(name): return False
    if path.is_absolute() or '..' in path.parts or any(p.casefold() in MODULE_PRIVATE and not declared_source_part(path.parts, i) for i,p in enumerate(path.parts)):
        return False
    return name in MODULE_EXTRAS or any(name.startswith(folder+'/') for folder in MODULE_GROUPS)

def module_sources(root):
    for folder in MODULE_GROUPS:
        origin=root/folder
        if not origin.exists(): continue
        for base,dirs,files in os.walk(origin, followlinks=False):
            for item in [Path(base),*(Path(base)/d for d in dirs),*(Path(base)/f for f in files)]:
                attrs=getattr(item.lstat(), 'st_file_attributes', 0)
                if item.is_symlink() or attrs & getattr(stat,'FILE_ATTRIBUTE_REPARSE_POINT',0):
                    raise ValueError('source_symlink:'+item.relative_to(root).as_posix())
            dirs[:]=[d for d in dirs if d.casefold() not in MODULE_PRIVATE
                     or declared_source_part((Path(base)/d).relative_to(root).parts,
                                             len((Path(base)/d).relative_to(root).parts)-1)]
            for filename in files:
                path=Path(base)/filename;name=path.relative_to(root).as_posix()
                if (module_source_name(name) and path.suffix.lower() in (TEXT | BINARIES)
                        and not path.name.startswith('.env') and '.local.' not in path.name):
                    yield name,path
    for name in MODULE_EXTRAS:
        path=root/name
        if path.exists():
            for parent in [path,*path.parents]:
                if parent == root: break
                attrs=getattr(parent.lstat(),'st_file_attributes',0)
                if parent.is_symlink() or attrs & getattr(stat,'FILE_ATTRIBUTE_REPARSE_POINT',0):
                    raise ValueError('source_symlink:'+name)
            if not path.is_file():raise ValueError('module_source_not_file:'+name)
            yield name,path


def source_files(root=ROOT):
    files = {}
    for folder in GROUPS:
        for path in (root / folder).rglob('*'):
            relative = path.relative_to(root).as_posix()
            if any(p in {'node_modules', '.git', '__pycache__'} for p in path.parts): continue
            if (relative.startswith(('Core/link/', 'scripts/link/'))
                    or relative == 'scripts/control-public-files.json'): continue
            # These exact signed runtime payloads are generated during packaging.
            # Their source files already live at their normal public paths.
            if relative == 'Client/Desktop/update-bootstrap' or relative.startswith('Client/Desktop/update-bootstrap/'): continue
            # Shared memory is runtime user data, including SQLite sidecars.
            if relative == 'Core/memory' or relative.startswith('Core/memory/'): continue
            if relative == 'Core/tools/build-alpha-candidate.ps1': continue
            if path.is_symlink(): raise ValueError('source_symlink:' + relative)
            if not path.is_file(): continue
            if path.suffix in {'.exe', '.syso', '.zip', '.dmg', '.pyc', '.log'}: continue
            if path.name.startswith('.env') and path.name != '.env.example': continue
            files[relative] = path
    for name in EXTRAS: files[name] = root / name
    files.update(module_sources(root))
    if root == ROOT or (root / 'Config/提示词索引.json').is_file():
        files.update(resources.public_resource_files(root))
    files['README.md'] = root / 'scripts/PUBLIC-README.md'
    files.update(development.source_files(root))
    return files

def validate(name, data, rules=None, known_secrets=(), depth=0):
    rules = rules if rules is not None else policy()
    errors = []
    def fail(rule):
        if rule not in errors: errors.append(rule)
    legacy = rules.get('desktop_compatibility', {}).get(name)
    if legacy and digest(data) != legacy:
        fail('changed_desktop_compatibility_resource')
    path = PurePosixPath(name.replace('\\', '/'))
    parts = {p.casefold() for p in path.parts}
    developer_document = name in development.DOCUMENTS
    if (name == 'Core/link' or name.startswith(('Core/link/', 'scripts/link/'))
            or name == 'scripts/control-public-files.json'):
        fail('legacy_product_source')
    blocked = BLOCKED - {'control'} if module_source_name(name) else BLOCKED
    if developer_document:
        blocked = blocked - {'docs', 'aidebug', 'control'}
    if (path.is_absolute() or re.match(r'^[A-Za-z]:', name) or '..' in path.parts
            or any(part.casefold() in blocked and not declared_source_part(path.parts, i)
                   for i, part in enumerate(path.parts))): fail('private_artifact_path')
    if path.parts and path.parts[0].casefold() in MODULE_ROOTS and not (module_source_name(name) or developer_document or name in RUNTIME_BOOTSTRAP): fail('private_artifact_path')
    if name.startswith(SERVER_TREES) and name not in SERVER_CLIENT_FILES and not developer_document: fail('server_source')
    if path.name in {'config.json', 'auth.json', 'companion-profile.json'}: fail('personal_configuration_path')
    if re.search(r'\.(?:sqlite(?:3)?|db)(?:-(?:wal|shm|journal))?$', path.name, re.I): fail('private_database_path')
    if path.name.startswith('.env') and path.name != '.env.example': fail('private_environment_file')
    if ('prompt' in parts or 'prompts' in parts or resources.tool_manual(name) or resources.tool_manual_sidecar(name)) and not developer_document:
        reviewed = rules.get('reviewed_prompt_resources', {}).get(name)
        if name not in rules.get('synthetic_prompt_files', {}) and reviewed != digest(data):
            fail('personal_prompt_path')
    if path.parts and path.parts[0] == 'Config' and path.name not in resources.PUBLIC_CONFIG and not developer_document:
        fail('personal_configuration_path')
    if any(value and value in data for value in known_secrets): fail('known_credential')
    synthetic = rules.get('synthetic_tokens', {}).get(name, [])
    for match in SECRET.finditer(data):
        if digest(match.group()) not in synthetic: fail('credential_or_private_key')
    bundled_together_runtime = (name in MODULE_EXTRAS
                                and name.startswith('Program/official/together/product/runtime/')
                                and path.suffix.lower() in {'.exe', '.dll', '.pyd', '.zip'})
    if path.suffix.lower() in BINARIES or bundled_together_runtime:
        reviewed = [rules.get('binary_assets', {}).get(name)] + rules.get('historical_binary_assets', {}).get(name, [])
        if digest(data) not in reviewed: fail('unreviewed_binary')
        return errors
    if (path.suffix.lower() not in TEXT and path.name != '.env.example'
            and rules.get('reviewed_text_assets', {}).get(name) != digest(data)):
        fail('unreviewed_file_type')
    try: text = data.decode('utf-8-sig', errors='strict')
    except UnicodeError:
        fail('non_utf8_source'); return errors
    text = re.sub(r'\\u([0-9a-fA-F]{4})|\\x([0-9a-fA-F]{2})', lambda m: chr(int(m.group(1) or m.group(2), 16)), text).replace(r'\/', '/')
    text = unquote(text)
    decoded = text.encode('utf-8', errors='surrogatepass')
    if any(value and value in decoded for value in known_secrets): fail('known_credential')
    for match in SECRET.finditer(decoded):
        if digest(match.group()) not in synthetic: fail('credential_or_private_key')
    if STATION.search(text): fail('native_or_station_identity')
    reviewed_paths = rules.get('reviewed_path_literals', {}).get(name, [])
    for match in WINDOWS.finditer(text):
        if digest(match.group().encode()) in reviewed_paths: continue
        pieces = [p for p in match.group(2).replace('\\', '/').split('/') if p]
        first = pieces[0].casefold() if pieces else ''
        if first == 'users' and (len(pieces) == 1 or pieces[1].casefold() in EXAMPLE_USERS): continue
        if first not in EXAMPLE_ROOTS: fail('local_absolute_path')
    for match in HOME.finditer(text):
        if match.group(1).casefold() not in EXAMPLE_USERS and digest(match.group().encode()) not in reviewed_paths:
            fail('personal_home_path')
    for match in OPERATIONS.finditer(text):
        if match.group(1).casefold() not in {'example', 'fixture', 'product', 'aieyra-os'} and digest(match.group().encode()) not in reviewed_paths:
            fail('operations_path')
    normalized = text.replace(r'\.', '.').replace('[.]', '.').replace(r'\:', ':')
    for candidate in re.findall(r'(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])', normalized):
        try: address = ipaddress.ip_address(candidate)
        except ValueError: continue
        if not address_is_example(address) and digest(candidate.encode()) not in rules.get('reviewed_ip_literals', {}).get(name, []): fail('unclassified_ip_literal')
    ipv6 = re.findall(r'(?<![\w:])(?:[A-Fa-f0-9]{0,4}:){2,}[A-Fa-f0-9:.]*(?:%[A-Za-z0-9_.-]+)?(?![\w:])', normalized)
    for candidate in ipv6:
        try: address = ipaddress.ip_address(candidate)
        except ValueError: continue
        if not address_is_example(address) and digest(candidate.encode()) not in rules.get('reviewed_ip_literals', {}).get(name, []): fail('unclassified_ip_literal')
    for match in EMAIL.finditer(text):
        value = match.group()
        if value.endswith(('@example.com', '@example.org', '@example.net', '@example.test', '@users.noreply.github.com')): continue
        if digest(value.encode()) not in rules.get('public_attribution_emails', {}).get(name, []): fail('unclassified_email')
    allowed_hosts = set(rules.get('public_service_hosts') or PUBLIC_SERVICE_HOSTS)
    for match in SERVICE_HOST.finditer(normalized):
        if match.group(1).casefold() not in allowed_hosts: fail('unlisted_service_host')
    if name in rules.get('synthetic_prompt_files', {}) and digest(data) != rules['synthetic_prompt_files'][name]: fail('unreviewed_prompt_fixture')
    if path.suffix == '.json' and depth < 2:
        try: obj = json.loads(text)
        except ValueError: obj = None
        if isinstance(obj, dict) and isinstance(obj.get('payload'), str) and ('signature' in obj or 'key_id' in obj):
            try: payload = base64.b64decode(obj['payload'], validate=True)
            except ValueError: fail('invalid_signed_payload')
            else:
                for error in validate('signed-payload.json', payload, rules, known_secrets, depth+1): fail(error)
    return errors

def check_source(root=ROOT, known_secrets=()):
    rules = policy(); files = source_files(root); failures=[]
    for name, path in files.items():
        for rule in validate(name, path.read_bytes(), rules, known_secrets): failures.append({'path':name,'rule':rule})
    return {'ok': not failures, 'files':len(files), 'failures':failures}

def check_history(repository, known_secrets=()):
    def git(*args): return subprocess.check_output(['git', '-C', str(repository), *args])
    refs = git('rev-list', '--all').decode().splitlines(); paths={}; failures=[];rules=policy()
    tags = []
    for row in git('for-each-ref','--format=%(objecttype) %(objectname)','refs/tags').decode().splitlines():
        kind, oid = row.split()
        while kind == 'tag' and oid not in tags:
            tags.append(oid)
            raw = git('cat-file','tag',oid)
            for rule in validate('tag-message.txt',raw,rules,known_secrets): failures.append({'object':oid,'rule':rule})
            header = dict(line.split(b' ',1) for line in raw.split(b'\n\n',1)[0].splitlines() if b' ' in line)
            oid, kind = header[b'object'].decode(), header[b'type'].decode()
    for commit in refs:
        for rule in validate('commit-message.txt',git('cat-file','commit',commit),rules,known_secrets): failures.append({'object':commit,'rule':rule})
        for row in git('ls-tree','-r','-z',commit).split(b'\0'):
            if not row: continue
            meta, name = row.split(b'\t',1); mode, kind, oid = meta.decode().split();name=name.decode()
            if kind!='blob' or mode not in {'100644','100755'}: failures.append({'path':name,'rule':'unreviewed_link'})
            else: paths.setdefault(oid,set()).add(name)
    proc=subprocess.Popen(['git','-C',str(repository),'cat-file','--batch'],stdin=subprocess.PIPE,stdout=subprocess.PIPE)
    try:
        for oid,names in paths.items():
            proc.stdin.write((oid+'\n').encode());proc.stdin.flush();header=proc.stdout.readline().decode().split();raw=proc.stdout.read(int(header[2]));assert proc.stdout.read(1)==b'\n'
            for name in names:
                for rule in validate(name,raw,rules,known_secrets):failures.append({'object':oid,'path':name,'rule':rule})
    finally:proc.stdin.close();proc.wait(timeout=10);proc.stdout.close()
    return {'ok':bool(refs) and not failures,'commits':len(refs),'annotatedTags':len(tags),'blobs':len(paths),'failures':failures}

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--history',type=Path);parser.add_argument('--root',type=Path,default=ROOT);parser.add_argument('--output',type=Path);args=parser.parse_args()
    result=check_history(args.history) if args.history else check_source(args.root)
    encoded=json.dumps(result,ensure_ascii=False,indent=2)
    if args.output: args.output.write_text(encoded,encoding='utf-8')
    print(encoded);raise SystemExit(0 if result['ok'] else 1)
