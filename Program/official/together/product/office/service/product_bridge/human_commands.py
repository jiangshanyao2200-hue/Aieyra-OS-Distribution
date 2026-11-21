# @file-map:start
# 文件: link/office/service/product_bridge/human_commands.py
# 位置: 二环·工位服务 | 本机控制、接入、凭据、工位与租约的HTTP服务。
# 约束: 服务绑定本机并核对所有者身份；凭据与工作正文不因短暂失联清空；关闭使用租约排空
# 下游: link/office/service/product_bridge/bridge.py, link/office/service/product_bridge/commands.py, link/office/service/product_bridge/matrix_client.py
# 上游: link/office/service/product_bridge/commands.py, link/office/service/product_bridge/human_relay.py
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: python -X utf8 -B -m unittest discover -s link/office/tests/service
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   normalized | function
#   match | function
#   prepare | function
#   ingest | function
#   observe | function
#   deliver_once | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Human replies in the original bridge command ledger, never a new executor."""

import json
import re

from commands import identifier, runtime_target, snapshot, target_key, unknown
from matrix_client import BridgeError, canonical, digest, require

BINDING = (
    "session_id",
    "agent_id",
    "generation",
    "human_id",
    "expected_request_version",
    "request_token_sha256",
)
STATES = {
    "decision_recorded",
    "delivered_to_agent",
    "resuming",
    "resolved",
    "failed",
    "unknown",
    "cancelled",
    "expired",
}


# @chain-region normalized | calls: all, decision.values, identifier, isinstance, len, re.fullmatch, require, set …
def normalized(reply):
    require(
        isinstance(reply, dict) and set(reply) == set(BINDING) | {"request_id", "decision"},
        "invalid_human_reply",
    )
    for key in ("request_id", "session_id", "agent_id", "human_id"):
        identifier(reply[key])
    require(
        type(reply["generation"]) is int and 1 <= reply["generation"] <= 16, "invalid_generation"
    )
    require(
        type(reply["expected_request_version"]) is int and reply["expected_request_version"] > 0,
        "invalid_human_version",
    )
    require(
        isinstance(reply["request_token_sha256"], str)
        and re.fullmatch("[a-f0-9]{64}", reply["request_token_sha256"]),
        "invalid_human_token_hash",
    )
    decision = reply["decision"]
    require(
        isinstance(decision, dict) and decision and not set(decision) - {"option_id", "text"},
        "invalid_human_decision",
    )
    require(
        all(
            isinstance(x, str) and x.strip() and len(x.encode("utf-8")) <= 8000
            for x in decision.values()
        ),
        "invalid_human_decision",
    )
    return {"action": "humans.reply", **reply}


# @chain-region match | calls: isinstance, record.get, require, {'human_id': 'id', 'expected_request_version': 'version'}.get
def match(value, record):
    require(isinstance(record, dict), "invalid_human_observation")
    for key in BINDING:
        native = {"human_id": "id", "expected_request_version": "version"}.get(key, key)
        require(value[key] == record.get(native), "human_binding_mismatch")


# @chain-region prepare | calls: all, bridge._receipt, bridge.client.clean, bridge.client.description.get, bridge.client.rpc, bridge.config.get, bridge.transaction, canonical …
def prepare(bridge, reply):
    """Reserve once BEFORE center begin. A persisted reservation never regrants RPC."""
    value = normalized(reply)
    require(bridge.client.clean(value) == value, "credential_in_payload")
    rid = value["request_id"]
    with bridge.transaction() as db:
        old = db.execute("SELECT fingerprint FROM commands WHERE request_id=?", (rid,)).fetchone()
        if old:
            require(old[0] == digest(value), "command_id_conflict")
            return value, False
    require(
        bridge.client.description.get("human_callback_version") == 1, "human_callback_not_supported"
    )
    require(
        bridge.client.mode == "fixture" or bridge.config.get("enable_os_writes") is True,
        "os_writes_disabled",
    )
    require(value["session_id"] == bridge.client.binding["session_id"], "human_origin_mismatch")
    record = bridge.client.rpc("agents.status", {"id": value["agent_id"]})
    target = runtime_target(bridge, value["agent_id"], record)
    require(
        record["generation"] == value["generation"] and record["state"] == "waiting_user",
        "human_agent_not_waiting",
    )
    require(record["spec"].get("model_id") in bridge.config["allowed_models"], "model_not_allowed")
    require(
        all(t in bridge.config["allowed_tools"] for t in record["spec"].get("tools", [])),
        "tools_not_allowed",
    )
    native = bridge.client.rpc("humans.status", {"id": value["human_id"]})
    match(value, native)
    require(native["state"] == "waiting_user", "human_request_not_waiting")
    with bridge.transaction() as db:
        old = db.execute("SELECT fingerprint FROM commands WHERE request_id=?", (rid,)).fetchone()
        if old:
            require(old[0] == digest(value), "command_id_conflict")
            return value, False
        db.execute(
            "INSERT INTO commands(request_id,fingerprint,payload,state,target) VALUES(?,?,?,?,?)",
            (rid, digest(value), canonical(value), "submitting", canonical(target)),
        )
        bridge._receipt(
            db,
            target_key(value),
            "human_callback_intent",
            {"request_id": rid, "human_id": value["human_id"], "generation": value["generation"]},
        )
    return value, True


