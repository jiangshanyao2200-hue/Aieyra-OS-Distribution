# @file-map:start
# 文件: link/office/service/http_drain.py
# 位置: 二环·工位服务 | 本机控制、接入、凭据、工位与租约的HTTP服务。
# 约束: 服务绑定本机并核对所有者身份；凭据与工作正文不因短暂失联清空；关闭使用租约排空
# 下游: 无已解析的项目内静态导入
# 上游: link/office/service/main.py
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: python -X utf8 -B -m unittest discover -s link/office/tests/service
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   drain_rejected_body | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Deliver early HTTP rejection responses before bounded upload cleanup."""

import socket
import time


# @chain-region drain_rejected_body | calls: getattr, handler.connection.settimeout, handler.connection.shutdown, handler.rfile.read1, handler.wfile.flush, len, min, time.monotonic
def drain_rejected_body(handler):
    if not getattr(handler, "_unread_post_body", False):
        return
    try:
        handler.wfile.flush()
        handler.connection.shutdown(socket.SHUT_WR)
        deadline = time.monotonic() + 0.25
        remaining = 65536
        while remaining > 0:
            timeout = deadline - time.monotonic()
            if timeout <= 0:
                break
            handler.connection.settimeout(timeout)
            chunk = handler.rfile.read1(min(8192, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
    except OSError:
        pass
