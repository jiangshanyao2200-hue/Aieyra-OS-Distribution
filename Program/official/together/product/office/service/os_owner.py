# @file-map:start
# 文件: link/office/service/os_owner.py
# 位置: 二环·工位服务 | 本机控制、接入、凭据、工位与租约的HTTP服务。
# 约束: 服务绑定本机并核对所有者身份；凭据与工作正文不因短暂失联清空；关闭使用租约排空
# 下游: 无已解析的项目内静态导入
# 上游: link/office/service/main.py
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: python -X utf8 -B -m unittest discover -s link/office/tests/service
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   OSOwner | class
#   OSOwner.__init__ | function
#   OSOwner.__init__.input_line | function
#   OSOwner.__init__.input_loop | function
#   OSOwner.__init__.observe | function
#   OSOwner.close | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Control only opens user storage after proving an active OS owner."""

import json
import os
import queue
import re
import socket
import sys
import threading


# @chain-region OSOwner | calls: (token + '\n').encode, ValueError, ack.endswith, ack.extend, bytearray, bytes, hello.get, input_line …
class OSOwner:
    # @chain-region OSOwner.__init__ | calls: (token + '\n').encode, ValueError, ack.endswith, ack.extend, bytearray, bytes, hello.get, input_line …
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
            raise ValueError("生命周期连接不可用，请重新打开 Aieyra 众创 Link") from None
        ready = queue.Queue(maxsize=1)

        # @chain-region OSOwner.__init__.input_line | calls: bytearray, bytes, len, line.extend, os.read, sys.stdin.fileno
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

        # @chain-region OSOwner.__init__.input_loop | calls: ValueError, hello.get, input_line, json.loads, len, re.fullmatch, ready.empty, ready.put …
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

        # @chain-region OSOwner.__init__.observe | calls: self.lost.set, self.peer.recv
        def observe():
            try:
                while self.peer.recv(128):
                    pass
            except OSError:
                pass
            finally:
                self.lost.set()

        threading.Thread(target=observe, name="control-os-lease", daemon=True).start()

    # @chain-region OSOwner.close | calls: self.lost.set, self.peer.close, self.peer.shutdown
    def close(self):
        if self.peer:
            try:
                self.peer.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            self.peer.close()
        self.lost.set()
