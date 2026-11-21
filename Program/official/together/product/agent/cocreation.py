# @file-map:start
# 文件: link/agent/cocreation.py
# 位置: 二环·Agent完整链路 | 协作CLI、接续、实际启动器、工作包、源码传输和本机运行。
# 约束: 使用本人已有身份和connection，不因压缩重建身份；写操作保留request_id；未知结果查回执，凭据不进入日志与文档
# 下游: link/agent/appcontainer.py, link/agent/cocreation_source.py, link/agent/workspace.py
# 上游: tests/test_u81_runtime.py
# 链路: source-transfer
# 验证: AIDEBUG/development-download.test.cjs, AIDEBUG/transfer-recovery.test.cjs, tests/test_u81_runtime.py
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   digest | function
#   extract | function
#   Development | class
#   Development.__init__ | function
#   Development.cloud | function
#   Development.update | function
#   Development.status | function
#   Development.prepare | function
#   Development.overlay | function
#   Development.command | function
#   Development.build | function
#   Development._build | function
#   Development.stop | function
#   Development.debug | function
#   Development.logs | function
#   main | function
#   main.emit | function
#   main.rpc | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Download/sync, build and launch the co-creation OS in a real Windows AppContainer."""
import hashlib
import json
import os
import re
from pathlib import Path, PurePosixPath
import secrets
import shutil
import subprocess
import sys
import threading
import time
import zipfile
if not __package__:
    # The bundled isolated Python deliberately omits the script directory.
    sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    from .appcontainer import AppContainer
    from .cocreation_source import Checkout
    from .workspace import atomic, document
except ImportError:
    from appcontainer import AppContainer
    from cocreation_source import Checkout
    from workspace import atomic, document

MAX_RUNTIME = 3 * 2 ** 30


