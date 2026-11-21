# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: scripts/AGENTS.md | ring 3
# Chains: module-local; query impact before editing
# Regions: load; ProjectMap
# Impact: python -B scripts/code-atlas.py show scripts/test_project_map.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

HERE = Path(__file__).parent


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


project_map = load('project_map', 'check-project-map.py')
privacy = load('map_test_privacy', 'public-privacy.py')


class ProjectMap(unittest.TestCase):
    def fixture(self, root):
        files = {'Core/entry.go': 'package core', 'Core/AGENTS.md': '# Core',
                 'Contracts/AGENTS.md': '# Contracts', 'scripts/AGENTS.md': '# Scripts',
                 'docs/开发指南.md': '# Guide', 'README.md': '[Guide](docs/开发指南.md)',
                 'scripts/PUBLIC-README.md': '[Guide](docs/开发指南.md)',
                 'Contracts/development-documents.json': json.dumps({
                     'templates': {'README.md': 'scripts/PUBLIC-README.md'}})}
        modules = []
        for name, entry in [('Core', 'Core/entry.go'), ('Contracts', 'Contracts/development-documents.json'),
                            ('scripts', 'scripts/PUBLIC-README.md')]:
            modules.append({'id': name.lower(), 'path': name, 'agreement': name + '/AGENTS.md',
                            'entries': [entry], 'documents': [], 'verification': ['Unit checks'],
                            'pending': [], 'depends_on': [], 'status': 'active', 'data_ownership': 'Public code'})
        document = {'schema': 'aieyra.project-map/1', 'modules': modules}
        files['docs/工程地图.json'] = json.dumps(document)
        for name, data in files.items():
            p = root / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(data, encoding='utf-8')
        return document

    def test_public_template_links_resolve_at_their_destination(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            self.fixture(root)
            self.assertTrue(project_map.validate(root)['ok'])
            (root / 'docs/开发指南.md').unlink()
            self.assertFalse(project_map.validate(root)['ok'])

    def test_exported_availability_is_checked_against_actual_inventory(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            document = self.fixture(root)
            document['modules'][0]['entries'].append('Core/omitted.go')
            document['distribution'] = privacy.development.map_distribution(document, privacy.source_files(root))
            (root / 'docs/工程地图.json').write_text(json.dumps(document), encoding='utf-8')
            self.assertTrue(project_map.validate(root)['ok'])
            (root / 'Core/entry.go').unlink()
            result = project_map.validate(root)
            self.assertFalse(result['ok'])
            self.assertIn('map distribution does not match exported files', result['failures'])

    def test_forged_omission_does_not_hide_a_shipped_entry(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            document = self.fixture(root)
            document['distribution'] = privacy.development.map_distribution(document, privacy.source_files(root))
            document = copy.deepcopy(document)
            document['distribution']['unavailable']['core']['entries'] = ['Core/entry.go']
            (root / 'docs/工程地图.json').write_text(json.dumps(document), encoding='utf-8')
            self.assertFalse(project_map.validate(root)['ok'])

    def test_omitted_module_may_link_to_a_shipped_shared_guide(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            document = self.fixture(root)
            optional = copy.deepcopy(document['modules'][0])
            optional.update(id='core.optional', path='Core/optional', agreement='Core/optional/AGENTS.md',
                            entries=['Core/optional/entry.go'], documents=['docs/开发指南.md'])
            document['modules'].append(optional)
            document['distribution'] = privacy.development.map_distribution(document, privacy.source_files(root))
            (root / 'docs/工程地图.json').write_text(json.dumps(document), encoding='utf-8')
            self.assertTrue(project_map.validate(root)['ok'])


if __name__ == '__main__':
    unittest.main()
