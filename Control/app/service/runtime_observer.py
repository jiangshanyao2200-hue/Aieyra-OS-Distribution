# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: Control/app/service/AGENTS.md | ring 2
# Chains: module-local; query impact before editing
# Regions: RuntimeObserver; WakeupChecks
# Impact: python -B scripts/code-atlas.py show Control/app/service/runtime_observer.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""Read only native runtime evidence and match it to existing deliveries."""

import datetime as dt
import hashlib
from itertools import islice
import json
import os
import re
import threading
import time
from pathlib import Path
from service_common import MARKER, Problem, delivery_message


class RuntimeObserver:
    """只投影生命周期和本客户端消息标记；不返回用户正文或模型思考。"""

    def __init__(self, config, delivery_lookup=None):
        self.bindings = {x["actor_id"]: dict(x) for x in config.get("runtime_bindings", [])}
        self.delivery_lookup = delivery_lookup
        self.sessions_root = Path(config.get("runtime_sessions_dir", ""))
        self.states = {}
        self.receipts = {}

    def abandon_turn(self, actor, state):
        for delivery in state["active"]:
            receipt = self.receipts[(actor, delivery)]
            receipt.update(state="unknown", error="未收到原轮次的结束证据，已停止关联后续答复。")
            for key in ("reply", "reply_at", "reply_truncated"):
                receipt.pop(key, None)
        state.update(active=[], turn_id=None, start_event_id=None, started_at=None)

    def observe(self):
        for actor, binding in self.bindings.items():
            state = self.states.setdefault(
                actor,
                {"state": "unknown", "offset": 0, "active": [], "thread_id": binding["thread_id"]},
            )
            if state["thread_id"] != binding["thread_id"]:
                self.abandon_turn(actor, state)
                state = self.states[actor] = {
                    "state": "unknown",
                    "offset": 0,
                    "active": [],
                    "thread_id": binding["thread_id"],
                }
            path = Path(binding.get("rollout", ""))
            if not path.is_file() and time.monotonic() >= state.get("next_search", 0):
                matches = (
                    list(self.sessions_root.glob("*/*/*/*" + binding["thread_id"] + ".jsonl"))
                    if self.sessions_root.is_dir()
                    else []
                )
                if len(matches) == 1:
                    binding["rollout"] = str(matches[0])
                    path = matches[0]
                state["next_search"] = time.monotonic() + 30
            if not path.is_file():
                state["state"] = "unknown"
                continue
            try:
                if path.stat().st_size < state["offset"]:
                    self.abandon_turn(actor, state)
                    state.update(offset=0, state="unknown")
                with path.open("rb") as source:
                    source.seek(state["offset"])
                    for _ in range(200000):
                        line = source.readline()
                        if not line or not line.endswith(b"\n"):
                            break
                        state["offset"] = source.tell()
                        try:
                            event = json.loads(line)
                        except ValueError:
                            self.abandon_turn(actor, state)
                            state["state"] = "unknown"
                            continue
                        payload = event.get("payload", {})
                        if not isinstance(payload, dict):
                            continue
                        kind = payload.get("type")
                        if event.get("type") in ("response_item", "event_msg"):
                            state["last_activity_at"] = event.get("timestamp")
                        if event.get("type") == "event_msg":
                            if kind == "task_started":
                                turn_id = payload.get("turn_id")
                                if not isinstance(turn_id, str) or not turn_id:
                                    turn_id = None
                                if turn_id is None or turn_id != state.get("turn_id"):
                                    self.abandon_turn(actor, state)
                                    if turn_id:
                                        state.update(
                                            start_event_id="codex-event:"
                                            + hashlib.sha256(line).hexdigest(),
                                            started_at=event.get("timestamp"),
                                        )
                                state.update(
                                    state="running",
                                    observed_at=event.get("timestamp"),
                                    turn_id=turn_id,
                                )
                            elif kind in ("task_complete", "task_completed", "turn_aborted"):
                                if (
                                    not state.get("turn_id")
                                    or payload.get("turn_id") != state["turn_id"]
                                ):
                                    continue
                                state.update(state="idle", observed_at=event.get("timestamp"))
                                for delivery in state["active"]:
                                    self.receipts[(actor, delivery)]["state"] = (
                                        "completed" if kind != "turn_aborted" else "interrupted"
                                    )
                                state.update(
                                    active=[], turn_id=None, start_event_id=None, started_at=None
                                )
                        if (
                            event.get("type") == "response_item"
                            and kind == "message"
                            and payload.get("role") == "user"
                        ):
                            for part in payload.get("content", []):
                                text = part.get("text", "") if isinstance(part, dict) else ""
                                if not isinstance(text, str):
                                    continue
                                for delivery in MARKER.findall(text):
                                    body_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()
                                    event_id = "codex-event:" + hashlib.sha256(line).hexdigest()
                                    if self.delivery_lookup:
                                        original = self.delivery_lookup(delivery)
                                        if (
                                            not original
                                            or original["target"] != actor
                                            or original.get("target_thread_id")
                                            != binding["thread_id"]
                                            or body_hash
                                            != hashlib.sha256(
                                                delivery_message(original).encode("utf-8")
                                            ).hexdigest()
                                            or original.get("native_event_id")
                                            not in (None, event_id)
                                            or original.get("turn_id")
                                            not in (None, state.get("turn_id"))
                                        ):
                                            continue
                                    # A duplicate marker never adopts a later turn or erases
                                    # the first receipt. Forged body hashes are not receipts.
                                    previous = self.receipts.get((actor, delivery))
                                    if previous and previous["message_hash"] == body_hash:
                                        continue
                                    self.receipts[(actor, delivery)] = {
                                        "state": "received",
                                        "message_hash": body_hash,
                                        "turn_id": state.get("turn_id"),
                                        "thread_id": binding["thread_id"],
                                        "native_event_id": event_id,
                                        "native_received_at": event.get("timestamp"),
                                        "native_start_event_id": state.get("start_event_id"),
                                        "native_started_at": state.get("started_at"),
                                    }
                                    if state.get("turn_id") and delivery not in state["active"]:
                                        state["active"].append(delivery)
                        if (
                            event.get("type") == "response_item"
                            and kind == "message"
                            and payload.get("role") == "assistant"
                            and payload.get("phase") == "final_answer"
                            and state["active"]
                        ):
                            if payload.get("turn_id", state["turn_id"]) != state["turn_id"]:
                                continue
                            answer = "\n".join(
                                part["text"]
                                for part in payload.get("content", [])
                                if isinstance(part, dict)
                                and part.get("type") == "output_text"
                                and isinstance(part.get("text"), str)
                            )
                            if answer:
                                for delivery in state["active"]:
                                    self.receipts[(actor, delivery)].update(
                                        reply=answer[:16000],
                                        reply_at=event.get("timestamp"),
                                        reply_truncated=len(answer) > 16000,
                                    )
            except OSError:
                state["state"] = "unknown"

    def snapshot(self, actor):
        state = self.states.get(actor, {})
        if not state:
            return {"state": "unknown", "bound": actor in self.bindings}
        result = {
            k: state.get(k) for k in ("state", "observed_at", "thread_id", "last_activity_at")
        }
        result["evidence"] = "recorded_lifecycle"
        result["bound"] = actor in self.bindings
        result["workstation_id"] = state.get("thread_id")
        result["last_known_state"] = state["state"]
        try:
            age = (
                dt.datetime.now(dt.timezone.utc)
                - dt.datetime.fromisoformat(state["last_activity_at"].replace("Z", "+00:00"))
            ).total_seconds()
        except (ValueError, TypeError, KeyError):
            age = None
        result["stale"] = age is None or age > 180
        if result["stale"]:
            result["state"] = "unknown"
        return result


