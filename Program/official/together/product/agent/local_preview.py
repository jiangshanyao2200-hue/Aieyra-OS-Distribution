# @file-map:start
# 文件: link/agent/local_preview.py
# 位置: 二环·Agent完整链路 | 协作CLI、接续、实际启动器、工作包、源码传输和本机运行。
# 约束: 使用本人已有身份和connection，不因压缩重建身份；写操作保留request_id；未知结果查回执，凭据不进入日志与文档
# 下游: link/agent/local_runner.py, link/agent/source_protocol.py, link/agent/workspace.py
# 上游: AIDEBUG/practice-experiment.py, link/agent/proposal.py, tests/test_local_preview.py
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: AIDEBUG/practice-experiment.py, tests/test_local_preview.py
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   public | function
#   LocalPreview | class
#   LocalPreview.__init__ | function
#   LocalPreview.path | function
#   LocalPreview.inspect | function
#   LocalPreview.list | function
#   LocalPreview.start | function
#   LocalPreview.stop | function
#   snapshot_files | function
#   worker | function
#   worker.save | function
#   worker.Handler | class
#   worker.Handler.log_message | function
#   worker.Handler.setup | function
#   worker.Handler.do_HEAD | function
#   worker.Handler.do_GET | function
#   worker.Handler.handle_request | function
#   worker.Handler.reply | function
#   worker.BoundedServer | class
#   worker.BoundedServer.__init__ | function
#   worker.BoundedServer.process_request | function
#   worker.BoundedServer.process_request_thread | function
#   dashboard | function
#   add_parser | function
#   run | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Explicit, account-scoped web previews of immutable local source snapshots."""
from __future__ import annotations

import argparse
import json
import mimetypes
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import quote, unquote, urlsplit

if not __package__:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    from . import source_protocol as source
    from .workspace import Workspaces, atomic, document, exclusive, plain, ID
    from .local_runner import environment, process_alive, available
except ImportError:
    import source_protocol as source
    from workspace import Workspaces, atomic, document, exclusive, plain, ID
    from local_runner import environment, process_alive, available

TERMINAL = {'stopped', 'expired', 'interrupted', 'failed', 'limit_reached'}


# @chain-region public | calls: record.get
def public(record):
    return {k: record.get(k) for k in ('id', 'workspace_id', 'snapshot', 'base', 'root', 'entry',
            'state', 'error', 'created', 'updated', 'updates', 'expires', 'source_changes')}


