# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: Control/app/service/AGENTS.md | ring 2
# Chains: module-local; query impact before editing
# Regions: SelfHeal
# Impact: python -B scripts/code-atlas.py show Control/app/service/self_heal.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""工位自愈（用户 2026-10-12：中断了就发「继续」；默认关闭，用户要求时由领导开启）.

Every 30 seconds, while enabled, look at each bound station's native session
(native_presence). A Codex turn that went silent past the stale threshold, or
stopped on an error, gets one "继续" queued into that same thread with
`codex queue`. One attempt per interruption, a cooldown per station, and every
attempt is kept in an audit list that Link shows. Claude Code sessions cannot be
written into from outside, so their interruptions are recorded for the leader
instead of pretending to heal them. Nothing here ends processes or reads text.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import threading
import time
from pathlib import Path

import native_presence

POLL_SECONDS = 30
COOLDOWN_SECONDS = 600
MESSAGE = "继续"
AUDIT_LIMIT = 50


class SelfHeal:
    def __init__(self, app, data_dir: Path, runner=None, clock=time.time):
        self.app = app
        self.path = Path(data_dir) / "self-heal.json"
        self.runner = runner or self._codex_queue
        self.clock = clock
        self.lock = threading.Lock()
        self.stop = threading.Event()
        self.thread = None
        self.state = self._load()

    def _load(self):
        try:
            value = json.loads(self.path.read_text(encoding="utf-8"))
            if isinstance(value, dict):
                value.setdefault("audit", [])
                value.setdefault("attempted", {})
                value["enabled"] = value.get("enabled") is True
                return value
        except (OSError, ValueError):
            pass
        return {"enabled": False, "updated_at": None, "updated_by": None, "audit": [], "attempted": {}}

    def _save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temp = self.path.with_suffix(".tmp")
        temp.write_text(json.dumps(self.state, ensure_ascii=False), encoding="utf-8")
        temp.replace(self.path)

    def start(self):
        if self.thread is None:
            self.thread = threading.Thread(target=self._loop, name="self-heal", daemon=True)
            self.thread.start()

    def close(self):
        self.stop.set()

    def _loop(self):
        while not self.stop.wait(POLL_SECONDS):
            try:
                self.run_once()
            except Exception:
                pass

    def set_enabled(self, enabled: bool, actor_id: str):
        with self.lock:
            self.state.update(enabled=bool(enabled), updated_at=self.clock(), updated_by=actor_id)
            self._audit({"kind": "toggle", "actor_id": actor_id, "result": "enabled" if enabled else "disabled"})
            self._save()
            return self.public()

    def _audit(self, entry):
        entry = {"at": self.clock(), **entry}
        self.state["audit"].append(entry)
        del self.state["audit"][:-AUDIT_LIMIT]

    @staticmethod
    def _codex_queue(native_id: str) -> str:
        codex = shutil.which("codex")
        if not codex:
            raise RuntimeError("codex_cli_missing")
        done = subprocess.run(
            [codex, "queue", "--thread", native_id, "--message", MESSAGE],
            capture_output=True, text=True, timeout=60,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        if done.returncode != 0:
            raise RuntimeError("codex_queue_failed")
        return "queued"

    def run_once(self):
        bindings = self.app.agent_access.native_bindings()
        now = self.clock()
        changed = False
        with self.lock:
            attempted = self.state["attempted"]
            for actor_id, native in bindings.items():
                presence = native_presence.observe(native)
                if not presence:
                    continue
                key = actor_id + "|" + str(presence.get("at"))
                previous = attempted.get(actor_id)
                # 尝试之后又有了新动静：记一笔「已恢复」。
                if previous and previous.get("result") == "queued" and not previous.get("recovered") \
                        and presence["state"] in ("running", "idle") and presence.get("at") != previous.get("at"):
                    previous["recovered"] = True
                    self._audit({"kind": "recovered", "actor_id": actor_id, "host": presence["host"], "result": "activity_observed"})
                    changed = True
                if presence["state"] not in ("stale", "error") or not self.state["enabled"]:
                    continue
                if previous and (previous.get("key") == key or now - previous.get("tried_at", 0) < COOLDOWN_SECONDS):
                    continue
                entry = {"key": key, "at": presence.get("at"), "tried_at": now, "reason": presence["state"]}
                if presence["host"] != "codex":
                    entry["result"] = "manual_required"
                else:
                    try:
                        entry["result"] = self.runner(native)
                    except Exception as error:
                        entry["result"] = "failed"
                        entry["failure"] = str(error)[:80]
                attempted[actor_id] = entry
                self._audit({"kind": "continue", "actor_id": actor_id, "host": presence["host"],
                             "reason": presence["state"], "result": entry["result"], "failure": entry.get("failure")})
                changed = True
            if changed:
                self._save()

    def public(self):
        return {
            "enabled": self.state["enabled"],
            "updated_at": self.state.get("updated_at"),
            "updated_by": self.state.get("updated_by"),
            "audit": [
                {k: v for k, v in item.items() if k in ("at", "kind", "actor_id", "host", "reason", "result", "failure")}
                for item in self.state["audit"][-20:]
            ],
        }