class WakeupChecks:
    """Durable consumption checks; queue acceptance alone is never delivery evidence."""

    PUBLIC = (
        "id", "request_id", "project", "target", "seat_id", "native_session_id", "binding_version",
        "message_id", "state", "reason", "created", "queued_at", "deadline", "observed_at",
        "evidence", "native_event_id", "notice_message_id", "notice_state", "execution_location",
    )

    def __init__(self, app, clock=time.time):
        self.app, self.store, self.clock = app, app.store, clock
        self.lock = threading.RLock()
        self.cursor = 0

    @staticmethod
    def digest(value):
        return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()

    @staticmethod
    def ident(value):
        if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_.:-]{1,100}", value):
            raise Problem("invalid_wakeup_identifier", "唤醒核验编号无效。")
        return value

    @classmethod
    def public(cls, row):
        return {key: row[key] for key in cls.PUBLIC if key in row}

    @staticmethod
    def public_policy(row):
        return {key: row[key] for key in ("project", "enabled", "window_seconds", "leader_actor_id", "updated") if key in row}

    def authorize(self, peer, value):
        access = self.app.agent_access
        session = access.session(peer, value.get("session_id"))
        access.validate_center(peer, session)
        if not access.is_leader(peer):
            raise Problem("wakeup_leader_required", "只有项目领导可以设置或登记唤醒核验。", 403)

    def policy_action(self, peer, value):
        if set(value) != {"request_id", "session_id", "enabled", "window_seconds"}:
            raise Problem("invalid_wakeup_policy", "请提供原会话、请求编号和核验设置。")
        self.authorize(peer, value)
        rid = self.ident(value["request_id"])
        if type(value["enabled"]) is not bool or type(value["window_seconds"]) is not int or not 10 <= value["window_seconds"] <= 300:
            raise Problem("invalid_wakeup_policy", "核验窗口需为10至300秒。")
        row = {"project": peer["project"], "enabled": value["enabled"], "window_seconds": value["window_seconds"],
               "leader_actor_id": peer["actor_id"], "identity": peer["identity"], "updated": self.clock()}
        with self.lock:
            saved = self.store.save_wakeup_policy(peer["actor_id"], rid, self.digest({"project": peer["project"], **value}), row)
        self.app.sync_wake.set()
        return {"policy": self.public_policy(saved)}

    def target_binding(self, seat_id, project):
        with self.store.db() as db:
            row = db.execute(
                "SELECT b.*,c.project FROM agent_station_bindings b JOIN agent_credentials c ON c.actor_id=b.actor_id "
                "WHERE b.seat_id=? AND c.project=? AND c.revoked=0", (seat_id, project)
            ).fetchone()
        if row and row["native_session_id"]:
            return dict(row)
        # Explicit old native bindings stay usable without inventing a transport lease.
        for binding in self.app.config.get("runtime_bindings", []):
            if binding.get("seat_id") == seat_id and binding.get("project") == project and binding.get("thread_id"):
                return {"actor_id": binding["actor_id"], "seat_id": seat_id, "project": project,
                        "native_session_id": binding["thread_id"], "version": 0}
        raise Problem("wakeup_target_missing", "目标工位没有可核验的原生绑定。", 409)

    def source_message(self, peer, message_id):
        if getattr(self.app.hub, "is_local", False):
            with self.app.hub.client.store.db() as db:
                row = db.execute("SELECT id,sender,project FROM messages WHERE id=?", (message_id,)).fetchone()
            row = dict(row) if row else None
        else:
            page = self.app.agent_access.center(peer, "history", query={"project": [peer["project"]],
                    "include_coordination": ["1"], "limit": ["100"]})
            row = next((item for item in page.get("messages", []) if item.get("id") == message_id), None)
        if not row or row["sender"] != peer["actor_id"] or row["project"] not in (peer["project"], "coordination"):
            raise Problem("wakeup_source_denied", "请登记本人在本项目发送的原派单。", 403)

    def rollout_path(self, binding, location):
        if location != "local":
            return None
        configured = next((item for item in self.app.config.get("runtime_bindings", [])
                           if item.get("actor_id") == binding["actor_id"]
                           and item.get("thread_id") == binding["native_session_id"]), None)
        if configured and configured.get("rollout"):
            path = Path(configured["rollout"])
            if path.is_absolute():
                return path
        root = self.app.config.get("runtime_sessions_dir")
        if not isinstance(root, str) or not root or not Path(root).is_absolute():
            return None
        matches = list(islice(Path(root).glob("*/*/*/*" + binding["native_session_id"] + ".jsonl"), 2))
        return matches[0] if len(matches) == 1 else None

    @staticmethod
    def fingerprint(source, offset):
        start = max(0, offset - 4096)
        source.seek(start)
        return hashlib.sha256(source.read(offset - start)).hexdigest()

    def baseline(self, binding, location):
        path = self.rollout_path(binding, location)
        if path is None:
            return {"reason": "remote_evidence_unavailable" if location != "local" else "runtime_unavailable"}
        try:
            with path.open("rb") as source:
                stat = os.fstat(source.fileno())
                meta = json.loads(source.readline(65537))
                if meta.get("type") != "session_meta" or meta.get("payload", {}).get("id") != binding["native_session_id"]:
                    return {"reason": "native_log_mismatch"}
                source.seek(max(0, stat.st_size - 1))
                if source.read(1) != b"\n":
                    return {"reason": "log_incomplete"}
                anchor = self.fingerprint(source, stat.st_size)
                if os.fstat(source.fileno()).st_size != stat.st_size:
                    return {"reason": "log_changed_during_prepare"}
            return {"path": str(path), "offset": stat.st_size, "file_id": [stat.st_dev, stat.st_ino], "anchor": anchor}
        except (OSError, ValueError, TypeError, AttributeError):
            return {"reason": "runtime_unavailable"}

    def prepare(self, peer, value):
        if set(value) != {"request_id", "session_id", "seat_id", "message_id", "input_sha256", "execution_location"}:
            raise Problem("invalid_wakeup_prepare", "请登记原派单、目标工位、原输入摘要和执行位置。")
        self.authorize(peer, value)
        self.source_message(peer, self.ident(value["message_id"]))
        registry = self.app.agent_access.remote(peer["identity"], "registry")
        seat = next((item for item in registry.get("seats", []) if item.get("id") == value["seat_id"]), None)
        if not seat or seat.get("project") != peer["project"] or seat.get("membership_state") == "removed" or seat.get("desired_state") in ("removed", "retired", "archived"):
            raise Problem("wakeup_target_denied", "目标工位必须属于本项目。", 403)
        with self.lock:
            binding = self.target_binding(self.ident(value["seat_id"]), peer["project"])
            if binding["actor_id"] != seat.get("actor_id"):
                raise Problem("wakeup_target_changed", "目标工位绑定已变化。", 409)
            result = self._prepare(peer["actor_id"], peer["project"], value, binding)
        self.app.sync_wake.set()
        return {"check": self.public(result), "queue_performed": False}

    def _prepare(self, sender, project, value, binding):
        policy = self.store.wakeup_policy(project)
        if not policy["enabled"]:
            raise Problem("wakeup_checks_disabled", "项目领导尚未开启唤醒送达核验。", 409)
        rid = self.ident(value["request_id"])
        body_hash, location = value["input_sha256"], value["execution_location"]
        if not isinstance(body_hash, str) or not re.fullmatch(r"[a-f0-9]{64}", body_hash) or location not in ("local", "server", "mobile", "unknown"):
            raise Problem("invalid_wakeup_input", "输入摘要或执行位置无效。")
        check_id = "wake-" + self.digest([sender, project, rid])[:48]
        digest = self.digest({"sender": sender, "project": project, "request_id": rid, "seat_id": binding["seat_id"],
                              "message_id": value["message_id"], "input_sha256": body_hash, "execution_location": location})
        previous = self.store.wakeup_check(check_id)
        if previous:
            if previous["digest"] != digest:
                raise Problem("request_id_conflict", "原唤醒核验编号不能改换输入或目标。", 409)
            return previous
        created = self.clock()
        recent = self.store.wakeup_checks(project)
        if any(item["message_id"] == value["message_id"] and item["target"] == binding["actor_id"]
               and created - item["created"] < 60 for item in recent):
            raise Problem("wakeup_check_cooldown", "同一派单与工位仍在核验冷却期，请查询原编号。", 429)
        row = {"id": check_id, "request_id": rid, "sender": sender, "project": project, "digest": digest,
               "target": binding["actor_id"], "seat_id": binding["seat_id"], "native_session_id": binding["native_session_id"],
               "binding_version": binding["version"], "message_id": value["message_id"], "input_sha256": body_hash,
               "execution_location": location, "created": created, "deadline": created + policy["window_seconds"],
               "window_seconds": policy["window_seconds"], "state": "pending", "reason": "awaiting_queue_commit",
               "baseline": self.baseline(binding, location), "notice_state": "none"}
        return self.store.add_wakeup_check(row)

    def commit(self, peer, value):
        if set(value) != {"request_id", "session_id", "check_id", "queue_id", "thread_id"}:
            raise Problem("invalid_wakeup_commit", "请登记原queue回执及原线程编号。")
        self.authorize(peer, value)
        with self.lock:
            row = self.store.wakeup_check(self.ident(value["check_id"]))
            if not row or row["sender"] != peer["actor_id"] or row["project"] != peer["project"]:
                raise Problem("wakeup_check_missing", "该唤醒核验不属于本人工位。", 404)
            if value["request_id"] != row["request_id"] or value["thread_id"] != row["native_session_id"]:
                raise Problem("wakeup_commit_target_changed", "queue回执必须匹配原请求和原线程。", 409)
            self._commit(row, self.ident(value["queue_id"]))
        self.app.sync_wake.set()
        return {"check": self.public(row), "queue_performed": False}

    def _commit(self, row, queue_id):
        if row.get("queue_id"):
            if row["queue_id"] != queue_id:
                raise Problem("wakeup_commit_conflict", "原核验已登记另一条queue回执。", 409)
            return
        row.update(queue_id=queue_id, queued_at=self.clock(), deadline=self.clock() + row["window_seconds"])
        if row["state"] == "pending":
            row["reason"] = "awaiting_consumption"
        self.store.update_wakeup_check(row)

    def prepare_internal(self, binding, delivery, message_id):
        with self.store.db() as db:
            credential = db.execute("SELECT project FROM agent_credentials WHERE actor_id=? AND revoked=0", (delivery["target"],)).fetchone()
        configured = next((item for item in self.app.config.get("runtime_bindings", []) if item.get("actor_id") == delivery["target"]), {})
        project = credential[0] if credential else configured.get("project")
        if not project or not self.store.wakeup_policy(project)["enabled"]:
            return None
        registry = self.app.hub.registry()
        seat = next((item for item in registry.get("seats", []) if item.get("actor_id") == delivery["target"] and item.get("project") == project), None)
        seat_id = seat["id"] if seat else configured.get("seat_id")
        if not seat_id:
            raise Problem("wakeup_target_missing", "核验已开启，但目标没有原工位；未执行queue。", 409)
        with self.lock:
            target = self.target_binding(seat_id, project)
            if (binding.get("native_session_id") if binding.get("bridge") else binding.get("thread_id")) != target["native_session_id"]:
                raise Problem("wakeup_target_changed", "原投递线程与原生绑定不同；未执行queue。", 409)
            location = configured.get("execution_location")
            if location not in ("local", "server", "mobile", "unknown"):
                location = "local" if not binding.get("bridge") and configured.get("thread_id") == target["native_session_id"] else "unknown"
            value = {"request_id": "internal-" + self.digest(delivery["id"])[:48], "message_id": message_id,
                     "input_sha256": hashlib.sha256(delivery_message(delivery).encode()).hexdigest(),
                     "execution_location": location}
            return self._prepare("local-control", project, value, target)

    def commit_internal(self, row, queue_id):
        if row is not None:
            with self.lock:
                self._commit(row, queue_id)

    def read(self, peer):
        rows = self.store.wakeup_checks(peer["project"])
        if not self.app.agent_access.is_leader(peer):
            rows = [row for row in rows if row["target"] == peer["actor_id"]]
        return {"policy": self.public_policy(self.store.wakeup_policy(peer["project"])), "checks": [self.public(row) for row in rows]}

    def snapshot(self):
        return [self.public(row) for row in self.store.wakeup_checks()]

    def target_ack(self, row):
        if not getattr(self.app.hub, "is_local", False):
            return False
        with self.app.hub.client.store.db() as db:
            receipt = db.execute("SELECT read_at FROM receipts WHERE message_id=? AND actor_id=?",
                                 (row["message_id"], row["target"])).fetchone()
        return bool(receipt and receipt[0] >= row["created"])

    def scan(self, row):
        baseline = row["baseline"]
        if not baseline.get("path"):
            return baseline.get("reason", "runtime_unavailable"), False, False
        try:
            with Path(baseline["path"]).open("rb") as source:
                stat = os.fstat(source.fileno())
                offset = baseline["offset"]
                if [stat.st_dev, stat.st_ino] != baseline["file_id"] or stat.st_size < offset or self.fingerprint(source, offset) != baseline["anchor"]:
                    return "log_discontinuity", False, False
                source.seek(offset)
                used, partial = 0, False
                while used < 262144:
                    limit = min(131073, 262144 - used + 1)
                    line = source.readline(limit)
                    if not line:
                        break
                    if not line.endswith(b"\n"):
                        if len(line) == limit and limit < 131073:
                            break  # Tick budget exhausted; continue at this line next tick.
                        partial = True
                        if len(line) > 131072:
                            return "log_record_too_large", False, False
                        break
                    used += len(line)
                    try:
                        event = json.loads(line)
                    except ValueError:
                        return "log_invalid", False, False
                    if not isinstance(event, dict) or not isinstance(event.get("payload"), dict):
                        return "log_invalid", False, False
                    payload = event["payload"]
                    if event.get("type") == "response_item" and payload.get("type") == "message" and payload.get("role") == "user":
                        content = payload.get("content", [])
                        if not isinstance(content, list):
                            return "log_invalid", False, False
                        texts = [part.get("text", "") for part in content if isinstance(part, dict) and part.get("type") == "input_text"]
                        if all(isinstance(text, str) for text in texts) and hashlib.sha256("".join(texts).encode()).hexdigest() == row["input_sha256"]:
                            row["native_event_id"] = "codex-event:" + hashlib.sha256(line).hexdigest()
                            return "native_exact_input", True, True
                    baseline["offset"] = source.tell()
                caught_up = baseline["offset"] == stat.st_size and not partial
                baseline["anchor"] = self.fingerprint(source, baseline["offset"])
                return "log_incomplete" if partial else "awaiting_consumption", False, caught_up
        except (OSError, ValueError, TypeError, KeyError):
            return "runtime_unavailable", False, False

    def notify(self, row, policy):
        if row.get("notice_message_id") or self.clock() < row.get("next_notice_at", 0):
            return
        label = "未送达" if row["state"] == "undelivered" else "无法判断"
        if "notice_body" not in row:
            row.update(notice_body=("@" + policy["leader_actor_id"] + " 【工位唤醒核验】" + row["seat_id"] + "：" + label
                       + "；原派单 " + row["message_id"] + "；核验 " + row["id"] + "；原因 " + row["reason"]
                       + "。Queued 仅表示受理。请读原核验后决定后续动作，本功能未重发或额外唤醒。"),
                       notice_identity=policy["identity"], notice_state="pending")
            # Persist identical content and sender before the external write, including a crash after acceptance.
            self.store.update_wakeup_check(row)
        try:
            receipt = self.app.agent_access.remote(row.get("notice_identity", policy["identity"]), "message", body={"request_id": "wakeup-notice:" + row["id"],
                    "project": row["project"], "kind": "progress", "reply_to": row["message_id"], "body": row["notice_body"]})
            if not isinstance(receipt.get("id"), str) or not receipt["id"]:
                raise ValueError("notice_unconfirmed")
            row.update(notice_state="stored", notice_message_id=receipt["id"])
        except Exception:
            # Retry only the identical durable notice, never the native queue.
            row.update(notice_state="pending", next_notice_at=self.clock() + 30)

    def tick(self):
        with self.lock:
            rows = self.store.wakeup_checks(observe=True)
            # Bound total per-tick IO as well as each individual log scan.
            if rows:
                offset = self.cursor % len(rows)
                selected = (rows[offset:] + rows[:offset])[:32]
                self.cursor = (offset + len(selected)) % len(rows)
            else:
                selected = []
            for row in selected:
                policy = self.store.wakeup_policy(row["project"])
                if not policy["enabled"]:
                    continue
                previous = self.digest(row)
                try:
                    binding = self.target_binding(row["seat_id"], row["project"])
                    current = binding["actor_id"] == row["target"] and binding["version"] == row["binding_version"] and binding["native_session_id"] == row["native_session_id"]
                except Problem:
                    current = False
                if not current:
                    row.update(state="unknown", reason="native_binding_changed")
                elif row.get("queue_id") and self.target_ack(row):
                    row.update(state="delivered", reason="target_center_ack", evidence="target_center_ack", observed_at=self.clock())
                elif not row.get("queue_id"):
                    if self.clock() >= row["deadline"]:
                        row.update(state="unknown", reason="queue_commit_missing")
                elif self.clock() - row["created"] <= 3600 and row.get("reason") not in ("log_discontinuity", "log_invalid", "log_record_too_large", "native_binding_changed"):
                    reason, delivered, caught_up = self.scan(row)
                    if delivered:
                        row.update(state="delivered", reason=reason, evidence=reason, observed_at=self.clock())
                    elif self.clock() >= row["deadline"]:
                        row.update(state="undelivered" if caught_up else "unknown", reason="no_consumption_in_window" if caught_up else reason)
                    elif reason not in ("awaiting_consumption", "log_incomplete"):
                        row.update(state="unknown", reason=reason)
                if row["state"] in ("unknown", "undelivered"):
                    self.notify(row, policy)
                if self.digest(row) != previous:
                    self.store.update_wakeup_check(row)
