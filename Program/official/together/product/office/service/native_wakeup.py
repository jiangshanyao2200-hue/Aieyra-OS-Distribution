# @file-map:start
# 文件: link/office/service/native_wakeup.py
# 位置: 二环·工位服务 | 本机控制、接入、凭据、工位与租约的HTTP服务。
# 约束: 服务绑定本机并核对所有者身份；凭据与工作正文不因短暂失联清空；关闭使用租约排空
# 下游: 无已解析的项目内静态导入
# 上游: link/office/service/native_host.py, link/office/service/office_codex.py, link/office/service/station_keepalive.py, link/office/service/station_notifications.py
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: python -X utf8 -B -m unittest discover -s link/office/tests/service
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   WakeError | class
#   CodexConnection | class
#   CodexConnection.__init__ | function
#   CodexConnection._reader | function
#   CodexConnection._read | function
#   CodexConnection._write | function
#   CodexConnection._frame | function
#   CodexConnection.send | function
#   CodexConnection.receive | function
#   CodexConnection.call | function
#   CodexConnection.close | function
#   NativeWakeup | class
#   NativeWakeup.__init__ | function
#   NativeWakeup.validate_target | function
#   NativeWakeup.notify | function
#   ResourceGate | class
#   ResourceGate.__init__ | function
#   ResourceGate.__call__ | function
#   ResourceGate.__call__.Memory | class
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Bounded notifications to an existing Codex daemon; never create a new host/thread."""

import base64
import hashlib
import json
import os
from pathlib import Path
import queue
import struct
import subprocess
import threading
import time


# @chain-region WakeError
class WakeError(Exception):
    pass


# @chain-region CodexConnection | calls: ('GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ' + key + '\r\nSec-WebSocket-Version: 13\r\n\r\n').encode, (key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode, Path, Path(executable).is_absolute, Path(executable).is_file, WakeError, base64.b64encode, base64.b64encode(hashlib.sha1((key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode …
class CodexConnection:
    """Codex proxy forwards raw WebSocket bytes, not JSON-lines, on Windows too."""

    # @chain-region CodexConnection.__init__ | calls: ('GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ' + key + '\r\nSec-WebSocket-Version: 13\r\n\r\n').encode, (key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode, Path, Path(executable).is_absolute, Path(executable).is_file, WakeError, base64.b64encode, base64.b64encode(hashlib.sha1((key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode …
    def __init__(self, executable, timeout=8, *, proxy_args=None, env=None):
        if not Path(executable).is_file() or not Path(executable).is_absolute():
            raise WakeError("native_executable_unavailable")
        self.timeout = timeout
        self.buffer = bytearray()
        self.chunks = queue.Queue(maxsize=64)
        self.closed = threading.Event()
        self.sequence = 0
        self.process = subprocess.Popen(
            [executable, *(proxy_args if proxy_args is not None else ["app-server", "proxy"])],
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            creationflags=(subprocess.CREATE_NO_WINDOW | subprocess.BELOW_NORMAL_PRIORITY_CLASS)
            if os.name == "nt"
            else 0,
        )
        threading.Thread(target=self._reader, daemon=True).start()
        try:
            key = base64.b64encode(os.urandom(16)).decode()
            self._write(
                (
                    "GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\n"
                    "Connection: Upgrade\r\nSec-WebSocket-Key: "
                    + key
                    + "\r\nSec-WebSocket-Version: 13\r\n\r\n"
                ).encode()
            )
            deadline = time.monotonic() + timeout
            header = b""
            while not header.endswith(b"\r\n\r\n") and len(header) < 8192:
                header += self._read(1, deadline)
            lines = header.decode("ascii").split("\r\n")
            headers = {
                line.split(":", 1)[0].lower(): line.split(":", 1)[1].strip()
                for line in lines[1:]
                if ":" in line
            }
            accept = base64.b64encode(
                hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()
            ).decode()
            if (
                lines[0] != "HTTP/1.1 101 Switching Protocols"
                or headers.get("sec-websocket-accept", "") != accept
            ):
                raise WakeError("native_handshake_invalid")
            self.call(
                "initialize",
                {
                    "clientInfo": {"name": "aieyra_control_station", "version": "1"},
                    "capabilities": {"experimentalApi": True},
                },
            )
            self.send({"method": "initialized"})
        except Exception:
            self.close()
            raise

    # @chain-region CodexConnection._reader | calls: self.chunks.put, self.closed.is_set, self.closed.set, self.process.stdout.read1
    def _reader(self):
        try:
            while not self.closed.is_set():
                chunk = self.process.stdout.read1(16384)
                while not self.closed.is_set():
                    try:
                        self.chunks.put(chunk, timeout=0.2)
                        break
                    except queue.Full:
                        continue
                if not chunk:
                    break
        except OSError:
            self.closed.set()

    # @chain-region CodexConnection._read | calls: WakeError, bytes, len, max, self.buffer.extend, self.chunks.get, self.closed.is_set, time.monotonic
    def _read(self, count, deadline):
        while len(self.buffer) < count:
            if time.monotonic() >= deadline:
                raise WakeError("native_timeout")
            if self.closed.is_set():
                raise WakeError("native_connection_closed")
            try:
                chunk = self.chunks.get(timeout=max(0.001, deadline - time.monotonic()))
            except queue.Empty:
                raise WakeError("native_timeout") from None
            if not chunk:
                raise WakeError("native_connection_closed")
            self.buffer.extend(chunk)
        data = bytes(self.buffer[:count])
        del self.buffer[:count]
        return data

    # @chain-region CodexConnection._write | calls: self.process.stdin.flush, self.process.stdin.write
    def _write(self, data):
        self.process.stdin.write(data)
        self.process.stdin.flush()

    # @chain-region CodexConnection._frame | calls: bytes, enumerate, len, os.urandom, self._write, struct.pack
    def _frame(self, payload, opcode=1):
        mask = os.urandom(4)
        length = len(payload)
        head = (
            bytes([128 | opcode, 128 | length])
            if length < 126
            else (
                bytes([128 | opcode, 254]) + struct.pack("!H", length)
                if length <= 65535
                else bytes([128 | opcode, 255]) + struct.pack("!Q", length)
            )
        )
        self._write(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))

    # @chain-region CodexConnection.send | calls: json.dumps, json.dumps(value, ensure_ascii=False).encode, self._frame
    def send(self, value):
        self._frame(json.dumps(value, ensure_ascii=False).encode())

    # @chain-region CodexConnection.receive | calls: WakeError, body.extend, bytearray, json.loads, len, self._frame, self._read, struct.unpack
    def receive(self, deadline):
        body = bytearray()
        started = False
        while True:
            first, second = self._read(2, deadline)
            opcode, length = first & 15, second & 127
            if first & 112 or second & 128:
                raise WakeError("native_frame_invalid")
            if length == 126:
                length = struct.unpack("!H", self._read(2, deadline))[0]
            elif length == 127:
                length = struct.unpack("!Q", self._read(8, deadline))[0]
            if length + len(body) > 2 * 1024 * 1024:
                raise WakeError("native_response_limit")
            payload = self._read(length, deadline)
            if opcode == 8:
                raise WakeError("native_connection_closed")
            if opcode in (9, 10):
                if not first & 128 or length > 125:
                    raise WakeError("native_frame_invalid")
                if opcode == 9:
                    self._frame(payload, 10)
                continue
            if opcode not in (0, 1) or (opcode == 0) != started:
                raise WakeError("native_frame_invalid")
            started = True
            body.extend(payload)
            if first & 128:
                return json.loads(body)

    # @chain-region CodexConnection.call | calls: WakeError, isinstance, range, self.receive, self.send, time.monotonic, value.get
    def call(self, method, params):
        self.sequence += 1
        self.send({"id": self.sequence, "method": method, "params": params})
        deadline = time.monotonic() + self.timeout
        for _ in range(200):
            value = self.receive(deadline)
            if value.get("id") == self.sequence and "method" not in value:
                if "error" in value:
                    raise WakeError("native_rpc_rejected")
                if not isinstance(value.get("result"), dict):
                    raise WakeError("native_receipt_invalid")
                return value["result"]
            # Never approve tools or permissions on behalf of the leader.
            if "id" in value and "method" in value:
                self.send(
                    {
                        "id": value["id"],
                        "error": {
                            "code": -32601,
                            "message": "Notification client cannot approve requests",
                        },
                    }
                )
        raise WakeError("native_event_limit")

    # @chain-region CodexConnection.close | calls: self.closed.set, self.process.poll, self.process.stdin.close, self.process.stdout.close, self.process.terminate, self.process.wait
    def close(self):
        self.closed.set()
        try:
            self.process.stdin.close()
            self.process.wait(timeout=1)
        except (OSError, subprocess.TimeoutExpired):
            if self.process.poll() is None:
                self.process.terminate()  # Only our short-lived proxy, never the daemon.
                self.process.wait(timeout=2)
        self.process.stdout.close()


# @chain-region NativeWakeup | calls: WakeError, any, before_send, binding.get, bindings.get, client.call, client.close, hashlib.sha256 …
class NativeWakeup:
    # @chain-region NativeWakeup.__init__
    def __init__(self, config, connection=CodexConnection):
        self.config, self.connection = config, connection

    # @chain-region NativeWakeup.validate_target | calls: WakeError, any, binding.get, bindings.get, isinstance, self.config.get, target.get, type
    def validate_target(self, target):
        host = self.config.get("host", "codex")
        if "bindings" in self.config:
            bindings = self.config["bindings"]
            if not isinstance(bindings, dict):
                raise WakeError("native_binding_configuration_invalid")
            binding = bindings.get(target.get("leader"))
            if not isinstance(binding, dict):
                raise WakeError("native_binding_configuration_required")
            if (
                not isinstance(binding.get("native_session_id"), str)
                or type(binding.get("binding_version")) is not int
                or binding["binding_version"] < 1
                or not isinstance(binding.get("host"), str)
            ):
                raise WakeError("native_binding_configuration_invalid")
            if any(
                binding[key] != target.get(key) for key in ("native_session_id", "binding_version")
            ):
                raise WakeError("native_binding_configuration_changed")
            host = binding["host"]
        if host != "codex":
            raise WakeError("native_host_unsupported")

    # @chain-region NativeWakeup.notify | calls: WakeError, before_send, client.call, client.close, hashlib.sha256, hashlib.sha256(prompt.encode()).hexdigest, isinstance, last.get …
    def notify(self, target, prompt, message_id, before_send):
        executable = self.config.get("executable", "")
        if not self.config.get("enabled"):
            raise WakeError("native_adapter_disabled")
        self.validate_target(target)
        client = self.connection(executable)
        try:
            tid = target["native_session_id"]
            thread = client.call("thread/read", {"threadId": tid, "includeTurns": False})["thread"]
            if thread.get("id") != tid:
                raise WakeError("native_identity_mismatch")
            status = thread.get("status", {})
            if status.get("type") not in ("active", "idle", "notLoaded"):
                raise WakeError("native_waiting_or_failed")
            if "archived_sessions" in str(thread.get("path", "")).replace("\\", "/").split("/"):
                raise WakeError("native_handoff_or_user_resume_required")
            if status.get("type") == "systemError" or status.get("activeFlags"):
                raise WakeError("native_waiting_or_failed")
            if status.get("type") != "active":
                turns = client.call(
                    "thread/turns/list", {"threadId": tid, "limit": 1, "itemsView": "notLoaded"}
                )
                last = (turns.get("data") or [{}])[0]
                if last.get("status") != "completed":
                    raise WakeError("native_handoff_or_user_resume_required")
                # Resume only the already bound thread; no model/policy/cwd overrides.
                thread = client.call("thread/resume", {"threadId": tid, "excludeTurns": True})[
                    "thread"
                ]
                if (
                    thread.get("id") != tid
                    or thread.get("status", {}).get("activeFlags")
                    or thread.get("status", {}).get("type") not in ("idle", "active")
                ):
                    raise WakeError("native_identity_or_wait_state_changed")
            before_send()
            result = client.call(
                "turn/start",
                {
                    "threadId": tid,
                    "clientUserMessageId": message_id,
                    "input": [{"type": "text", "text": prompt, "text_elements": []}],
                },
            )
            turn = result.get("turn", {})
            if not isinstance(turn.get("id"), str) or not turn["id"]:
                raise WakeError("native_receipt_invalid")
            return {
                "thread_id": tid,
                "turn_id": turn["id"],
                "status": turn.get("status"),
                "message_sha256": hashlib.sha256(prompt.encode()).hexdigest(),
            }
        finally:
            client.close()


# @chain-region ResourceGate | calls: Memory, Path, Path('/proc/meminfo').read_text, Path('/proc/meminfo').read_text().splitlines, Path('/proc/stat').read_text, Path('/proc/stat').read_text().splitlines, Path('/proc/stat').read_text().splitlines()[0].split, ctypes.byref …
class ResourceGate:
    """Sample host CPU/RAM before one notification; not a machine-wide hard cap."""

    # @chain-region ResourceGate.__init__
    def __init__(self):
        self.previous = None

    # @chain-region ResourceGate.__call__ | calls: Memory, Path, Path('/proc/meminfo').read_text, Path('/proc/meminfo').read_text().splitlines, Path('/proc/stat').read_text, Path('/proc/stat').read_text().splitlines, Path('/proc/stat').read_text().splitlines()[0].split, ctypes.byref …
    def __call__(self):
        if os.name != "nt":
            try:
                values = dict(
                    line.split(":", 1) for line in Path("/proc/meminfo").read_text().splitlines()
                )
                available = int(values["MemAvailable"].split()[0]) / int(
                    values["MemTotal"].split()[0]
                )
                ticks = list(map(int, Path("/proc/stat").read_text().splitlines()[0].split()[1:9]))
                idle, total = ticks[3] + ticks[4], sum(ticks)
            except (OSError, KeyError, ValueError):
                return False
        else:
            import ctypes
            from ctypes import wintypes

            # @chain-region ResourceGate.__call__.Memory
            class Memory(ctypes.Structure):
                _fields_ = [("length", wintypes.DWORD), ("load", wintypes.DWORD)] + [
                    (key, ctypes.c_ulonglong)
                    for key in (
                        "total",
                        "available",
                        "page_total",
                        "page_available",
                        "virtual_total",
                        "virtual_available",
                        "extended",
                    )
                ]

            memory = Memory()
            memory.length = ctypes.sizeof(memory)
            times = [ctypes.c_ulonglong() for _ in range(3)]
            if not ctypes.windll.kernel32.GlobalMemoryStatusEx(
                ctypes.byref(memory)
            ) or not ctypes.windll.kernel32.GetSystemTimes(*(ctypes.byref(x) for x in times)):
                return False
            available = memory.available / memory.total
            idle, total = times[0].value, times[1].value + times[2].value
        previous, self.previous = self.previous, (idle, total)
        if previous is None or total <= previous[1]:
            return False
        cpu = 1 - (idle - previous[0]) / (total - previous[1])
        return available >= 0.20 and cpu < 0.80
