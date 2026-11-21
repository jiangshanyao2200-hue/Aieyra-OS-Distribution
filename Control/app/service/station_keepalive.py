# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: Control/app/service/AGENTS.md | ring 2
# Chains: module-local; query impact before editing
# Regions: codex_executable; StationKeepalive
# Impact: python -B scripts/code-atlas.py show Control/app/service/station_keepalive.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""Station keepalive: a station schedules bounded messages to its own native session.

Only on the user's request (the plan records it). Two modes:
- cache: keep the provider prompt cache warm after the station stops working;
  the message asks for a one-word reply and no work.
- resume: anti-interruption; the station's own text is delivered after silence.

The interval has a safety floor and every plan has a fire limit, so nothing is
maintained forever. A fire only happens after `interval` seconds without native
activity; a running turn already keeps the cache warm and is never interrupted.
Delivery: `native` sends into a Codex thread through the existing adapter;
`host` is for hosts that cannot be written into from outside (Claude Code):
the station runs `agent-station.py keepalive-wait` in the background, which
returns when the next message is due and records the fire here.
"""

import json
import os
import shutil
import threading
import time
import uuid
from pathlib import Path

import native_presence
from agent_access import AgentError, canonical, digest, ident, text
from native_wakeup import NativeWakeup, WakeError

MIN_INTERVAL = 300
MAX_INTERVAL = 3600
MAX_FIRES = 20
POLL_SECONDS = 30
ACTIVE = ("active", "waiting_host")
CACHE_TEXT = "缓存保活：这是你按用户要求设置的定时消息，只为保持上下文缓存。不要开始新工作、不要调用工具，回复「保活」两个字即可。"
RESUME_DEFAULT = "防中断保活：如果有已授权但未完成的工作，继续推进；没有就回复「保活」两个字。"


def codex_executable(config):
    """Configured path first, then the native binary behind the npm `codex` shim."""
    for value in (config.get("executable"), config.get("leader_executable")):
        if value and Path(value).is_absolute() and Path(value).is_file():
            return value
    shim = shutil.which("codex")
    if shim:
        base = Path(shim).resolve().parent / "node_modules" / "@openai" / "codex" / "node_modules"
        for found in base.glob("@openai/codex-*/vendor/*/bin/codex" + (".exe" if os.name == "nt" else "")):
            return str(found)
    return ""


class StationKeepalive:
    def __init__(self, app, adapter=None, observe=None, clock=time.time):
        self.app, self.store, self.access = app, app.store, app.agent_access
        config = dict(app.config.get("station_keepalive", {}))
        config.setdefault("leader_executable", app.config.get("leader_wakeup", {}).get("executable", ""))
        self.min_interval = max(MIN_INTERVAL, int(config.get("min_interval_seconds", MIN_INTERVAL)))
        self.config = config
        self.adapter = adapter
        self.observe = observe or native_presence.observe
        self.clock = clock
        self.lock = threading.Lock()
        self.next_poll = 0.0
        with self.store.db() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS station_keepalive(
                    id TEXT PRIMARY KEY, credential_id TEXT NOT NULL, request_id TEXT NOT NULL,
                    digest TEXT NOT NULL, actor_id TEXT NOT NULL, project TEXT NOT NULL,
                    seat_id TEXT NOT NULL, native_session_id TEXT NOT NULL,
                    binding_version INTEGER NOT NULL, host TEXT NOT NULL, mode TEXT NOT NULL,
                    delivery TEXT NOT NULL, interval_seconds INTEGER NOT NULL,
                    max_fires INTEGER NOT NULL, fires INTEGER NOT NULL DEFAULT 0,
                    message TEXT NOT NULL, user_request TEXT NOT NULL, state TEXT NOT NULL,
                    error TEXT, created REAL NOT NULL, updated REAL NOT NULL,
                    last_fire_at REAL, next_check REAL NOT NULL, last_receipt TEXT,
                    UNIQUE(credential_id,request_id));
                CREATE INDEX IF NOT EXISTS station_keepalive_actor ON station_keepalive(actor_id,state);
                CREATE TABLE IF NOT EXISTS station_keepalive_requests(
                    credential_id TEXT NOT NULL, request_id TEXT NOT NULL, digest TEXT NOT NULL,
                    response TEXT NOT NULL, PRIMARY KEY(credential_id,request_id));
            """)
            # A send interrupted by a restart is never replayed; it counts as fired.
            db.execute("UPDATE station_keepalive SET error='interrupted_native_submission' WHERE error='submitting'")

    @staticmethod
    def view(row):
        if not row:
            return None
        value = {k: row[k] for k in row.keys() if k not in ("credential_id", "digest", "request_id")}
        value["last_receipt"] = json.loads(value["last_receipt"]) if value.get("last_receipt") else None
        return value

    def public(self, row):
        """Status only, for the Link UI (no user request text or message body)."""
        if not row:
            return None
        return {k: row[k] for k in ("id", "state", "mode", "delivery", "interval_seconds", "max_fires", "fires", "last_fire_at")} | {
            "next_due": self.due(row) if row["state"] in ACTIVE else None
        }

    def current(self, actor_id):
        with self.store.db() as db:
            return db.execute(
                "SELECT * FROM station_keepalive WHERE actor_id=? ORDER BY created DESC LIMIT 1", (actor_id,)
            ).fetchone()

    def last_activity(self, row):
        presence = self.observe(row["native_session_id"])
        if not presence:
            return None, 0.0
        return presence, self.clock() - float(presence.get("silence_seconds") or 0)

    def due(self, row, activity=None):
        if activity is None:
            _, activity = self.last_activity(row)
        return max(row["created"], row["last_fire_at"] or 0, activity or 0) + row["interval_seconds"]

    # —— agent API ——
    def read(self, peer):
        row = self.current(peer["actor_id"])
        return {"keepalive": self.view(row), "next_due": self.due(row) if row and row["state"] in ACTIVE else None,
                "min_interval_seconds": self.min_interval, "max_interval_seconds": MAX_INTERVAL, "max_fires_limit": MAX_FIRES,
                "enabled_by_default": False}

    def action(self, peer, value):
        if not isinstance(value, dict) or value.get("action") not in ("set", "cancel", "fire"):
            raise AgentError("invalid_keepalive_action")
        allowed = {
            "set": ({"request_id", "session_id", "action", "mode", "interval_seconds", "max_fires", "user_request", "delivery"}, {"message"}),
            "cancel": ({"request_id", "session_id", "action", "reason"}, set()),
            "fire": ({"request_id", "action", "id"}, set()),
        }[value["action"]]
        if not allowed[0] <= set(value) or set(value) - allowed[0] - allowed[1]:
            raise AgentError("invalid_keepalive_action")
        rid = ident(value["request_id"])
        hashed = digest(canonical(value))
        with self.store.db() as db:
            old = db.execute("SELECT * FROM station_keepalive_requests WHERE credential_id=? AND request_id=?",
                             (peer["id"], rid)).fetchone()
        if old:
            if old["digest"] != hashed:
                raise AgentError("request_id_conflict", 409)
            return {**json.loads(old["response"]), "replayed": True}
        if value["action"] != "fire":
            session = self.access.session(peer, value["session_id"])
            self.access.validate_center(peer, session)
        result = getattr(self, "_" + value["action"])(peer, value)
        with self.store.db() as db:
            db.execute("INSERT INTO station_keepalive_requests VALUES(?,?,?,?)", (peer["id"], rid, hashed, canonical(result)))
        return result

    def _set(self, peer, value):
        mode, delivery = value["mode"], value["delivery"]
        if mode not in ("cache", "resume") or delivery not in ("native", "host"):
            raise AgentError("invalid_keepalive_mode")
        interval, fires = value["interval_seconds"], value["max_fires"]
        if type(interval) is not int or not self.min_interval <= interval <= MAX_INTERVAL:
            raise AgentError("keepalive_interval_out_of_range")
        if type(fires) is not int or not 1 <= fires <= MAX_FIRES:
            raise AgentError("keepalive_max_fires_out_of_range")
        user_request = text(value["user_request"], 600)
        if mode == "cache" and "message" in value:
            raise AgentError("keepalive_cache_message_fixed")
        message = text(value["message"], 600) if "message" in value else (CACHE_TEXT if mode == "cache" else RESUME_DEFAULT)
        with self.store.db() as db:
            binding = db.execute(
                "SELECT b.* FROM agent_station_bindings b JOIN agent_credentials c ON c.actor_id=b.actor_id WHERE b.actor_id=? AND c.id=? AND c.revoked=0",
                (peer["actor_id"], peer["id"]),
            ).fetchone()
        if not binding or not binding["native_session_id"]:
            raise AgentError("station_native_binding_missing", 409)
        presence = self.observe(binding["native_session_id"])
        host = (presence or {}).get("host") or "unknown"
        if delivery == "native" and host != "codex":
            raise AgentError("keepalive_native_host_unsupported_use_host_delivery", 409)
        now = self.clock()
        pid = "keepalive-" + uuid.uuid4().hex[:20]
        with self.store.db() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("UPDATE station_keepalive SET state='superseded',updated=? WHERE actor_id=? AND state IN ('active','waiting_host','needs_attention')",
                       (now, peer["actor_id"]))
            db.execute(
                "INSERT INTO station_keepalive(id,credential_id,request_id,digest,actor_id,project,seat_id,native_session_id,binding_version,host,mode,delivery,interval_seconds,max_fires,message,user_request,state,created,updated,next_check) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (pid, peer["id"], value["request_id"], digest(canonical(value)), peer["actor_id"], peer["project"], binding["seat_id"],
                 binding["native_session_id"], binding["version"], host, mode, delivery, interval, fires, message, user_request,
                 "active" if delivery == "native" else "waiting_host", now, now, now + interval),
            )
            row = db.execute("SELECT * FROM station_keepalive WHERE id=?", (pid,)).fetchone()
        self.app.sync_wake.set()
        return {"keepalive": self.view(row), "next_due": self.due(row)}

    def _cancel(self, peer, value):
        reason = text(value["reason"], 600)
        now = self.clock()
        with self.store.db() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM station_keepalive WHERE actor_id=? AND state IN ('active','waiting_host','needs_attention') ORDER BY created DESC LIMIT 1",
                             (peer["actor_id"],)).fetchone()
            if not row:
                raise AgentError("keepalive_not_active", 404)
            db.execute("UPDATE station_keepalive SET state='cancelled',error=?,updated=? WHERE id=?", ("cancelled: " + reason, now, row["id"]))
            row = db.execute("SELECT * FROM station_keepalive WHERE id=?", (row["id"],)).fetchone()
        return {"keepalive": self.view(row)}

    def _fire(self, peer, value):
        """Host delivery: the waiter records the fire it is about to hand to its host."""
        with self.store.db() as db:
            row = db.execute("SELECT * FROM station_keepalive WHERE id=? AND actor_id=?", (ident(value["id"]), peer["actor_id"])).fetchone()
        if not row:
            raise AgentError("keepalive_missing", 404)
        if row["delivery"] != "host" or row["state"] != "waiting_host":
            raise AgentError("keepalive_not_waiting_host", 409)
        if not self.valid_binding(row):
            self.finish(row["id"], "superseded", "station_binding_changed")
            raise AgentError("keepalive_binding_changed", 409)
        due = self.due(row)
        if self.clock() < due - 15:
            raise AgentError("keepalive_not_due", 409)
        receipt = {"delivery": "host", "fired_at": self.clock()}
        row = self.record_fire(row, receipt)
        return {"keepalive": self.view(row), "message": self.prompt(row), "next_due": self.due(row) if row["state"] in ACTIVE else None}

    # —— scheduler ——
    def prompt(self, row):
        return "[station-keepalive:%s %d/%d] %s" % (row["id"], row["fires"], row["max_fires"], row["message"])

    def valid_binding(self, row):
        with self.store.db() as db:
            binding = db.execute(
                "SELECT b.* FROM agent_station_bindings b JOIN agent_credentials c ON c.actor_id=b.actor_id WHERE b.actor_id=? AND c.id=? AND c.revoked=0",
                (row["actor_id"], row["credential_id"]),
            ).fetchone()
        return bool(binding and binding["native_session_id"] == row["native_session_id"] and binding["version"] == row["binding_version"])

    def finish(self, pid, state, error=None):
        with self.store.db() as db:
            db.execute("UPDATE station_keepalive SET state=?,error=?,updated=? WHERE id=?", (state, error, self.clock(), pid))

    def record_fire(self, row, receipt, error=None):
        now = self.clock()
        fires = row["fires"] + 1
        state = "completed" if fires >= row["max_fires"] else row["state"]
        with self.store.db() as db:
            db.execute("UPDATE station_keepalive SET fires=?,state=?,last_fire_at=?,last_receipt=?,error=?,updated=?,next_check=? WHERE id=?",
                       (fires, state, now, canonical(receipt), error, now, now + row["interval_seconds"], row["id"]))
            return db.execute("SELECT * FROM station_keepalive WHERE id=?", (row["id"],)).fetchone()

    def defer(self, row, seconds, error=None):
        with self.store.db() as db:
            db.execute("UPDATE station_keepalive SET next_check=?,error=?,updated=? WHERE id=?",
                       (self.clock() + seconds, error, self.clock(), row["id"]))

    def tick(self):
        now = self.clock()
        if now < self.next_poll or not self.lock.acquire(blocking=False):
            return
        try:
            self.next_poll = now + POLL_SECONDS
            with self.store.db() as db:
                rows = db.execute("SELECT * FROM station_keepalive WHERE state IN ('active','waiting_host') AND next_check<=?", (now,)).fetchall()
            for row in rows:
                self.check(row)
        finally:
            self.lock.release()

    def check(self, row):
        if not self.valid_binding(row):
            return self.finish(row["id"], "superseded", "station_binding_changed")
        if row["delivery"] == "host":
            return self.defer(row, POLL_SECONDS)
        presence, activity = self.last_activity(row)
        due = self.due(row, activity)
        if self.clock() < due:
            return self.defer(row, max(1, due - self.clock()))
        state = (presence or {}).get("state")
        # A running turn keeps the cache warm; cache mode never interrupts work.
        if state == "running" or (row["mode"] == "cache" and state == "error"):
            return self.defer(row, row["interval_seconds"])
        config = {"enabled": True, "host": "codex", "executable": codex_executable(self.config)}
        adapter = self.adapter or NativeWakeup(config)
        target = {"leader": row["actor_id"], "native_session_id": row["native_session_id"], "binding_version": row["binding_version"]}
        sent = False

        def before_send():
            nonlocal sent
            if not self.valid_binding(row):
                raise WakeError("station_binding_changed")
            with self.store.db() as db:
                db.execute("UPDATE station_keepalive SET error='submitting' WHERE id=?", (row["id"],))
            sent = True

        upcoming = dict(row) | {"fires": row["fires"] + 1}
        try:
            receipt = adapter.notify(target, self.prompt(upcoming), row["id"] + ":" + str(upcoming["fires"]), before_send)
            self.record_fire(row, receipt)
        except Exception as error:
            code = str(error) if isinstance(error, WakeError) else "native_adapter_unavailable"
            if sent:
                self.record_fire(row, {"state": "unknown"}, code)  # counted; never replayed
            elif code in ("native_waiting_or_failed", "native_identity_or_wait_state_changed"):
                self.defer(row, row["interval_seconds"], code)
            elif code in ("native_executable_unavailable", "native_timeout", "native_connection_closed", "native_adapter_unavailable"):
                self.defer(row, 300, code)
            else:
                self.finish(row["id"], "needs_attention", code)
