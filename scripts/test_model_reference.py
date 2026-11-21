# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: scripts/AGENTS.md | ring 3
# Chains: module-local; query impact before editing
# Regions: ReferenceTests
# Impact: python -B scripts/code-atlas.py show scripts/test_model_reference.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""Reference imports preserve reviewed behavior and reject ambiguous facts."""
import copy
import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('model_reference', Path(__file__).with_name('update-model-reference.py'))
reference = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reference)


class ReferenceTests(unittest.TestCase):
    def fixture(self):
        models = {f'fixture-{i}': {'id': f'fixture-{i}', 'limit': {'context': 200000, 'output': 8000}, 'tool_call': True} for i in range(100)}
        catalog = {'models': [{'id': 'channel-only', 'rules': [{'protocol': 'chat_completions'}]}], 'native_models': [
            {'id': 'fixture-0', 'provider': 'openai', 'context_window': 100000, 'rules': [{'protocol': 'responses'}], 'verification': 'official-fixture'}]}
        return catalog, {'openai': {'models': models}}

    def test_conflicts_keep_reviewed_limits_and_channel_rules(self):
        catalog, data = self.fixture()
        before = copy.deepcopy(catalog)
        result, report = reference.build(catalog, data, 'a'*64, '2026-11-02')
        self.assertEqual(catalog, before)
        self.assertEqual(result['models'], catalog['models'])
        self.assertEqual(result['native_models'][0]['context_window'], 100000)
        self.assertEqual(result['native_models'][0]['rules'], catalog['native_models'][0]['rules'])
        added = next(r for r in result['native_models'] if r['id'] == 'fixture-1')
        self.assertIsNone(added['tool_calls'])
        self.assertEqual(added['rules'], [])
        self.assertEqual(added['protocols'], [])
        self.assertTrue(added['reference_metadata']['tool_call'])
        self.assertEqual(len(report['preservedFacts']), 1)
        self.assertEqual(reference.build(result, data, 'a'*64, '2026-11-02')[0], result)

    def test_ambiguous_id_is_not_merged(self):
        catalog, data = self.fixture()
        data['google'] = {'models': {'fixture-1': {'id': 'fixture-1', 'limit': {'context': 900000}}}}
        result, report = reference.build(catalog, data, 'a'*64, '2026-11-02')
        self.assertNotIn('fixture-1', [r['id'] for r in result['native_models']])
        self.assertEqual(report['ambiguous'][0]['id'], 'fixture-1')

    def test_invalid_snapshot_and_parameters_are_not_accepted(self):
        catalog, data = self.fixture()
        data['openai']['models']['fixture-1']['id'] = 'different-id'
        with self.assertRaises(ValueError): reference.build(catalog, data, 'a'*64, '2026-11-02')
        with self.assertRaises(ValueError): reference.unique_object([('x', 1), ('x', 2)])
        self.assertIsNone(reference.positive_int(True))
        self.assertEqual(reference.options([{'type': 'effort', 'values': ['invented']}, {'type': 'budget_tokens', 'max': 10, 'min': 20}]), [])
        with self.assertRaises(ValueError): reference.build(*self.fixture(), 'a'*64, 'not-a-date')


if __name__ == '__main__':
    unittest.main()
