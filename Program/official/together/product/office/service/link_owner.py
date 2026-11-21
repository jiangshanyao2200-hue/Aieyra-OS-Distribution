# @file-map:start
# 文件: link/office/service/link_owner.py
# 位置: 二环·工位服务 | 本机控制、接入、凭据、工位与租约的HTTP服务。
# 约束: 服务绑定本机并核对所有者身份；凭据与工作正文不因短暂失联清空；关闭使用租约排空
# 下游: link/office/service/main.py
# 上游: 入口/动态加载；参阅链路与目录地图
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: python -X utf8 -B -m unittest discover -s link/office/tests/service
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   run | function
#   run.lease | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
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


# @chain-region run | calls: (json.dumps({'type': 'owner.hello', 'owner_id': owner_id}) + '\n').encode, (json.dumps({'type': 'owner.shutdown', 'owner_id': owner_id}) + '\n').encode, (token + '\n').encode, Path, Path(__file__).with_name, bytearray, bytes, data.endswith …
def run(port):
    stop = threading.Event()
    token, owner_id = secrets.token_hex(32), secrets.token_hex(16)
    peers = []
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen(4)
    listener.settimeout(0.2)

    # @chain-region run.lease | calls: (token + '\n').encode, bytearray, bytes, data.endswith, data.extend, hmac.compare_digest, len, listener.accept …
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
