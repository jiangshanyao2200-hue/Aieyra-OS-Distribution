# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: Control/app/service/AGENTS.md | ring 2
# Chains: module-local; query impact before editing
# Regions: Store
# Impact: python -B scripts/code-atlas.py show Control/app/service/delivery_store.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""SQLite delivery, event and cache persistence for the local service."""

import hashlib
import json
import sqlite3
from requirement_delivery import canonical
from service_common import ID, Problem, delivery_message, now


class Store:
    def __init__(self, path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        with self.db() as db:
            db.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS resources(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY,target TEXT NOT NULL,body TEXT NOT NULL,
                    state TEXT NOT NULL,message_id TEXT,queue_id TEXT,error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,object_id TEXT NOT NULL,created_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS cache(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS wakeup_policies(project TEXT PRIMARY KEY,payload TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS wakeup_policy_requests(actor TEXT NOT NULL,id TEXT NOT NULL,digest TEXT NOT NULL,
                    response TEXT NOT NULL,PRIMARY KEY(actor,id));
                CREATE TABLE IF NOT EXISTS wakeup_checks(id TEXT PRIMARY KEY,project TEXT NOT NULL,target TEXT NOT NULL,
                    seat_id TEXT NOT NULL,state TEXT NOT NULL,created REAL NOT NULL,payload TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS wakeup_check_project ON wakeup_checks(project,created);
            """)
            columns = {row[1] for row in db.execute("PRAGMA table_info(deliveries)")}
            for column, kind in (
                ("reply", "TEXT"),
                ("reply_at", "TEXT"),
                ("reply_truncated", "INTEGER"),
                ("turn_id", "TEXT"),
                ("target_thread_id", "TEXT"),
                ("intake_context", "TEXT"),
                ("body_sha256", "TEXT"),
                ("queued_at", "TEXT"),
                ("native_event_id", "TEXT"),
                ("native_received_at", "TEXT"),
                ("native_start_event_id", "TEXT"),
                ("native_started_at", "TEXT"),
                ("intake_dirty", "INTEGER DEFAULT 0"),
            ):
                if column not in columns:
                    db.execute("ALTER TABLE deliveries ADD COLUMN " + column + " " + kind)

    def db(self):
        class Connection(sqlite3.Connection):
            def __exit__(self, *args):
                try:
                    return super().__exit__(*args)
                finally:
                    self.close()

        db = sqlite3.connect(self.path, timeout=10, factory=Connection)
        db.row_factory = sqlite3.Row
        return db

    @staticmethod
    def event(db, kind, object_id):
        db.execute(
            "INSERT INTO events(kind,object_id,created_at) VALUES(?,?,?)", (kind, object_id, now())
        )

    def submit(self, request_id, target, body, target_thread_id=None, intake_context=None):
        if not isinstance(request_id, str) or not ID.fullmatch(request_id):
            raise Problem("invalid_id", "请使用有效的消息编号。")
        if not isinstance(body, str) or not body.strip() or len(body) > 4000:
            raise Problem("invalid_body", "消息需为1至4000字。")
        context = canonical(intake_context) if intake_context is not None else None
        body_hash = hashlib.sha256(
            delivery_message({"id": request_id, "body": body}).encode("utf-8")
        ).hexdigest()
        with self.db() as db:
            db.execute("BEGIN IMMEDIATE")
            old = db.execute("SELECT * FROM deliveries WHERE id=?", (request_id,)).fetchone()
            if old:
                if (
                    old["target"] != target
                    or old["body"] != body
                    or old["target_thread_id"] != target_thread_id
                    or old["intake_context"] != context
                ):
                    raise Problem("id_conflict", "该消息编号已用于不同内容。", 409)
                return dict(old)
            stamp = now()
            db.execute(
                "INSERT INTO deliveries(id,target,body,state,created_at,updated_at,target_thread_id,intake_context,body_sha256,intake_dirty) VALUES(?,?,?,'pending',?,?,?,?,?,?)",
                (
                    request_id,
                    target,
                    body,
                    stamp,
                    stamp,
                    target_thread_id,
                    context,
                    body_hash,
                    int(context is not None),
                ),
            )
            self.event(db, "delivery.pending", request_id)
            return dict(db.execute("SELECT * FROM deliveries WHERE id=?", (request_id,)).fetchone())

    def delivery(self, request_id):
        with self.db() as db:
            row = db.execute("SELECT * FROM deliveries WHERE id=?", (request_id,)).fetchone()
        return dict(row) if row else None

    def claim_pending(self):
        with self.db() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT * FROM deliveries WHERE state='pending' ORDER BY created_at LIMIT 1"
            ).fetchone()
            if not row:
                return None
            db.execute(
                "UPDATE deliveries SET state='sending',updated_at=?,error=NULL WHERE id=?",
                (now(), row["id"]),
            )
            self.event(db, "delivery.sending", row["id"])
            return dict(row)

    def transition(self, request_id, state, **fields):
        allowed = {
            k: v
            for k, v in fields.items()
            if k
            in (
                "message_id",
                "queue_id",
                "error",
                "reply",
                "reply_at",
                "reply_truncated",
                "turn_id",
                "queued_at",
                "native_event_id",
                "native_received_at",
                "native_start_event_id",
                "native_started_at",
            )
        }
        with self.db() as db:
            values = {"state": state, "updated_at": now(), **allowed}
            db.execute(
                "UPDATE deliveries SET "
                + ",".join(k + "=?" for k in values)
                + ",intake_dirty=CASE WHEN intake_context IS NULL THEN 0 ELSE 1 END WHERE id=?",
                [*values.values(), request_id],
            )
            self.event(db, "delivery." + state, request_id)

    def recover(self):
        with self.db() as db:
            # 云端message有幂等ID，CLI投递没有永久幂等；未知写入绝不自动重放。
            db.execute("UPDATE deliveries SET state='pending' WHERE state='sending'")
            rows = db.execute("SELECT id FROM deliveries WHERE state='queue_submitting'").fetchall()
            for row in rows:
                db.execute(
                    "UPDATE deliveries SET state='unknown',error=?,updated_at=?,intake_dirty=CASE WHEN intake_context IS NULL THEN 0 ELSE 1 END WHERE id=?",
                    ("上次投递中断，等待运行时证据核对；未自动重发。", now(), row["id"]),
                )
                self.event(db, "delivery.unknown", row["id"])

    def deliveries(self, states=None):
        with self.db() as db:
            if states:
                return [
                    dict(x)
                    for x in db.execute(
                        "SELECT * FROM deliveries WHERE state IN ("
                        + ",".join("?" for _ in states)
                        + ") ORDER BY created_at",
                        states,
                    )
                ]
            return [
                dict(x)
                for x in db.execute("SELECT * FROM deliveries ORDER BY created_at DESC LIMIT 200")
            ]

    def cache(self, value=None):
        with self.db() as db:
            if value is not None:
                db.execute(
                    "INSERT OR REPLACE INTO cache VALUES('hub',?)",
                    (json.dumps(value, ensure_ascii=False),),
                )
            row = db.execute("SELECT payload FROM cache WHERE id='hub'").fetchone()
            return json.loads(row[0]) if row else None

    def wakeup_policy(self, project):
        with self.db() as db:
            row = db.execute("SELECT payload FROM wakeup_policies WHERE project=?", (project,)).fetchone()
        return json.loads(row[0]) if row else {"project": project, "enabled": False, "window_seconds": 60}

    def save_wakeup_policy(self, actor, request_id, digest, value):
        with self.db() as db:
            db.execute("BEGIN IMMEDIATE")
            old = db.execute(
                "SELECT * FROM wakeup_policy_requests WHERE actor=? AND id=?", (actor, request_id)
            ).fetchone()
            if old:
                if old["digest"] != digest:
                    raise Problem("request_id_conflict", "该请求编号已用于不同的唤醒核验设置。", 409)
                return json.loads(old["response"])
            encoded = json.dumps(value, ensure_ascii=False)
            db.execute("INSERT OR REPLACE INTO wakeup_policies VALUES(?,?)", (value["project"], encoded))
            db.execute("INSERT INTO wakeup_policy_requests VALUES(?,?,?,?)", (actor, request_id, digest, encoded))
            self.event(db, "wakeup.policy", value["project"])
        return value

    def wakeup_check(self, check_id):
        with self.db() as db:
            row = db.execute("SELECT payload FROM wakeup_checks WHERE id=?", (check_id,)).fetchone()
        return json.loads(row[0]) if row else None

    def add_wakeup_check(self, value):
        with self.db() as db:
            db.execute("BEGIN IMMEDIATE")
            old = db.execute("SELECT payload FROM wakeup_checks WHERE id=?", (value["id"],)).fetchone()
            if old:
                original = json.loads(old[0])
                if original["digest"] != value["digest"]:
                    raise Problem("request_id_conflict", "该请求编号已用于另一条唤醒核验。", 409)
                return original
            # Keep observation work bounded; this never queues a native message.
            if db.execute("SELECT count(*) FROM wakeup_checks WHERE state='pending'").fetchone()[0] >= 500:
                raise Problem("wakeup_check_capacity", "待核验数量已达上限。", 429)
            db.execute(
                "INSERT INTO wakeup_checks VALUES(?,?,?,?,?,?,?)",
                (value["id"], value["project"], value["target"], value["seat_id"], value["state"],
                 value["created"], json.dumps(value, ensure_ascii=False)),
            )
            self.event(db, "wakeup.prepared", value["id"])
        return value

    def update_wakeup_check(self, value):
        with self.db() as db:
            db.execute(
                "UPDATE wakeup_checks SET state=?,payload=? WHERE id=?",
                (value["state"], json.dumps(value, ensure_ascii=False), value["id"]),
            )

    def wakeup_checks(self, project=None, observe=False):
        clauses, args = [], []
        if project is not None:
            clauses.append("project=?")
            args.append(project)
        if observe:
            clauses.append("state!='delivered'")
        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        with self.db() as db:
            rows = db.execute(
                "SELECT payload FROM wakeup_checks" + where + " ORDER BY created DESC LIMIT ?",
                [*args, 1000 if observe else 200],
            ).fetchall()
        return [json.loads(row[0]) for row in rows]
