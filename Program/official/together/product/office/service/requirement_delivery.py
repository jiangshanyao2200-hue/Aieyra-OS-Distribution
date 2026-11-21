# @file-map:start
# 文件: link/office/service/requirement_delivery.py
# 位置: 二环·工位服务 | 本机控制、接入、凭据、工位与租约的HTTP服务。
# 约束: 服务绑定本机并核对所有者身份；凭据与工作正文不因短暂失联清空；关闭使用租约排空
# 下游: 无已解析的项目内静态导入
# 上游: link/office/service/delivery_store.py, link/office/service/hub_client.py, link/office/service/main.py
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: python -X utf8 -B -m unittest discover -s link/office/tests/service
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   canonical | function
#   digest | function
#   now | function
#   RequirementDeliveryError | class
#   RequirementDeliveryError.__init__ | function
#   require | function
#   RequirementDeliveries | class
#   RequirementDeliveries.__init__ | function
#   RequirementDeliveries.check | function
#   RequirementDeliveries.submit | function
#   RequirementDeliveries.record | function
#   RequirementDeliveries.collect | function
#   RequirementDeliveries.sync | function
#   RequirementDeliveries._sync | function
#   RequirementDeliveries.status | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Link explicit requirement dispatch to the existing delivery ledger and queue.

