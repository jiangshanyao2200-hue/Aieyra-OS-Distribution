# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: scripts/AGENTS.md | ring 3
# Chains: module-local; query impact before editing
# Regions: ProjectMapTests
# Impact: python -B scripts/code-atlas.py show scripts/test_check_project_map.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('project_map', Path(__file__).with_name('check-project-map.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ProjectMapTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='aieyra-project-map-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name, content in {'Core/main.go': 'package core', 'Core/AGENTS.md': '[入口](main.go)',
                              'docs/工程地图.md': '[Core](../Core/AGENTS.md)'}.items():
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding='utf-8')
        self.item = dict(id='core', path='Core', agreement='Core/AGENTS.md', entries=['Core/main.go'],
                         documents=['docs/工程地图.md'], depends_on=[], status='active',
                         data_ownership='Core owns runtime state, user files remain private.',
                         verification=['go test ./'], pending=[])
        self.doc = dict(schema='aieyra.project-map/1', modules=[self.item])

    def test_real_paths_and_relative_links(self):
        self.assertTrue(module.validate(self.root, self.doc)['ok'])
        (self.root / 'Core/main.go').unlink()
        self.assertIn('core: Core/main.go: missing file', module.validate(self.root, self.doc)['failures'])

    def test_new_module_requires_map_and_own_agreement(self):
        (self.root / 'Halo').mkdir()
        self.assertIn('Halo: module absent from map', module.validate(self.root, self.doc)['failures'])
        self.item['agreement'] = 'docs/工程地图.md'
        self.assertFalse(module.validate(self.root, self.doc)['ok'])

    def test_missing_dependency_private_paths_and_broken_doc_links(self):
        self.item['depends_on'] = ['missing']
        self.item['entries'] = ['Data/private.sqlite']
        (self.root / 'Core/AGENTS.md').write_text('[missing](../missing.md)', encoding='utf-8')
        result = module.validate(self.root, self.doc)
        self.assertFalse(result['ok'])
        self.assertTrue(any('private or escaping' in item for item in result['failures']))
        self.assertTrue(any('unknown/self dependency' in item for item in result['failures']))
        self.assertTrue(any('invalid local link' in item for item in result['failures']))

    def test_duplicate_and_malformed_records_fail_without_scanning_private_data(self):
        self.doc['modules'].extend([dict(self.item), None])
        self.assertFalse(module.validate(self.root, self.doc)['ok'])
        self.doc['modules'] = [dict(self.item, id=[], path=None, depends_on=[None])]
        self.assertFalse(module.validate(self.root, self.doc)['ok'])


if __name__ == '__main__':
    unittest.main()
