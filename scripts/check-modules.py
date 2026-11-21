#!/usr/bin/env python3
# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: scripts/AGENTS.md | ring 3
# Chains: module-local; query impact before editing
# Regions: desktop_compatibility; release_identity; renderer_dependencies; packages; renderer_delivery; check
# Impact: python -B scripts/code-atlas.py show scripts/check-modules.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""Check Go boundaries, recursive renderer dependencies and host entrypoints.

The V8 module parser reads static JS imports without evaluating application code.
Dynamic imports use a conservative literal-only check. This is an architecture
guard, not an IPC/authentication audit or a security sandbox.
"""
import json
import hashlib
import os
from pathlib import Path
import runpy
import subprocess

ROOT = Path(__file__).resolve().parents[1]
PREFIX = "github.com/aieyra/aieyra-os/CORE"
CLIENT = "github.com/aieyra/aieyra-os/client"


def desktop_compatibility(root=ROOT):
    """Old Program versions retain exact public resource URLs and bytes."""
    manifest = json.loads((root / 'Contracts/desktop-compatibility.json').read_text(encoding='utf-8'))
    assert manifest.get('schema') == 1 and manifest.get('files'), 'invalid desktop compatibility manifest'
    for name, expected in manifest['files'].items():
        assert name.startswith(('Desktop/ui/', 'Desktop/renderer/', 'Desktop/assets/fonts/')) and '..' not in name.split('/'), name
        file = root
        for part in name.split('/'):
            file /= part
            assert not file.is_symlink(), ('linked compatibility resource', name)
        assert file.is_file(), ('missing compatibility resource', name)
        data = file.read_bytes()
        assert len(data) == expected['size'] and hashlib.sha256(data).hexdigest() == expected['sha256'], ('changed compatibility resource', name)
    return manifest['files']


def release_identity(root=ROOT):
    # Reuse the existing platform packaging contract; do not invent another
    # release sequence or equate independently versioned Control/Link services.
    identity = runpy.run_path(str(ROOT / 'scripts/build-macos.py'))['release_identity'](root, {})
    package = json.loads((root / 'Client/Desktop/package.json').read_text(encoding='utf-8'))
    lock = json.loads((root / 'Client/Desktop/package-lock.json').read_text(encoding='utf-8'))
    versions = [package['version'], lock['version'], lock['packages']['']['version']]
    assert all(v == identity['version'] for v in versions), ('Desktop release identity mismatch', versions)
    return identity


def renderer_dependencies(root=ROOT):
    """Keep existing UI files centralized; enforce their host injection boundary."""
    # SourceTextModule is Node built-in tooling: no product/parser dependency.
    script = r'''
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=JSON.parse(fs.readFileSync(0,'utf8')),files=[],edges=[],errors=[];
function walk(dir){if(!fs.existsSync(dir))return;for(const e of fs.readdirSync(dir,{withFileTypes:true})){
 const p=path.join(dir,e.name);if(e.isSymbolicLink())throw Error('Symlink in renderer: '+p);
 if(e.isDirectory())walk(p);else if(/\.[cm]?js$/.test(e.name))files.push(p);
}}
for(const dir of ['Client/Desktop/ui','Control/app/web'])walk(path.join(root,dir));
const relative=p=>path.relative(root,p).replaceAll('\\','/');
const routes={'Control/app/web/ui-ticker.mjs':'Client/Desktop/ui/ticker.mjs','Control/app/web/motion.mjs':'Client/Desktop/ui/motion.mjs','Control/app/web/tooltip.mjs':'Client/Desktop/ui/tooltip.mjs'};
// Existing browser client shared by Desktop. Parsing it does not contact cloud.
const shared=new Set(['Contracts/official-services.mjs','Program/official/link/ui/control.mjs','Program/official/link/ui/link.mjs','Program/official/navigation.mjs','Program/official/servers/ui/app-servers.mjs','Halo/runtime/transition.mjs','Halo/official/pulsar-burst.mjs','Halo/official/effects.mjs','Halo/contract/definition.mjs','Halo/runtime/desktop.mjs','Halo/official/instrument.mjs','Link/cloud/client/remote-link.mjs','Theme/showcase/catalog.mjs','Theme/showcase/fixtures.mjs','Theme/runtime/appearance.mjs','Theme/runtime/control-geometry.mjs','Theme/runtime/copy-feedback.mjs','Theme/runtime/layout.mjs','Theme/runtime/markdown.mjs','Theme/runtime/thinking.mjs','Theme/runtime/media.mjs','Theme/runtime/sounds.mjs','Theme/contract/definition.mjs','Theme/contract/assets.mjs','Theme/contract/elements.mjs','Theme/official/default/chat-layout-schema.mjs','Tool/base/official/apply_patch/presentation/desktop.mjs','Tool/toolbox/official/imagegen/presentation/desktop.mjs','Tool/presentation/desktop.mjs','Tool/presentation/frame.mjs','Tool/presentation/value.mjs','Tool/presentation/receipt.mjs','Tool/base/official/view_image/presentation/desktop.mjs','Tool/base/official/web_search/presentation/desktop.mjs','Tool/base/official/terminal/presentation/desktop.mjs','Tool/base/official/terminal/presentation/text.mjs','Tool/base/official/update_plan/presentation/model.mjs','Tool/base/official/update_plan/presentation/desktop.mjs','Tool/workbox/presentation/desktop.mjs','Tool/toolbox/official/videogen/presentation/desktop.mjs','Tool/presentation/receipt-reader.mjs','Tool/presentation/state.mjs','Tool/presentation/retained-dom.mjs']);
// Scoped receipt readers and their readonly transcript are shared UI; neither
// imports host capabilities. Keep them in the same recursive parser review.
shared.add('Tool/presentation/projection.mjs');
shared.add('Tool/base/official/terminal/presentation/readonly.mjs');
const dataAssets=new Set();
const legacyManifest=path.join(root,'Contracts/desktop-compatibility.json');
if(fs.existsSync(legacyManifest))for(const name of Object.keys(JSON.parse(fs.readFileSync(legacyManifest,'utf8')).files))if(/\.[cm]?js$/.test(name))shared.add(name);
for(const name of shared)if(fs.existsSync(path.join(root,name)))files.push(path.join(root,name));
function edge(file,spec,kind){
 const from=relative(file);if(!spec.startsWith('.')){errors.push({from,spec,kind,error:'Renderer imports non-relative host/package capability'});return;}
 let target=path.resolve(path.dirname(file),spec),to=relative(target);
 if(routes[to]){to=routes[to];target=path.join(root,to);}
 const allowed=to.startsWith('Client/Desktop/ui/')||(from.startsWith('Control/app/web/')&&to.startsWith('Control/app/web/'))||shared.has(to)||dataAssets.has(to);
 if(!allowed||!fs.existsSync(target)||!fs.statSync(target).isFile())errors.push({from,spec,to,kind,error:'Renderer dependency outside reviewed UI or missing'});
 edges.push({from,to,kind});
}
for(const file of files){const from=relative(file),source=fs.readFileSync(file,'utf8');
 // Remove comments but preserve strings, including URLs. Dynamic expressions are
 // intentionally rejected; introducing one requires an explicit reviewed boundary.
 const clean=source.replace(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g,(m,s)=>s||' ');
 try{
  const module=new vm.SourceTextModule(source,{identifier:file});
  for(const spec of module.dependencySpecifiers)edge(file,spec,'static');
  for(const m of clean.matchAll(/\bimport\s*\(\s*([^)]*)\)/g)){
   const literal=m[1].trim();
   if(!/^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')$/.test(literal)){errors.push({from,error:'Unreviewed dynamic import expression'});continue;}
   const parsed=new vm.SourceTextModule('import '+literal+';');edge(file,parsed.dependencySpecifiers[0],'dynamic-literal');
  }
  if(/\brequire\s*\(|\bwindow\s*(?:\.\s*aieyra\b|\[\s*['"]aieyra['"]\s*\])/.test(clean))errors.push({from,error:'Renderer bypasses injected host adapter'});
 }catch(e){errors.push({from,error:e.message});}
}
process.stdout.write(JSON.stringify({files:files.length,edges,errors}));
'''
    result = subprocess.run(
        ['node', '--experimental-vm-modules', '-e', script],
        input=json.dumps(str(root.resolve())), text=True, encoding='utf-8',
        capture_output=True, check=True,
    )
    report = json.loads(result.stdout)
    assert not report['errors'], report['errors']
    return report


def packages(*args, target=None, arch="amd64"):
    env = dict(os.environ)
    if target:
        env.update(GOOS=target, GOARCH=arch, CGO_ENABLED="0")
    result = subprocess.run(
        ["go", "list", "-json", *args], cwd=ROOT / "Core", env=env,
        text=True, encoding="utf-8", capture_output=True, check=True,
    )
    decoder = json.JSONDecoder()
    remaining = result.stdout.lstrip()
    rows = []
    while remaining:
        row, end = decoder.raw_decode(remaining)
        rows.append(row)
        remaining = remaining[end:].lstrip()
    return rows


def renderer_delivery(report):
    """A valid source import must also survive public/runtime packaging."""
    public = runpy.run_path(str(ROOT / 'scripts/public-privacy.py'))['source_files']()
    runtime = runpy.run_path(str(ROOT / 'scripts/runtime-files.py'))['runtime_files'](public)
    required = {edge[key] for edge in report['edges'] for key in ('from', 'to')}
    assert not required - public.keys(), ('renderer omitted from public export', sorted(required - public.keys()))
    assert not required - runtime.keys(), ('renderer omitted from runtime export', sorted(required - runtime.keys()))
    # Browser execution belongs to Program; native services are injected by
    # Desktop. Follow actual page/style references so moving HTML cannot leave
    # an import working only in the development tree.
    browser = ROOT / 'Program/official/browser'
    import re
    for file in (browser / 'service').glob('*.cjs'):
        source = file.read_text(encoding='utf-8')
        imports = re.findall(r"require\(['\"]([^'\"]+)['\"]\)", source)
        assert all(name.startswith(('node:', './', '../ui/')) for name in imports), ('browser bypasses host injection', file, imports)
    for file in browser.rglob('*'):
        if not file.is_file():
            continue
        targets = [file]
        source = file.read_text(encoding='utf-8')
        if file.suffix == '.html':
            targets += [(file.parent / name).resolve() for name in re.findall(r'(?:src|href)="([^"#]+)"', source)]
        if file.suffix == '.css':
            targets += [(file.parent / name).resolve() for name in re.findall(r"@import\s+url\(['\"]?([^'\")]+)", source)]
        for target in targets:
            name = target.relative_to(ROOT).as_posix()
            assert target.is_file() and name in public and name in runtime, ('browser asset omitted from delivery', name)
    return len(required)


def check():
    identity = release_identity()
    desktop_compatibility()
    rows = packages("./...")
    allowed = {
        PREFIX + "/platform": {PREFIX + "/internal/privatefile"},
        PREFIX + "/modules": {PREFIX + "/internal/privatefile"},
        PREFIX + "/tools": {PREFIX + "/platform", PREFIX + "/internal/privatefile"},
    }
    for row in rows:
        name = row["ImportPath"]
        local = {p for p in row.get("Imports", []) if p == PREFIX or p.startswith(PREFIX + "/")}
        if name in allowed:
            assert local <= allowed[name], (name, "forbidden dependencies", sorted(local - allowed[name]))
        if name == PREFIX or name.startswith(PREFIX + "/host"):
            assert not any(p.startswith(PREFIX + "/ui") for p in local), (name, "depends on UI")
        if name == PREFIX:
            assert not any(p.startswith(PREFIX + "/host") for p in local), "core depends on host"
            assert not any(p.startswith(CLIENT) for p in row.get('Imports', [])), 'core depends on client'

    # Shared stores may reuse the owner-private atomic file primitive, never
    # an execution service. Check transitive dependencies too: privatefile may
    # not quietly become a route back into Core or a client.
    for row in packages('-deps', './memoryservice', './sessionservice'):
        if row['ImportPath'] in {PREFIX + '/memoryservice', PREFIX + '/sessionservice'}:
            product = {p for p in row.get('Deps', []) if p.startswith('github.com/aieyra/aieyra-os/')}
            assert all(p == PREFIX + '/internal/privatefile' or p == 'github.com/aieyra/aieyra-os/contracts' or p.startswith('github.com/aieyra/aieyra-os/contracts/') for p in product), ('storage service depends on application', row['ImportPath'], sorted(product))

    # The terminal renderer uses shared contracts, never a second executor.
    clients = packages('-deps', CLIENT + '/...')
    for row in clients:
        if row['ImportPath'].startswith((CLIENT + '/CLI/terminal', CLIENT + '/CLI/mdrender')):
            product = {p for p in row.get('Deps', []) if p.startswith('github.com/aieyra/aieyra-os/')}
            assert all(p.startswith((CLIENT + '/CLI/', 'github.com/aieyra/aieyra-os/contracts', 'github.com/aieyra/aieyra-os/tool/base/official/apply_patch/presentation/text', 'github.com/aieyra/aieyra-os/tool/base/official/apply_patch/contract', 'github.com/aieyra/aieyra-os/tool/base/official/terminal/presentation/text', 'github.com/aieyra/aieyra-os/tool/base/official/web_search/contract', 'github.com/aieyra/aieyra-os/tool/base/official/web_search/presentation/text', 'github.com/aieyra/aieyra-os/tool/base/official/view_image/contract', 'github.com/aieyra/aieyra-os/tool/base/official/view_image/presentation/text', 'github.com/aieyra/aieyra-os/tool/base/official/update_plan/contract', 'github.com/aieyra/aieyra-os/tool/base/official/update_plan/presentation/text', 'github.com/aieyra/aieyra-os/tool/toolbox/official/imagegen/presentation/text', 'github.com/aieyra/aieyra-os/tool/toolbox/official/imagegen/contract', 'github.com/aieyra/aieyra-os/tool/toolbox/official/videogen/presentation/text', 'github.com/aieyra/aieyra-os/tool/presentation/text', 'github.com/aieyra/aieyra-os/tool/contract')) for p in product), (row['ImportPath'], 'renderer depends on execution host', sorted(product))

    # Tool source packages own execution and presentation independently. A
    # renderer cannot gain executor or host imports by sharing the tool root.
    tool = packages('-deps', 'github.com/aieyra/aieyra-os/tool/...')
    for row in tool:
        name = row['ImportPath']
        if name.startswith('github.com/aieyra/aieyra-os/tool/'):
            product = {p for p in row.get('Deps', []) if p.startswith('github.com/aieyra/aieyra-os/')}
            assert all(p.startswith(('github.com/aieyra/aieyra-os/tool/', 'github.com/aieyra/aieyra-os/contracts')) for p in product), (name, 'tool depends on application', sorted(product))
            if '/presentation/' in name:
                assert all('/presentation/' in p or '/contract' in p or p.startswith('github.com/aieyra/aieyra-os/contracts') for p in product), (name, 'presentation depends on executor', sorted(product))

    # Provider transport is an independent module: it must never acquire
    # settings, storage, tools or GUI dependencies through a Core back edge.
    api = packages("-deps", "github.com/aieyra/aieyra-os/api/...")
    for row in api:
        name = row['ImportPath']
        if name.startswith('github.com/aieyra/aieyra-os/api/'):
            product = {p for p in row.get('Deps', []) if p.startswith('github.com/aieyra/aieyra-os/')}
            assert all(p.startswith(('github.com/aieyra/aieyra-os/api/', 'github.com/aieyra/aieyra-os/contracts')) for p in product), (name, 'API depends on application', sorted(product))

    agent = packages('-deps', 'github.com/aieyra/aieyra-os/agent/...')
    for row in agent:
        name = row['ImportPath']
        if name.startswith('github.com/aieyra/aieyra-os/agent/'):
            product = {p for p in row.get('Deps', []) if p.startswith('github.com/aieyra/aieyra-os/')}
            assert all(p.startswith(('github.com/aieyra/aieyra-os/agent/', 'github.com/aieyra/aieyra-os/contracts')) for p in product), (name, 'agent definition depends on execution host', sorted(product))
            if name.startswith('github.com/aieyra/aieyra-os/agent/context'):
                assert all(p.startswith(('github.com/aieyra/aieyra-os/agent/context', 'github.com/aieyra/aieyra-os/contracts')) for p in product), (name, 'shared context depends on an official personality', sorted(product))

    for row in packages('-deps', 'github.com/aieyra/aieyra-os/halo/...'):
        if row['ImportPath'].startswith('github.com/aieyra/aieyra-os/halo/'):
            assert not any(p.startswith('github.com/aieyra/aieyra-os/') and not p.startswith('github.com/aieyra/aieyra-os/halo/') for p in row.get('Deps', [])), 'Halo contract depends on host or Theme'

    linux = packages("-deps", "./cmd/aieyra-os", target="linux")
    for target in ('windows', 'darwin', 'linux'):
        desktop = packages('-deps', './cmd/aieyra-os', './cmd/aieyra-config', target=target)
        assert not any(r['ImportPath'] == PREFIX + '/ui' for r in desktop), (target, 'legacy executor UI')
    assert not list((ROOT / 'Core/ui').glob('*.go')), 'Legacy executor UI retained'
    cli_dependencies = {}
    for target, arch in [('windows', 'amd64'), ('linux', 'amd64'), ('android', 'arm64')]:
        cli = packages('-deps', './cmd/aieyra-cli', target=target, arch=arch)
        forbidden = [r['ImportPath'] for r in cli if r['ImportPath'] == PREFIX + '/ui']
        assert not forbidden, ('Dedicated CLI includes legacy executor UI', target, forbidden)
        assert any(r['ImportPath'] == CLIENT + '/CLI/terminal' for r in cli), target
        # Bubbles textarea retains a transitive clipboard import. Its keymap is
        # disabled; Unix pastes arrive from the terminal, with no X11 dependency.
        cli_dependencies[target] = len(cli)

    renderer = renderer_dependencies()
    renderer['delivered_files'] = renderer_delivery(renderer)
    # Verify the selected renderer is mounted through the host adapter. Settings
    # must not load the workspace, and an unknown extension must not fall back.
    entry = (ROOT / "Client/Desktop/host/entry.mjs").as_uri()
    subprocess.run(["node", "--input-type=module", "-e", f"""
