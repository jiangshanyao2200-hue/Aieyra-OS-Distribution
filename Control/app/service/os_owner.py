# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: Control/app/service/AGENTS.md | ring 2
# Chains: module-local; query impact before editing
# Regions: OSOwner
# Impact: python -B scripts/code-atlas.py show Control/app/service/os_owner.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""Control only opens user storage after proving an active OS owner."""

import json
import os
import queue
import re
import socket
import sys
import threading


class OSOwner:
    def __init__(self):
        self.lost = threading.Event()
        self.peer = None
        self.owner_id = None
        port = os.environ.get("AIEYRA_OS_OWNER_PORT", "")
        token = os.environ.get("AIEYRA_OS_OWNER_TOKEN", "")
        if (
            not re.fullmatch(r"[0-9]{1,5}", port)
            or not 1 <= int(port) <= 65535
            or not re.fullmatch(r"[a-f0-9]{64}", token)
        ):
            raise ValueError("Control 需要由 Aieyra OS 或 Aieyra Link 启动")
        try:
            self.peer = socket.create_connection(("127.0.0.1", int(port)), timeout=3)
            self.peer.sendall((token + "\n").encode("ascii"))
            ack = bytearray()
            while len(ack) < 128 and not ack.endswith(b"\n"):
                data = self.peer.recv(1)
                if not data:
                    break
                ack.extend(data)
            if ack != b"aieyra-os-owner/1\n":
                raise ValueError("OS 生命周期验证失败")
            self.peer.settimeout(None)
        except Exception:
            self.close()
            raise ValueError("OS 生命周期连接不可用，请从 Aieyra OS 重新打开 Control") from None
        ready = queue.Queue(maxsize=1)

        def input_line():
            # A daemon blocked in BufferedReader.readline can abort Python at
            # shutdown (for example when a second office loses the data lock).
            # Read the dedicated owner pipe without acquiring its buffered lock.
            line = bytearray()
            while len(line) < 16385:
                part = os.read(sys.stdin.fileno(), 1)
                if not part:
                    break
                line.extend(part)
                if part == b"\n":
                    break
            return bytes(line)

        def input_loop():
            try:
                hello = json.loads(input_line())
                if hello.get("type") != "owner.hello" or not re.fullmatch(
                    r"[a-f0-9]{32}", hello.get("owner_id", "")
                ):
                    raise ValueError()
                self.owner_id = hello["owner_id"]
                ready.put(True)
                while True:
                    line = input_line()
                    if not line or len(line) > 16384:
                        break
                    value = json.loads(line)
                    if (
                        value.get("type") == "owner.shutdown"
                        and value.get("owner_id") == self.owner_id
                    ):
                        break
            except Exception:
                if ready.empty():
                    ready.put(False)
            finally:
                self.lost.set()

        threading.Thread(target=input_loop, name="control-os-input", daemon=True).start()
        try:
            if not ready.get(timeout=3):
                raise ValueError()
        except (queue.Empty, ValueError):
            self.close()
            raise ValueError("OS 所有权握手未完成") from None

        def observe():
            try:
                while self.peer.recv(128):
                    pass
            except OSError:
                pass
            finally:
                self.lost.set()

        threading.Thread(target=observe, name="control-os-lease", daemon=True).start()

    def close(self):
        if self.peer:
            try:
                self.peer.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            self.peer.close()
        self.lost.set()
