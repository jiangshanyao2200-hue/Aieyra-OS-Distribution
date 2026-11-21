# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: scripts/AGENTS.md | ring 3
# Chains: module-local; query impact before editing
# Regions: DevelopmentSessionTests
# Impact: python -B scripts/code-atlas.py show scripts/test_development_session.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""Regression checks for lost work, stale evidence and interrupted handoffs."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('development_session', Path(__file__).with_name('development-session.py'))
session = importlib.util.module_from_spec(spec)
spec.loader.exec_module(session)


class DevelopmentSessionTests(unittest.TestCase):
    def project(self, base):
        root = base/'project'
        root.mkdir()
        update = {'goal':'Preserve the original task', 'appendRequests':['Exact original request.'],
                  'constraints':['Use synthetic data only.'], 'next':['Inspect the shared implementation.'],
                  'items':[{'id':'shared','summary':'Inspect and change the shared owner','status':'pending'}]}
        return root, base/'journal', update

    def test_resuming_retains_requests_next_actions_and_requires_the_expected_head(self):
        with tempfile.TemporaryDirectory() as task_dir:
            root, directory, update = self.project(Path(task_dir))
            first = session.checkpoint(root,directory,update)
            resumed = session.resume(root,directory,first['headSHA256'])
            self.assertEqual(update['next'],resumed['next'])
            second = session.checkpoint(root,directory,{'appendRequests':['User steering.'],'next':['Apply the shared change.']},first['headSHA256'])
            original, _ = session.history(root,directory)
            self.assertEqual(['Exact original request.','User steering.'],original['requests'])
            self.assertEqual(2,second['revision'])
            with self.assertRaisesRegex(ValueError,'head changed'):
                session.checkpoint(root,directory,{'next':['A stale writer.']},first['headSHA256'])
            with self.assertRaisesRegex(ValueError,'--expect-head'):
                session.checkpoint(root,directory,{'next':['No checkpoint base.']})
            (directory/'checkpoint-000002.json').unlink()
            with self.assertRaisesRegex(ValueError,'head changed'):
                session.resume(root,directory,second['headSHA256'])

    def test_pending_work_live_resources_and_unverified_failure_prevent_completion(self):
        with tempfile.TemporaryDirectory() as task_dir:
            root, directory, update = self.project(Path(task_dir))
            first = session.checkpoint(root,directory,update)
            with self.assertRaisesRegex(ValueError,'Cannot complete'):
                session.checkpoint(root,directory,{'status':'complete'},first['headSHA256'])
            evidence = Path(task_dir)/'exit.json'
            evidence.write_text('{"released":true}',encoding='utf-8')
            ref = {'id':'exit','kind':'evidence','file':str(evidence)}
            work = [{'id':'shared','summary':'Shared owner checked','status':'done','evidence':['exit']}]
            resource = {'id':'gui','summary':'Owned synthetic GUI','kind':'gui','identifier':'owned-pid-42',
                        'startedAt':'2026-01-01T00:00:00Z','status':'active'}
            second = session.checkpoint(root,directory,{'items':work,'references':[ref],'resources':[resource]},first['headSHA256'])
            self.assertEqual(['gui'],[r['id'] for r in session.resume(root,directory)['resourcesToInspect']])
            with self.assertRaisesRegex(ValueError,'Cannot complete'):
                session.checkpoint(root,directory,{'status':'complete'},second['headSHA256'])
            with self.assertRaisesRegex(ValueError,'verification reference'):
                session.checkpoint(root,directory,{'failures':[{'id':'bug','summary':'Retain failure','status':'resolved','reason':'Fixed','evidence':['exit']}]},second['headSHA256'])
            resource.update(status='released',evidence=['exit'])
            final = session.checkpoint(root,directory,{'status':'complete','resources':[resource],'next':[]},second['headSHA256'])
            self.assertEqual('complete',final['status'])

    def test_changed_or_removed_evidence_is_reported_without_rebinding_or_running_it(self):
        with tempfile.TemporaryDirectory() as task_dir:
            root, directory, update = self.project(Path(task_dir))
            evidence = Path(task_dir)/'proof.json'
            evidence.write_text('{"result":"old failure"}',encoding='utf-8')
            update['references'] = [{'id':'proof','kind':'evidence','file':str(evidence)}]
            first = session.checkpoint(root,directory,update)
            original = (directory/'checkpoint-000001.json').read_bytes()
            evidence.write_text('{"result":"changed"}',encoding='utf-8')
            self.assertFalse(session.resume(root,directory)['referencesCurrent'])
            with self.assertRaisesRegex(ValueError,'immutable reference changed'):
                session.checkpoint(root,directory,{'references':update['references']},first['headSHA256'])
            self.assertEqual(original,(directory/'checkpoint-000001.json').read_bytes())
            evidence.unlink()
            self.assertFalse(session.resume(root,directory)['referencesCurrent'])

    def test_work_and_failure_records_cannot_silently_disappear(self):
        with tempfile.TemporaryDirectory() as task_dir:
            root, directory, update = self.project(Path(task_dir))
            first = session.checkpoint(root,directory,update)
            with self.assertRaisesRegex(ValueError,'must remain explicit'):
                session.checkpoint(root,directory,{'items':[]},first['headSHA256'])
            value = json.loads((directory/'checkpoint-000001.json').read_text(encoding='utf-8'))
            value['requests'] = ['A rewritten request.']
            second = session.checkpoint(root,directory,{'next':['Another step.']},first['headSHA256'])
            (directory/'checkpoint-000001.json').write_text(json.dumps(value),encoding='utf-8')
            with self.assertRaisesRegex(ValueError,'chain/root mismatch'):
                session.resume(root,directory,second['headSHA256'])

    def test_evidence_references_cannot_be_dropped_and_resume_retains_original_requests(self):
        with tempfile.TemporaryDirectory() as task_dir:
            root, directory, update = self.project(Path(task_dir))
            proof = Path(task_dir)/'original-failure.log'
            proof.write_text('Original failure remains available.',encoding='utf-8')
            update['references'] = [{'id':'failure','kind':'evidence','file':str(proof)}]
            first = session.checkpoint(root,directory,update)
            with self.assertRaisesRegex(ValueError,'references.*remain explicit'):
                session.checkpoint(root,directory,{'references':[]},first['headSHA256'])
            resumed = session.resume(root,directory)
            self.assertEqual(update['appendRequests'],resumed['requests'])

    def test_exclusive_checkpoint_creation_preserves_the_first_concurrent_writer(self):
        with tempfile.TemporaryDirectory() as task_dir:
            root, directory, update = self.project(Path(task_dir))
            first = session.checkpoint(root,directory,update)
            state, head = session.history(root,directory)
            with patch.object(session,'history',return_value=(state,head)):
                session.checkpoint(root,directory,{'next':['Writer one.']},first['headSHA256'])
                kept = (directory/'checkpoint-000002.json').read_bytes()
                with self.assertRaises(FileExistsError):
                    session.checkpoint(root,directory,{'next':['Writer two.']},first['headSHA256'])
            self.assertEqual(kept,(directory/'checkpoint-000002.json').read_bytes())

    def test_journal_paths_source_export_and_database_references_are_rejected(self):
        with tempfile.TemporaryDirectory() as task_dir:
            root, directory, update = self.project(Path(task_dir))
            with self.assertRaisesRegex(ValueError,'outside the project'):
                session.checkpoint(root,root/'journal',update)
            with self.assertRaisesRegex(ValueError,'Absolute'):
                session.resume(root,Path('relative'))
            database = Path(task_dir)/'synthetic.sqlite'
            database.write_bytes(b'must not be read as a checkpoint reference')
            update['references'] = [{'id':'db','kind':'evidence','file':str(database)}]
            with self.assertRaisesRegex(ValueError,'Unsupported reference type'):
                session.checkpoint(root,directory,update)


if __name__=='__main__':
    unittest.main()