import assert from 'node:assert/strict';
import {{mountDesktop}} from {json.dumps(entry)};
const api = {{}}, extension = {{}}, calls = [];
const options = {{api, extension,
  workspace: async () => {{ calls.push('workspace'); return {{mountWorkspace(value) {{
    assert.equal(value, api); return 'workspace';
  }}}}; }},
  settings: async () => {{ calls.push('settings'); return {{mountSettings(value, transport) {{
    assert.equal(value, api); assert.equal(transport, extension); return 'settings';
  }}}}; }}
}};
const mount = query => mountDesktop({{...options, location: {{href: 'https://desktop.invalid/' + query}}}});
assert.equal(await mount(''), 'workspace');
assert.deepEqual(calls.splice(0), ['workspace']);
assert.equal(await mount('?extension=settings'), 'settings');
assert.deepEqual(calls.splice(0), ['settings']);
await assert.rejects(mount('?extension=unknown'), /未知的扩展入口/);
assert.deepEqual(calls, []);
"""], cwd=ROOT, check=True)
    assert '../host/entry.mjs' in (ROOT / "Client/Desktop/ui/index.html").read_text(encoding="utf-8")
    for relative in ["Core/app", "Core/cli", "Client/Desktop/src/workspace", "Client/Desktop/renderer/workspace"]:
        assert not (ROOT / relative).exists(), ("old source path retained", relative)
    print(json.dumps({"ok": True, "release": identity, "packages": len(rows), "linux_dependencies": len(linux),
                      "cli_dependencies": cli_dependencies,
                      "renderer_files": renderer['files'], "renderer_edges": len(renderer['edges']), "renderer_delivered_files": renderer['delivered_files'],
                      "boundaries": ["core", "contracts/protocol", "api/transport", "api/codec", "api/request", "api/parameters", "api/catalog", "api/images", "client/CLI", "tool/base", "tool/toolbox", "agent/contract", "agent/official", "tool/presentation", "tools", "ui", "host", "platform"]}))


if __name__ == "__main__":
    check()