# @chain-region ingest | calls: bridge._receipt, bridge.transaction, canonical, db.execute, db.execute('SELECT observation FROM commands WHERE request_id=?', (value['request_id'],)).fetchone, json.loads, match, record.get …
def ingest(bridge, value, record):
    from bridge import timestamp

    match(value, record)
    require(
        record.get("decision_id") == value["request_id"]
        and record.get("decision") == value["decision"],
        "human_decision_not_observed",
    )
    require(record.get("state") in STATES, "invalid_human_state")
    timestamp(record.get("updated_at"))
    observation = {
        k: record[k]
        for k in (
            "id",
            "version",
            "session_id",
            "agent_id",
            "generation",
            "state",
            "updated_at",
            "decision_id",
            "decision",
        )
    }
    with bridge.transaction() as db:
        previous = db.execute(
            "SELECT observation FROM commands WHERE request_id=?", (value["request_id"],)
        ).fetchone()[0]
        if previous:
            before = json.loads(previous)
            require(
                timestamp(observation["updated_at"]) >= timestamp(before["updated_at"]),
                "stale_human_observation",
            )
            terminal = {"resolved", "failed", "cancelled", "expired"}
            require(
                before["state"] not in terminal or observation["state"] == before["state"],
                "human_terminal_regressed",
            )
        db.execute(
            "UPDATE commands SET state='observed',observation=?,last_error=NULL WHERE request_id=?",
            (canonical(observation), value["request_id"]),
        )
        if previous != canonical(observation):
            bridge._receipt(
                db,
                target_key(value),
                "human_callback_observed",
                {"request_id": value["request_id"], "observation": observation},
            )
    return snapshot(bridge, value["request_id"])


# @chain-region observe | calls: bridge.client.rpc, ingest, str, unknown
def observe(bridge, value):
    try:
        return ingest(bridge, value, bridge.client.rpc("humans.status", {"id": value["human_id"]}))
    except BridgeError as exc:
        return unknown(bridge, value, str(exc))


# @chain-region deliver_once | calls: bridge.client.rpc, bridge.transaction, db.execute, db.execute('SELECT fingerprint,state FROM commands WHERE request_id=?', (value['request_id'],)).fetchone, digest, ingest, observe, require …
def deliver_once(bridge, value):
    # The original host calls this only on the fresh prepare + fresh begin path.
    with bridge.transaction() as db:
        row = db.execute(
            "SELECT fingerprint,state FROM commands WHERE request_id=?", (value["request_id"],)
        ).fetchone()
        require(row is not None and row["fingerprint"] == digest(value), "human_intent_missing")
        first = row["state"] == "submitting"
        if first:
            db.execute(
                "UPDATE commands SET state='dispatching' WHERE request_id=?", (value["request_id"],)
            )
    if not first:
        return observe(bridge, value)
    try:
        return ingest(
            bridge,
            value,
            bridge.client.rpc("humans.reply", {k: v for k, v in value.items() if k != "action"}),
        )
    except BridgeError as exc:
        return unknown(bridge, value, str(exc))
