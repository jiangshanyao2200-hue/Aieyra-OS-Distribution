# @file-map:start
# 文件: link/office/service/service_common.py
# 位置: 二环·工位服务 | 本机控制、接入、凭据、工位与租约的HTTP服务。
# 约束: 服务绑定本机并核对所有者身份；凭据与工作正文不因短暂失联清空；关闭使用租约排空
# 下游: 无已解析的项目内静态导入
# 上游: link/office/service/delivery_store.py, link/office/service/hub_client.py, link/office/service/main.py, link/office/service/office_extensions.py, link/office/service/office_runtime.py, link/office/service/runtime_observer.py
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: python -X utf8 -B -m unittest discover -s link/office/tests/service
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   now | function
#   delivery_message | function
#   Problem | class
#   Problem.__init__ | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Small protocol primitives shared by the local service modules."""

import datetime as dt
import re

REGISTRY_ACTIONS = frozenset(
    {
        "project-register",
        "governance-grant",
        "host-register",
        "adapter-register",
        "seat-create",
        "seat-update",
        "seat-control",
        "operation-receipt",
    }
)

ID = re.compile(r"^[A-Za-z0-9_.:-]{1,100}$")
MARKER = re.compile(
    r"^\[control-delivery:([A-Za-z0-9_.:-]{1,100})\]\n【用户通过协作管理客户端发给本工位的消息】\n"
)


# @chain-region now | calls: dt.datetime.now, dt.datetime.now(dt.timezone.utc).isoformat
def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


# @chain-region delivery_message
def delivery_message(delivery):
    return (
        "[control-delivery:"
        + delivery["id"]
        + "]\n【用户通过协作管理客户端发给本工位的消息】\n"
        + delivery["body"]
    )


# @chain-region Problem
class Problem(Exception):
    # @chain-region Problem.__init__
    def __init__(self, code, message, status=400):
        self.code, self.message, self.status = code, message, status
