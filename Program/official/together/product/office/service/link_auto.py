# @file-map:start
# 文件: link/office/service/link_auto.py
# 位置: 二环·工位服务 | 本机控制、接入、凭据、工位与租约的HTTP服务。
# 约束: 服务绑定本机并核对所有者身份；凭据与工作正文不因短暂失联清空；关闭使用租约排空
# 下游: link/office/service/device_link.py, link/office/service/link_paths.py
# 上游: link/office/service/device_link.py
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: python -X utf8 -B -m unittest discover -s link/office/tests/service
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   LinkAuto | class
#   LinkAuto.__init__ | function
#   LinkAuto.binary | function
#   LinkAuto.start | function
#   LinkAuto.start.serve | function
#   LinkAuto.status | function
#   LinkAuto.close | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Owner-scoped automatic LAN host; snapshots never contain credentials."""

from copy import deepcopy
import json
import os
from pathlib import Path
import re
import subprocess
import threading
import time


# @chain-region LinkAuto | calls: LinkError, OSError, Path, ValueError, bool, child.stdin.close, child.stdout.close, child.stdout.readline …
class LinkAuto:
    # @chain-region LinkAuto.__init__ | calls: bool, os.environ.get, threading.Event, threading.RLock
    def __init__(self, manager):
        self.manager = manager
        configured = os.environ.get("AIEYRA_LINK_LAN_AUTO")
        self.enabled = configured == "1" if configured is not None else bool(
            os.environ.get("AIEYRA_LINK_DATA_DIR") and os.environ.get("AIEYRA_OS_OWNER_PORT")
        )
        self.lock = threading.RLock()
        self.stop = threading.Event()
        self.child = None
        self.worker = None
        self.updated = 0
        self.value = {"state": "starting" if self.enabled else "disabled", "auto_connect": self.enabled, "devices": []}

    # @chain-region LinkAuto.binary | calls: OSError, Path, os.environ.get, path.is_file, product_link_root, str
    def binary(self):
        from link_paths import product_link_root

        override = os.environ.get("AIEYRA_LINK_LAN_BINARY")
        if override:
            path = Path(override)
        else:
            root = product_link_root(self.manager.software_root)
            if root is None:
                raise OSError("Link runtime unavailable")
            path = root / "runtime/native" / ("aieyra-link-lan.exe" if os.name == "nt" else "aieyra-link-lan")
        if not path.is_file():
            raise OSError("Link runtime unavailable")
        return str(path)

    # @chain-region LinkAuto.start | calls: ValueError, bool, child.stdin.close, child.stdout.close, child.stdout.readline, child.wait, getattr, isinstance …
    def start(self, origin):
        if not self.enabled or self.worker:
            return

        # @chain-region LinkAuto.start.serve | calls: ValueError, bool, child.stdin.close, child.stdout.close, child.stdout.readline, child.wait, getattr, isinstance …
        def serve():
            delay = 2
            while not self.stop.is_set():
                child = None
                try:
                    command = [
                        self.binary(), "serve", "--data",
                        os.environ.get("AIEYRA_LINK_DATA_DIR", str(self.manager.root / "auto-host")),
                        "--listen", os.environ.get("AIEYRA_LINK_LAN_LISTEN", "0.0.0.0:17920"),
                        "--control-url", origin,
                        "--project", os.environ.get("AIEYRA_LINK_LAN_PROJECT", "os"),
                        "--name", os.environ.get("AIEYRA_LINK_LAN_NAME", "Aieyra Together Link"),
                    ]
                    with self.lock:
                        if self.stop.is_set():
                            return
                        child = subprocess.Popen(
                            command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL,
                            env={**os.environ, "AIEYRA_OS_OWNER_STDIN": "1"},
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                        )
                        self.child = child
                    while not self.stop.is_set():
                        line = child.stdout.readline(32769)
                        if not line:
                            break
                        if len(line) > 32768:
                            raise ValueError("Invalid Link snapshot")
                        value = json.loads(line)
                        if value.get("state") != "ready" or value.get("protocol") != "aieyra-link-lan/1":
                            raise ValueError("Invalid Link protocol")
                        devices = value.get("devices")
                        if not isinstance(devices, list) or len(devices) > 32:
                            raise ValueError("Invalid device snapshot")
                        rows = []
                        for row in devices:
                            if not isinstance(row, dict) or not re.fullmatch(r"[a-f0-9]{32}", row.get("device_id", "")) or not isinstance(row.get("name"), str) or type(row.get("online")) is not bool:
                                raise ValueError("Invalid device snapshot")
                            rows.append({key: row.get(key) for key in ("device_id", "name", "online", "last_seen")})
                        with self.lock:
                            self.value = {
                                "state": "ready", "auto_connect": True, "devices": rows,
                                "name": value.get("name", "Aieyra Together Link"),
                                "mdns": bool(value.get("mdns", self.value.get("mdns"))),
                                "broadcast": bool(value.get("broadcast", self.value.get("broadcast"))),
                            }
                            self.updated = time.monotonic()
                        delay = 2
                except (OSError, ValueError, TypeError, AttributeError):
                    pass
                finally:
                    if child:
                        if child.stdin:
                            try:
                                child.stdin.close()
                            except OSError:
                                pass
                        # This process is ours. Keep ownership until actual exit;
                        # never replace a host still holding the identity lock.
                        child.wait()
                        child.stdout.close()
                    with self.lock:
                        if self.child is child:
                            self.child = None
                        self.value = {**self.value, "state": "stopped" if self.stop.is_set() else "waiting", "devices": [{**r, "online": False} for r in self.value["devices"]]}
                self.stop.wait(delay)
                delay = min(delay * 2, 30)

        self.worker = threading.Thread(target=serve, name="control-link-auto", daemon=True)
        self.worker.start()

    # @chain-region LinkAuto.status | calls: deepcopy, self.child.poll, time.monotonic
    def status(self):
        with self.lock:
            value = deepcopy(self.value)
            live = self.child is not None and self.child.poll() is None
            if value["state"] == "ready" and (not live or time.monotonic() - self.updated > 25):
                value["state"] = "waiting"
                value["devices"] = [{**row, "online": False} for row in value["devices"]]
            return value

    # @chain-region LinkAuto.close | calls: LinkError, child.stdin.close, self.stop.set, self.worker.is_alive, self.worker.join
    def close(self):
        self.stop.set()
        with self.lock:
            child = self.child
            if child and child.stdin:
                try:
                    child.stdin.close()
                except OSError:
                    pass
        if self.worker:
            self.worker.join(timeout=12)
            if self.worker.is_alive():
                from device_link import LinkError
                raise LinkError("link_shutdown_unconfirmed", 503)