# @chain-region digest | calls: h.hexdigest, h.update, hashlib.sha256, iter, open, stream.read
def digest(file):
    h = hashlib.sha256()
    with open(file, 'rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''): h.update(chunk)
    return h.hexdigest()


# @chain-region extract | calls: PurePosixPath, ValueError, dst.write, file.open, file.parent.mkdir, h.hexdigest, h.update, hashlib.sha256 …
def extract(archive, target, files, progress=lambda *_: None):
    total = 0
    with zipfile.ZipFile(archive) as z:
        rows = z.infolist()
        if len(rows) != len(files) or len(rows) > 50000: raise ValueError('runtime_archive_entries')
        seen = set()
        for row in rows:
            name = row.filename
            p = PurePosixPath(name)
            if (name in seen or name not in files or p.is_absolute() or '..' in p.parts or
                '\\' in name or ':' in name or row.is_dir() or (row.external_attr >> 16) & 0o170000 == 0o120000):
                raise ValueError('runtime_archive_path')
            seen.add(name); total += row.file_size
            if total > MAX_RUNTIME or row.file_size != files[name]['bytes']: raise ValueError('runtime_archive_size')
            file = target / name; file.parent.mkdir(parents=True, exist_ok=True)
            h = hashlib.sha256()
            with z.open(row) as src, file.open('xb') as dst:
                for chunk in iter(lambda: src.read(1024 * 1024), b''): h.update(chunk); dst.write(chunk)
            if h.hexdigest() != files[name]['sha256']: raise ValueError('runtime_file_digest')
            if len(seen) % 100 == 0 or len(seen) == len(files): progress(len(seen), len(files))


# @chain-region Development | calls: (data / 'config.json').exists, (owner / 'go.mod').is_file, (p / 'package.json').is_file, (package / 'package.json').read_text, (self.box / 'installed.json').is_file, (self.box / 'workspace').mkdir, (self.box / frame['relative']).resolve, (self.runtime / n).is_file …
class Development:
    # @chain-region Development.__init__ | calls: AppContainer, Checkout, Path, Path(config['directory']).resolve, config.get, document, hashlib.sha256, hashlib.sha256(str(self.root).encode()).hexdigest …
    def __init__(self, config, rpc, changed=lambda value: None):
        self.root = Path(config['directory']).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.rpc, self.changed = rpc, changed
        self.checkout = Checkout(self.root / 'sources', config['server'], config['account'], self.cloud,
                                 lambda done, total: self.update(completed=done, count=total, retrying=False, file_name=None, file_received=0, file_total=None),
                                 lambda name, done, total: self.update(file_name=name, file_received=done, file_total=total, retrying=False))
        self.box = self.checkout.root / 'sandbox'
        self.runtime = self.box / 'runtime'
        self.container = AppContainer(self.box, 'aieyra.together.dev.' + hashlib.sha256(str(self.root).encode()).hexdigest()[:20])
        self.process = None
        self.debug_session = None
        self.cancelled = threading.Event()
        self.state = {'state': 'idle', 'sandbox': 'Windows AppContainer', 'source_path': None}
        self.receipt = self.checkout.root / 'development.json'
        if self.receipt.is_file():
            prior = document(self.receipt)
            self.state.update({key: prior[key] for key in ('source_path', 'revision', 'downloaded', 'tested') if key in prior})
        if self.state.get('downloaded') and self.runtime.is_dir(): self.state['state'] = 'ready'
        else: self.state['downloaded'] = False
        self.log = self.box / 'output.log'
        self.hidden = config.get('offscreen', False)

    # @chain-region Development.cloud | calls: ValueError, getattr, max, min, self.cancelled.is_set, self.cancelled.wait, self.rpc, self.state.get …
    def cloud(self, route, body=None):
        if self.cancelled.is_set(): raise ValueError('已取消')
        if body is not None: raise ValueError('checkout_is_read_only')
        attempt = 0
        while True:
            try:
                result = self.rpc('cloud', {'route': route})
                if self.state.get('retrying'): self.update(retrying=False)
                return result
            except Exception as error:
                status = getattr(error, 'status', 0)
                if status not in (408, 429, 500, 502, 503, 504): raise
                delay = max(min(30, 2 ** min(attempt, 5)), min(3600, getattr(error, 'retry_after', 0)))
                attempt += 1
                self.update(retrying=True)
                if self.cancelled.wait(delay): raise ValueError('已取消')

    # @chain-region Development.update | calls: atomic, self.changed, self.state.update, self.status
    def update(self, **values):
        self.state.update(values)
        atomic(self.receipt, self.state)
        self.changed(self.status())

    # @chain-region Development.status | calls: dict, process.close, process.poll, self.state.update
    def status(self):
        process = self.process
        if process and process.poll() is not None and self.state['state'] == 'running':
            self.state.update(state='stopped', exit_code=process.poll())
            process.close()
            if self.process is process: self.process = None
        return dict(self.state)

    # @chain-region Development.prepare | calls: (data / 'config.json').exists, (self.box / 'installed.json').is_file, (self.box / 'workspace').mkdir, Path, ValueError, atomic, data.mkdir, digest …
    def prepare(self, launch=False):
        if self.process and self.process.poll() is None: raise ValueError('请先停止正在运行的众创 OS。')
        self.cancelled.clear()
        try:
            if self.log.exists() and self.log.stat().st_size > 8 * 1024 * 1024:
                os.replace(self.log, self.box / 'output.previous.log')
            self.update(state='syncing', error=None, conflicts=[], received=0, total=None, completed=0, count=None, file_name=None, file_received=0, file_total=None, retrying=False, tested=False)
            value = self.checkout.sync()
            self.update(source_path=value['path'], revision=value.get('base'), conflicts=value.get('conflicts', []))
            if not value['applied']:
                self.update(state='conflict', error='源码存在冲突，请先处理列出的文件。'); return self.status()
            if self.cancelled.is_set(): raise ValueError('已取消')
            meta = self.cloud('/engineering/development')
            if not self.runtime.is_dir() or not (self.box / 'installed.json').is_file() or document(self.box / 'installed.json').get('sha256') != meta['sha256']:
                self.update(state='downloading', received=0, total=meta['size'], completed=0, count=None)
                archive = Path(self.rpc('artifact', {'artifact': {k: meta[k] for k in ('file', 'size', 'sha256')}})['path'])
                if self.cancelled.is_set(): raise ValueError('已取消')
                if digest(archive) != meta['sha256']: raise ValueError('下载文件校验失败')
                stage = self.box / ('runtime-' + secrets.token_hex(8))
                stage.mkdir()
                try:
                    self.update(state='preparing', completed=0, count=len(meta['files']))
                    extract(archive, stage, meta['files'], lambda done, total: self.update(completed=done, count=total))
                    if self.cancelled.is_set(): raise ValueError('已取消')
                    previous = self.box / 'previous-runtime'
                    if previous.exists(): shutil.rmtree(previous)
                    if self.runtime.exists(): self.runtime.rename(previous)
                    try: stage.rename(self.runtime)
                    except Exception:
                        if previous.exists(): previous.rename(self.runtime)
                        raise
                    if previous.exists(): shutil.rmtree(previous)
                finally:
                    if stage.exists(): shutil.rmtree(stage)
                atomic(self.box / 'installed.json', {'sha256': meta['sha256']})
            self.update(downloaded=True, state='preparing', completed=None, count=None, received=0, total=None, retrying=False)
            if not launch:
                self.update(state='ready'); return self.status()
            self.overlay(value, meta)
            self.container.grant()
            self.update(state='testing')
            self.build(value, meta)
            self.command([self.runtime / 'Aieyra OS.exe', '-version'], self.runtime, 30)
            self.update(tested=True, state='starting')
            if self.cancelled.is_set(): raise ValueError('已取消')
            data = self.box / 'data'; data.mkdir(exist_ok=True)
            if not (data / 'config.json').exists(): atomic(data / 'config.json', {})
            (self.box / 'workspace').mkdir(exist_ok=True)
            self.debug_session = secrets.token_hex(16)
            env = {'AIEYRA_ROOT': str(self.runtime), 'AIEYRA_HOST_LIFECYCLE_TRACE': '1',
                   'AIEYRA_AIDEBUG_SESSION': self.debug_session,
                   'AIEYRA_NOTES_DIR': str(self.box / 'workspace'), 'AIEYRA_WORKSPACE_OFFSCREEN': '1' if self.hidden else '0'}
            start_offset = self.log.stat().st_size if self.log.exists() else 0
            process = self.container.start([self.runtime / 'Aieyra OS.exe', '-config', data / 'config.json',
                                                '-workdir', self.box / 'workspace'], self.runtime, self.log, env)
            self.process = process
            # Require this launch's actual desktop load, not a stale log or a live PID.
            ready = False
            for _ in range(240):
                if self.cancelled.wait(.25): raise ValueError('已取消')
                code = process.poll()
                if code is not None: raise ValueError('众创 OS 启动失败（退出码 ' + str(code) + '），请查看日志。')
                with self.log.open('rb') as stream:
                    stream.seek(start_offset); output = stream.read(65536)
                if b'"host_phase":"load-complete"' in output:
                    ready = True; break
            if not ready: raise ValueError('众创 OS 页面未能就绪，请查看日志。')
            self.update(state='running', pid=process.pid, started=time.time(), runtime_path=str(self.runtime))
        except Exception as error:
            if self.process: self.process.close(); self.process = None
            phase = self.state['state']
            self.update(state='stopped' if self.cancelled.is_set() else 'error', pid=None, failed_phase=phase, retrying=False,
                        error=None if self.cancelled.is_set() else str(error)[:350])
        return self.status()

    # @chain-region Development.overlay | calls: Path, atomic, digest, document, files.items, files.keys, previous.get, previous.keys …
    def overlay(self, value, meta):
        tree, files = Path(value['path']), value['files']
        prior_file = self.checkout.root / 'overlay.json'
        prior = document(prior_file) if prior_file.exists() else {}
        previous = prior.get('files', {})
        stamps = prior.get('stamps', {})
        current = {}
        for name in previous.keys() - files.keys():
            target = self.runtime / name
            if target.is_file(): target.unlink()
        for name, sha in files.items():
            src, target = tree / name, self.runtime / name
            stamp = [target.stat().st_size, target.stat().st_mtime_ns] if target.is_file() else None
            if previous.get(name) != sha or stamps.get(name) != stamp or stamp is None:
                if stamp is None or digest(target) != sha:
                    target.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(src, target)
                stat = target.stat(); stamp = [stat.st_size, stat.st_mtime_ns]
            current[name] = stamp
        atomic(prior_file, {'files': files, 'stamps': current})

    # @chain-region Development.command | calls: ValueError, process.close, process.poll, self.cancelled.is_set, self.cancelled.wait, self.container.start, time.monotonic
    def command(self, argv, cwd, timeout=600, extra=None):
        if self.cancelled.is_set(): raise ValueError('已取消')
        process = self.container.start(argv, cwd, self.log, extra)
        self.process = process
        try:
            deadline = time.monotonic() + timeout
            while process.poll() is None:
                if self.cancelled.wait(.2): raise ValueError('已取消')
                if time.monotonic() > deadline: raise ValueError('构建或测试超时，请查看日志。')
            if process.poll() != 0: raise ValueError('构建或测试失败，请查看日志。')
        finally:
            process.close()
            if self.process is process: self.process = None

    # @chain-region Development.build | calls: (self.runtime / name).is_file, all, atomic, digest, document, hashlib.sha256, hashlib.sha256(json.dumps({'recipe': 2, 'runtime': meta['sha256'], 'files': value['files']}, sort_keys=True, separators=(',', ':')).encode()).hexdigest, json.dumps …
    def build(self, value, meta):
        signature = hashlib.sha256(json.dumps({'recipe':2,'runtime':meta['sha256'],'files':value['files']},sort_keys=True,separators=(',',':')).encode()).hexdigest()
        receipt = self.box / 'build.json'
        prior = document(receipt) if receipt.exists() else {}
        outputs = ['Aieyra OS.exe','Aieyra CLI.exe','Aieyra Link.exe','Aieyra Browser.exe','Link/app/runtime/link/aieyra-link.exe']
        if prior.get('signature') == signature and prior.get('outputs') and all((self.runtime/name).is_file() and digest(self.runtime/name)==sha for name,sha in prior['outputs'].items()):
            self.update(cached_build=True)
            return
        self.update(cached_build=False)
        self._build(value, meta)
        atomic(receipt,{'signature':signature,'outputs':{name:digest(self.runtime/name) for name in outputs if (self.runtime/name).is_file()}})

    # @chain-region Development._build | calls: (owner / 'go.mod').is_file, (p / 'package.json').is_file, (package / 'package.json').read_text, (self.runtime / n).is_file, (self.runtime / n).is_relative_to, (self.runtime / name).read_text, Path, ValueError …
    def _build(self, value, meta):
        # Prebuilt executables are usable only for their exact source hashes.
        baseline = self.checkout.download(meta['revision'])['files']
        current = value['files']
        changed = [name for name in baseline.keys() | current.keys() if baseline.get(name) != current.get(name)]
        if not changed: return
        go_changed = any(n.endswith(('.go', 'go.mod', 'go.sum', 'go.work', '.syso')) for n in changed)
        if go_changed:
            self.update(state='building', step='Go')
            versions = [match[1] for name in current if name.endswith('go.mod')
                        if (match := re.search(r'(?m)^go\s+([\d.]+)', (self.runtime / name).read_text(encoding='utf-8')))]
            version = max(versions, key=lambda v: tuple(map(int, v.split('.')))) if versions else '1.26.8'
            tools = self.rpc('toolchain', {'kind': 'go', 'directory': str(self.box / 'tools/go'), 'version': version})
            self.container.grant()
            env = {'GOROOT': tools['path'], 'GOCACHE': str(self.box / 'temporary/go-cache'), 'GOPATH': str(self.box / 'temporary/go-path'),
                   'CGO_ENABLED': '0', 'GOTOOLCHAIN': 'local', 'GOPROXY': 'https://goproxy.cn|https://proxy.golang.org'}
            go = Path(tools['path']) / 'bin/go.exe'
            for package, output in (('./cmd/aieyra-os', 'Aieyra OS.exe'), ('./cmd/aieyra-cli', 'Aieyra CLI.exe'),
                                    ('./cmd/aieyra-module', 'Aieyra Link.exe'), ('./cmd/aieyra-module', 'Aieyra Browser.exe')):
                flags = '-s -w' if output == 'Aieyra CLI.exe' else '-H=windowsgui -s -w'
                self.command([go, 'build', '-trimpath', '-ldflags', flags, '-o', self.runtime / output, package], self.runtime / 'Core', 900, env)
            native = self.runtime / 'Link/app/link-core'
            if any(n.startswith('Link/app/link-core/') for n in changed):
                self.command([go, 'build', '-trimpath', '-o', self.runtime / 'Link/app/runtime/link/aieyra-link.exe', './cmd/aieyra-link'], native, 900, env)
            # Test each changed package in its owning Go module, including standalone modules.
            modules = {}
            for name in changed:
                if not name.endswith(('.go', 'go.mod', 'go.sum')): continue
                directory = (self.runtime / name).parent
                if not directory.is_dir(): continue
                owner = directory
                while owner != self.runtime and not (owner / 'go.mod').is_file(): owner = owner.parent
                if owner == self.runtime: continue
                package = './...' if Path(name).name in ('go.mod', 'go.sum') else './' + directory.relative_to(owner).as_posix()
                modules.setdefault(owner, set()).add(package)
            for module, packages in sorted(modules.items()):
                self.command([go, 'test'] + sorted(packages), module, 900, env)
        packages = set()
        for name in changed:
            if name.endswith(('.ts', '.tsx', '.jsx', '.vue')) or Path(name).name in ('package.json', 'package-lock.json'):
                p = (self.runtime / name).parent
                while p != self.runtime:
                    if (p / 'package.json').is_file(): packages.add(p); break
                    p = p.parent
        if packages:
            self.update(state='building', step='UI')
            tools = self.rpc('toolchain', {'kind': 'node', 'directory': str(self.box / 'tools/node')})
            self.container.grant()
            node = Path(tools['path']) / 'node.exe'
            env = {'PATH': tools['path'] + ';' + os.environ['SystemRoot'] + '\\System32', 'npm_config_cache': str(self.box / 'temporary/npm-cache'),
                   'ELECTRON_SKIP_BINARY_DOWNLOAD': '1'}
            npm = Path(tools['path']) / 'node_modules/npm/bin/npm-cli.js'
            for package in sorted(packages):
                spec = json.loads((package / 'package.json').read_text(encoding='utf-8'))
                self.command([node, npm, 'ci', '--no-audit', '--no-fund'], package, 900, env)
                if spec.get('scripts', {}).get('build'): self.command([node, npm, 'run', 'build'], package, 900, env)
                elif any(n.endswith(('.ts', '.tsx', '.jsx', '.vue')) and (self.runtime / n).is_relative_to(package) for n in changed):
                    raise ValueError('该界面源码缺少构建命令：' + str(package.relative_to(self.runtime)))
        scripts = [n for n in changed if n.endswith(('.cjs', '.mjs', '.js')) and (self.runtime / n).is_file()]
        if scripts:
            electron = self.runtime / 'Client/Desktop/node_modules/electron/dist/electron.exe'
            for name in scripts: self.command([electron, '--no-stdio-init', '--check', self.runtime / name], self.runtime, 30, {'ELECTRON_RUN_AS_NODE': '1'})

    # @chain-region Development.stop | calls: self.cancelled.set, self.process.close, self.status, self.update
    def stop(self):
        self.cancelled.set()
        if self.process: self.process.close(); self.process = None
        self.update(state='stopped', pid=None)
        return self.status()

    # @chain-region Development.debug | calls: (self.box / frame['relative']).resolve, ValueError, atomic, directory.mkdir, directory.resolve, document, document(request).get, file.is_relative_to …
    def debug(self, command):
        if not self.debug_session or not self.process or self.process.poll() is not None:
            raise ValueError('众创 OS 未运行')
        if not isinstance(command, dict): raise ValueError('invalid_os_command')
        identifier = secrets.token_hex(16)
        directory = self.box / 'diagnostics/os'; directory.mkdir(parents=True, exist_ok=True)
        request, response = directory / 'command.json', directory / (identifier + '.json')
        atomic(request, {**command, 'id': identifier, 'session': self.debug_session})
        deadline = time.monotonic() + 12
        try:
            while time.monotonic() < deadline:
                if response.exists():
                    result = document(response)
                    if result.get('error'): raise ValueError(result['error'])
                    value = result.get('value')
                    if isinstance(value, dict):
                        for frame in value.get('frames', []):
                            file = (self.box / frame['relative']).resolve()
                            if not file.is_relative_to(directory.resolve()): raise ValueError('invalid_os_capture')
                            frame['path'] = str(file)
                    return value
                if self.cancelled.wait(.05): raise ValueError('已取消')
            raise ValueError('众创 OS 诊断未响应；请查询实际窗口或运行日志')
        finally:
            response.unlink(missing_ok=True)
            if request.exists() and document(request).get('id') == identifier: request.unlink(missing_ok=True)

    # @chain-region Development.logs | calls: ValueError, len, raw.decode, self.log.exists, self.log.open, self.log.stat, stream.read, stream.seek …
    def logs(self, offset=0):
        if type(offset) is not int or not 0 <= offset <= MAX_RUNTIME: raise ValueError('invalid_log_offset')
        if not self.log.exists(): return {'text': '', 'offset': 0, 'next_offset': None}
        with self.log.open('rb') as stream:
            stream.seek(offset); raw = stream.read(32768)
        return {'text': raw.decode('utf-8', 'replace'), 'offset': offset,
                'next_offset': offset + len(raw) if offset + len(raw) < self.log.stat().st_size else None}


# @chain-region main | calls: Development, ValueError, emit, event.wait, json.dumps, json.loads, manager.cancelled.is_set, manager.container.close …
def main():
    config = json.loads(sys.stdin.readline())
    output = threading.Lock(); pending = {}; thread = None
    # @chain-region main.emit | calls: json.dumps, print
    def emit(value):
        with output: print(json.dumps(value, ensure_ascii=False, separators=(',', ':')), flush=True)
    # @chain-region main.rpc | calls: ValueError, emit, event.wait, manager.cancelled.is_set, pending.pop, row.get, secrets.token_hex, threading.Event
    def rpc(kind, payload):
        ident = secrets.token_hex(8); event = threading.Event(); row = {'event': event}
        pending[ident] = row; emit({'rpc': ident, 'kind': kind, 'payload': payload})
        while not event.wait(.2):
            if manager.cancelled.is_set():
                pending.pop(ident, None)
                raise ValueError('已取消')
        if row.get('error'):
            error = ValueError(row['error'])
            error.status, error.retry_after = row.get('status', 0), row.get('retry_after', 0)
            raise error
        return row['value']
    manager = Development(config, rpc, lambda value: emit({'state': value}))
    emit({'state': manager.status()})
    try:
        for line in sys.stdin:
            value = json.loads(line)
            if 'rpc' in value:
                row = pending.pop(value['rpc'], None)
                if row:
                    row.update(value=value.get('value'), error=value.get('error'), status=value.get('status', 0), retry_after=value.get('retry_after', 0))
                    row['event'].set()
                continue
            ident, action = value.get('id'), value.get('action')
            try:
                if action in ('download', 'start'):
                    if thread and thread.is_alive(): raise ValueError('正在处理，请稍候。')
                    if manager.process and manager.process.poll() is None: raise ValueError('请先停止正在运行的众创 OS。')
                    manager.state.update(state='syncing', error=None)
                    thread = threading.Thread(target=manager.prepare, kwargs={'launch': action == 'start'}, daemon=True); thread.start()
                    result = manager.status()
                elif action == 'status': result = manager.status()
                elif action == 'stop': result = manager.stop()
                elif action == 'logs': result = manager.logs(value.get('offset', 0))
                elif action == 'debug': result = manager.debug(value.get('command'))
                else: raise ValueError('unknown_development_action')
                emit({'id': ident, 'value': result})
            except Exception as error: emit({'id': ident, 'error': str(error)[:350]})
    finally:
        manager.stop(); manager.container.close()


if __name__ == '__main__': main()
