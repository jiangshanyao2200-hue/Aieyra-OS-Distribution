# @file-map:start
# 文件: link/office/service/request_intake.py
# 位置: 二环·工位服务 | 本机控制、接入、凭据、工位与租约的HTTP服务。
# 约束: 服务绑定本机并核对所有者身份；凭据与工作正文不因短暂失联清空；关闭使用租约排空
# 下游: 无已解析的项目内静态导入
# 上游: link/office/service/hub_client.py, link/office/service/main.py
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: python -X utf8 -B -m unittest discover -s link/office/tests/service
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   IntakeError | class
#   IntakeError.__init__ | function
#   query_fields | function
#   RequestIntake | class
#   RequestIntake.__init__ | function
#   RequestIntake.read | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Read-only facade for the center's request-intake contract.

Routes and query fields are fixed locally; no credential or arbitrary URL comes
from the browser. Reading a requirement never schedules its task.
"""

import copy
from datetime import datetime, timezone
import re

ID = re.compile(r"^[A-Za-z0-9_.:-]{1,100}$")
ROUTES = {
    "requirements": {"limit", "after", "q", "project", "state"},
    "requirement": {"id", "history", "before_version"},
    "tasks": {"limit", "after", "status", "project"},
    "task": {"id"},
    "task-history": {"project", "limit", "before"},
    "requirement-receipts": {"id", "after", "limit"},
    "intake-receipt": {"request_id"},
    "intake-events": {"after", "stream_epoch"},
}


# @chain-region IntakeError
class IntakeError(Exception):
    # @chain-region IntakeError.__init__
    def __init__(self, code, status=400):
        self.code, self.status = code, status


# @chain-region query_fields | calls: ID.fullmatch, IntakeError, fields.get, fields['after'].isascii, fields['after'].isdecimal, int, isinstance, len …
def query_fields(route, query):
    if route not in ROUTES or not isinstance(query, dict) or set(query) - ROUTES[route]:
        raise IntakeError("invalid_intake_query")
    fields = {}
    for key, values in query.items():
        if (
            not isinstance(values, list)
            or len(values) != 1
            or not isinstance(values[0], str)
            or len(values[0]) > 4000
        ):
            raise IntakeError("invalid_intake_query")
        fields[key] = values[0]
    required = (
        "id"
        if route in ("requirement", "task", "requirement-receipts")
        else "request_id"
        if route == "intake-receipt"
        else None
    )
    if required and not ID.fullmatch(fields.get(required, "")):
        raise IntakeError("invalid_intake_identifier")
    for key in ("id", "request_id", "project"):
        if fields.get(key) and not ID.fullmatch(fields[key]):
            raise IntakeError("invalid_intake_identifier")
    for key in ("limit", "before_version", "history"):
        if key in fields:
            value = fields[key]
            maximum = 100 if key == "limit" else 1 if key == "history" else 2147483647
            minimum = 0 if key == "history" else 1
            if not value.isascii() or not value.isdecimal() or not minimum <= int(value) <= maximum:
                raise IntakeError("invalid_intake_pagination")
    if "after" in fields:
        if route in ("requirements", "tasks"):
            if fields["after"] and not ID.fullmatch(fields["after"]):
                raise IntakeError("invalid_intake_cursor")
        elif (
            not fields["after"].isascii()
            or not fields["after"].isdecimal()
            or not 0 <= int(fields["after"]) <= 9223372036854775807
        ):
            raise IntakeError("invalid_intake_cursor")
    if fields.get("state") and fields["state"] not in ("active", "cancelled", "superseded"):
        raise IntakeError("invalid_requirement_state")
    return fields


# @chain-region RequestIntake | calls: IntakeError, copy.deepcopy, datetime.now, datetime.now(timezone.utc).isoformat, hasattr, int, isinstance, query_fields …
class RequestIntake:
    # @chain-region RequestIntake.__init__
    def __init__(self, hub):
        self.hub = hub

    # @chain-region RequestIntake.read | calls: IntakeError, copy.deepcopy, datetime.now, datetime.now(timezone.utc).isoformat, hasattr, int, isinstance, query_fields …
    def read(self, route, query):
        fields = query_fields(route, query)
        if not hasattr(self.hub, "intake_read"):
            raise IntakeError("intake_not_connected", 503)
        try:
            result = self.hub.intake_read(route, fields)
        except Exception as error:
            match = re.fullmatch(r"([1-5][0-9]{2}):([A-Za-z0-9_.-]{1,100})", str(error))
            if match:
                status, code = int(match[1]), match[2]
                if status == 404 and code == "not_found":
                    raise IntakeError("intake_not_connected", 503) from None
                if status in (400, 401, 403, 404, 409, 413, 429):
                    raise IntakeError(code, status) from None
            raise IntakeError("intake_unavailable", 503) from None
        if not isinstance(result, dict):
            raise IntakeError("invalid_intake_response", 502)
        value = copy.deepcopy(result)
        # Center cursor/epoch/history are kept exactly. No cross-page snapshot
        # or execution receipt is inferred here; the client must reconcile events.
        value["control"] = {
            "source": "coordination_request_intake_v1",
            "available": True,
            "stale": False,
            "observed_at": datetime.now(timezone.utc).isoformat(),
        }
        return value