# @chain-region LocalPreview | calls: (self.root / 'jobs' / (ident + '.log')).open, (self.root / 'records').glob, (self.root / name).mkdir, ID.fullmatch, Path, Path(__file__).resolve, Path(home or work.home.parent / 'engineering-previews').resolve, ValueError …
class LocalPreview:
    # @chain-region LocalPreview.__init__ | calls: (self.root / name).mkdir, Path, Path(home or work.home.parent / 'engineering-previews').resolve, plain, self.root.mkdir, source.canonical, source.canonical(work.scope).encode, source.digest
    def __init__(self, work, home=None):
        self.work = work
        self.home = Path(home or work.home.parent/'engineering-previews').resolve()
        self.root = self.home/source.digest(source.canonical(work.scope).encode())
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        plain(self.root, True)
        for name in ('records', 'jobs', 'stop'):
            (self.root/name).mkdir(exist_ok=True, mode=0o700)
            plain(self.root/name, True)

    # @chain-region LocalPreview.path | calls: ID.fullmatch, ValueError, isinstance
    def path(self, kind, ident):
        if not isinstance(ident, str) or not ID.fullmatch(ident):
            raise ValueError('invalid_preview_id')
        return self.root/kind/(ident+'.json')

    # @chain-region LocalPreview.inspect | calls: ValueError, atomic, document, document(self.path('jobs', ident)).get, process_alive, record.get, record.update, self.path …
    def inspect(self, ident):
        record = document(self.path('records', ident))
        if record.get('scope') != self.work.scope or record.get('id') != ident:
            raise ValueError('preview_account_mismatch')
        if record['state'] not in TERMINAL:
            pid = document(self.path('jobs', ident)).get('pid')
            if not process_alive(pid):
                record.update(state='interrupted', error='preview_worker_interrupted', updated=time.time())
                atomic(self.path('records', ident), record)
        return record

    # @chain-region LocalPreview.list | calls: (self.root / 'records').glob, self.inspect, sorted
    def list(self):
        return sorted((self.inspect(p.stem) for p in (self.root/'records').glob('*.json')),
                      key=lambda r: r['created'], reverse=True)

    # @chain-region LocalPreview.start | calls: (self.root / 'jobs' / (ident + '.log')).open, Path, Path(__file__).resolve, ValueError, atomic, child.poll, document, entry.lower …
    def start(self, workspace_id, root='.', entry='index.html', interval=5, lifetime=7200):
        if root != '.': root = source.source_path(root)
        entry = source.source_path(entry)
        if not entry.lower().endswith(('.html', '.htm')):
            raise ValueError('preview_html_entry_required')
        if not 2 <= interval <= 60 or not 30 <= lifetime <= 86400:
            raise ValueError('invalid_preview_options')
        self.work._load(workspace_id)
        with exclusive(self.root/'admission.lock'):
            rows = self.list()
            for row in rows:
                if row['workspace_id'] == workspace_id and row['state'] not in TERMINAL:
                    if (row['root'], row['entry']) != (root, entry):
                        raise ValueError('stop_existing_workspace_preview_first')
                    return {'preview': row, 'reused': True}
            if len(rows) >= 100 or sum(r['state'] not in TERMINAL for r in rows) >= 4:
                raise ValueError('preview_capacity')
            fixed = self.work.snapshot(workspace_id)
            snapshot = document(self.work._path('snapshots', fixed['id'], '.json'))
            name = entry if root == '.' else root+'/'+entry
            if name not in snapshot['files']:
                raise ValueError('preview_entry_not_in_snapshot')
            ident = secrets.token_hex(16)
            record = {'id': ident, 'scope': self.work.scope, 'workspace_id': workspace_id,
                      'snapshot': fixed['id'], 'base': fixed['base'], 'root': root, 'entry': entry,
                      'state': 'starting', 'created': time.time(), 'updated': time.time(),
                      'updates': 0, 'expires': time.time()+lifetime, 'source_changes': None}
            # Only public identity is needed for offline snapshots; never give the web server an Agent key.
            job = {'record': record, 'work_home': str(self.work.home), 'preview_home': str(self.home),
                   'agent_id': self.work.secret['id'], 'interval': interval, 'token': secrets.token_hex(24)}
            atomic(self.path('jobs', ident), job)
            atomic(self.path('records', ident), record)
            with (self.root/'jobs'/(ident+'.log')).open('ab') as output:
                child = subprocess.Popen([sys.executable, '-B', str(Path(__file__).resolve()),
                    '--worker', str(self.path('jobs', ident))], stdin=subprocess.DEVNULL,
                    stdout=output, stderr=output, env=environment(), start_new_session=os.name != 'nt',
                    creationflags=0x08000000 if os.name == 'nt' else 0)
            # Keep the job immutable in the child: persist PID separately from the job input.
            job['pid'] = child.pid
            atomic(self.path('jobs', ident), job)
            threading.Thread(target=child.wait, daemon=True).start()
            deadline = time.monotonic()+10
            while time.monotonic() < deadline:
                result = document(self.path('records', ident))
                if result['state'] != 'starting':
                    return {'preview': result, 'started': result['state'] == 'running'}
                if child.poll() is not None: break
                time.sleep(.05)
            atomic(self.path('stop', ident), {'requested': time.time()})
            raise ValueError('preview_start_failed_or_timed_out')

    # @chain-region LocalPreview.stop | calls: atomic, self.inspect, self.path, time.time
    def stop(self, ident):
        row = self.inspect(ident)
        if row['state'] not in TERMINAL:
            atomic(self.path('stop', ident), {'requested': time.time()})
        return {'id': ident, 'stop_requested': True, 'state': row['state']}


