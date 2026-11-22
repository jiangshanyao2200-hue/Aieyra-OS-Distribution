# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: scripts/AGENTS.md | ring 3
# Chains: module-local; query impact before editing
# Regions: WindowsPackage
# Impact: python -B scripts/code-atlas.py show scripts/test_windows_package.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""Standalone delivery regressions; only public package artifacts are copied."""
import importlib.util, io, json, os, shutil, subprocess, tempfile, unittest, zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('windows_package', Path(__file__).with_name('build-windows.py'))
package = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(package)


class WindowsPackage(unittest.TestCase):
    def test_ascii_alias_to_unicode_source_uses_utf8_zip_flag(self):
        transport = package.load('test_transport', 'windows-transport.py')
        stream = io.BytesIO()
        source = 'Config/OpenCode模型.json'
        with zipfile.ZipFile(stream, 'w') as archive:
            archive.writestr(transport.entry('Program/catalog.json', transport.COPY + source.encode()), b'')
        with zipfile.ZipFile(stream) as archive:
            entry = archive.infolist()[0]
            self.assertTrue(entry.flag_bits & 0x800)
            self.assertEqual(entry.comment.decode(), 'copy-v1:' + source)

    @unittest.skipUnless(os.name == 'nt', 'requires actual Windows cmd and Windows PowerShell')
    def test_native_bat_reads_bomless_utf8_config(self):
        # Install.bat launches Windows PowerShell, whose default encoding differs
        # from pwsh7. Use the actual Chinese public config, not an ASCII fixture.
        with tempfile.TemporaryDirectory(prefix='aieyra-bat-') as folder:
            root = Path(folder) / '中文 包 (安装)&'
            dest = Path(folder) / '临时 桌面 (验证)&'
            generated = Path(folder) / 'generated'
            generated.mkdir()
            inventory = package.os_files(package.ROOT, generated)
            names = ['Install.bat', 'scripts/create-launchers.ps1', 'Client/Desktop/host/module-launchers.json',
                     'scripts/sync-cli-entry.ps1', 'Config/运行参数.json']
            # Only icons actually shipped in the package may satisfy shortcuts.
            names.extend(name for name in inventory if name.endswith('.ico'))
            for name in names:
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(inventory[name], target)
            raw = (root / 'Config/运行参数.json').read_bytes()
            self.assertFalse(raw.startswith(b'\xef\xbb\xbf'))
            stage = json.loads(raw)['release_stage']
            launchers = json.loads((root / 'Client/Desktop/host/module-launchers.json').read_text(encoding='utf-8'))
            suite = {'Aieyra OS', *(name for key, name in launchers.items() if key != 'link')}
            if stage.get('cli'):
                suite.add('Aieyra CLI')
            for name in suite:
                (root / f'{name}.exe').write_bytes(b'never executed; shortcut target only')
            command = '"' + os.environ['COMSPEC'] + '" /d /s /c ""' + str(root / 'Install.bat') + '" "' + str(dest) + '""'
            result = subprocess.run(command, capture_output=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr.decode('utf-8', errors='replace'))
            expected = {f'{name}.lnk' for name in suite}
            self.assertEqual({p.name for p in dest.glob('*.lnk')}, expected)

    def test_complete_runtime_inventory_is_accepted_by_desktop_updater(self):
        node = os.environ.get('AIEYRA_TEST_NODE') or shutil.which('node')
        if not node:
            self.skipTest('Node unavailable for update inventory validation')
        with tempfile.TemporaryDirectory(prefix='aieyra-package-paths-') as folder:
            files = package.os_files(package.ROOT, Path(folder))
            result = subprocess.run([node, '-e',
                "const fs=require('node:fs'),f=require('./Client/Desktop/src/managed-update-files.cjs');"
                "for(const name of JSON.parse(fs.readFileSync(0,'utf8')))f.safeName(name)",
                ], cwd=package.ROOT, input=json.dumps(list(files)), text=True,
                encoding='utf-8', capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('Agent/context/history/policy.go', files)
            self.assertIn('Link/cloud/client/remote-link.mjs', files)
            self.assertIn('docs/工程地图.json', files)
            self.assertLess(len(files), package.WINDOWS_ARCHIVE_ENTRIES)
            self.assertLess(sum(p.stat().st_size for p in files.values()), package.WINDOWS_FULL_BYTES)
            workspace = 'Program/official/workspace/node_modules/'
            self.assertIn(workspace + 'exceljs/lib/doc/data/theme1.json', files)
            self.assertIn(workspace + 'pdfjs-dist/build/pdf.mjs', files)
            self.assertIn(workspace + '@napi-rs/canvas-win32-x64-msvc/skia.win32-x64-msvc.node', files)
            self.assertNotIn(workspace + 'lucide-react/package.json', files)

    def test_final_os_map_accounts_for_added_engines_without_rewriting_vendor_documents(self):
        privacy = package.load('final_os_privacy_test', 'public-privacy.py')
        runtime = package.load('final_os_runtime_test', 'runtime-files.py')
        with tempfile.TemporaryDirectory(prefix='aieyra-final-os-docs-') as folder:
            root = Path(folder)
            source_map = {'schema': 'aieyra.project-map/1', 'modules': [{
                'id': 'runtime', 'entries': ['runtime/search/LICENSE.txt'], 'documents': [],
                'agreement': 'runtime/AGENTS.md'}]}
            fixtures = {'docs/工程地图.json': json.dumps(source_map),
                        'Program/official/workspace/package-lock.json': json.dumps({'packages': {}}),
                        'runtime/AGENTS.md': '[license](search/LICENSE.txt)',
                        'runtime/search/LICENSE.txt': 'license',
                        'Client/Desktop/node_modules/electron/README.md': '[upstream](not-bundled.md)',
                        'empty-boundary.txt': ''}
            for name, text in fixtures.items():
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(text, encoding='utf-8')
            for name in package.EXECUTABLES:
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(b'synthetic executable')
            generated = root / 'generated'
            generated.mkdir()
            public = {name: root / name for name in ('docs/工程地图.json', 'runtime/AGENTS.md')}
            controlled_privacy = SimpleNamespace(
                check_source=lambda _: {'ok': True}, source_files=lambda _: public,
                development=privacy.development,
                resources=SimpleNamespace(public_default_files=lambda _: {'边界': root / 'empty-boundary.txt'}))
            modules = {'public-privacy.py': controlled_privacy, 'runtime-files.py': runtime,
                       'provision-media.py': SimpleNamespace(verify=lambda _: None)}
            with patch.object(package, 'ROOT', root), patch.object(package, 'load', side_effect=lambda _, file: modules[file]):
                final = package.os_files(root, generated)
            content = {name: path.read_bytes() if name.endswith('.md') or name == privacy.development.MAP else b''
                       for name, path in final.items()}
            report = privacy.development.validate(content)
            self.assertTrue(report['ok'], report['failures'])
            missing = json.loads(content[privacy.development.MAP])['distribution']['unavailable']['runtime']
            self.assertEqual(missing['entries'], [])
            self.assertEqual(final['Client/Desktop/node_modules/electron/README.md'], root / 'Client/Desktop/node_modules/electron/README.md')
            self.assertEqual(content['runtime/AGENTS.md'], b'[license](search/LICENSE.txt)')

    def test_developer_navigation_is_projected_for_each_actual_package_inventory(self):
        privacy = package.load('documentation_privacy_test', 'public-privacy.py')
        runtime = package.load('documentation_runtime_test', 'runtime-files.py')
        full = runtime.runtime_files(privacy.source_files(package.ROOT))
        for name in package.LINK_REQUIRED:
            if name.endswith('.exe'):
                full.setdefault(name, package.ROOT / name)
        with tempfile.TemporaryDirectory(prefix='aieyra-delivery-documents-') as folder:
            for kind, files in [('os', full), ('link', package.link_files(package.ROOT, full))]:
                rendered = privacy.development.prepare_paths(files, Path(folder) / kind)
                content = {name: path.read_bytes() if name.endswith('.md') or name == privacy.development.MAP else b''
                           for name, path in rendered.items()}
                self.assertTrue(privacy.development.validate(content)['ok'], kind)
                for name in privacy.development.DOCUMENTS:
                    self.assertTrue(name in rendered, (kind, name))
                map_document = json.loads(content[privacy.development.MAP])
                missing = map_document['distribution']['unavailable']
                self.assertIn('AIDEBUG/aidebug.cjs', missing['aidebug']['entries'])
                for name, path in rendered.items():
                    if path != files[name]:
                        self.assertTrue(name.endswith(('.md', '.json')))
                        self.assertEqual(privacy.validate(name, path.read_bytes()), [], name)

    def test_theme_showcase_loads_from_reviewed_package_without_source_checkout(self):
        node = os.environ.get('AIEYRA_TEST_NODE') or shutil.which('node')
        if not node:
            self.skipTest('Node unavailable for isolated module-load smoke')
        privacy = package.load('showcase_privacy_test', 'public-privacy.py')
        runtime = package.load('showcase_runtime_test', 'runtime-files.py')
        selected = runtime.runtime_files(privacy.source_files(package.ROOT))
        # Only a disposable package artifact. No implementation is edited here.
        with tempfile.TemporaryDirectory(prefix='aieyra-showcase-package-') as tmp:
            target = Path(tmp)
            for name, source in selected.items():
                if name.startswith(('Theme/', 'Tool/')) and source.suffix in {'.mjs', '.cjs', '.json'}:
                    dest = target / name
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(source, dest)
            script = """
import assert from 'node:assert/strict';
const catalog=await import('./Theme/showcase/catalog.mjs');
const fixtures=await import('./Theme/showcase/fixtures.mjs');
assert(catalog.scenes.length>0 && catalog.totals.elements>0);
assert.equal(typeof fixtures.mountScene,'function');
assert.equal(typeof fixtures.setSampleState,'function');
console.log(JSON.stringify({scenes:catalog.scenes.length,...catalog.totals}));
"""
            result = subprocess.run([node, '--input-type=module', '-e', script], cwd=target, capture_output=True, text=True, encoding='utf-8', timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertGreater(json.loads(result.stdout)['scenes'], 0)

    def test_link_includes_shared_runtime_and_public_prompt_dependencies(self):
        privacy = package.load('link_privacy_test', 'public-privacy.py')
        runtime = package.load('link_runtime_test', 'runtime-files.py')
        full = runtime.runtime_files(privacy.source_files(package.ROOT))
        # Binary presence is separately checked by the real staging builder.
        for name in package.LINK_REQUIRED:
            if name.endswith('.exe'):
                full.setdefault(name, package.ROOT / name)
        selected = package.link_files(package.ROOT, full)
        required = ['Core/platform/config-file.cjs', 'Theme/runtime/settings.cjs',
                    'Theme/official/default/appearance.css', 'Contracts/product-layout.json',
                    'Contracts/resources/prompts.cjs', 'Agent/official/definitions.cjs',
                    'Agent/official/Eyra/context/prompts/上下文清洗.txt']
        self.assertFalse([name for name in required if name not in selected])
        self.assertNotIn('Aieyra OS.exe', selected)
        self.assertNotIn('Config/config.json', selected)
        self.assertNotIn('Prompt/Matrix/边界.txt', selected)
        self.assertTrue(all(name in selected for name in privacy.resources.public_resource_files(package.ROOT)))
        # Official defaults are indexed package resources. Private layers and
        # the retired default copies must never be exported alongside them.
        defaults = privacy.resources.public_default_files(package.ROOT)
        for name, source in defaults.items():
            canonical = 'Agent/official/Eyra/prompts/default/'+name+'.txt'
            self.assertEqual(source, package.ROOT / canonical)
            self.assertIn(canonical, selected)
            self.assertNotIn('Prompt/Matrix/默认/'+name+'.txt', selected)
        self.assertTrue(privacy.check_source(package.ROOT)['ok'])
        node = os.environ.get('AIEYRA_TEST_NODE') or shutil.which('node')
        if not node:
            self.skipTest('Node unavailable for isolated module-load smoke')
        # This is a package smoke artifact, never a second development checkout.
        with tempfile.TemporaryDirectory(prefix='aieyra-link-package-') as tmp:
            target = Path(tmp)
            for name, source in selected.items():
                if source.is_file() and source.suffix in package.TEXT:
                    dst = target / name
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(source, dst)
            script = r"""
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=process.cwd();process.env.AIEYRA_RESOURCE_ROOT=root;
assert.equal(typeof require('./Client/Desktop/host/window-theme.cjs').createWindowTheme,'function');
require('./Client/Desktop/src/model-setup.cjs');require('./Client/Desktop/src/managed-update-files.cjs');
const r=require('./Client/Desktop/src/resources.cjs');
for(const name of r.promptIndex().names())assert.equal(typeof r.prompt(name),'string',name);
const stylesheet=fs.readFileSync('Theme/official/default/appearance.css','utf8');assert(stylesheet.length>100);
for(const name of Object.keys(require.cache))assert(name.startsWith(root+path.sep),'module escaped isolated package');
// Load the real renderer graph as well: host-only requires missed the remote
// Link client imported by the standalone page before it can mount its view.
import('./Client/Desktop/ui/module-link.mjs').then(()=>{
 console.log(JSON.stringify({modules:Object.keys(require.cache).length,prompts:r.promptIndex().names().length}));
}).catch(error=>{console.error(error);process.exitCode=1;});
"""
            result = subprocess.run([node, '-e', script], cwd=target, capture_output=True, text=True, encoding='utf-8', timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertGreater(json.loads(result.stdout)['modules'], 10)

    def test_computer_native_dependencies_survive_source_os_and_link_selection(self):
        privacy = package.load('computer_privacy_test', 'public-privacy.py')
        runtime = package.load('computer_runtime_test', 'runtime-files.py')
        source = privacy.source_files(package.ROOT)
        full = runtime.runtime_files(source)
        for name in package.LINK_REQUIRED:
            if name.endswith('.exe'):
                full.setdefault(name, package.ROOT / name)
        selected = package.link_files(package.ROOT, full)
        names = ['Client/Desktop/tools/computer-use.ps1', 'Client/Desktop/tools/computer-input.cs']
        for kind, files in [('source', source), ('os', full), ('link', selected)]:
            for name in names:
                self.assertTrue(name in files, (kind, name))
                self.assertEqual(files[name].read_bytes(), (package.ROOT / name).read_bytes())
                self.assertEqual(privacy.validate(name, files[name].read_bytes()), [])
        # Resolve the native compiler input from the delivered script itself.
        # No development checkout or arbitrary tools directory supplies it.
        with tempfile.TemporaryDirectory(prefix='aieyra-computer-payload-') as folder:
            target = Path(folder)
            for name in names:
                dest = target / name
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(selected[name], dest)
            script = target / names[0]
            import re
            dependencies = re.findall(r"Join-Path \$PSScriptRoot '([^']+\.cs)'", script.read_text(encoding='utf-8-sig'))
            self.assertEqual(dependencies, ['computer-input.cs'])
            for dependency in dependencies:
                self.assertTrue((script.parent / dependency).is_file())
            manifest = package.baseline({name: target / name for name in names}, '0.0.1', 1)
            self.assertTrue(all(name in manifest['texts'] for name in names))

    def test_cloud_adapter_imports_from_public_payload_without_development_checkout(self):
        privacy = package.load('cloud_payload_privacy_test', 'public-privacy.py')
        runtime = package.load('cloud_payload_runtime_test', 'runtime-files.py')
        source = privacy.source_files(package.ROOT)
        full = runtime.runtime_files(source)
        for name in package.LINK_REQUIRED:
            if name.endswith('.exe'):
                full.setdefault(name, package.ROOT / name)
        selected = package.link_files(package.ROOT, full)
        names = ['Link/cloud/desktop_owner.py', 'Link/cloud/protocol.py', 'Link/portable/link.py',
                 'Link/portable/agent.py', 'Link/portable/cloud_transport.py']
        for files in [source, full, selected]:
            for name in names:
                self.assertTrue(name in files, name)
                self.assertEqual(privacy.validate(name, files[name].read_bytes()), [])
        with tempfile.TemporaryDirectory(prefix='aieyra-cloud-payload-') as folder:
            target = Path(folder)
            for name, source in selected.items():
                if name in names or name.startswith(('Control/app/scripts/', 'Control/app/service/')) and name.endswith('.py'):
                    dest = target / name
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(source, dest)
            script = """
import importlib.util,socket
from pathlib import Path
def deny_network(*a,**k): raise AssertionError('imports must not contact an office')
socket.socket.connect=socket.socket.connect_ex=socket.create_connection=socket.getaddrinfo=deny_network
root=Path.cwd()
for name in ['Link/portable/link.py','Link/portable/cloud_transport.py','Link/cloud/desktop_owner.py']:
 spec=importlib.util.spec_from_file_location(Path(name).stem,root/name)
 module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
print('three cloud entry imports passed without network or source checkout')
"""
            import sys
            result = subprocess.run([sys.executable, '-B', '-c', script], cwd=target,
                                    capture_output=True, text=True, encoding='utf-8', timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_macos_ssh_payload_loads_its_transitive_modules_without_checkout(self):
        mac = package.load('mac_ssh_payload', 'build-macos.py')
        node = os.environ.get('AIEYRA_TEST_NODE') or shutil.which('node')
        if not node:
            self.skipTest('Node unavailable for SSH payload smoke')
        with tempfile.TemporaryDirectory(prefix='aieyra-macos-ssh-') as folder:
            target = Path(folder)
            mac.copy_desktop_network_runtime(package.ROOT, target)
            script = "const ssh=require('./Client/Desktop/node_modules/ssh2');if(typeof ssh.Client!=='function')throw Error('SSH client missing');if(typeof require('./Client/Desktop/node_modules/socks').SocksClient.createConnection!=='function')throw Error('SOCKS client missing');"
            result = subprocess.run([node, '-e', script], cwd=target, capture_output=True,
                                    text=True, encoding='utf-8', timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_standalone_shared_host_keeps_ssh_and_core_native_runtime(self):
        privacy = package.load('link_shared_host_privacy', 'public-privacy.py')
        runtime = package.load('link_shared_host_runtime', 'runtime-files.py')
        full = runtime.runtime_files(privacy.source_files(package.ROOT))
        for name in package.LINK_REQUIRED:
            if name.endswith('.exe'):
                full.setdefault(name, package.ROOT / name)
        for prefix in ['Core/tools/runtime', 'runtime/search'] + [
                'Client/Desktop/node_modules/' + name
                for name in package.DESKTOP_NETWORK_PACKAGES]:
            full.update(package.tree(package.ROOT / prefix, prefix))
        selected = package.link_files(package.ROOT, full)
        self.assertIn('Client/Desktop/host/main.cjs', selected)
        self.assertNotIn('Aieyra OS.exe', selected)
        self.assertTrue(any(n.startswith('Core/tools/runtime/') for n in selected))
        self.assertTrue(any(n.startswith('runtime/search/') for n in selected))
        node = os.environ.get('AIEYRA_TEST_NODE') or shutil.which('node')
        if not node:
            self.skipTest('Node unavailable for independent SSH import')
        with tempfile.TemporaryDirectory(prefix='aieyra-link-shared-host-') as folder:
            target = Path(folder)
            for name, source in selected.items():
                if name.startswith('Client/Desktop/node_modules/'):
                    dest = target / name
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(source, dest)
            result = subprocess.run([node, '-e', "if(typeof require('./Client/Desktop/node_modules/ssh2').Client!=='function')throw Error('SSH closure missing');if(typeof require('./Client/Desktop/node_modules/socks').SocksClient.createConnection!=='function')throw Error('SOCKS client missing')"],
                                    cwd=target, capture_output=True, text=True, encoding='utf-8', timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_modular_prompt_gets_merge_baseline_before_budget_is_used(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            files = {}
            for name, text in [('API/catalog/sample.txt', 'ordinary source'),
                               ('Agent/official/Eyra/context/prompts/规则.txt', 'rule'),
                               ('Theme/official/default/appearance.css', 'body{}')]:
                p = root / name
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(text, encoding='utf-8')
                files[name] = p
            with patch.object(package, 'TEXTS_TOTAL', 10):
                result = package.baseline(files, '0.0.1', 1)
            self.assertEqual(set(result['texts']), {'Agent/official/Eyra/context/prompts/规则.txt', 'Theme/official/default/appearance.css'})
            self.assertEqual(set(result['files']), set(files))


if __name__ == '__main__':
    unittest.main()
