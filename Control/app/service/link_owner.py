# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: Control/app/service/AGENTS.md | ring 2
# Chains: module-local; query impact before editing
# Regions: run
# Impact: python -B scripts/code-atlas.py show Control/app/service/link_owner.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""Foreground Link host: own one Control child using the desktop lease protocol."""

import hmac
import json
import os
from pathlib import Path
import secrets
import signal
import socket
import subprocess
import sys
import threading


def run(port, *, owner_stdin=False):
    stop = threading.Event()
    token, owner_id = secrets.token_hex(32), secrets.token_hex(16)
    peers = []
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen(4)
    listener.settimeout(0.2)

    def lease():
        while not stop.is_set():
            try:
                peer, _ = listener.accept()
            except socket.timeout:
                continue
            except OSError:
                return
            try:
                peer.settimeout(3)
                data = bytearray()
                while len(data) < 66 and not data.endswith(b"\n"):
                    chunk = peer.recv(1)
                    if not chunk:
                        break
                    data.extend(chunk)
                if not hmac.compare_digest(bytes(data), (token + "\n").encode()):
                    peer.close()
                    continue
                peer.sendall(b"aieyra-os-owner/1\n")
                peer.settimeout(None)
                peers.append(peer)
            except OSError:
                peer.close()

    worker = threading.Thread(target=lease, daemon=True)
    worker.start()
    if owner_stdin:
        def watch_owner():
            try:
                os.read(sys.stdin.fileno(), 1)
            except OSError:
                pass
            finally:
                stop.set()

        threading.Thread(target=watch_owner, daemon=True).start()
    previous = {}
    for sig in (signal.SIGINT, signal.SIGTERM):
        previous[sig] = signal.signal(sig, lambda *_: stop.set())
    env = dict(
        os.environ,
        AIEYRA_OS_OWNER_PORT=str(listener.getsockname()[1]),
        AIEYRA_OS_OWNER_TOKEN=token,
        PYTHONDONTWRITEBYTECODE="1",
    )
    process = None
    try:
        process = subprocess.Popen(
            [
                sys.executable,
                "-X",
                "utf8",
                "-B",
                str(Path(__file__).with_name("main.py")),
                "--os-managed",
                "--os-owner-stdin",
                "--owner-kind=link",
                "--port",
                str(port),
            ],
            env=env,
            stdin=subprocess.PIPE,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        process.stdin.write(
            (json.dumps({"type": "owner.hello", "owner_id": owner_id}) + "\n").encode()
        )
        process.stdin.flush()
        while process.poll() is None and not stop.wait(0.2):
            pass
    finally:
        stop.set()
        listener.close()
        worker.join(4)
        if process is not None:
            if process.poll() is None:
                try:
                    process.stdin.write(
                        (
                            json.dumps({"type": "owner.shutdown", "owner_id": owner_id}) + "\n"
                        ).encode()
                    )
                    process.stdin.flush()
                except (OSError, BrokenPipeError):
                    pass
            process.stdin.close()
        for peer in peers:
            try:
                peer.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            peer.close()
        # Never kill a writer. The owned service joins workers before releasing its lock.
        if process is not None:
            process.wait()
        for sig, handler in previous.items():
            signal.signal(sig, handler)
    return process.returncode
