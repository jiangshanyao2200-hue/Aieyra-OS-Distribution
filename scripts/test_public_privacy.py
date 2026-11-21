# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: scripts/AGENTS.md | ring 3
# Chains: module-local; query impact before editing
# Regions: PrivacyBoundary
# Impact: python -B scripts/code-atlas.py show scripts/test_public_privacy.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

import importlib.util, json, shutil, tempfile, unittest
from pathlib import Path

SPEC=importlib.util.spec_from_file_location('privacy',Path(__file__).with_name('public-privacy.py'))
p=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(p)
RUNTIME_SPEC=importlib.util.spec_from_file_location('runtime_files',Path(__file__).with_name('runtime-files.py'))
runtime=importlib.util.module_from_spec(RUNTIME_SPEC);RUNTIME_SPEC.loader.exec_module(runtime)
MAC_SPEC=importlib.util.spec_from_file_location('build_macos',Path(__file__).with_name('build-macos.py'))
mac=importlib.util.module_from_spec(MAC_SPEC);MAC_SPEC.loader.exec_module(mac)

class PrivacyBoundary(unittest.TestCase):
    def test_public_checkout_contains_reviewed_installer_build_inputs(self):
        files = dict(p.module_sources(p.ROOT))
        for name in ('Client/Installer/Installer.xaml', 'Client/Installer/Installer.manifest'):
            with self.subTest(name=name):
                self.assertIn(name, files)
                self.assertEqual(p.validate(name, files[name].read_bytes()), [])

    def test_named_source_areas_survive_both_inventories_without_admitting_user_data(self):
        public = ['Tool/runtime/javascript.go', 'Agent/context/history/policy.go']
        private = ['Tool/runtime/history/private.txt', 'Tool/runtime/runtime/private.txt',
                   'Agent/context/history/data/private.txt', 'Agent/context/history/history/private.txt',
                   'Agent/context/history/runtime/private.txt', 'Agent/context/history/private.sqlite',
                   'Tool/other/runtime/private.txt', 'Agent/other/history/private.txt']
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name in public + private:
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text('synthetic source', encoding='utf-8')
            selected = p.source_files(root)
            packaged = runtime.runtime_files(selected)
            for name in public:
                self.assertIn(name, selected)
                self.assertIn(name, packaged)
                self.assertEqual(p.validate(name, selected[name].read_bytes(), {}), [])
            for name in private:
                self.assertNotIn(name, packaged)
                self.assertTrue(p.validate(name, b'fixture', {}), name)

    def test_reviewed_text_requires_exact_path_and_bytes_and_still_scans_secrets(self):
        name='Client/Desktop/ui/vendor/fixture.LICENSE'
        content=b'fixture license text'
        rules={'reviewed_text_assets':{name:p.digest(content)}}
        self.assertEqual(p.validate(name,content,rules),[])
        self.assertIn('unreviewed_file_type',p.validate(name,content+b' changed',rules))
        self.assertIn('unreviewed_file_type',p.validate('other.LICENSE',content,rules))
        secret=b'ghp_'+b'F'*36
        self.assertIn('credential_or_private_key',p.validate(name,secret,{'reviewed_text_assets':{name:p.digest(secret)}}))
        self.assertIn('non_utf8_source',p.validate(name,b'\xff',{'reviewed_text_assets':{name:p.digest(b'\xff')}}))

    @staticmethod
    def user_path(separator=b'\\'):
        return separator.join([b'C:',b'Users',b'privateperson',b'key.txt'])
    def test_real_user_path_and_escaped_forms_blocked(self):
        plain=self.user_path()
        variants=[plain,self.user_path(b'\\\\'),self.user_path(b'\\u005c'),b'file:///'+self.user_path(b'/'),b'file:///'+self.user_path(b'/').replace(b'Users',b'%55sers'),b'/'.join([b'',b'home',b'privateperson',b'key.txt'])]
        for raw in variants:
            with self.subTest(raw=raw):self.assertTrue(p.validate('source.txt',raw,{}))
    def test_credentials_rejected_without_echo(self):
        key=b'ghp_'+b'F'*36
        result=p.validate('source.txt',key,{})
        self.assertEqual(result,['credential_or_private_key']);self.assertNotIn(key.decode(),json.dumps(result))
    def test_known_secret_overrides_exact_synthetic_allowance(self):
        key=b'sk-'+b'fixture'*5
        rules={'synthetic_tokens':{'test.txt':[p.digest(key)]}}
        self.assertEqual(p.validate('test.txt',key,rules),[])
        self.assertIn('known_credential',p.validate('test.txt',key,rules,[key]))
        self.assertIn('credential_or_private_key',p.validate('other.txt',key,rules))
    def test_station_identity_and_operations_address(self):
        samples=[b'agent-'+b'1'*16,b'-'.join([b'01abcdef',b'1234',b'5678',b'1234',b'123456789abc']),b'/'.join([b'',b'srv',b'private-install',b'database']),b'.'.join([b'8',b'8',b'4',b'4']),b'[.]'.join([b'8',b'8',b'4',b'4'])]
        for raw in samples:self.assertTrue(p.validate('source.txt',raw,{}))
    def test_private_and_ipv6_endpoints_are_not_implicitly_public(self):
        addresses=['.'.join(['10','20','30','40']),'.'.join(['172','18','4','5']),'.'.join(['192','168','4','5']),':'.join(['fd12','3456',':1']),':'.join(['2606','4700','4700',':1111']),':'.join(['fe80',':1234'])]
        for address in addresses:
            for raw in [address,'https://['+address+']:443',address.replace(':',r'\u003a').replace('.',r'\u002e')]:
                self.assertIn('unclassified_ip_literal',p.validate('source.txt',raw.encode(),{}),raw)
        self.assertEqual(p.validate('source.txt',b'http://[::1] http://[2001:db8::1]',{}),[])
        self.assertEqual(p.validate('source.txt',b'*::before *::after dialog[open]::backdrop [Convert]::FromBase64String [Console]::Error',{}),[])
    def test_private_artifact_names(self):
        for name in ['history/run.txt','AIDEBUG/shot.png','DOCS/recovery.txt','config.json','Prompt/private.txt','.env.production','.env.json','../secret.txt','C:'+ '/private.txt']:
            self.assertTrue(p.validate(name,b'test',{}),name)
    def test_editable_resources_exclude_personal_files_and_retain_exact_review(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            for name in p.resources.PUBLIC_CONFIG:
                file=root/'Config'/name;file.parent.mkdir(parents=True,exist_ok=True);file.write_text('{}',encoding='utf-8')
            index={'resources':[{'file':n} for n in ['Nova/提示词.txt','子代/模板/Eyra会话.txt','子代/模板/对话.txt','子代/模板/看图.txt']]}
            (root/'Config/提示词索引.json').write_text(json.dumps(index),encoding='utf-8')
            public=['Prompt/'+row['file'] for row in index['resources']]+['Prompt/Matrix/默认/'+n for n in ('自我.txt','工作.txt','边界.txt','思考方式.txt')]
            private=['Config/config.json','Config/link/cloud-office.json','Data/memory/private.sqlite','Prompt/Matrix/自我.txt','Prompt/子代/'+'a'*32+'/提示词.txt']
            for name in public+private:
                file=root/name;file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(b'synthetic resource')
            selected=p.source_files(root)
            self.assertTrue(set(public)<=selected.keys())
            self.assertFalse(set(private)&selected.keys())
            self.assertTrue(set(public)<=runtime.runtime_files(selected).keys())
            name=public[0];raw=b'synthetic resource'
            rules={'reviewed_prompt_resources':{name:p.digest(raw)}}
            self.assertEqual(p.validate(name,raw,rules),[])
            self.assertIn('personal_prompt_path',p.validate(name,b'local personal edit',rules))
    def test_sdk_packages_keep_all_manifest_files_in_public_and_runtime_inventory(self):
        selected=p.source_files()
        packaged=runtime.runtime_files(selected)
        for manifest in (p.ROOT/'SDK/examples').glob('*/manifest.json'):
            for name in json.loads(manifest.read_text(encoding='utf-8'))['files']:
                relative=(manifest.parent/name).relative_to(p.ROOT).as_posix()
                self.assertIn(relative,selected,relative)
                self.assertIn(relative,packaged,relative)
                self.assertEqual(p.validate(relative,selected[relative].read_bytes()),[],relative)

    def test_every_renderer_dependency_is_present_in_public_and_runtime_inventory(self):
        if not shutil.which('node'):
            self.skipTest('Node unavailable for renderer dependency parser')
        spec=importlib.util.spec_from_file_location('module_dependencies',Path(__file__).with_name('check-modules.py'))
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        report=module.renderer_dependencies()
        dependencies={edge[key] for edge in report['edges'] for key in ('from','to')}
        selected=p.source_files()
        packaged=runtime.runtime_files(selected)
        self.assertEqual(sorted(dependencies-selected.keys()),[], 'renderer source omitted from public export')
        self.assertEqual(sorted(dependencies-packaged.keys()),[], 'renderer source omitted from runtime export')

    def test_module_media_selection_cannot_hide_unreviewed_or_changed_binary(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            for ext in ('.wav','.png','.jpg','.jpeg','.woff2'):
                name='SDK/examples/synthetic/assets/tone'+ext
                file=root/name;file.parent.mkdir(parents=True,exist_ok=True)
                raw=b'known-generated-media';file.write_bytes(raw)
                selected=dict(p.module_sources(root))
                self.assertIn(name,selected)
                self.assertIn('unreviewed_binary',p.validate(name,raw,{}))
                rules={'binary_assets':{name:p.digest(raw)}}
                self.assertEqual(p.validate(name,raw,rules),[])
                self.assertIn('unreviewed_binary',p.validate(name,raw+b'changed',rules))
                secret=b'ghp_'+b'F'*36
                self.assertIn('credential_or_private_key',p.validate(name,secret,{'binary_assets':{name:p.digest(secret)}}))
            hidden=root/'SDK/examples/synthetic/Data/private.wav';hidden.parent.mkdir();hidden.write_bytes(b'private')
            self.assertNotIn(hidden.relative_to(root).as_posix(),dict(p.module_sources(root)))

    def test_artwork_change_fails_exact_review(self):
        rules={'binary_assets':{'asset.png':p.digest(b'known-art')}}
        self.assertEqual(p.validate('asset.png',b'known-art',rules),[])
        self.assertIn('unreviewed_binary',p.validate('asset.png',b'changed-art',rules))
        self.assertIn('unreviewed_binary',p.validate('other.png',b'known-art',rules))
    def test_typescript_keeps_text_privacy_checks(self):
        for name in ['Client/Desktop/ui/canvas.ts','Client/Desktop/ui/canvas.tsx']:
            self.assertEqual(p.validate(name,b'export const label = "Canvas";',{}),[])
            self.assertIn('credential_or_private_key',p.validate(name,b'// '+b'ghp_'+b'F'*36,{}))
            self.assertIn('local_absolute_path',p.validate(name,self.user_path(),{}))
            self.assertIn('non_utf8_source',p.validate(name,b'\xff',{}))
    def test_native_computer_source_is_scanned_as_text(self):
        name = 'Client/Desktop/tools/computer-input.cs'
        self.assertEqual(p.validate(name, b'public class SyntheticInput {}', {}), [])
        self.assertIn('credential_or_private_key', p.validate(name, b'// '+b'ghp_'+b'F'*36, {}))
        self.assertIn('local_absolute_path', p.validate(name, self.user_path(), {}))
        self.assertIn('non_utf8_source', p.validate(name, b'\xff', {}))

    def test_fonts_require_reviewed_path_and_exact_bytes(self):
        name='Client/Desktop/assets/fonts/fixture.woff2'
        raw=b'wOF2\x00\xfffixture-font'
        rules={'binary_assets':{name:p.digest(raw)}}
        self.assertEqual(p.validate(name,raw,rules),[])
        self.assertIn('unreviewed_binary',p.validate(name,raw+b'changed',rules))
        self.assertIn('unreviewed_binary',p.validate('other.woff2',raw,rules))
        secret=b'ghp_'+b'F'*36
        self.assertIn('credential_or_private_key',p.validate(name,secret,{'binary_assets':{name:p.digest(secret)}}))
    def test_systemd_service_is_text_and_still_scans_private_content(self):
        name='scripts/fixtures/aieyra-link.service'
        self.assertEqual(p.validate(name,b'[Service]\nExecStart=/usr/local/bin/aieyra-link\n',{}),[])
        self.assertIn('credential_or_private_key',p.validate(name,b'Environment=TOKEN='+b'ghp_'+b'F'*36,{}))
        self.assertIn('local_absolute_path',p.validate(name,self.user_path(),{}))
        self.assertIn('non_utf8_source',p.validate(name,b'\xff',{}))
    def test_historical_artwork_requires_exact_path_and_hash(self):
        rules={'historical_binary_assets':{'asset.png':[p.digest(b'old-art')]}}
        self.assertEqual(p.validate('asset.png',b'old-art',rules),[])
        self.assertIn('unreviewed_binary',p.validate('asset.png',b'other-art',rules))
        self.assertIn('unreviewed_binary',p.validate('other.png',b'old-art',rules))
    def test_relocated_system_paths_keep_exact_historical_review(self):
        # 模块迁移不能遗失历史白名单；仍逐路径、逐字节匹配。
        samples=[('Core/shell_guard.go','Core/tools/shell_guard.go',b'C:/'+b'Program Files'),
                 ('Core/shell_windows.go','Core/platform/shell_windows.go',b'C:'+bytes([92])+b'Program Files'+bytes([92])+b'PowerShell')]
        for old,new,raw in samples:
            for name in (old,new):
                self.assertEqual(p.validate(name,raw),[])
                self.assertIn('local_absolute_path',p.validate(name,self.user_path()))
                self.assertIn('local_absolute_path',p.validate(name,raw.replace(b'Program',b'ConfidentialFolder')))
            self.assertIn('local_absolute_path',p.validate('other.go',raw))
    def test_annotated_tag_metadata_scanned(self):
        import subprocess
        with tempfile.TemporaryDirectory() as tmp:
            def git(*args):return subprocess.run(['git','-C',tmp,*args],capture_output=True,check=True)
            git('init','-q');git('config','user.name','Test');git('config','user.email','test@example.com')
            Path(tmp,'README.md').write_text('public fixture');git('add','.');git('commit','-qm','fixture')
            tagtext='contact '+ '@'.join(['privateperson','private-domain.invalid'])
            git('tag','-a','v1','-m',tagtext)
            result=p.check_history(Path(tmp))
            self.assertFalse(result['ok']);self.assertEqual(result['annotatedTags'],1)
            self.assertTrue(any(x['rule']=='unclassified_email' for x in result['failures']))
    def test_encoded_signed_payload_scanned(self):
        import base64
        raw=json.dumps({'signature':'placeholder','payload':base64.b64encode(self.user_path()).decode()}).encode()
        self.assertIn('local_absolute_path',p.validate('baseline.json',raw,{}))
    def test_public_examples_and_noreply_allowed(self):
        raw=b'C:\\fixtures\\test.txt /home/user/test 127.0.0.1 192.0.2.4 https://os.aieyra.cn user@example.com 123+brand@users.noreply.github.com'
        self.assertEqual(p.validate('source.txt',raw,{}),[])
    def test_only_reviewed_client_service_hosts_ship(self):
        for host in ('aieyra.cn', 'api.aieyra.cn', 'fast.aieyra.cn', 'os.aieyra.cn', 'osupdate.aieyra.cn', 'ctrlupdate.aieyra.cn'):
            self.assertNotIn('unlisted_service_host', p.validate('Client/Desktop/src/x.cjs', ('const u="https://' + host + '/v1";').encode()), host)
        # Built at run time so this public test never carries a real internal host name.
        domain = b'.'.join([b'aieyra', b'cn'])
        for text in (b'https://sub2.' + domain + b'/meta-muse/v1', b'origin: Admin.' + domain.upper(), b'see panel.' + domain,
                     rb'https:\/\/ctrl.' + domain, b'https%3A%2F%2Finternal.' + domain + b'%2F'):
            self.assertIn('unlisted_service_host', p.validate('Client/Desktop/src/x.cjs', text), text)

    def test_server_programs_never_ship_but_client_protocol_does(self):
        for name in ('Control/app/cloud/server.py', 'Control/app/cloud/site/site.js', 'Link/cloud/server.py', 'Link/cloud/admin_remote.py'):
            self.assertIn('server_source', p.validate(name, b'print(1)'), name)
        for name in sorted(p.SERVER_CLIENT_FILES):
            self.assertNotIn('server_source', p.validate(name, b'print(1)'), name)
        self.assertFalse(any(name.startswith(p.SERVER_TREES) and name not in p.SERVER_CLIENT_FILES and name not in p.development.DOCUMENTS
                             for name in p.source_files()))

    def test_unclassified_personal_email_rejected(self):
        self.assertIn('unclassified_email',p.validate('source.txt',b'@'.join([b'privateperson',b'private-domain.invalid']),{}))
    def test_old_exporter_hardcoded_user_path_cannot_return(self):
        raw=b"spawn('"+self.user_path(b'\\\\')+b"',['total.py'])"
        self.assertIn('local_absolute_path',p.validate('Client/Desktop/tools/verify-living-deepseek-live.cjs',raw))
    def test_generated_bootstrap_excluded_only_from_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            for name in ['Client/Desktop/update-bootstrap/LICENSE','Client/Desktop/update-bootstrap/CLI-README.md',
                         'Client/Desktop/update-bootstrap/create-launchers.ps1','Client/Desktop/update-bootstrap/cli.exe',
                         'Client/Desktop/src/managed-update-bootstrap.cjs','scripts/create-launchers.ps1',
                         'scripts/CLI-README.md','LICENSE']:
                target=root/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_text('synthetic public bytes')
            names=p.source_files(root)
            self.assertFalse(any(name.startswith('Client/Desktop/update-bootstrap/') for name in names))
            self.assertTrue({'Client/Desktop/src/managed-update-bootstrap.cjs','scripts/create-launchers.ps1',
                             'scripts/CLI-README.md','LICENSE'}<=names.keys())
            self.assertEqual(p.validate('Client/Desktop/update-bootstrap/LICENSE',b'synthetic public bytes',{}),[])
    def test_memory_schema_is_scanned_and_runtime_database_never_exported(self):
        schema='Core/memoryservice/schema.sql'
        self.assertEqual(p.validate(schema,b'CREATE TABLE memories(id TEXT PRIMARY KEY);',{}),[])
        self.assertIn('credential_or_private_key',p.validate(schema,b'-- '+b'ghp_'+b'F'*36,{}))
        self.assertIn('non_utf8_source',p.validate(schema,b'\xff',{}))
        for name in ['Core/memory/eyra.sqlite','Core/memory/eyra.sqlite-wal','Core/memory/eyra.sqlite-shm',
                     'Core/renamed.sqlite','Core/renamed.db-journal','Client/Desktop/src/renamed.sqlite3']:
            self.assertIn('private_database_path',p.validate(name,b'SQLite format 3\x00',{}))
        self.assertIn('private_artifact_path',p.validate('Core/memory/export.txt',b'private memory',{}))
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            for name in [schema,'Core/memoryservice/store.go','Core/memory/eyra.sqlite',
                         'Core/memory/eyra.sqlite-wal','Core/memory/eyra.sqlite-shm','Core/memory/export.txt']:
                target=root/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_text('fixture')
            names=p.source_files(root)
            self.assertFalse(any(name.startswith('Core/memory/') for name in names))
            self.assertTrue({schema,'Core/memoryservice/store.go'}<=names.keys())

    def test_public_tools_keep_user_commands_without_private_harnesses(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            public=['Client/Desktop/tools/check.cjs','Client/Desktop/tools/ensure-electron.cjs',
                    'Client/Desktop/tools/print-paths.cjs','Client/Desktop/test/ui-identity.cjs',
                    'Core/tools/shell_guard.go','Tool/base/official/apply_patch/patch.go',
                    'Tool/base/official/apply_patch/patch_test.go','Tool/base/official/apply_patch/manual.txt',
                    'Tool/base/official/apply_patch/presentation/desktop.css','Tool/base/official/apply_patch/presentation/desktop.mjs',
                    'Tool/toolbox/official/imagegen/execute.go','Tool/toolbox/official/imagegen/manual.txt','Tool/toolbox/official/imagegen/presentation/desktop.mjs','API/images/generator.go']
            private=['Client/Desktop/tools/private-harness.cjs','Client/Desktop/tools/nested/receipt.json',
                     'Core/tools/build-alpha-candidate.ps1','AIDEBUG/private-test.py',
                     'Tool/base/third-party/example/code.go','Tool/base/local/example/private.txt',
                     'Tool/base/official/apply_patch/data/receipts.json','Tool/toolbox/official/imagegen/data/receipts.json','Tool/toolbox/third-party/example/private.txt']
            for name in public+private:
                target=root/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_text('fixture')
            names=p.source_files(root)
            self.assertTrue(set(public)<=names.keys())
            self.assertTrue(set(private).isdisjoint(names))

    def test_extension_runtimes_are_sources_but_nested_data_is_private(self):
        public = ['Agent/official/Eyra/definition.json','Agent/official/Eyra/team/definition.json','Agent/contract/task.go', 'Program/runtime/desktop.cjs', 'Theme/runtime/settings.cjs', 'Theme/runtime/layout.mjs']
        private = ['Agent/third-party/example/private.json','Agent/official/Eyra/data/record.json', 'Theme/runtime/data/config.json', 'Theme/third-party/example/runtime/index.js', 'Program/runtime/history/session.json']
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            for name in public+private:
                file=root/name;file.parent.mkdir(parents=True,exist_ok=True);file.write_text('fixture')
            names=p.source_files(root)
            self.assertTrue(set(public)<=names.keys())
            self.assertTrue(set(private).isdisjoint(names))

    def test_mapped_agent_prompts_keep_exact_review_and_exclude_legacy_overrides(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            for name in p.resources.PUBLIC_CONFIG:
                file=root/'Config'/name;file.parent.mkdir(parents=True,exist_ok=True);file.write_text('{}',encoding='utf-8')
            target='Agent/official/Vaya/prompts/提示词.txt'
            legacy='Prompt/Vaya/提示词.txt'
            row={'file':'Vaya/提示词.txt','path':target,'legacy_sha256':p.digest(b'old')}
            (root/'Config/提示词索引.json').write_text(json.dumps({'resources':[row]}),encoding='utf-8')
            for name in [target,legacy]+['Prompt/Matrix/默认/'+n+'.txt' for n in ('自我','工作','边界','思考方式')]:
                file=root/name;file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(b'fixture')
            selected=p.source_files(root)
            self.assertIn(target,selected);self.assertNotIn(legacy,selected)
            self.assertIn(target,runtime.runtime_files(selected))
            rules={'reviewed_prompt_resources':{target:p.digest(b'fixture')}}
            self.assertEqual(p.validate(target,b'fixture',rules),[])
            self.assertIn('personal_prompt_path',p.validate(target,b'local edit',rules))
            row['path']='Data/private.txt'
            (root/'Config/提示词索引.json').write_text(json.dumps({'resources':[row]}),encoding='utf-8')
            with self.assertRaises(ValueError):p.source_files(root)

    def test_mapped_tool_manuals_keep_exact_review_and_exclude_legacy_overrides(self):
        for target in ['Tool/base/official/update_plan/manual.txt', 'Tool/base/official/web_search/manual/method.txt', 'Tool/base/official/web_search/prompts/search.txt']:
            with tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp)
                for name in p.resources.PUBLIC_CONFIG:
                    file=root/'Config'/name;file.parent.mkdir(parents=True,exist_ok=True);file.write_text('{}',encoding='utf-8')
                legacy='Prompt/Matrix/工具说明/持久计划.txt'
                row={'file':'Matrix/工具说明/持久计划.txt','path':target,'legacy_sha256':p.digest(b'old')}
                (root/'Config/提示词索引.json').write_text(json.dumps({'resources':[row]}),encoding='utf-8')
                for name in [target,legacy]+['Prompt/Matrix/默认/'+n+'.txt' for n in ('自我','工作','边界','思考方式')]:
                    file=root/name;file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(b'fixture')
                for suffix in ['.backup.'+'a'*64,'.tmp.123','.write-lock','.restore.json']:
                    (root/(target+suffix)).write_bytes(b'private backup')
                selected=p.source_files(root)
                self.assertEqual([name for name in selected if name.startswith(target)], [target])
                self.assertIn(target,selected);self.assertNotIn(legacy,selected)
                self.assertIn(target,runtime.runtime_files(selected))
                rules={'reviewed_prompt_resources':{target:p.digest(b'fixture')}}
                self.assertEqual(p.validate(target,b'fixture',rules),[])
                self.assertIn('personal_prompt_path',p.validate(target,b'local edit',rules))
                row['path']='Data/private.txt'
                (root/'Config/提示词索引.json').write_text(json.dumps({'resources':[row]}),encoding='utf-8')
                with self.assertRaises(ValueError):p.source_files(root)

    def test_runtime_inventory_retains_reviewed_rebuild_dependencies(self):
        reviewed={name:b'fixture' for name in [
            'Theme/go.mod','Theme/runtime/layout.mjs','Theme/runtime/settings.cjs','Theme/contract/elements.json','Theme/official/default/appearance.css','Program/go.mod','Program/runtime/desktop.cjs','Program/contract/definition.go','Contracts/mod.schema.json','SDK/examples/program-notebook/manifest.json','Core/go.mod','Core/go.sum','Client/CLI/host/cli.go','Core/memoryservice/schema.sql',
            'Agent/go.mod','Agent/contract/task.go','Agent/official/definitions.cjs','Agent/official/Eyra/definition.json','Tool/go.mod','Tool/go.sum','Tool/base/official/apply_patch/patch.go','Tool/toolbox/official/imagegen/execute.go','Tool/toolbox/official/imagegen/manual.txt','API/images/generator.go',
            'Tool/runtime/javascript.go','Halo/runtime/desktop.mjs','Tool/base/official/apply_patch/manual.txt','Tool/base/official/apply_patch/presentation/desktop.css','Client/CLI/terminal/terminal.go',
            'Client/Desktop/package.json','Client/Desktop/src/managed-update.cjs','Client/Desktop/ui/workspace.css',
            'README.md','LICENSE','scripts/create-launchers.ps1','scripts/CLI-README.md',
            'CLOUD/server.mjs','.github/workflows/test.yml','scripts/export-source.py']}
        selected=runtime.runtime_files(reviewed)
        excluded={'CLOUD/server.mjs','.github/workflows/test.yml','scripts/export-source.py'}
        self.assertEqual(selected,{name:data for name,data in reviewed.items() if name not in excluded})
        for name in ['', '/Core/app.go','Core/../private','Core//app.go','./Core/app.go',
                     'Core/./app.go','Core\\app.go','C:'+ '/Core/app.go']:
            with self.subTest(name=name),self.assertRaises(ValueError):runtime.runtime_name(name)

    def test_os_module_inventory_excludes_private_store_and_runtime(self):
        software = ['Control/app/service/main.py', 'Control/app/web/app.js',
                    'Control/app/scripts/agent-client.py', 'Control/app/scripts/task_delegation.py',
                    'Link/app/link-core/go.mod',
                    'Link/app/link-core/link/cli.go', 'Editor/src/main.ts']
        private = ['Control/共享库/私有数据/account.txt', 'Control/app/data/history.txt',
                   'Control/app/service/data/config.json', 'Link/app/link-core/data/session.txt',
                   'Link/app/runtime/link/aieyra-link.exe', 'Editor/src/history/private.txt',
                   'Control/app/service/renamed.sqlite-wal', 'Link/app/link-core/account.db-journal']
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name in software + private:
                target = root/name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text('fixture', encoding='utf-8')
            names = p.source_files(root)
            self.assertTrue(set(software) <= names.keys())
            self.assertTrue(set(private[:-2]).isdisjoint(names))
            for name in private:
                self.assertTrue(p.validate(name, b'fixture', {}))
            for name in software:
                self.assertEqual(p.validate(name, b'fixture', {}), [])
                self.assertIn('credential_or_private_key', p.validate(name, b'ghp_'+b'F'*36, {}))

    def test_os_module_source_link_cannot_export_external_data(self):
        import os
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            external = root/'private'
            external.mkdir()
            (external/'account.py').write_text('private fixture')
            link = root/'Control/app/service'
            link.parent.mkdir(parents=True)
            try:
                os.symlink(external, link, target_is_directory=True)
            except OSError as error:
                self.skipTest('Host cannot create synthetic symlink: '+type(error).__name__)
            with self.assertRaisesRegex(ValueError, 'source_symlink'):
                p.source_files(root)

    def test_macos_identity_rejects_mismatched_metadata_and_environment(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'Core/host').mkdir(parents=True);(root/'scripts').mkdir()
            (root/'Core/host/app.go').write_text('var Version = "1.2.3"\n')
            target=root/'scripts/release-metadata.json'
            valid={'schema':1,'product':'aieyra-os','version':'1.2.3','sequence':7}
            with self.assertRaises(ValueError):mac.release_identity(root,{})
            target.write_text(json.dumps(valid))
            self.assertEqual(mac.release_identity(root,{}),valid)
            matching={'RELEASE_VERSION':'1.2.3','RELEASE_SEQUENCE':'7',
                      'GITHUB_REF_TYPE':'tag','GITHUB_REF_NAME':'v1.2.3'}
            self.assertEqual(mac.release_identity(root,matching),valid)
            for key,value in [('RELEASE_VERSION','1.2.2'),('RELEASE_SEQUENCE','6'),
                              ('GITHUB_REF_NAME','v1.2.2')]:
                with self.subTest(key=key),self.assertRaises(ValueError):
                    mac.release_identity(root,{**matching,key:value})
            for key,value in [('schema',True),('sequence',True),('sequence',0),
                              ('sequence','7'),('version','1.2.2'),('product','other')]:
                target.write_text(json.dumps({**valid,key:value}))
                with self.subTest(key=key,value=value),self.assertRaises(ValueError):
                    mac.release_identity(root,{})

if __name__=='__main__':unittest.main()
