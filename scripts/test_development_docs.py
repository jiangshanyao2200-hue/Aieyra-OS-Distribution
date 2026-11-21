# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: scripts/AGENTS.md | ring 3
# Chains: module-local; query impact before editing
# Regions: DevelopmentDocuments
# Impact: python -B scripts/code-atlas.py show scripts/test_development_docs.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

import importlib.util
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('privacy', Path(__file__).with_name('public-privacy.py'))
privacy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(privacy)
docs = privacy.development


class DevelopmentDocuments(unittest.TestCase):
    def test_inventory_validation_uses_public_origins_and_checks_exported_edits(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            guide = root / 'guide.md'
            guide.write_bytes(b'# Guide')
            readme = root / 'PUBLIC-README.md'
            readme.write_bytes(b'[Guide](guide.md)')
            map_path = root / 'map.json'
            map_path.write_text(json.dumps({'schema': 'aieyra.project-map/1', 'modules': [{
                'id': 'docs', 'entries': ['guide.md'], 'documents': [], 'agreement': 'guide.md'}]}), encoding='utf-8')
            paths = {'README.md': readme, 'guide.md': guide, docs.MAP: map_path}
            self.assertTrue(docs.validate_paths(paths)['ok'])
            content, _ = docs.prepare(docs.document_contents(paths))
            map_path.write_bytes(content[docs.MAP])
            readme.write_bytes(b'[Missing](missing.md)')
            self.assertFalse(docs.validate_paths(paths)['ok'])
            readme.write_bytes(b'[Guide](guide.md)')
            del paths['guide.md']
            self.assertFalse(docs.validate_paths(paths)['ok'])

    def test_public_templates_use_destination_links_and_reexport_reads_actual_roots(self):
        guide = 'docs/开发指南.md'
        source_map = {'schema': 'aieyra.project-map/1', 'modules': [{
            'id': 'docs', 'entries': [guide], 'documents': [], 'agreement': 'docs/AGENTS.md'}]}
        files = {docs.MAP: json.dumps(source_map).encode(), guide: b'# Guide',
                 'AGENTS.md': ('[Guide](' + guide + ')').encode(),
                 'scripts/PUBLIC-AGENTS.md': ('[Guide](' + guide + ')').encode()}
        prepared, _ = docs.prepare(files)
        self.assertEqual(prepared['AGENTS.md'], prepared['scripts/PUBLIC-AGENTS.md'])
        self.assertIn(b'[Guide]', prepared['AGENTS.md'])
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for name, data in prepared.items():
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
            # A user's edit in the exported checkout must be read and scanned,
            # not silently replaced by the template on a later export/check.
            secret = b'ghp_' + b'F' * 36
            (root / 'AGENTS.md').write_bytes(secret)
            selected = dict(docs.source_files(root))
            self.assertEqual(selected['AGENTS.md'], root / 'AGENTS.md')
            self.assertIn('credential_or_private_key', privacy.validate('AGENTS.md', selected['AGENTS.md'].read_bytes(), {}))

    def test_signed_markdown_bytes_are_preserved_and_missing_payload_blocks_export(self):
        payload = b'\xef\xbb\xbf# Exact package manual\r\n'
        manifest = {'schema': 'aieyra.mod/1', 'files': {
            'manual.md': {'sha256': hashlib.sha256(payload).hexdigest(), 'size': len(payload)}}}
        files = {docs.MAP: json.dumps({'schema': 'aieyra.project-map/1', 'modules': [{
            'id': 'sdk', 'entries': [], 'documents': [], 'agreement': 'SDK/AGENTS.md'}]}).encode(),
            'SDK/example/manifest.json': json.dumps(manifest).encode(),
            'SDK/example/manual.md': payload}
        prepared, _ = docs.prepare(files)
        self.assertEqual(prepared['SDK/example/manual.md'], payload)
        del files['SDK/example/manual.md']
        with self.assertRaisesRegex(ValueError, 'development_package_payload_mismatch'):
            docs.prepare(files)

    def test_package_preflight_reuses_measured_identities_without_payload_collection(self):
        payload = b'public payload\n'
        expected = {'size': len(payload), 'sha256': hashlib.sha256(payload).hexdigest()}
        files = {'Tool/fixture/manifest.json': json.dumps({
            'schema': 'aieyra.mod/1', 'files': {'view.mjs': expected}}).encode()}
        facts = {'Tool/fixture/view.mjs': expected}
        self.assertEqual(docs.exact_package_files(files, identity=facts.get),
                         {'Tool/fixture/manifest.json', 'Tool/fixture/view.mjs'})
        with self.assertRaisesRegex(ValueError, 'development_package_payload_mismatch'):
            docs.exact_package_files(files)
        facts['Tool/fixture/view.mjs'] = {**expected, 'sha256': '0' * 64}
        with self.assertRaisesRegex(ValueError, 'development_package_payload_mismatch'):
            docs.exact_package_files(files, identity=facts.get)

    def test_exact_document_selection_preserves_privacy_checks(self):
        for name in ('docs/工程地图.md', 'AIDEBUG/core/AGENTS.md', 'Config/AGENTS.md', 'docs/提示词目录.md'):
            with self.subTest(name=name):
                self.assertEqual(privacy.validate(name, b'Public contract', {}), [])
                secret = b'ghp_' + b'F' * 36
                self.assertIn('credential_or_private_key', privacy.validate(name, secret, {}))
                self.assertIn('known_credential', privacy.validate(name, b'Private contract', {}, [b'Private contract']))
        for name in ('docs/CURRENT.md', 'docs/private-notes.md', 'AIDEBUG/core/secret.md',
                     'Prompt/private.md', 'Config/private.md', 'Core/link/AGENTS.md',
                     'DOCS/工程地图.md', 'docs/../Config/AGENTS.md'):
            self.assertTrue(privacy.validate(name, b'Private source', {}), name)

    def test_selected_document_cannot_follow_external_symlink(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            external = root / 'private'
            external.mkdir()
            (external / '工程地图.md').write_text('private text', encoding='utf-8')
            try:
                (root / 'docs').symlink_to(external, target_is_directory=True)
            except OSError as error:
                self.skipTest('symlink unavailable: ' + type(error).__name__)
            with self.assertRaisesRegex(ValueError, 'development_document_symlink'):
                dict(docs.source_files(root))

    def test_distribution_is_explicit_and_does_not_invent_implementation_acceptance(self):
        original = {'schema': 'aieyra.project-map/1', 'modules': [{
            'id': 'client', 'path': 'Client', 'agreement': 'Client/AGENTS.md',
            'entries': ['Client/main.go', 'Client/private-adapter.go'],
            'documents': ['docs/CURRENT.md'], 'status': 'contract', 'pending': ['Not implemented'],
        }]}
        files = {
            docs.MAP: json.dumps(original).encode(), 'Client/main.go': b'package client',
            'Client/AGENTS.md': ('[source](main.go) [private](private-adapter.go) '
                                 '[guide](<../docs/开发 指南.md#start>) [private ledger](../docs/CURRENT.md)\n'
                                 '```text\n[example](example.txt)\n```\n').encode(),
            'docs/开发 指南.md': '[module](../Client/)'.encode(),
        }
        result, receipt = docs.prepare(files)
        exported = json.loads(result[docs.MAP])
        self.assertEqual(exported['modules'], original['modules'])
        self.assertEqual(exported['distribution']['unavailable']['client'], {
            'entries': ['Client/private-adapter.go'], 'documents': ['docs/CURRENT.md'], 'agreement': []})
        self.assertEqual(len(receipt['unavailable_links']), 2)
        self.assertEqual(len(result), len(files))
        text = result['Client/AGENTS.md'].decode()
        self.assertIn('[source](main.go)', text)
        self.assertIn('[guide](<../docs/开发 指南.md#start>)', text)
        self.assertIn('[example](example.txt)', text)
        self.assertIn('未随开发包提供', text)
        self.assertTrue(docs.validate(result)['ok'])
        tampered = dict(result)
        tampered['Client/private-adapter.go'] = b'changed inventory'
        self.assertFalse(docs.validate(tampered)['ok'])
        missing = dict(result)
        del missing['Client/main.go']
        self.assertFalse(docs.validate(missing)['ok'])

    def test_runtime_delivery_keeps_exact_agreements_and_map(self):
        spec = importlib.util.spec_from_file_location('runtime_files', Path(__file__).with_name('runtime-files.py'))
        runtime = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(runtime)
        selected = runtime.runtime_files({name: b'fixture' for name in docs.DOCUMENTS})
        self.assertEqual(set(selected), docs.DOCUMENTS)
        self.assertFalse(runtime.runtime_name('docs/CURRENT.md'))
        self.assertFalse(runtime.runtime_name('AIDEBUG/private-notes.md'))


if __name__ == '__main__':
    unittest.main()
