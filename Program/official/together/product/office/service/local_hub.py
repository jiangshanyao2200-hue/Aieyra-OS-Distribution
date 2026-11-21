# @file-map:start
# 文件: link/office/service/local_hub.py
# 位置: 二环·工位服务 | 本机控制、接入、凭据、工位与租约的HTTP服务。
# 约束: 服务绑定本机并核对所有者身份；凭据与工作正文不因短暂失联清空；关闭使用租约排空
# 下游: 无已解析的项目内静态导入
# 上游: link/office/service/main.py
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: python -X utf8 -B -m unittest discover -s link/office/tests/service
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   LocalClient | class
#   LocalClient.__init__ | function
#   LocalClient.load | function
#   LocalClient.save | function
#   LocalClient.call | function
#   LocalClient.start | function
#   LocalClient.chat_history | function
#   create_local_hub | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Local transport for the pinned coordination engine. No sockets or cloud calls."""

from __future__ import annotations

import secrets
import time
from urllib.parse import urlsplit, parse_qs
from coordination_core import hub as engine
from coordination_core.core import Fault


# @chain-region LocalClient | calls: Fault, FileNotFoundError, ValueError, db.execute, db.execute("SELECT id,name,role,project FROM actors WHERE id='owner' AND revoked=0").fetchone, db.execute('SELECT actor_id FROM local_identities WHERE alias=?', (identity,)).fetchone, db.execute('SELECT id,name,role,project FROM actors WHERE id=? AND revoked=0', (aid,)).fetchone, db.execute('SELECT version FROM registered_projects WHERE id=?', (project['id'],)).fetchone …
class LocalClient:
    # @chain-region LocalClient.__init__ | calls: db.execute, db.execute('SELECT version FROM registered_projects WHERE id=?', (project['id'],)).fetchone, engine.Store, secrets.token_hex, secrets.token_urlsafe, self.call, self.store.db, self.store.init
    def __init__(self, data_dir, projects):
        self.store = engine.Store(data_dir / "office.sqlite")
        try:
            self.store.init(secrets.token_urlsafe(32))
        except Fault as error:
            if error.code != "already_initialized":
                raise
        with self.store.db() as db:
            db.execute(
                "CREATE TABLE IF NOT EXISTS local_identities(alias TEXT PRIMARY KEY,actor_id TEXT NOT NULL REFERENCES actors(id))"
            )
            db.execute("INSERT OR IGNORE INTO local_identities VALUES('owner','owner')")
            db.execute(
                "CREATE INDEX IF NOT EXISTS control_message_created ON messages(created,seq)"
            )
            db.execute(
                "CREATE TABLE IF NOT EXISTS control_message_stream("
                "id INTEGER PRIMARY KEY CHECK(id=1), epoch TEXT NOT NULL)"
            )
            db.execute(
                "INSERT OR IGNORE INTO control_message_stream VALUES(1,?)",
                (secrets.token_hex(32),),
            )
        for project in [
            {"id": "coordination", "name": "本地群聊", "root": "", "source": ""},
            *projects,
        ]:
            with self.store.db() as db:
                old = db.execute(
                    "SELECT version FROM registered_projects WHERE id=?", (project["id"],)
                ).fetchone()
            if old:
                continue
            self.call(
                "owner",
                "/v1/project-register",
                {**project, "version": 0, "request_id": "local-project-" + project["id"]},
            )

    # @chain-region LocalClient.load | calls: FileNotFoundError, db.execute, db.execute('SELECT actor_id FROM local_identities WHERE alias=?', (identity,)).fetchone, self.store.db
    def load(self, identity):
        with self.store.db() as db:
            row = db.execute(
                "SELECT actor_id FROM local_identities WHERE alias=?", (identity,)
            ).fetchone()
        if not row:
            raise FileNotFoundError(identity)
        return {"id": row["actor_id"]}

    # @chain-region LocalClient.save | calls: db.execute, self.store.db
    def save(self, identity, result):
        with self.store.db() as db:
            db.execute("INSERT INTO local_identities VALUES(?,?)", (identity, result["id"]))

    # @chain-region LocalClient.call | calls: Fault, ValueError, db.execute, db.execute('SELECT id,name,role,project FROM actors WHERE id=? AND revoked=0', (aid,)).fetchone, dict, parse_qs, parsed.path.removeprefix, self.load …
    def call(self, identity, path, body=None):
        try:
            aid = self.load(identity)["id"]
            with self.store.db() as db:
                actor = db.execute(
                    "SELECT id,name,role,project FROM actors WHERE id=? AND revoked=0", (aid,)
                ).fetchone()
            if not actor:
                raise Fault("unauthorized", 401)
            parsed = urlsplit(path)
            return (
                self.store.read(
                    dict(actor), parsed.path, parse_qs(parsed.query, keep_blank_values=True)
                )
                if body is None
                else self.store.write(dict(actor), parsed.path.removeprefix("/v1/"), body)
            )
        except Fault as error:
            raise ValueError(f"{error.status}:{error.code}") from None

    # @chain-region LocalClient.start
    def start(self):
        return {"local": True}

    # @chain-region LocalClient.chat_history | calls: db.execute, db.execute("SELECT id,name,role,project FROM actors WHERE id='owner' AND revoked=0").fetchone, dict, len, list, reversed, self.store.db, self.store.messages …
    def chat_history(self, before=None):
        end = time.time()
        start = None
        # Display window only: old messages remain in the local office database.
        with self.store.db() as db:
            actor = dict(
                db.execute(
                    "SELECT id,name,role,project FROM actors WHERE id='owner' AND revoked=0"
                ).fetchone()
            )
            rows = self.store.messages(
                db,
                actor,
                "m.created<=? AND m.seq<?",
                (end, before or 9223372036854775807),
                True,
                101,
            )
        return {
            "messages": list(reversed(rows[:100])),
            "has_more": len(rows) > 100,
            "next_before": rows[99]["seq"] if len(rows) > 100 else None,
            "window_start": start,
            "window_end": end,
            "retention_hours": None,
        }


# @chain-region create_local_hub | calls: LocalClient, config.get, hub_type.__new__
def create_local_hub(config, data_dir, hub_type):
    value = hub_type.__new__(hub_type)
    value.config = {
        **config,
        "hub_read_identity": "owner",
        "hub_user_identity": "owner",
        "hub_management_identity": "owner",
        "hub_registry_identity": "owner",
        "hub_operations_identity": "owner",
    }
    value.client = LocalClient(data_dir, config.get("local_projects", []))
    value.is_local = True
    return value
