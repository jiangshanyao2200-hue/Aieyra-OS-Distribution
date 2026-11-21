# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: scripts/AGENTS.md | ring 3
# Chains: module-local; query impact before editing
# Regions: RendererBoundaries
# Impact: python -B scripts/code-atlas.py show scripts/test_check_modules.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""Architecture guard regression cases; fixtures never execute renderer code."""
import importlib.util
import json
import hashlib
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('module_check', Path(__file__).with_name('check-modules.py'))
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)


class RendererBoundaries(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='aieyra-boundaries-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def write(self, name, text='export const value = 1;'):
        p = self.root / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding='utf-8')

    def test_recursive_import_reexport_and_dynamic_literal_without_execution(self):
        self.write('Client/Desktop/ui/data.mjs')
        self.write('Client/Desktop/ui/nested/page.mjs', '''
import {value} from '../data.mjs';
export * from '../data.mjs';
const later = () => import('../data.mjs');
// import('node:fs') is a comment, not a dependency.
throw Error('Must never evaluate application code');
''')
        result = check.renderer_dependencies(self.root)
        self.assertEqual(result['files'], 2)
        self.assertEqual({e['kind'] for e in result['edges']}, {'static', 'dynamic-literal'})

    def test_nested_host_import_and_path_traversal_are_rejected(self):
        self.write('Client/Desktop/host/private.mjs')
        self.write('Client/Desktop/ui/nested/page.mjs', "import '../../host/private.mjs';")
        with self.assertRaisesRegex(AssertionError, 'outside reviewed UI'):
            check.renderer_dependencies(self.root)

    def test_node_reexport_and_dynamic_expression_are_rejected(self):
        for source in ["export * from 'node:fs';", "import('electron');", 'import(window.modulePath);']:
            with self.subTest(source=source):
                self.write('Client/Desktop/ui/nested/page.mjs', source)
                with self.assertRaises(AssertionError):
                    check.renderer_dependencies(self.root)

    def test_raw_host_bridge_and_require_are_rejected(self):
        for source in ["window['aieyra'].send({});", 'window.aieyra.send({});', "require('fs');"]:
            with self.subTest(source=source):
                self.write('Client/Desktop/ui/nested/page.mjs', source)
                with self.assertRaisesRegex(AssertionError, 'bypasses injected'):
                    check.renderer_dependencies(self.root)

    def test_missing_target_is_not_silently_ignored(self):
        self.write('Client/Desktop/ui/page.mjs', "import './missing.mjs';")
        with self.assertRaisesRegex(AssertionError, 'missing'):
            check.renderer_dependencies(self.root)

    def test_http_aliases_resolve_to_shared_motion_and_ticker(self):
        self.write('Client/Desktop/ui/motion.mjs')
        self.write('Client/Desktop/ui/ticker.mjs')
        self.write('Control/app/web/page.js', "import './motion.mjs'; export * from './ui-ticker.mjs';")
        result = check.renderer_dependencies(self.root)
        self.assertEqual(len(result['edges']), 2)
        self.assertTrue(all(e['to'].startswith('Client/Desktop/ui/') for e in result['edges']))

    def test_shared_client_cannot_pull_in_server_code(self):
        self.write('Client/Desktop/ui/page.mjs', "export * from '../../../Link/cloud/client/remote-link.mjs';")
        self.write('Link/cloud/client/remote-link.mjs', "import '../server.mjs';")
        self.write('Link/cloud/server.mjs')
        with self.assertRaisesRegex(AssertionError, 'outside reviewed UI'):
            check.renderer_dependencies(self.root)

    def test_program_resource_compatibility_requires_original_bytes_and_presence(self):
        name = 'Desktop/ui/app-shell.mjs'
        source = 'export const legacy = true;'
        self.write(name, source)
        self.write('Contracts/desktop-compatibility.json', json.dumps({'schema': 1, 'files': {
            name: {'size': len(source), 'sha256': hashlib.sha256(source.encode()).hexdigest()}
        }}))
        self.assertEqual(list(check.desktop_compatibility(self.root)), [name])
        self.write(name, 'export const legacy = false;')
        with self.assertRaisesRegex(AssertionError, 'changed compatibility'):
            check.desktop_compatibility(self.root)
        (self.root / name).unlink()
        with self.assertRaisesRegex(AssertionError, 'missing compatibility'):
            check.desktop_compatibility(self.root)

    def test_release_sources_and_lock_identity_cannot_drift(self):
        self.write('Core/host/app.go', 'var Version = "1.2.3"')
        self.write('scripts/release-metadata.json', json.dumps({'schema': 1, 'product': 'aieyra-os', 'version': '1.2.3', 'sequence': 4}))
        self.write('Client/Desktop/package.json', json.dumps({'version': '1.2.3'}))
        lock = {'version': '1.2.3', 'packages': {'': {'version': '1.2.3'}}}
        self.write('Client/Desktop/package-lock.json', json.dumps(lock))
        self.assertEqual(check.release_identity(self.root)['version'], '1.2.3')
        lock['packages']['']['version'] = '1.2.2'
        self.write('Client/Desktop/package-lock.json', json.dumps(lock))
        with self.assertRaisesRegex(AssertionError, 'release identity mismatch'):
            check.release_identity(self.root)


if __name__ == '__main__':
    unittest.main()
