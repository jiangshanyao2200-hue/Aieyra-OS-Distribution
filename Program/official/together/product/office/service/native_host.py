# @file-map:start
# 文件: link/office/service/native_host.py
# 位置: 二环·工位服务 | 本机控制、接入、凭据、工位与租约的HTTP服务。
# 约束: 服务绑定本机并核对所有者身份；凭据与工作正文不因短暂失联清空；关闭使用租约排空
# 下游: link/office/service/native_wakeup.py, link/office/service/office_codex.py
# 上游: link/office/service/main.py
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: python -X utf8 -B -m unittest discover -s link/office/tests/service
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   read_codex_state | function
#   NativeHostObserver | class
#   NativeHostObserver.__init__ | function
#   NativeHostObserver.observe | function
#   NativeHostObserver._run | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Read only the status of an already bound native thread; no resume or turn/start."""
from __future__ import annotations

import queue
import re
import threading
import time
from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path
from native_wakeup import CodexConnection, WakeError

ID = re.compile(r'^[A-Za-z0-9_-]{8,80}$')


# @chain-region read_codex_state | calls: ID.fullmatch, Path, Path(executable).is_absolute, Path(executable).is_file, WakeError, client.call, client.call('thread/read', {'threadId': native_id, 'includeTurns': False}).get, client.close …
def read_codex_state(executable, native_id, connection=CodexConnection, *, connection_config=None):
    if not isinstance(native_id, str) or not ID.fullmatch(native_id):
        raise WakeError('invalid_native_id')
    options = {}
    if connection_config is not None:
        if connection_config.get('binding', {}).get('native_session_id') != native_id:
            raise WakeError('native_binding_configuration_changed')
        from office_codex import connection_options
        executable, args, env = connection_options(connection_config)
        options = {'proxy_args': args, 'env': env}
    if not isinstance(executable, str) or not Path(executable).is_absolute() or not Path(executable).is_file():
        raise WakeError('native_executable_unavailable')
    client = connection(executable, timeout=2, **options)
    try:
        thread = client.call('thread/read', {'threadId': native_id, 'includeTurns': False}).get('thread', {})
        if thread.get('id') != native_id:
            raise WakeError('native_identity_mismatch')
        status = thread.get('status') or {}
        kind, flags = status.get('type'), status.get('activeFlags') or []
        archived = 'archived_sessions' in str(thread.get('path', '')).replace('\\', '/').split('/')
        state = ('offline' if archived else 'waiting_user' if flags else
                 {'active': 'running', 'idle': 'idle', 'systemError': 'error'}.get(kind, 'unknown'))
        return {'host': 'codex', 'state': state, 'source': 'native_host',
                'at': datetime.now(timezone.utc).isoformat(), 'silence_seconds': 0}
    finally:
        client.close()


# @chain-region NativeHostObserver | calls: ID.fullmatch, OrderedDict, datetime.now, datetime.now(timezone.utc).isoformat, dict, int, isinstance, len …
class NativeHostObserver:
    """One bounded queue; snapshot reads never wait for native IPC or scan other threads."""
    # @chain-region NativeHostObserver.__init__ | calls: OrderedDict, int, max, queue.Queue, set, threading.Lock
    def __init__(self, executable, stop, probe=read_codex_state, interval=30, freshness=45, capacity=64):
        self.executable, self.stop, self.probe = executable, stop, probe
        self.interval, self.freshness = interval, freshness
        self.lock = threading.Lock()
        self.queue = queue.Queue(maxsize=16)
        self.pending, self.results, self.attempts = set(), {}, {}
        self.bindings = OrderedDict()
        self.capacity = max(1, int(capacity))
        self.worker = None

    # @chain-region NativeHostObserver.observe | calls: ID.fullmatch, dict, isinstance, len, self.attempts.get, self.attempts.pop, self.bindings.pop, self.bindings.popitem …
    def observe(self, native_id, actor_id=None, binding_version=None):
        if not self.executable or not isinstance(native_id, str) or not ID.fullmatch(native_id) or self.stop.is_set():
            return None
        if actor_id is not None and (type(binding_version) is not int or binding_version < 1):
            return None
        actor_id = actor_id or native_id
        key = (actor_id, native_id, binding_version)
        now = time.monotonic()
        with self.lock:
            previous = self.bindings.pop(actor_id, None)
            if previous and previous != key:
                self.results.pop(previous, None)
                self.attempts.pop(previous, None)
            self.bindings[actor_id] = key
            while len(self.bindings) > self.capacity:
                _, expired = self.bindings.popitem(last=False)
                self.results.pop(expired, None)
                self.attempts.pop(expired, None)
            if key not in self.pending and now - self.attempts.get(key, -1e9) >= self.interval:
                try:
                    self.queue.put_nowait(key)
                    self.pending.add(key)
                    self.attempts[key] = now
                except queue.Full:
                    pass
                if self.worker is None:
                    self.worker = threading.Thread(target=self._run, daemon=True, name='station-native-status')
                    self.worker.start()
            row = self.results.get(key)
            return dict(row[0]) if row and 0 <= now - row[1] <= self.freshness else None

    # @chain-region NativeHostObserver._run | calls: datetime.now, datetime.now(timezone.utc).isoformat, self.bindings.get, self.pending.discard, self.probe, self.queue.get, self.queue.task_done, self.stop.is_set …
    def _run(self):
        while not self.stop.is_set():
            try:
                key = self.queue.get(timeout=1)
            except queue.Empty:
                continue
            try:
                value = self.probe(self.executable, key[1])
            except Exception:
                value = {'host': 'codex', 'state': 'unknown', 'source': 'native_host',
                         'at': datetime.now(timezone.utc).isoformat(), 'reason': 'native_status_unavailable'}
            with self.lock:
                # A binding may have changed while the read-only IPC was in flight.
                if not self.stop.is_set() and self.bindings.get(key[0]) == key:
                    self.results[key] = (value, time.monotonic())
                    self.attempts[key] = time.monotonic()
                self.pending.discard(key)
            self.queue.task_done()
