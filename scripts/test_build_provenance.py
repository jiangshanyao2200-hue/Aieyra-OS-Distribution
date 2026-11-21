# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: scripts/AGENTS.md | ring 3
# Chains: module-local; query impact before editing
# Regions: BuildSources
# Impact: python -B scripts/code-atlas.py show scripts/test_build_provenance.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""Build identity regressions use temporary public checkouts and inert outputs."""
import importlib.util
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('build_provenance', Path(__file__).with_name('build-provenance.py'))
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


class BuildSources(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='aieyra-provenance-test-')
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.root = self.base / 'product 中文'
        self.receipts = self.base / 'receipts'
        for name in build.privacy.EXTRAS:
            self.write(name)
        self.write('scripts/PUBLIC-README.md', b'public navigation\n')
        self.write('Core/main.go', b'package main\n')
        self.write('Core/host/app.go', b'package host\n')
        self.write('Client/Desktop/ui/main.css', b'body { color: white; }\n')
        for name in build.privacy.resources.PUBLIC_CONFIG:
            self.write('Config/' + name, b'{}')
        self.write('Config/提示词索引.json', b'{"resources": []}')
        for name in ('自我.txt', '工作.txt', '边界.txt', '思考方式.txt'):
            self.write('Prompt/Matrix/默认/' + name, b'public default\n')

    def write(self, name, data=b'fixture\n', root=None):
        path = (root or self.root) / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return path

    def begin(self):
        return build.begin(self.root, self.receipts)

    def test_same_bytes_keep_digest_and_each_build_gets_its_own_id(self):
        first = self.begin()
        source = self.root / 'Core/main.go'
        os.utime(source, None)
        second = self.begin()
        self.assertEqual(first['source_digest'], second['source_digest'])
        self.assertNotEqual(first['build_id'], second['build_id'])
        self.assertNotEqual(first['snapshot'], second['snapshot'])
        self.assertEqual(build.verify(self.root, first['snapshot'])['status'], 'prepared')

    def test_digest_is_not_tied_to_absolute_checkout_path(self):
        first = build.source_manifest(self.root)
        other = self.base / 'relocated'
        for path in self.root.rglob('*'):
            if path.is_file():
                self.write(path.relative_to(self.root).as_posix(), path.read_bytes(), other)
        self.assertEqual(first, build.source_manifest(other))

    def test_private_config_data_and_compiled_outputs_never_enter_sources(self):
        first = self.begin()
        for name in ('Config/config.json', 'Config/link/cloud-office.json',
                     'Data/Agents/Eyra/prompts/边界.txt', 'Data/private.sqlite',
                     'Core/memory/private.sqlite', 'Client/Desktop/node_modules/private.json',
                     'Core/cmd/aieyra-os/resource_windows_amd64.syso', *build.ARTIFACTS):
            self.write(name, b'not a product source\n')
        current = build.source_manifest(self.root)
        self.assertEqual(first['source_digest'], current['source_digest'])
        self.assertFalse(any(name.startswith('Data/') for name in current['files']))
        self.assertNotIn('Config/config.json', current['files'])
        self.assertEqual(build.verify(self.root, first['snapshot'])['status'], 'prepared')

    def test_source_content_change_rejects_completion_without_rewriting_receipt(self):
        identity = self.begin()
        receipt = Path(identity['snapshot'])
        original = receipt.read_bytes()
        self.write('Client/Desktop/ui/main.css', b'body { color: black; }\n')
        with self.assertRaisesRegex(ValueError, 'Build sources changed: Client/Desktop/ui/main.css'):
            build.verify(self.root, receipt, complete=True)
        self.assertEqual(receipt.read_bytes(), original)

    def test_added_and_removed_sources_are_detected(self):
        identity = self.begin()
        added = self.write('Core/added.go', b'package main\n')
        with self.assertRaisesRegex(ValueError, 'Core/added.go'):
            build.verify(self.root, identity['snapshot'])
        added.unlink()
        (self.root / 'Core/main.go').unlink()
        with self.assertRaisesRegex(ValueError, 'Core/main.go'):
            build.verify(self.root, identity['snapshot'])

    def test_equal_bytes_under_a_different_logical_path_change_digest(self):
        identity = self.begin()
        (self.root / 'Core/main.go').rename(self.root / 'Core/renamed.go')
        with self.assertRaisesRegex(ValueError, 'Core/main.go.*Core/renamed.go'):
            build.verify(self.root, identity['snapshot'])

    def test_complete_requires_all_four_outputs_and_preserves_build_identity(self):
        identity = self.begin()
        receipt = Path(identity['snapshot'])
        for name in build.ARTIFACTS[:-1]:
            self.write(name, name.encode())
        with self.assertRaises(FileNotFoundError):
            build.verify(self.root, receipt, complete=True)
        self.assertEqual(json.loads(receipt.read_bytes())['status'], 'prepared')
        self.write(build.ARTIFACTS[-1], b'fourth inert artifact')
        result = build.verify(self.root, receipt, complete=True)
        saved = json.loads(receipt.read_bytes())
        self.assertEqual(result['status'], 'complete')
        self.assertEqual(set(saved['artifacts']), set(build.ARTIFACTS))
        for key in ('build_id', 'source_digest', 'built_at'):
            self.assertEqual(saved[key], identity[key])
        with self.assertRaisesRegex(ValueError, 'already complete'):
            build.verify(self.root, receipt, complete=True)

    def test_receipts_cannot_be_written_inside_product_tree(self):
        target = self.root / 'Data/build-receipts'
        with self.assertRaisesRegex(ValueError, 'outside the product'):
            build.begin(self.root, target)
        self.assertFalse(target.exists())

    def public_package(self):
        name = 'Tool/base/official/fixture/presentation.mjs'
        payload = b'export const value = 1;\n'
        manifest = 'Tool/base/official/fixture/manifest.json'
        self.write(name, payload)
        self.write(manifest, json.dumps({'schema': 'aieyra.mod/1', 'files': {
            'presentation.mjs': {'size': len(payload), 'sha256': hashlib.sha256(payload).hexdigest()},
        }}).encode())
        return name, manifest

    def test_changed_declared_package_payload_blocks_next_build_before_receipt_or_output_changes(self):
        name, _ = self.public_package()
        first = self.begin()
        self.assertEqual(first['package_payload_files'], 2)
        original = Path(first['snapshot']).read_bytes()
        for artifact in build.ARTIFACTS:
            self.write(artifact, b'previous inert build\n')
        # Same length: file existence and byte count alone cannot catch this.
        self.write(name, b'export const value = 2;\n')
        with self.assertRaisesRegex(ValueError, 'development_package_payload_mismatch: ' + name):
            self.begin()
        self.assertEqual(Path(first['snapshot']).read_bytes(), original)
        self.assertEqual(len(list(self.receipts.glob('*.json'))), 1)
        for artifact in build.ARTIFACTS:
            self.assertEqual((self.root / artifact).read_bytes(), b'previous inert build\n')

    def test_missing_declared_payload_blocks_first_receipt(self):
        name, _ = self.public_package()
        (self.root / name).unlink()
        with self.assertRaisesRegex(ValueError, 'development_package_payload_mismatch: ' + name):
            self.begin()
        self.assertFalse(self.receipts.exists())

    def test_package_preflight_does_not_collect_unselected_private_payload(self):
        _, manifest = self.public_package()
        private = self.write('Data/not-public.txt', b'synthetic private marker\n')
        self.write(manifest, json.dumps({'schema': 'aieyra.mod/1', 'files': {
            '../../../../Data/not-public.txt': {'size': private.stat().st_size,
                                               'sha256': hashlib.sha256(private.read_bytes()).hexdigest()},
        }}).encode())
        ordinary_open = Path.open
        def guarded_open(path, *args, **kwargs):
            if path.resolve() == private.resolve():
                self.fail('Package preflight read an unselected private payload')
            return ordinary_open(path, *args, **kwargs)
        with patch.object(Path, 'open', guarded_open):
            with self.assertRaisesRegex(ValueError, 'development_package_payload_mismatch'):
                self.begin()
        self.assertFalse(self.receipts.exists())

    def test_tampered_snapshot_and_a_different_product_root_are_rejected(self):
        identity = self.begin()
        receipt = Path(identity['snapshot'])
        with self.assertRaisesRegex(ValueError, 'identity is invalid'):
            build.verify(self.base / 'different-product', receipt)
        value = json.loads(receipt.read_bytes())
        value['files']['Data/private.txt'] = {'size': 0, 'sha256': '0' * 64}
        receipt.write_text(json.dumps(value), encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'identity is invalid'):
            build.verify(self.root, receipt)

    def test_redirected_source_and_receipt_are_rejected(self):
        identity = self.begin()
        source = self.root / 'Core/main.go'
        source.unlink()
        try:
            source.symlink_to(self.root / 'Core/host/app.go')
        except OSError as error:
            self.skipTest('Symlink creation unavailable: ' + type(error).__name__)
        with self.assertRaisesRegex(ValueError, 'source_symlink|redirected'):
            build.verify(self.root, identity['snapshot'])
        source.unlink()
        self.write('Core/main.go', b'package main\n')
        redirected = self.receipts / 'redirected.json'
        redirected.symlink_to(identity['snapshot'])
        with self.assertRaisesRegex(ValueError, 'receipt is redirected'):
            build.verify(self.root, redirected)

    def test_rebuild_helper_dependencies_use_the_shared_runtime_selector(self):
        names = {'scripts/build-provenance.py', 'scripts/public-privacy.py',
                 'scripts/runtime-files.py', 'scripts/resources.py',
                 'scripts/development-docs.py', 'scripts/public-privacy-policy.json',
                 'scripts/provision-search.py', 'scripts/search-runtime.lock.json',
                 'scripts/build-module-launchers.ps1', 'scripts/winres.py'}
        reviewed = {name: b'public' for name in names | {'Data/private.json', 'Config/config.json'}}
        self.assertEqual(set(build.runtime.runtime_files(reviewed)), names)

    def test_actual_public_inventory_retains_the_build_helpers(self):
        selected = build.selected_sources(build.ROOT)
        for name in ('Core/build.ps1', 'Core/host/app.go', 'Core/host/workspace.go',
                     'scripts/build-provenance.py', 'scripts/build-module-launchers.ps1',
                     'scripts/public-privacy.py', 'scripts/public-privacy-policy.json',
                     'scripts/runtime-files.py', 'scripts/resources.py',
                     'scripts/development-docs.py', 'scripts/provision-search.py',
                     'scripts/search-runtime.lock.json', 'scripts/winres.py'):
            self.assertIn(name, selected)
            self.assertTrue(selected[name].is_file(), name)
        self.assertFalse(any(name.startswith('Data/') for name in selected))
        self.assertNotIn('Config/config.json', selected)

    def test_cli_round_trip_and_changed_source_exit_code(self):
        command = [sys.executable, '-B', str(Path(build.__file__)), 'begin',
                   '--root', str(self.root), '--receipt-dir', str(self.receipts)]
        started = subprocess.run(command, capture_output=True, text=True, encoding='utf-8', timeout=20)
        self.assertEqual(started.returncode, 0, started.stderr)
        identity = json.loads(started.stdout)
        command = [sys.executable, '-B', str(Path(build.__file__)), 'verify',
                   '--root', str(self.root), '--snapshot', identity['snapshot']]
        checked = subprocess.run(command, capture_output=True, text=True, encoding='utf-8', timeout=20)
        self.assertEqual(checked.returncode, 0, checked.stderr)
        self.assertEqual(json.loads(checked.stdout)['build_id'], identity['build_id'])
        self.write('Core/main.go', b'package changed\n')
        rejected = subprocess.run(command, capture_output=True, text=True, encoding='utf-8', timeout=20)
        self.assertEqual(rejected.returncode, 1)
        self.assertIn('Build sources changed', rejected.stderr)

    def test_cli_payload_mismatch_fails_before_creating_any_receipt(self):
        name, manifest = self.public_package()
        original = (self.root / manifest).read_bytes()
        self.write(name, b'export const value = 2;\n')
        command = [sys.executable, '-B', str(Path(build.__file__)), 'begin',
                   '--root', str(self.root), '--receipt-dir', str(self.receipts)]
        result = subprocess.run(command, capture_output=True, text=True, encoding='utf-8', timeout=20)
        self.assertEqual(result.returncode, 1)
        self.assertIn('development_package_payload_mismatch: ' + name, result.stderr)
        self.assertEqual(result.stdout, '')
        self.assertFalse(self.receipts.exists())
        self.assertEqual((self.root / manifest).read_bytes(), original)


if __name__ == '__main__':
    unittest.main()
