# @file-map:start
# 文件: link/office/service/center_messages.py
# 位置: 二环·工位服务 | 本机控制、接入、凭据、工位与租约的HTTP服务。
# 约束: 服务绑定本机并核对所有者身份；凭据与工作正文不因短暂失联清空；关闭使用租约排空
# 下游: 无已解析的项目内静态导入
# 上游: link/office/service/agent_access.py
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: python -X utf8 -B -m unittest discover -s link/office/tests/service
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   PageError | class
#   PageError.__init__ | function
#   parse | function
#   parse.single | function
#   metadata | function
#   projects | function
#   local_page | function
#   legacy_page | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Bounded project views over local messages and one-page legacy center reads."""

from __future__ import annotations

import hashlib
import json
import re

MAX_SEQ = 9223372036854775807
PROJECT = re.compile(r"[A-Za-z0-9_.:-]{1,100}\Z")
EPOCH = re.compile(r"[a-f0-9]{64}\Z")


# @chain-region PageError
class PageError(Exception):
    # @chain-region PageError.__init__
    def __init__(self, code, status=400):
        self.code, self.status = code, status


# @chain-region parse | calls: EPOCH.fullmatch, PROJECT.fullmatch, PageError, int, isinstance, len, query.get, re.fullmatch …
def parse(route, query):
    cursor = "after" if route == "inbox" else "before"
    if set(query) - {cursor, "limit", "project", "include_coordination", "stream_epoch"}:
        raise PageError("invalid_center_filter_query")

    # @chain-region parse.single | calls: PageError, isinstance, len, query.get
    def single(key, default):
        raw = query.get(key, [default])
        if not isinstance(raw, list) or len(raw) != 1 or not isinstance(raw[0], str):
            raise PageError("invalid_center_filter_query")
        return raw[0]

    project = single("project", "")
    include = single("include_coordination", "0")
    if not PROJECT.fullmatch(project) or include not in ("0", "1"):
        raise PageError("invalid_center_filter_query")
    epoch = single("stream_epoch", "")
    if "stream_epoch" in query and not EPOCH.fullmatch(epoch):
        raise PageError("invalid_center_stream_epoch")
    values = {}
    for key, default, minimum, maximum in (
        (cursor, "0" if route == "inbox" else str(MAX_SEQ), 0 if route == "inbox" else 1, MAX_SEQ),
        ("limit", "50" if route == "inbox" else "20", 1, 100),
    ):
        raw = single(key, default)
        if not re.fullmatch(r"[0-9]{1,19}", raw) or not minimum <= int(raw) <= maximum:
            raise PageError("invalid_center_filter_query")
        values[key] = int(raw)
    return {
        **values,
        "project": project,
        "include_coordination": include == "1",
        "stream_epoch": epoch or None,
    }


# @chain-region metadata
def metadata(route, value, mode):
    return {
        "filter_mode": mode,
        "filter": {k: value[k] for k in ("project", "include_coordination")},
        "order": "ascending" if route == "inbox" else "descending",
        "limit": value["limit"],
        "reading_does_not_acknowledge": True,
    }


# @chain-region projects | calls: dict.fromkeys, tuple
def projects(value):
    return tuple(
        dict.fromkeys(
            [value["project"], *(["coordination"] if value["include_coordination"] else [])]
        )
    )


