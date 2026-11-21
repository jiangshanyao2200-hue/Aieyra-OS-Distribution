# @file-map:start
# 文件: link/office/service/self_heal.py
# 位置: 二环·工位服务 | 本机控制、接入、凭据、工位与租约的HTTP服务。
# 约束: 服务绑定本机并核对所有者身份；凭据与工作正文不因短暂失联清空；关闭使用租约排空
# 下游: link/office/service/native_presence.py
# 上游: link/office/service/main.py
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: python -X utf8 -B -m unittest discover -s link/office/tests/service
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   SelfHeal | class
#   SelfHeal.__init__ | function
#   SelfHeal._load | function
#   SelfHeal._save | function
#   SelfHeal.start | function
#   SelfHeal.close | function
#   SelfHeal._loop | function
#   SelfHeal.set_enabled | function
#   SelfHeal._audit | function
#   SelfHeal._codex_queue | function
#   SelfHeal.run_once | function
#   SelfHeal.public | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
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


# @chain-region SelfHeal | calls: Path, RuntimeError, attempted.get, bindings.items, bool, entry.get, getattr, isinstance …
class SelfHeal:
    # @chain-region SelfHeal.__init__ | calls: Path, self._load, threading.Event, threading.Lock
    def __init__(self, app, data_dir: Path, runner=None, clock=time.time):
        self.app = app
        self.path = Path(data_dir) / "self-heal.json"
        self.runner = runner or self._codex_queue
        self.clock = clock
        self.lock = threading.Lock()
        self.stop = threading.Event()
        self.thread = None
        self.state = self._load()

    # @chain-region SelfHeal._load | calls: isinstance, json.loads, self.path.read_text, value.get, value.setdefault
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

    # @chain-region SelfHeal._save | calls: json.dumps, self.path.parent.mkdir, self.path.with_suffix, temp.replace, temp.write_text
    def _save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temp = self.path.with_suffix(".tmp")
        temp.write_text(json.dumps(self.state, ensure_ascii=False), encoding="utf-8")
        temp.replace(self.path)

    # @chain-region SelfHeal.start | calls: self.thread.start, threading.Thread
    def start(self):
        if self.thread is None:
            self.thread = threading.Thread(target=self._loop, name="self-heal", daemon=True)
            self.thread.start()

    # @chain-region SelfHeal.close | calls: self.stop.set
    def close(self):
        self.stop.set()

    # @chain-region SelfHeal._loop | calls: self.run_once, self.stop.wait
    def _loop(self):
        while not self.stop.wait(POLL_SECONDS):
            try:
                self.run_once()
            except Exception:
                pass

    # @chain-region SelfHeal.set_enabled | calls: bool, self._audit, self._save, self.clock, self.public, self.state.update
    def set_enabled(self, enabled: bool, actor_id: str):
        with self.lock:
            self.state.update(enabled=bool(enabled), updated_at=self.clock(), updated_by=actor_id)
            self._audit({"kind": "toggle", "actor_id": actor_id, "result": "enabled" if enabled else "disabled"})
            self._save()
            return self.public()

    # @chain-region SelfHeal._audit | calls: self.clock, self.state['audit'].append
    def _audit(self, entry):
        entry = {"at": self.clock(), **entry}
        self.state["audit"].append(entry)
        del self.state["audit"][:-AUDIT_LIMIT]

    # @chain-region SelfHeal._codex_queue | calls: RuntimeError, getattr, shutil.which, subprocess.run
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

    # @chain-region SelfHeal.run_once | calls: attempted.get, bindings.items, entry.get, native_presence.observe, presence.get, previous.get, self._audit, self._save …
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

    # @chain-region SelfHeal.public | calls: item.items, self.state.get
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
