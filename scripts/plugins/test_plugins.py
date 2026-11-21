# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: scripts/AGENTS.md | ring 3
# Chains: module-local; query impact before editing
# Regions: load; PluginTests
# Impact: python -B scripts/code-atlas.py show scripts/plugins/test_plugins.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""Built-in Control discovery, compatibility forwarding and private-data protection."""

import importlib.util
import json
import os
from pathlib import Path
import subprocess
import shutil
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))
from link_product import discover_app, regular

try:
    LINK = discover_app(ROOT)
except FileNotFoundError:
    LINK = None


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


privacy = load("plugin_privacy_tests", "public-privacy.py")
runtime = load("plugin_runtime_tests", "runtime-files.py")


class PluginTests(unittest.TestCase):
    def test_entry_points_work_outside_checkout(self):
        if LINK is None:
            self.skipTest('Optional installed Link integration; fixture forwarding remains required')
        for command in [("control", "--help"), ("station", "--help"), ("transfer", "--help"), ("build-link", "--help")]:
            with self.subTest(command=command), tempfile.TemporaryDirectory() as directory:
                result = subprocess.run([sys.executable, '-X', 'utf8', str(ROOT / "scripts/plugins.py"), *command], cwd=directory, capture_output=True, text=True, encoding='utf-8', env={**os.environ, 'AIEYRA_LINK_ROOT': str(LINK)})
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn("usage:", result.stdout)

    def test_missing_builtin_does_not_use_sibling_or_environment(self):
        with tempfile.TemporaryDirectory() as directory:
            area = Path(directory)
            app = area / 'Aieyra Link/app'
            (app / 'scripts').mkdir(parents=True)
            (app / 'service').mkdir()
            (app / 'scripts/control.py').touch()
            (app / 'service/main.py').touch()
            for override in (str(app), 'relative'):
                with self.assertRaises(FileNotFoundError):
                    discover_app(area / 'OS', {'AIEYRA_LINK_ROOT': override})

    def test_builtin_discovery_ignores_environment_and_sibling(self):
        with tempfile.TemporaryDirectory() as directory:
            area = Path(directory)
            app = area / 'OS/Control/app'
            (app / 'scripts').mkdir(parents=True)
            (app / 'service').mkdir()
            (app / 'scripts/control.py').touch()
            (app / 'service/main.py').touch()
            for override in (str(area / 'other'), 'relative'):
                self.assertEqual(discover_app(area / 'OS', {'AIEYRA_LINK_ROOT': override}), app)

    def test_forwarding_preserves_arguments_and_child_exit(self):
        with tempfile.TemporaryDirectory() as directory:
            checkout = Path(directory) / 'OS'
            app = checkout / 'Control/app'
            (app / 'scripts').mkdir(parents=True)
            (app / 'service').mkdir()
            (app / 'service/main.py').touch()
            (checkout / 'scripts').mkdir()
            for name in ('plugins.py', 'link_product.py'):
                shutil.copy2(ROOT / 'scripts' / name, checkout / 'scripts' / name)
            probe = "import json,sys;print(json.dumps(sys.argv[1:],ensure_ascii=False));sys.exit(19)"
            for name in ['control.py', 'agent-station.py', 'station-transfer.py']:
                (app / 'scripts' / name).write_text(probe, encoding='utf-8')
            cases = [
                (['link', '--', '--name', '中文 name', '--request-id', 'original'], ['link', '--name', '中文 name', '--request-id', 'original']),
                (['station', '--profile', 'space name', 'join'], ['--profile', 'space name', 'join']),
                (['doctor', '--json'], ['doctor', '--json']),
                (['build-link', '--output', 'chosen runtime'], ['install-link', '--output', 'chosen runtime']),
            ]
            for arguments, expected in cases:
                with self.subTest(arguments=arguments):
                    result = subprocess.run([sys.executable, '-X', 'utf8', str(checkout / 'scripts/plugins.py'), *arguments], cwd=directory, env={**os.environ, 'AIEYRA_LINK_ROOT': str(Path(directory) / 'irrelevant')}, capture_output=True, text=True, encoding='utf-8', timeout=20)
                    self.assertEqual(result.returncode, 19, result.stderr)
                    self.assertEqual(json.loads(result.stdout), expected)

    def test_standalone_package_entry_is_retired(self):
        result = subprocess.run([sys.executable, '-X', 'utf8', str(ROOT / 'scripts/package-link.py')], capture_output=True, text=True, encoding='utf-8', timeout=10)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('不再提供独立安装包', result.stdout + result.stderr)

    def test_os_export_excludes_legacy_product_and_private_data(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ['CONTROL/service/main.py', 'Core/link/main.go',
                         'scripts/link/install.sh', 'scripts/control-public-files.json',
                         'Core/consumer/main.go']:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('fixture', encoding='utf-8')
            names = privacy.source_files(root)
            self.assertIn('Core/consumer/main.go', names)
            self.assertFalse(any(name.startswith(('CONTROL/', 'Core/link/', 'scripts/link/')) for name in names))
            self.assertNotIn('scripts/control-public-files.json', names)
        for name in ['CONTROL/service/main.py', 'CONTROL/docs/LINUX_TERMUX.md',
                     'CONTROL/data/station.json', 'Core/link/main.go',
                     'scripts/link/install.sh', 'scripts/control-public-files.json', 'DOCS/private.md']:
            self.assertTrue(privacy.validate(name, b'fixture'), name)
        for raw in [b"ghp_" + b"F" * 36, b'/'.join([b'', b'home', b'privateperson', b'file'])]:
            self.assertTrue(privacy.validate("CONTROL/service/main.py", raw))
        secret = b"synthetic-credential-to-redact"
        variants = [secret, b"".join(("%%%02x" % c).encode() for c in secret),
                    b"".join(("\\u%04x" % c).encode() for c in secret)]
        for raw in variants:
            self.assertIn("known_credential", privacy.validate("CONTROL/README.md", raw, known_secrets=[secret]))

    def test_runtime_contains_consumers_and_excludes_legacy_product(self):
        required = ['Core/main.go', 'Client/Desktop/host/link-product.cjs', 'scripts/plugins.py',
                    'scripts/link_product.py', 'scripts/package-link.py', 'scripts/PLUGINS.md']
        excluded = ['CONTROL/service/main.py', 'CONTROL/web/index.html', 'CONTROL/LICENSE',
                    'CONTROL/scripts/agent-station.py', 'Core/link/main.go',
                    'Core/link/LICENSE', 'scripts/link/install.sh', 'CONTROL/data/station.json']
        for name in required:
            self.assertTrue(runtime.runtime_name(name), name)
        for name in excluded:
            self.assertFalse(runtime.runtime_name(name), name)


if __name__ == "__main__":
    unittest.main()