# @chain-region local_page | calls: ','.join, EPOCH.fullmatch, PageError, client.store.db, client.store.messages, db.execute, db.execute('SELECT 1 FROM registered_projects WHERE id=?', (value['project'],)).fetchone, db.execute('SELECT COALESCE(MAX(seq),0) FROM messages').fetchone …
def local_page(client, peer, route, value):
    # Resolve the enrolled identity and check revocation inside the same snapshot
    # as the project, head cursor and rows. This never reads as the local owner.
    with client.store.db() as db:
        db.execute("BEGIN")
        actor = db.execute(
            "SELECT a.id FROM local_identities i JOIN actors a ON a.id=i.actor_id "
            "WHERE i.alias=? AND a.id=? AND a.revoked=0",
            (peer["identity"], peer["actor_id"]),
        ).fetchone()
        if not actor:
            raise PageError("unauthorized", 401)
        if not db.execute(
            "SELECT 1 FROM registered_projects WHERE id=?", (value["project"],)
        ).fetchone():
            raise PageError("unknown_project")
        head = db.execute("SELECT COALESCE(MAX(seq),0) FROM messages").fetchone()[0]
        selected = projects(value)
        seed = db.execute("SELECT epoch FROM control_message_stream WHERE id=1").fetchone()
        if not seed or not EPOCH.fullmatch(seed[0]):
            raise PageError("center_stream_epoch_unavailable", 503)
        epoch = hashlib.sha256(
            json.dumps(["center-view/1", seed[0], sorted(selected)], separators=(",", ":")).encode()
        ).hexdigest()
        expected = value.get("stream_epoch")
        if expected is not None and expected != epoch:
            raise PageError("center_stream_epoch_mismatch", 409)
        if expected is not None and route == "inbox" and value["after"] > head:
            raise PageError("center_cursor_ahead_of_stream", 409)
        descending = route == "history"
        cursor = "before" if descending else "after"
        where = (
            "m.project IN ("
            + ",".join("?" for _ in selected)
            + ") AND m.seq"
            + ("<?" if descending else ">?")
        )
        rows = client.store.messages(
            db, dict(actor), where, (*selected, value[cursor]), descending, value["limit"] + 1
        )
    page = rows[: value["limit"]]
    more = len(rows) > len(page)
    result = {
        **metadata(route, value, "server"),
        "messages": page,
        "has_more": more,
        "snapshot_cursor": head,
        "stream_epoch": epoch,
        "epoch_checked": expected is not None,
        "scanned_count": len(page),
    }
    if descending:
        result["next_before"] = page[-1]["seq"] if more else None
    else:
        result["next_cursor"] = page[-1]["seq"] if more else max(value["after"], head)
    return result


# @chain-region legacy_page | calls: PageError, any, isinstance, len, metadata, min, p.get, projects …
def legacy_page(remote, peer, route, value):
    # A legacy deployment is explicit configuration. Never silently scan multiple
    # message pages or pretend a client-side selection is database filtering.
    registry = remote(peer["identity"], "registry")
    registered = registry.get("projects")
    if not isinstance(registered, list) or any(not isinstance(p, dict) for p in registered):
        raise PageError("invalid_center_filter_response", 502)
    if not any(p.get("id") == value["project"] for p in registered):
        raise PageError("unknown_project")
    if value.get("stream_epoch") is not None:
        raise PageError("center_stream_epoch_unavailable", 501)
    descending = route == "history"
    cursor = "before" if descending else "after"
    query = {cursor: [str(value[cursor])]}
    if not descending:
        query["limit"] = [str(min(value["limit"] + 1, 100))]
    raw = remote(peer["identity"], route, query=query)
    rows = raw.get("messages")
    if (
        not isinstance(rows, list)
        or len(rows) > 100
        or any(
            not isinstance(row, dict)
            or type(row.get("seq")) is not int
            or not 1 <= row["seq"] <= MAX_SEQ
            or not isinstance(row.get("project"), str)
            for row in rows
        )
    ):
        raise PageError("invalid_center_filter_response", 502)
    seqs = [value[cursor], *[r["seq"] for r in rows]]
    if any(not (a > b if descending else a < b) for a, b in zip(seqs, seqs[1:])):
        raise PageError("invalid_center_filter_response", 502)
    if "has_more" in raw and type(raw["has_more"]) is not bool:
        raise PageError("invalid_center_filter_response", 502)
    scanned = rows[: value["limit"]]
    more = len(rows) > len(scanned) or raw.get("has_more", len(rows) == 100)
    if more and not scanned:
        raise PageError("invalid_center_filter_response", 502)
    result = {
        **metadata(route, value, "legacy_scan"),
        "messages": [r for r in scanned if r["project"] in projects(value)],
        "scanned_count": len(scanned),
        "has_more": more,
        "snapshot_cursor": None,
        "stream_epoch": None,
        "epoch_checked": False,
    }
    if descending:
        result["next_before"] = scanned[-1]["seq"] if more else None
    else:
        end = scanned[-1]["seq"] if scanned else value["after"]
        original = raw.get("next_cursor")
        if (
            type(original) is not int
            or not (rows[-1]["seq"] if rows else value["after"]) <= original <= MAX_SEQ
        ):
            raise PageError("invalid_center_filter_response", 502)
        result["next_cursor"] = end if len(rows) > len(scanned) else original
    return result