# @chain-region snapshot_files | calls: ValueError, document, source.canonical, source.canonical({k: v for k, v in value.items() if k != 'id'}).encode, source.digest, source.validate_manifest, value.get, value.items …
def snapshot_files(work, ident, workspace_id):
    value = document(work._path('snapshots', ident, '.json'))
    if value.get('workspace_id') != workspace_id or value.get('id') != ident or source.digest(
            source.canonical({k: v for k, v in value.items() if k != 'id'}).encode()) != ident:
        raise ValueError('preview_snapshot_binding_mismatch')
    source.validate_manifest(value['files'])
    return value


# @chain-region worker | calls: (text.replace('</body>', script + '</body>') if '</body>' in text else text + script).encode, BoundedServer, LocalPreview, Path, Path(job_path).resolve, ValueError, Workspaces, atomic …
def worker(job_path):
    job_path = Path(job_path).resolve()
    job = document(job_path)
    record = job['record']
    work = Workspaces({'server': record['scope']['server'], 'user_id': record['scope']['user_id'],
                       'id': job['agent_id'], 'key': ''}, job['work_home'])
    manager = LocalPreview(work, job['preview_home'])
    ident = record['id']
    if manager.path('jobs', ident) != job_path or record['scope'] != work.scope:
        raise ValueError('preview_worker_binding_mismatch')
    guard = threading.RLock()

    # @chain-region worker.save | calls: atomic, manager.path, record.update, time.time
    def save(**updates):
        with guard:
            record.update(updates, updated=time.time())
            atomic(manager.path('records', ident), record)

    # @chain-region worker.Handler | calls: (text.replace('</body>', script + '</body>') if '</body>' in text else text + script).encode, Path, ValueError, dict, fixed['files'].get, json.dumps, len, mime.startswith …
    class Handler(BaseHTTPRequestHandler):
        # @chain-region worker.Handler.log_message
        def log_message(self, *args): pass

        # @chain-region worker.Handler.setup | calls: self.connection.settimeout, super, super().setup
        def setup(self):
            super().setup()
            self.connection.settimeout(5)

        # @chain-region worker.Handler.do_HEAD | calls: self.handle_request
        def do_HEAD(self): self.handle_request(True)
        # @chain-region worker.Handler.do_GET | calls: self.handle_request
        def do_GET(self): self.handle_request(False)

        # @chain-region worker.Handler.handle_request | calls: (text.replace('</body>', script + '</body>') if '</body>' in text else text + script).encode, Path, ValueError, dict, fixed['files'].get, json.dumps, len, mimetypes.guess_type …
        def handle_request(self, head=False):
            try:
                target = urlsplit(self.path)
                prefix = '/'+job['token']+'/'
                origin = 'http://127.0.0.1:'+str(self.server.server_port)
                if (len(self.path) > 4096 or self.headers.get('Host') != origin[7:] or
                    self.headers.get('Origin') not in (None, origin) or
                    target.query or target.fragment or not target.path.startswith(prefix)):
                    self.send_error(403); return
                route = unquote(target.path[len(prefix):], errors='strict')
                with guard: current = dict(record)
                if route == '__link_state':
                    self.reply(source.canonical(public(current)).encode(), 'application/json', head); return
                if not route:
                    self.send_response(307)
                    self.send_header('Location', prefix+'s/'+current['snapshot']+'/'+quote(current['entry'], safe='/'))
                    self.send_header('Content-Length', '0'); self.end_headers(); return
                parts = route.split('/', 2)
                if len(parts) != 3 or parts[0] != 's' or not source.HEX.fullmatch(parts[1]):
                    self.send_error(404); return
                name = source.source_path(parts[2])
                fixed = snapshot_files(work, parts[1], current['workspace_id'])
                path = name if current['root'] == '.' else current['root']+'/'+name
                sha = fixed['files'].get(path)
                if sha is None: self.send_error(404); return
                raw = work._blob(sha).read_bytes()
                if source.digest(raw) != sha: raise ValueError('preview_blob_changed_while_reading')
                mime = {'.js': 'text/javascript', '.mjs': 'text/javascript'}.get(Path(name).suffix,
                        mimetypes.guess_type(name)[0] or 'application/octet-stream')
                if mime == 'text/html':
                    # Each asset URL is pinned to this exact snapshot. Poll only the bounded public state.
                    script = """<script>(()=>{const p=PREFIX,s=SNAPSHOT,e=ENTRY;
const b=document.createElement('div');b.id='link-source-preview';b.setAttribute('role','status');
b.style.cssText='position:fixed;bottom:8px;right:8px;z-index:2147483647;padding:6px 10px;background:#17191ef2;color:#eee;border-radius:8px;font:12px system-ui;max-width:90vw';
document.body.append(b);let stopped=false;
async function tick(){try{const r=await fetch(p+'__link_state',{cache:'no-store'});if(!r.ok)throw Error();const v=await r.json();
b.textContent='本地网页预览 · '+v.snapshot.slice(0,10)+' · '+(v.state==='running'?'测试结果请查看执行记录':v.state);
if(v.state==='running'&&v.snapshot!==s){location.replace(p+'s/'+v.snapshot+'/'+e);return;}}
catch{b.textContent='预览连接已中断 · 当前画面保留';}if(!stopped)setTimeout(tick,1500);}
addEventListener('pagehide',()=>stopped=true,{once:true});tick();})();</script>"""
                    script = script.replace('PREFIX', json.dumps(prefix)).replace('SNAPSHOT', json.dumps(parts[1])).replace('ENTRY', json.dumps(quote(current['entry'], safe='/')))
                    # HTML assets are UTF-8 in source bundles; invalid bytes are reported, not replaced.
                    text = raw.decode('utf-8')
                    raw = (text.replace('</body>', script+'</body>') if '</body>' in text else text+script).encode()
                self.reply(raw, mime, head, parts[1])
            except (BrokenPipeError, ConnectionResetError): pass
            except (ValueError, OSError, UnicodeError):
                self.send_error(409, 'Preview source unavailable or changed')

        # @chain-region worker.Handler.reply | calls: len, mime.startswith, self.end_headers, self.send_header, self.send_response, self.wfile.write, str
        def reply(self, raw, mime, head, snapshot=None):
            self.send_response(200)
            self.send_header('Content-Type', mime+('; charset=utf-8' if mime.startswith(('text/', 'application/json')) else ''))
            self.send_header('Content-Length', str(len(raw)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'none'; base-uri 'self'")
            if snapshot: self.send_header('X-Link-Snapshot', snapshot)
            self.end_headers()
            if not head: self.wfile.write(raw)

    # @chain-region worker.BoundedServer | calls: self.shutdown_request, self.slots.acquire, self.slots.release, super, super().__init__, super().process_request, super().process_request_thread, threading.BoundedSemaphore
    class BoundedServer(ThreadingHTTPServer):
        request_queue_size = 8

        # @chain-region worker.BoundedServer.__init__ | calls: super, super().__init__, threading.BoundedSemaphore
        def __init__(self, *args):
            self.slots = threading.BoundedSemaphore(8)
            super().__init__(*args)

        # @chain-region worker.BoundedServer.process_request | calls: self.shutdown_request, self.slots.acquire, self.slots.release, super, super().process_request
        def process_request(self, request, address):
            if not self.slots.acquire(blocking=False):
                self.shutdown_request(request); return
            try: super().process_request(request, address)
            except BaseException:
                self.slots.release(); raise

        # @chain-region worker.BoundedServer.process_request_thread | calls: self.slots.release, super, super().process_request_thread
        def process_request_thread(self, request, address):
            try: super().process_request_thread(request, address)
            finally: self.slots.release()

    server = None
    finished = {'state': 'failed', 'error': 'preview_worker_incomplete'}
    try:
        snapshot_files(work, record['snapshot'], record['workspace_id'])
        server = BoundedServer(('127.0.0.1', 0), Handler)
        server.daemon_threads = True
        threading.Thread(target=server.serve_forever, daemon=True).start()
        save(state='running', url='http://127.0.0.1:'+str(server.server_port)+'/'+job['token']+'/')
        last = time.monotonic()
        while time.time() < record['expires']:
            if manager.path('stop', ident).exists():
                finished = {'state': 'stopped', 'error': None}; return
            if time.monotonic()-last < job['interval']: time.sleep(.1); continue
            last = time.monotonic()
            try:
                if not available(): save(state='waiting_resources', error=None); continue
                fixed = work.snapshot(record['workspace_id'])
                snapshot = snapshot_files(work, fixed['id'], record['workspace_id'])
                entry = record['entry'] if record['root'] == '.' else record['root']+'/'+record['entry']
                if entry not in snapshot['files']: raise ValueError('preview_entry_not_in_snapshot')
                changed = fixed['id'] != record['snapshot']
                if changed and record['updates'] >= 1000:
                    finished = {'state': 'limit_reached', 'error': None}; return
                status = work.status(record['workspace_id'])
                save(state='running', snapshot=fixed['id'], base=fixed['base'], error=None,
                     updates=record['updates']+int(changed), source_changes=len(status['changes']))
            except (ValueError, OSError) as error:
                save(state='waiting_workspace' if str(error) == 'workspace_busy' else 'blocked', error=str(error)[:200])
        finished = {'state': 'expired', 'error': None}
    except BaseException as error:
        finished = {'state': 'failed', 'error': type(error).__name__+': '+str(error)[:200]}
    finally:
        if server: server.shutdown(); server.server_close()
        # A terminal record means the listener has closed, including on Windows.
        save(**finished)


# @chain-region dashboard | calls: (root / 'records').glob, Path, ValueError, directory.is_absolute, document, document(root / 'jobs' / (p.stem + '.json')).get, isinstance, plain …
def dashboard(owner, data_directory, ident=None):
    if not isinstance(owner, str) or not source.HEX.fullmatch(owner): raise ValueError('invalid_preview_owner')
    directory = Path(data_directory)
    if not directory.is_absolute(): raise ValueError('invalid_preview_data_directory')
    root = directory/'engineering-previews'/owner
    if not root.exists(): return {'local_previews': []}
    plain(root, True)
    rows = []
    for p in (root/'records').glob('*.json'):
        if ident is not None and p.stem != ident: continue
        row = document(p)
        if source.digest(source.canonical(row['scope']).encode()) != owner: continue
        if row['state'] not in TERMINAL and not process_alive(document(root/'jobs'/(p.stem+'.json')).get('pid')):
            row = {**row, 'state': 'interrupted', 'error': 'preview_worker_interrupted'}
        if ident is not None: return {'preview': row}
        rows.append(public(row))
    return {'local_previews': sorted(rows, key=lambda r: r['created'], reverse=True)[:40]}


# @chain-region add_parser | calls: commands.add_parser, parser.add_argument
def add_parser(commands):
    parser = commands.add_parser('preview', help='Explicit local web preview with immutable source versions')
    parser.add_argument('operation', choices=['start', 'status', 'stop'])
    parser.add_argument('--workspace'); parser.add_argument('--id')
    parser.add_argument('--root', default='.'); parser.add_argument('--entry', default='index.html')
    parser.add_argument('--interval', type=float, default=5); parser.add_argument('--lifetime', type=int, default=7200)


# @chain-region run | calls: LocalPreview, Workspaces, manager.inspect, manager.list, manager.start, manager.stop
def run(args, secret):
    manager = LocalPreview(Workspaces(secret))
    if args.operation == 'start': return manager.start(args.workspace, args.root, args.entry, args.interval, args.lifetime)
    if args.operation == 'stop': return manager.stop(args.id)
    return {'preview': manager.inspect(args.id)} if args.id else {'previews': manager.list()}


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--worker': worker(sys.argv[2])
    elif len(sys.argv) == 2 and sys.argv[1] == '--bridge-rpc':
        try:
            message = json.loads(sys.stdin.read(8193)); payload = message.get('payload', {})
            if message.get('action') not in ('dashboard', 'inspect'): raise ValueError('preview_bridge_action_denied')
            ident = payload.get('id')
            if ident is not None and not ID.fullmatch(ident): raise ValueError('invalid_preview_id')
            print(source.canonical(dashboard(payload.get('owner'), payload.get('data_directory'), ident)))
        except Exception as error: print(source.canonical({'error': str(error)[:300]}))
    else: raise SystemExit('Use proposal.py preview')
