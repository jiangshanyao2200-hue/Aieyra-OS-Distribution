# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: Control/app/service/AGENTS.md | ring 2
# Chains: module-local; query impact before editing
# Regions: LinkAuto
# Impact: python -B scripts/code-atlas.py show Control/app/service/link_auto.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""Owner-scoped automatic LAN host; snapshots never contain credentials."""

from copy import deepcopy
import json
import os
from pathlib import Path
import re
import subprocess
import threading
import time


class LinkAuto:
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

    def binary(self):
        from link_paths import os_source_root

        override = os.environ.get("AIEYRA_LINK_LAN_BINARY")
        if override:
            path = Path(override)
        else:
            root = os_source_root(self.manager.software_root)
            if root is None:
                raise OSError("Link runtime unavailable")
            path = root / "Link/app/runtime/link" / ("aieyra-link-lan.exe" if os.name == "nt" else "aieyra-link-lan")
        if not path.is_file():
            raise OSError("Link runtime unavailable")
        return str(path)

    def start(self, origin):
        if not self.enabled or self.worker:
            return

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
                        "--name", os.environ.get("AIEYRA_LINK_LAN_NAME", "Aieyra OS"),
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
                                "name": value.get("name", "Aieyra OS"),
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

    def status(self):
        with self.lock:
            value = deepcopy(self.value)
            live = self.child is not None and self.child.poll() is None
            if value["state"] == "ready" and (not live or time.monotonic() - self.updated > 25):
                value["state"] = "waiting"
                value["devices"] = [{**row, "online": False} for row in value["devices"]]
            return value

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