This module records observations. Native execution remains Application.run_queue;
center records never cause an implicit dispatch.
"""

from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import threading
import time

ID = re.compile(r"^[A-Za-z0-9_.:-]{1,100}$")
TERMINAL = {"cancelled", "superseded", "delivered", "accepted"}


# @chain-region canonical | calls: json.dumps
def canonical(value):
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
    )


# @chain-region digest | calls: canonical, canonical(value).encode, hashlib.sha256, hashlib.sha256(canonical(value).encode()).hexdigest
def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


# @chain-region now | calls: datetime.now, datetime.now(timezone.utc).isoformat
def now():
    return datetime.now(timezone.utc).isoformat()


# @chain-region RequirementDeliveryError
class RequirementDeliveryError(Exception):
    # @chain-region RequirementDeliveryError.__init__
    def __init__(self, code, status=409):
        self.code, self.status = code, status


# @chain-region require | calls: RequirementDeliveryError
def require(condition, code, status=409):
    if not condition:
        raise RequirementDeliveryError(code, status)


# @chain-region RequirementDeliveries | calls: ID.fullmatch, Path, Path(data_dir).resolve, RequirementDeliveryError, all, any, binding.get, canonical …
class RequirementDeliveries:
    # @chain-region RequirementDeliveries.__init__ | calls: Path, Path(data_dir).resolve, db.execute, store.db, threading.Lock
    def __init__(self, store, hub, bindings, data_dir):
        self.store, self.hub, self.bindings = store, hub, bindings
        self.evidence_dir = Path(data_dir).resolve() / "intake-evidence"
        self.last_error = None
        self.sync_lock = threading.Lock()
        with store.db() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS intake_observations(
                id TEXT PRIMARY KEY,delivery_id TEXT NOT NULL,payload TEXT NOT NULL,
                state TEXT NOT NULL,response TEXT,error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
                next_attempt REAL NOT NULL DEFAULT 0)""")
            db.execute(
                "UPDATE intake_observations SET state='unknown',error='process_ended_query_original_id' WHERE state='submitting'"
            )

    # @chain-region RequirementDeliveries.check | calls: RequirementDeliveryError, any, binding.get, int, isinstance, item.get, link.get, re.fullmatch …
    def check(self, context):
        binding = self.bindings().get(context["target_actor"])
        require(
            binding and binding.get("thread_id") == context["target_thread_id"],
            "requirement_thread_changed",
        )
        try:
            item = self.hub.intake_read("requirement", {"id": context["requirement_id"]})
            task = self.hub.intake_read("task", {"id": context["task_id"]})
        except Exception as error:
            match = re.fullmatch(r"(401|403|404):([a-z0-9_]{1,100})", str(error))
            if match:
                raise RequirementDeliveryError(
                    match[2], 409 if match[1] == "404" else int(match[1])
                ) from None
            raise RequirementDeliveryError("requirement_current_state_unavailable", 503) from None
        require(
            isinstance(item, dict) and isinstance(task, dict),
            "requirement_current_state_invalid",
            503,
        )
        require(
            item.get("id") == context["requirement_id"]
            and item.get("version") == context["requirement_version"],
            "requirement_version_changed",
        )
        require(item.get("state") == "active", "requirement_not_active")
        require(
            task.get("id") == context["task_id"] and task.get("version") == context["task_version"],
            "requirement_task_version_changed",
        )
        require(task.get("status") not in TERMINAL, "requirement_task_retired_or_delivered")
        require(
            any(
                link.get("task_id") == context["task_id"]
                and context["target_actor"] in link.get("target_actors", [])
                for link in item.get("links", [])
            ),
            "requirement_target_changed",
        )
        require(
            not (
                task.get("owner")
                and task["owner"] != context["target_actor"]
                and task.get("lease_until", 0) > time.time()
            ),
            "requirement_task_owned_by_another_actor",
        )
        return item, task

    # @chain-region RequirementDeliveries.submit | calls: ID.fullmatch, canonical, db.execute, db.execute('SELECT * FROM deliveries WHERE id=?', (value['request_id'],)).fetchone, dict, isinstance, len, require …
    def submit(self, value):
        fields = {
            "request_id",
            "requirement_id",
            "requirement_version",
            "task_id",
            "task_version",
            "target_actor",
            "target_thread_id",
            "body",
        }
        require(
            isinstance(value, dict) and set(value) == fields,
            "invalid_requirement_dispatch_fields",
            400,
        )
        for key in ("request_id", "requirement_id", "task_id", "target_actor", "target_thread_id"):
            require(
                isinstance(value[key], str) and ID.fullmatch(value[key]),
                "invalid_requirement_dispatch_identifier",
                400,
            )
        for key in ("requirement_version", "task_version"):
            require(
                type(value[key]) is int and 0 < value[key] <= 2147483647,
                "invalid_requirement_dispatch_version",
                400,
            )
        require(
            isinstance(value["body"], str) and value["body"].strip() and len(value["body"]) <= 4000,
            "invalid_requirement_dispatch_body",
            400,
        )
        context = {
            key: value[key]
            for key in (
                "requirement_id",
                "requirement_version",
                "task_id",
                "task_version",
                "target_actor",
                "target_thread_id",
            )
        }
        # A retried explicit submission returns its original immutable receipt;
        # it does not depend on later task claims or route revisions.
        with self.store.db() as db:
            existing = db.execute(
                "SELECT * FROM deliveries WHERE id=?", (value["request_id"],)
            ).fetchone()
        if existing:
            require(
                existing["intake_context"] == canonical(context)
                and existing["body"] == value["body"],
                "requirement_dispatch_id_conflict",
            )
            return dict(existing)
        self.check(context)
        return self.store.submit(
            value["request_id"],
            value["target_actor"],
            value["body"],
            value["target_thread_id"],
            context,
        )

    # @chain-region RequirementDeliveries.record | calls: Path, canonical, canonical(evidence).encode, context['target_thread_id'].startswith, db.execute, db.execute('SELECT 1 FROM intake_observations WHERE id=?', (identifier,)).fetchone, delivery.get, dict …
    def record(self, delivery, kind, event_id, observed_at, detail):
        context = json.loads(delivery["intake_context"])
        identifier = "intake-native-" + digest([delivery["id"], kind, event_id])[:56]
        with self.store.db() as db:
            if db.execute("SELECT 1 FROM intake_observations WHERE id=?", (identifier,)).fetchone():
                return
        fact = dict(
            id=identifier,
            requirement_id=context["requirement_id"],
            requirement_version=context["requirement_version"],
            task_id=context["task_id"],
            task_version=context["task_version"],
            target_actor=context["target_actor"],
            delivery_id=delivery["id"],
            thread_ref=(
                context["target_thread_id"]
                if context["target_thread_id"].startswith("bridge:")
                else "codex:" + context["target_thread_id"]
            ),
            kind=kind,
            event_id=event_id,
            observed_at=observed_at,
            body_sha256=delivery["body_sha256"],
            detail=detail,
        )
        if delivery.get("queue_id"):
            fact["queue_id"] = delivery["queue_id"]
        if delivery.get("turn_id"):
            fact["native_turn_id"] = delivery["turn_id"]
        evidence = dict(
            schema_version=1,
            source=(
                "original_control_delivery_and_agent_report"
                if context["target_thread_id"].startswith("bridge:")
                else "original_control_delivery_and_runtime_observer"
            ),
            delivery_id=delivery["id"],
            context=context,
            fact=fact,
        )
        raw = canonical(evidence).encode()
        self.evidence_dir.mkdir(parents=True, exist_ok=True)
        path = self.evidence_dir / (identifier + ".json")
        if path.exists():
            # A crash may occur after durable evidence, before its outbox row.
            # Adopt those exact bytes; later discovery must not rewrite the fact.
            raw = path.read_bytes()
            saved = json.loads(raw)
            require(
                saved.get("schema_version") == 1
                and saved.get("source") == evidence["source"]
                and saved.get("context") == context
                and saved.get("delivery_id") == delivery["id"],
                "intake_evidence_changed",
            )
            old = saved.get("fact", {})
            for key in (
                "id",
                "requirement_id",
                "requirement_version",
                "task_id",
                "task_version",
                "target_actor",
                "delivery_id",
                "thread_ref",
                "kind",
                "event_id",
                "body_sha256",
            ):
                require(old.get(key) == fact[key], "intake_evidence_changed")
            for key in ("queue_id", "native_turn_id"):
                require(key not in old or old[key] == fact.get(key), "intake_evidence_changed")
            fact = old
        else:
            with tempfile.NamedTemporaryFile(dir=self.evidence_dir, delete=False) as output:
                temporary = Path(output.name)
                output.write(raw)
                output.flush()
                os.fsync(output.fileno())
            try:
                os.replace(temporary, path)
            finally:
                temporary.unlink(missing_ok=True)
        fact.update(evidence_ref=str(path), evidence_sha256=hashlib.sha256(raw).hexdigest())
        payload = canonical(dict(request_id=identifier, receipt=fact))
        with self.store.db() as db:
            db.execute(
                "INSERT OR IGNORE INTO intake_observations(id,delivery_id,payload,state,response,error,created_at,updated_at) VALUES(?,?,?,'pending',NULL,NULL,?,?)",
                (identifier, delivery["id"], payload, now(), now()),
            )

    # @chain-region RequirementDeliveries.collect | calls: db.execute, delivery.get, dict, digest, self.record, self.store.db, str, str(delivery.get('target_thread_id', '')).startswith
    def collect(self):
        with self.store.db() as db:
            deliveries = [
                dict(row)
                for row in db.execute(
                    "SELECT * FROM deliveries WHERE intake_context IS NOT NULL AND intake_dirty=1 ORDER BY updated_at LIMIT 50"
                )
            ]
        for delivery in deliveries:
            external = str(delivery.get("target_thread_id", "")).startswith("bridge:")
            if delivery.get("queue_id") and delivery.get("queued_at"):
                self.record(
                    delivery,
                    "dispatched",
                    ("agent-queue:" if external else "codex-queue:") + delivery["queue_id"],
                    delivery["queued_at"],
                    "Control queued the exact payload for the selected external Agent session; not proof of consumption."
                    if external
                    else "Original CLI returned a queue receipt for the fixed thread; not proof of native consumption.",
                )
            if delivery.get("native_event_id") and delivery.get("native_received_at"):
                self.record(
                    delivery,
                    "native_received",
                    delivery["native_event_id"],
                    delivery["native_received_at"],
                    "Authenticated external Agent reported receiving the fixed-session delivery with matching payload hash; agent-reported evidence."
                    if external
                    else "Observed the exact complete delivery marker and UTF-8 message hash in the fixed native thread.",
                )
            if (
                delivery.get("native_start_event_id")
                and delivery.get("native_started_at")
                and delivery.get("turn_id")
            ):
                self.record(
                    delivery,
                    "native_started",
                    delivery["native_start_event_id"],
                    delivery["native_started_at"],
                    "Authenticated external Agent reported starting the fixed delivery; this is not independent execution verification or task acceptance."
                    if external
                    else "Observed task_started for the original turn carrying this delivery; target claim and task acceptance remain separate.",
                )
            if external and delivery["state"] in ("completed", "failed", "interrupted"):
                self.record(
                    delivery,
                    "completed" if delivery["state"] == "completed" else "failed",
                    "agent-final:"
                    + digest([delivery["id"], delivery["state"], delivery.get("reply")])[:48],
                    delivery["updated_at"],
                    "External Agent reported "
                    + delivery["state"]
                    + "; result is available in the original delivery. Independent review and owner acceptance remain separate.",
                )
            if delivery["state"] == "unknown":
                self.record(
                    delivery,
                    "unknown",
                    "control-unknown:" + digest([delivery["id"], delivery.get("error")])[:48],
                    delivery["updated_at"],
                    "Original dispatch or runtime observation is unconfirmed. No native replay.",
                )
            with self.store.db() as db:
                db.execute(
                    "UPDATE deliveries SET intake_dirty=0 WHERE id=? AND updated_at=?",
                    (delivery["id"], delivery["updated_at"]),
                )

    # @chain-region RequirementDeliveries.sync | calls: self._sync, self.sync_lock.acquire, self.sync_lock.release
    def sync(self):
        if not self.sync_lock.acquire(blocking=False):
            return
        try:
            self._sync()
        finally:
            self.sync_lock.release()

    # @chain-region RequirementDeliveries._sync | calls: all, canonical, db.execute, dict, int, isinstance, json.loads, now …
    def _sync(self):
        try:
            self.collect()
        except Exception:
            self.last_error = "intake_local_evidence_unavailable"
            return
        with self.store.db() as db:
            rows = [
                dict(row)
                for row in db.execute(
                    "SELECT * FROM intake_observations WHERE state IN ('pending','unknown') AND next_attempt<=? ORDER BY created_at LIMIT 2",
                    (time.time(),),
                )
            ]
        for row in rows:
            payload = json.loads(row["payload"])
            try:
                response = None
                if row["state"] == "unknown":
                    try:
                        original = self.hub.intake_receipt(row["id"])
                        require(
                            original.get("recorded") is True
                            and original.get("request_id") == row["id"],
                            "intake_original_receipt_unconfirmed",
                            503,
                        )
                        response = original["response"]
                    except Exception as error:
                        # Only this contract's explicit missing receipt permits
                        # an idempotent CENTER-record retry. Never resend queue.
                        if str(error) != "404:intake_receipt_missing":
                            raise
                if response is None:
                    with self.store.db() as db:
                        db.execute(
                            "UPDATE intake_observations SET state='submitting',updated_at=? WHERE id=?",
                            (now(), row["id"]),
                        )
                    response = self.hub.intake_record(payload)
                require(
                    isinstance(response, dict)
                    and all(
                        response.get(key) == value for key, value in payload["receipt"].items()
                    ),
                    "intake_record_response_mismatch",
                )
                with self.store.db() as db:
                    db.execute(
                        "UPDATE intake_observations SET state='recorded',response=?,error=NULL,updated_at=? WHERE id=?",
                        (canonical(response), now(), row["id"]),
                    )
                    self.store.event(
                        db, "requirement_delivery.receipt_recorded", row["delivery_id"]
                    )
                self.last_error = None
            except Exception as error:
                match = re.fullmatch(r"([1-5][0-9]{2}):([a-z0-9_]{1,100})", str(error))
                code = (
                    match[2]
                    if match
                    else error.code
                    if isinstance(error, RequirementDeliveryError)
                    else "intake_record_unknown_query_original_id"
                )
                state = (
                    "rejected"
                    if (
                        (match and int(match[1]) in (400, 401, 403, 409))
                        or (isinstance(error, RequirementDeliveryError) and error.status == 409)
                    )
                    else "unknown"
                )
                with self.store.db() as db:
                    db.execute(
                        "UPDATE intake_observations SET state=?,error=?,updated_at=?,next_attempt=? WHERE id=?",
                        (state, code, now(), time.time() + 30, row["id"]),
                    )
                self.last_error = code

    # @chain-region RequirementDeliveries.status | calls: ID.fullmatch, db.execute, db.execute('SELECT * FROM deliveries WHERE id=? AND intake_context IS NOT NULL', (identifier,)).fetchone, delivery.pop, dict, isinstance, json.loads, require …
    def status(self, identifier):
        require(
            isinstance(identifier, str) and ID.fullmatch(identifier),
            "invalid_requirement_dispatch_identifier",
            400,
        )
        with self.store.db() as db:
            row = db.execute(
                "SELECT * FROM deliveries WHERE id=? AND intake_context IS NOT NULL", (identifier,)
            ).fetchone()
            require(row is not None, "requirement_delivery_missing", 404)
            receipts = [
                dict(x)
                for x in db.execute(
                    "SELECT id,state,error,created_at,updated_at FROM intake_observations WHERE delivery_id=? ORDER BY created_at",
                    (identifier,),
                )
            ]
        delivery = dict(row)
        delivery["intake"] = json.loads(delivery.pop("intake_context"))
        return dict(
            delivery=delivery, receipts=receipts, last_error=self.last_error, replay_allowed=False
        )
