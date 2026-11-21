# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: scripts/AGENTS.md | ring 3
# Chains: development
# Regions: digest; safe; load; style; preamble; without_header; inventory; declarations; relative_link; directory_map; module_for; ring_for; imports; build; atomic_write; refresh; check; source_identity; agreements_for; context_packet; validate_context; main
# Impact: python -B scripts/code-atlas.py show scripts/code-atlas.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""Maintain compact source navigation; declarations/imports are hints, not a call graph.

Only declared module source trees are read. Signed packages, compatibility payloads,
generated files and dependencies receive external maps without source edits.
"""
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
CODE = {'.go', '.js', '.mjs', '.cjs', '.py', '.css', '.ps1', '.sh', '.html', '.ts', '.tsx', '.cs', '.sql'}
SKIP = {'.git', '.tools', 'node_modules', 'vendor', 'test-runtime', '__pycache__', 'out', 'evidence', 'history', 'dist', 'build', 'test-output', 'data', 'sessions', 'memory', 'cache', 'logs', '私有数据', '共享库'}
ENGINES = {'runtime', 'Client/Desktop/runtime', 'Link/app/runtime', 'Control/app/runtime', 'Link/cloud/client/runtime'}
OWNED = {'Agent/context/history', 'Program/official/workspace/dist'}
INDEX = 'docs/代码链索引.json'
MARKER = '<AI-CHAIN v1>'
END = '</AI-CHAIN>'


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def safe(root, name):
    p = PurePosixPath(name)
    if not name or not p.parts or p.is_absolute() or '\\' in name or ':' in name or any(x in {'.', '..'} for x in p.parts):
        raise ValueError('Expected a project-relative path')
    current = root
    for part in p.parts:
        current /= part
        if current.exists():
            attrs = getattr(current.lstat(), 'st_file_attributes', 0)
            if current.is_symlink() or attrs & getattr(stat, 'FILE_ATTRIBUTE_REPARSE_POINT', 0):
                raise ValueError('Linked source path: ' + name)
    current.resolve().relative_to(root.resolve())
    return current


def load(root, name):
    return json.loads(safe(root, name).read_text(encoding='utf-8-sig'))


def style(name):
    suffix = Path(name).suffix.lower()
    if suffix == '.html':
        return None
    return '#' if suffix in {'.py', '.ps1', '.sh'} else '--' if suffix == '.sql' else '/*' if suffix == '.css' else '//'


def preamble(text, name):
    prefix = '\ufeff' if text.startswith('\ufeff') else ''
    text = text[len(prefix):]
    lines = text.splitlines(keepends=True)
    count = 1 if lines and lines[0].startswith('#!') else 0
    if Path(name).suffix == '.py':
        for i, line in enumerate(lines[:2]):
            if re.match(r'^\s*#.*coding[:=]\s*[-\w.]+', line):
                count = max(count, i + 1)
    if Path(name).suffix == '.css' and text.startswith('@charset '):
        end = text.find(';')
        if end >= 0:
            count = 2 if text[end+1:].startswith('\r\n') else 1 if text[end+1:].startswith('\n') else 0
            return prefix + text[:end+1+count], text[end+1+count:]
    return prefix + ''.join(lines[:count]), ''.join(lines[count:])


def without_header(text, name):
    prefix, body = preamble(text, name)
    first = ('/* ' if style(name) == '/*' else (style(name) or '') + ' ') + MARKER
    if not body.startswith(first):
        return text
    end = body.find(END)
    if end < 0:
        raise ValueError('Incomplete generated header: ' + name)
    newline = body.find('\n', end)
    if style(name) == '/*':
        closing = body.find('*/', end)
        if closing < 0:
            raise ValueError('Incomplete CSS chain header: '+name)
        newline = body.find('\n', closing)
    rest = body[newline+1:] if newline >= 0 else ''
    if rest.startswith('\r\n'):
        rest = rest[2:]
    elif rest.startswith('\n'):
        rest = rest[1:]
    return prefix + rest


def inventory(root, modules):
    roots = sorted({m['path'].split('/')[0] for m in modules} - {'Config', 'docs', 'runtime', 'Desktop'})
    names, packages = [], set()
    for folder in roots:
        origin = safe(root, folder)
        if not origin.is_dir():
            continue
        for base, dirs, files in os.walk(origin, followlinks=False):
            relative = Path(base).relative_to(root).as_posix()
            safe(root, relative)
            dirs[:] = sorted(d for d in dirs if (d.lower() not in SKIP or relative+'/'+d in OWNED) and relative+'/'+d not in ENGINES)
            for d in dirs:
                safe(root, relative+'/'+d)
            if 'manifest.json' in files:
                packages.add(relative)
            for file in sorted(files):
                if Path(file).suffix.lower() in CODE:
                    name = relative+'/'+file
                    safe(root, name)
                    names.append(name)
    # Compatibility files are navigable, but remain byte-for-byte untouched.
    compat = load(root, 'Contracts/desktop-compatibility.json').get('files', {})
    names.extend(n for n in compat if Path(n).suffix.lower() in CODE and safe(root, n).is_file())
    return sorted(set(names)), packages, set(compat)


def declarations(text, name):
    suffix = Path(name).suffix.lower()
    if suffix == '.py':
        tree = ast.parse(text.lstrip('\ufeff'), filename=name)
        return [{'name': n.name, 'kind': type(n).__name__, 'bodyLine': n.lineno} for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))]
    if suffix == '.go':
        pattern = r'(?m)^(func\s+(?:\([^\n]*?\)\s+)?|type\s+|var\s+|const\s+)([A-Za-z_]\w*)'
    elif suffix in {'.js', '.cjs', '.mjs', '.ts', '.tsx'}:
        pattern = r'(?m)^(?:export\s+(?:default\s+)?)?(?:async\s+)?(function\s+\*?\s*|class\s+|const\s+|let\s+|var\s+)([A-Za-z_$][\w$]*)'
    elif suffix in {'.ps1', '.sh'}:
        pattern = r'(?mi)^(function\s+)([\w-]+)'
    elif suffix == '.css':
        pattern = r'(?m)^([^/{}\n][^{}\n]{0,180})\s*(\{)'
    else:
        return []
    # Lexical candidates deliberately retain their limited proof strength.
    return [{'name': (m.group(1).strip() if suffix == '.css' else m.group(2)), 'kind': 'lexical', 'bodyLine': text.count('\n', 0, m.start())+1} for m in re.finditer(pattern, text)]


def relative_link(origin, target):
    return os.path.relpath(target, PurePosixPath(origin).parent).replace('\\', '/')


def directory_map(directory, protected):
    return 'docs/代码链目录/' + directory.replace('/', '--') + '.md' if protected else directory+'/CODEMAP.md'


def module_for(name, modules):
    return max((m for m in modules if name.startswith(m['path']+'/')), key=lambda m: len(m['path']), default=None)


def ring_for(mid, config):
    choices = [(len(prefix), ring) for ring, r in config['rings'].items() for prefix in r['modules'] if mid == prefix or mid.startswith(prefix+'.')]
    return max(choices)[1] if choices else '3'


def imports(text, name, names, gomods):
    suffix = Path(name).suffix.lower()
    specs = []
    if suffix in {'.js', '.cjs', '.mjs', '.ts', '.tsx'}:
        specs = re.findall(r'''(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)['"]([^'"\n]+)['"]''', text)
    elif suffix == '.css':
        specs = re.findall(r'''@import\s+['"]([^'"\n]+)['"]''', text)
    elif suffix == '.go':
        groups = re.findall(r'(?ms)^import\s*\((.*?)^\)', text)
        specs = re.findall(r'"([^"\n]+)"', '\n'.join(groups)) + re.findall(r'(?m)^import\s+(?:\w+\s+)?"([^"\n]+)"', text)
    elif suffix == '.py':
        tree = ast.parse(text.lstrip('\ufeff'), filename=name)
        for n in ast.walk(tree):
            if isinstance(n, ast.ImportFrom) and n.module:
                specs.append(('.' * n.level) + n.module)
    found = set()
    for spec in specs:
        if suffix == '.go':
            for module, base in gomods.items():
                if spec == module or spec.startswith(module+'/'):
                    folder = base + spec[len(module):]
                    found.update(n for n in names if n.endswith('.go') and not n.endswith('_test.go') and PurePosixPath(n).parent.as_posix() == folder)
        else:
            if suffix != '.py' and not spec.startswith('.'):
                continue
            if suffix == '.py':
                level = len(spec) - len(spec.lstrip('.'))
                parent = PurePosixPath(name).parent
                for _ in range(max(0, level-1)):
                    parent = parent.parent
                candidate = parent / spec.lstrip('.').replace('.', '/')
            else:
                candidate = PurePosixPath(name).parent / spec
            resolved = os.path.normpath(str(candidate)).replace('\\', '/')
            found.update(p for p in (resolved, *(resolved+s for s in ('.mjs', '.cjs', '.js', '.py', '.ts', '.tsx', '/index.cjs', '/index.js', '/__init__.py'))) if p in names)
    return sorted(found - {name})


def build(root):
    modules = load(root, 'docs/工程地图.json')['modules']
    config = load(root, 'Contracts/code-chains.json')
    if config.get('schema') != 'aieyra.code-chains/1':
        raise ValueError('Unsupported code-chain schema')
    names, packages, compat = inventory(root, modules)
    name_set = set(names)
    gomods = {}
    for m in modules:
        p = safe(root, m['path']+'/go.mod')
        if p.is_file():
            match = re.search(r'(?m)^module\s+(\S+)', p.read_text(encoding='utf-8'))
            if match:
                gomods[match.group(1)] = m['path']
    chains = {c['id']: c for c in config['chains']}
    if len(chains) != len(config['chains']):
        raise ValueError('Duplicate chain ID')
    for chain in chains.values():
        for name in chain['files']:
            if not safe(root, name).is_file():
                raise ValueError('Chain entry missing: '+name)
    records, originals, outputs = {}, {}, {}
    for name in names:
        raw = safe(root, name).read_bytes()
        text = without_header(raw.decode('utf-8'), name)
        module = module_for(name, modules)
        if not module:
            raise ValueError('Source directory lacks module ownership: '+name)
        package = next((p for p in sorted(packages, key=len) if name.startswith(p+'/')), None)
        protected = 'signed-package' if package else 'compatibility' if name in compat else 'generated' if re.search(r'(?im)(?:Code generated|DO NOT EDIT|sourceMappingURL=|^[ \t]*(?://|#|/\*|\*)[ \t]*Generated (?:by|from)\b)', text[:2048]) or name.endswith(('.min.js', '.d.ts')) else 'format' if style(name) is None else None
        directory = PurePosixPath(name).parent.as_posix()
        mapfile = directory_map(directory, bool(package) or name in compat)
        records[name] = {'module': module['id'], 'ring': ring_for(module['id'], config), 'agreement': module['agreement'], 'map': mapfile, 'bodySHA256': digest(text.encode('utf-8')), 'regions': declarations(text, name), 'imports': imports(text, name, name_set, gomods), 'chains': sorted(cid for cid,c in chains.items() if name in c['files']), 'protected': protected}
        originals[name] = text
    incoming = {n: [] for n in names}
    for name, r in records.items():
        for dependency in r['imports']:
            incoming[dependency].append(name)
    directories = {}
    for name, r in records.items():
        r['consumers'] = sorted(incoming[name])
        directories.setdefault(r['map'], []).append(name)
        if r['protected']:
            continue
        prefix, body = preamble(originals[name], name)
        marker = style(name)
        rows = [MARKER, 'Map: '+relative_link(name, r['map']), 'Owner: '+r['agreement']+' | ring '+r['ring'], 'Chains: '+(', '.join(r['chains']) or 'module-local; query impact before editing'), 'Regions: '+('; '.join(s['name'] for s in r['regions']) or 'module initialization / declarations'), 'Impact: python -B scripts/code-atlas.py show '+name, 'Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.', END]
        if marker == '/*':
            header = '/* '+rows[0]+'\n'+'\n'.join(' * '+line for line in rows[1:])+'\n */\n\n'
        else:
            header = '\n'.join(marker+' '+line for line in rows)+'\n\n'
        newline = '\r\n' if '\r\n' in originals[name] else '\n'
        outputs[name] = (prefix+header.replace('\n', newline)+body).encode('utf-8')
    for mapfile, entries in directories.items():
        folder = PurePosixPath(entries[0]).parent.as_posix()
        agreements = sorted({records[n]['agreement'] for n in entries})
        rows = ['<!-- Generated by scripts/code-atlas.py; edit code/contracts/nearest AGENTS, then refresh. -->', '# '+folder+' · 代码地图', '', '先读 '+ '、'.join('['+a+']('+relative_link(mapfile,a)+')' for a in agreements)+'。本图列实际文件、区域候选和静态导入；不是完整调用图或实际验收结论。', '', '市中心维护契约与执行边界，一环提供共同组件/服务，二环装配场景，三环扩展具体能力；环号是阅读层次，不能替代真实依赖规则。', '', '## 文件与区域目录', '']
        for name in entries:
            r = records[name]
            rows += ['### '+PurePosixPath(name).name, '', '['+name+']('+relative_link(mapfile,name)+') · '+r['module']+' · 环'+r['ring']+' · '+(r['protected'] or '自有源码，顶部注释链由本工具维护'), '', '区域：'+('; '.join(s['name'] for s in r['regions']) or '初始化与声明；直接阅读源码')+'。', '', '导入：'+(', '.join('`'+n+'`' for n in r['imports']) or '未解析到本项目静态导入')+'。', '', '消费者：'+(', '.join('`'+n+'`' for n in r['consumers']) or '静态导入未解析到；仍须查注册/IPC/模板/运行时消费者')+'。', '']
            for cid in r['chains']:
                c = chains[cid]
                rows += ['链 `'+cid+'`：'+c['purpose'], '', *('- '+s for s in c['invariants']), '', '实际场景：'+(', '.join('`'+s+'`' for s in c['scenes']) or '按模块影响选择，不能从地图推定通过')+'。', '']
        outputs[mapfile] = ('\n'.join(rows)+'\n').encode('utf-8')
    atlas = {'schema': 'aieyra.code-atlas/1', 'proof': 'Python top-level AST; other declarations and literal imports are lexical candidates. Dynamic calls, IPC, CSS consumers and runtime ownership require the curated chains and actual investigation.', 'contractSHA256': digest(safe(root,'Contracts/code-chains.json').read_bytes()), 'projectMapSHA256': digest(safe(root,'docs/工程地图.json').read_bytes()), 'files': records, 'directories': {m: es for m, es in sorted(directories.items())}}
    outputs[INDEX] = (json.dumps(atlas,ensure_ascii=False,indent=2)+'\n').encode('utf-8')
    return atlas, outputs


def atomic_write(path, raw):
    temporary = path.with_name(path.name+'.code-atlas.tmp')
    if temporary.exists():
        raise ValueError('Previous interrupted write retained: '+temporary.name)
    temporary.write_bytes(raw)
    for attempt in range(10):
        try:
            os.replace(temporary,path)
            return
        except PermissionError:
            if attempt == 9:
                raise
            time.sleep(.02)


def refresh(root, outputs, atlas):
    # Preflight every source before any write; never overwrite concurrent edits.
    for name, r in atlas['files'].items():
        if name in outputs:
            p = safe(root,name)
            if not p.is_file() or digest(without_header(p.read_bytes().decode('utf-8'),name).encode('utf-8')) != r['bodySHA256']:
                raise ValueError('Source changed after indexing: '+name)
    for name, raw in outputs.items():
        p = safe(root, name)
        if p.is_file() and p.read_bytes() == raw:
            continue
        p.parent.mkdir(parents=True, exist_ok=True)
        if name.endswith('/CODEMAP.md') and p.exists() and not p.read_bytes().startswith(b'<!-- Generated by scripts/code-atlas.py;'):
            raise ValueError('Existing handwritten directory map retained: '+name)
        atomic_write(p,raw)
    # Explicit file-by-file documentation inventory; no recursive export rule.
    manifest = load(root, 'Contracts/development-documents.json')
    docs = {n for n in outputs if n.endswith('.md') or n == INDEX}
    manifest['documents'] = sorted(set(manifest['documents']) | docs)
    manifest_path = safe(root,'Contracts/development-documents.json')
    raw = (json.dumps(manifest,ensure_ascii=False,indent=2)+'\n').encode('utf-8')
    if manifest_path.read_bytes() != raw:
        atomic_write(manifest_path,raw)


def check(root, atlas, outputs):
    stale = [n for n, raw in outputs.items() if not safe(root,n).is_file() or safe(root,n).read_bytes() != raw]
    declared = set(load(root, 'Contracts/development-documents.json')['documents'])
    missing = [n for n in outputs if (n.endswith('.md') or n == INDEX) and n not in declared]
    return {'ok': not stale and not missing, 'files': len(atlas['files']), 'directories': len(atlas['directories']), 'protectedFiles': sum(bool(r['protected']) for r in atlas['files'].values()), 'stale': stale, 'undeclaredDocumentation': missing}


def source_identity(root, atlas):
    """Hash current scoped files without rebuilding declarations or emitting bodies.

    Target-only freshness misses a new/deleted consumer. Inventory and every
    indexed body are checked together; metadata hashes bind the graph owner.
    """
    if atlas.get('schema') != 'aieyra.code-atlas/1':
        raise ValueError('Unsupported atlas; run refresh/check')
    metadata = {'Contracts/code-chains.json': atlas['contractSHA256'],
                'docs/工程地图.json': atlas.get('projectMapSHA256')}
    for name, expected in metadata.items():
        if not expected or digest(safe(root, name).read_bytes()) != expected:
            raise ValueError('Navigation metadata changed; run refresh/check: '+name)
    modules = load(root, 'docs/工程地图.json')['modules']
    names, _, _ = inventory(root, modules)
    if set(names) != set(atlas['files']):
        raise ValueError('Source inventory changed; run refresh/check')
    identities = []
    for name in names:
        raw = safe(root, name).read_bytes()
        body = without_header(raw.decode('utf-8'), name).encode('utf-8')
        if digest(body) != atlas['files'][name]['bodySHA256']:
            raise ValueError('Indexed body changed; run refresh/check: '+name)
        identities.append([name, digest(raw)])
    metadata[INDEX] = digest(safe(root, INDEX).read_bytes())
    metadata['Contracts/development-documents.json'] = digest(safe(root, 'Contracts/development-documents.json').read_bytes())
    return {'sourceFiles': len(names), 'sourceSHA256': digest(json.dumps(identities, separators=(',', ':')).encode('utf-8')), 'metadata': metadata}


def agreements_for(root, name):
    # Actual ancestor instructions can be more specific than the module owner.
    folders = [PurePosixPath('.'), *reversed(PurePosixPath(name).parent.parents), PurePosixPath(name).parent]
    return list(dict.fromkeys((folder/'AGENTS.md').as_posix() for folder in folders if safe(root, (folder/'AGENTS.md').as_posix()).is_file()))


def context_packet(root, target, limit=12, depth=1):
    if not 1 <= limit <= 40 or not 0 <= depth <= 3:
        raise ValueError('context limit 1..40 and depth 0..3 required')
    atlas = load(root, INDEX)
    identity = source_identity(root, atlas)
    config = load(root, 'Contracts/code-chains.json')
    chains = {c['id']: c for c in config['chains']}
    if target.startswith('chain:'):
        chain = chains.get(target[6:])
        if not chain:
            raise ValueError('Unknown chain')
        seeds = list(dict.fromkeys(chain['files']))
    else:
        safe(root, target)
        seeds = [target]
    if not seeds or any(n not in atlas['files'] for n in seeds):
        raise ValueError('Context target outside indexed source scope')
    if len(seeds) > limit:
        raise ValueError('limit must retain all chain seeds: '+str(len(seeds)))
    found = {n: {'relation': 'seed', 'depth': 0, 'from': None} for n in seeds}
    queue = list(seeds)
    # Curated dynamic links outrank lexical edges; BFS stays within the indexed
    # graph. A truncated result declares its omissions rather than inventing reach.
    for name in queue:
        level = found[name]['depth']
        if level >= depth:
            continue
        record = atlas['files'][name]
        relations = [('chain:'+cid, n) for cid in record['chains'] for n in chains[cid]['files']]
        relations += [('consumer', n) for n in record['consumers']]
        relations += [('import', n) for n in record['imports']]
        if name.endswith('.go'):
            relations += [('same-go-directory-candidate', n) for n in sorted(atlas['files']) if n.endswith('.go') and PurePosixPath(n).parent == PurePosixPath(name).parent]
        for relation, peer in relations:
            if peer not in found:
                found[peer] = {'relation': relation, 'depth': level+1, 'from': name}
                queue.append(peer)
    selected = queue[:limit]
    chain_ids = sorted({cid for n in selected for cid in atlas['files'][n]['chains']})
    references, records = [], []
    for name in selected:
        r = atlas['files'][name]
        text = safe(root, name).read_bytes().decode('utf-8')
        offset = text.count('\n')-without_header(text, name).count('\n')
        instructions = agreements_for(root, name)
        references += instructions + [r['agreement'], r['map']]
        records.append({'file': name, 'module': r['module'], 'ring': r['ring'], 'protected': r['protected'], 'why': found[name],
                        'agreements': instructions, 'map': r['map'], 'chains': r['chains'],
                        'regions': [{**region, 'line': region['bodyLine']+offset} for region in r['regions'][:4]],
                        'regionCount': len(r['regions']), 'imports': r['imports'][:4], 'importCount': len(r['imports']),
                        'consumers': r['consumers'][:4], 'consumerCount': len(r['consumers'])})
    modules = load(root, 'docs/工程地图.json')['modules']
    owners = [m for m in modules if m['id'] in {r['module'] for r in records}]
    # Instructions precede navigation; maps and source remain on-demand reads.
    read_order = list(dict.fromkeys([n for r in records for n in r['agreements']] + references))
    reference_hashes = {n: digest(safe(root, n).read_bytes()) for n in read_order}
    value = {'schema': 'aieyra.development-context/1', 'sourceRoot': str(root.resolve()), 'target': target,
             'basis': identity, 'references': reference_hashes, 'readOrder': read_order, 'depth': depth,
             'files': records, 'discoveredFiles': len(queue), 'omittedFiles': len(queue)-len(selected),
             'chains': [chains[cid] for cid in chain_ids],
             'owners': [{'id': m['id'], 'agreement': m['agreement'], 'status': m.get('status', 'unknown'),
                         'responsibility': m.get('responsibility', ''), 'verification': m.get('verification', []),
                         'pending': m.get('pending', [])} for m in owners],
             'limits': [atlas['proof'], 'Bounded traversal and four anchors/edges per file; counts disclose omissions. Read source and actual instructions before editing.',
                        'Scenario/suite selectors are recommendations from curated chains, not executed checks or coverage proof. No private task, configuration, credential or source body is included.']}
    # Detect a concurrent edit while the packet was assembled, not just before.
    if identity != source_identity(root, atlas) or any(digest(safe(root, n).read_bytes()) != h for n, h in reference_hashes.items()):
        raise ValueError('Source or instructions changed while collecting context')
    return value


def validate_context(root, packet):
    if not isinstance(packet, dict) or packet.get('schema') != 'aieyra.development-context/1' or packet.get('sourceRoot') != str(root.resolve()):
        raise ValueError('Context belongs to a different source root or schema')
    # Re-derive the bounded packet. A modified artifact cannot introduce extra
    # source/private paths through its references or silently remove constraints.
    current = context_packet(root, packet['target'], len(packet['files']), packet['depth'])
    if current != packet:
        raise ValueError('Context is stale or modified; collect a new packet')
    return {'ok': True, 'schema': packet['schema'], 'files': len(packet['files']), 'sourceFilesVerified': packet['basis']['sourceFiles']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['refresh', 'check', 'show', 'chain', 'recipe', 'context', 'context-check'])
    parser.add_argument('target', nargs='?')
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--limit', type=int, default=12)
    parser.add_argument('--depth', type=int, default=1)
    parser.add_argument('--max-chars', type=int, default=24000)
    parser.add_argument('--out', type=Path)
    args = parser.parse_args()
    if not 1 <= args.limit <= 100:
        raise ValueError('limit must be between 1 and 100')
    root = args.root.resolve()
    if (args.out or args.depth != 1 or args.max_chars != 24000) and args.command != 'context':
        raise ValueError('--out/--depth/--max-chars apply only to context')
    if args.command == 'context':
        if not args.target:
            raise ValueError('context <indexed-file|chain:ID> required')
        value = context_packet(root, args.target, args.limit, args.depth)
    elif args.command == 'context-check':
        if not args.target or not Path(args.target).is_absolute():
            raise ValueError('context-check requires an absolute context artifact path')
        value = validate_context(root, json.loads(Path(args.target).read_text(encoding='utf-8')))
    elif args.command in {'chain','recipe'}:
        c = load(root,'Contracts/code-chains.json')
        value = c['program_recipe'] if args.command == 'recipe' else next((x for x in c['chains'] if x['id'] == args.target), None)
        if not value:
            raise ValueError('Unknown chain')
    elif args.command == 'show':
        safe(root,args.target or '')
        atlas = load(root,INDEX)
        if atlas.get('schema') != 'aieyra.code-atlas/1' or atlas['contractSHA256'] != digest(safe(root,'Contracts/code-chains.json').read_bytes()):
            raise ValueError('Code-chain index stale; run refresh/check')
        r = atlas['files'].get(args.target)
        if not r:
            raise ValueError('File outside indexed source scope')
        current = safe(root,args.target).read_bytes().decode('utf-8')
        if digest(without_header(current,args.target).encode('utf-8')) != r['bodySHA256']:
            raise ValueError('Requested file changed; refresh the navigation')
        peers = sorted(n for n in atlas['files'] if n != args.target and n.endswith('.go') and PurePosixPath(n).parent == PurePosixPath(args.target).parent) if args.target.endswith('.go') else []
        value = {'file':args.target, **r, 'sameGoPackageCandidates':peers, 'freshness':'Target body and chain contract verified; use check for graph-wide changes.', 'readNext':'Follow chains, imports, consumers and nearest agreement; static hints do not resolve dynamic ownership.'}
        value['totals'] = {key:len(value[key]) for key in ('regions','imports','consumers','sameGoPackageCandidates')}
        for key in value['totals']:
            value[key] = value[key][:args.limit]
    else:
        atlas, outputs = build(root)
        if args.command == 'refresh':
            refresh(root,outputs,atlas)
        value = check(root,atlas,outputs)
    encoded = json.dumps(value,ensure_ascii=False,indent=2)+'\n'
    if args.command == 'context':
        if not 4000 <= args.max_chars <= 100000 or len(encoded) > args.max_chars:
            raise ValueError('Context exceeds character budget; reduce --limit/--depth or set --max-chars 4000..100000')
        if args.out:
            # Context is a task artifact, not a source or public-document update.
            destination = args.out
            if not destination.is_absolute() or destination.exists():
                raise ValueError('Context --out must be a new absolute artifact path')
            boundary = root.parent if (root.parent/'AGENTS.md').is_file() else root
            if destination.resolve().is_relative_to(boundary.resolve()):
                raise ValueError('Context artifact must be outside the project')
            current = destination
            while current != current.parent:
                if current.is_symlink() or (current.exists() and getattr(current.lstat(), 'st_file_attributes', 0) & getattr(stat, 'FILE_ATTRIBUTE_REPARSE_POINT', 0)):
                    raise ValueError('Linked context artifact path')
                current = current.parent
            destination.parent.mkdir(parents=True, exist_ok=True)
            with destination.open('x', encoding='utf-8') as stream:
                stream.write(encoded)
            print(json.dumps({'file': str(destination), 'characters': len(encoded), 'files': len(value['files']), 'omittedFiles': value['omittedFiles']}, ensure_ascii=False))
            return 0
    print(encoded, end='')
    return 0 if value.get('ok',True) else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError, SyntaxError, KeyError, TypeError) as error:
        print(str(error),file=sys.stderr)
        sys.exit(1)
