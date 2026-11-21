# @file-map:start
# 文件: link/office/service/watchdog.py
# 位置: 二环·工位服务 | 本机控制、接入、凭据、工位与租约的HTTP服务。
# 约束: 服务绑定本机并核对所有者身份；凭据与工作正文不因短暂失联清空；关闭使用租约排空
# 下游: 无已解析的项目内静态导入
# 上游: 入口/动态加载；参阅链路与目录地图
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: python -X utf8 -B -m unittest discover -s link/office/tests/service
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   utc_now | function
#   iso | function
#   parse_time | function
#   age_seconds | function
#   atomic_write | function
#   safe_code | function
#   _event_timestamp | function
#   _lifecycle_result | function
#   _session_identity | function
#   _continue_recovery | function
#   claude_lifecycle_state | function
#   InstanceLock | class
#   InstanceLock.__init__ | function
#   InstanceLock.close | function
#   lifecycle_state | function
#   read_quota | function
#   remaining_work | function
#   evaluate | function
#   interruption_summary | function
#   continue_ready | function
#   continue_summary | function
#   request_json | function
#   poll_local | function
#   deliver_trigger | function
#   update_delivery | function
#   continue_request_id | function
#   update_continue_delivery | function
#   deliver_continue | function
#   _audit | function
#   observe_continuations | function
#   run_once | function
#   main | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Five-seat liveness watchdog.

This process is deliberately independent from a model turn. It reads only
Codex rollout and Claude hook lifecycle metadata and uses the local Control
gateway for durable, CSRF-protected Trigger and opt-in continue deliveries. It never
reads message text, reasoning, credentials, or kills a process.
"""

from __future__ import annotations

import argparse
import copy
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import threading
import urllib.request


SCHEMA_VERSION = 2
TERMINAL_DELIVERY = {"completed", "interrupted"}
UNKNOWN_DELIVERY = {"unknown"}
CONTINUE_TERMINAL = {"completed", "interrupted", "failed", "cancelled"}
CLAUDE_ACTIVE_EVENTS = {
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "PreCompact",
    "PostCompact",
}
CLAUDE_ERROR_EVENTS = {"PostToolUseFailure", "StopFailure"}
CLAUDE_IDLE_EVENTS = {"SessionStart", "Stop"}
CLAUDE_OFFLINE_EVENTS = {"SessionEnd"}
SAFE_CODE = re.compile(r"^[A-Za-z0-9_.:-]{1,100}$")


# @chain-region utc_now | calls: dt.datetime.now
def utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


# @chain-region iso | calls: (value or utc_now()).isoformat, (value or utc_now()).isoformat().replace, utc_now
def iso(value: dt.datetime | None = None) -> str:
    return (value or utc_now()).isoformat().replace("+00:00", "Z")


# @chain-region parse_time | calls: dt.datetime.fromisoformat, isinstance, value.replace
def parse_time(value: object) -> dt.datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo is not None else None
    except ValueError:
        return None


# @chain-region age_seconds | calls: ((current or utc_now()) - parsed).total_seconds, max, parse_time, utc_now
def age_seconds(value: object, current: dt.datetime | None = None) -> float | None:
    parsed = parse_time(value)
    if parsed is None:
        return None
    return max(0.0, ((current or utc_now()) - parsed).total_seconds())


# @chain-region atomic_write | calls: json.dumps, os.replace, path.parent.mkdir, path.with_name, temporary.write_text
def atomic_write(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


# @chain-region safe_code | calls: SAFE_CODE.fullmatch, isinstance
def safe_code(value: object, fallback: str = "unknown_error") -> str:
    """Keep error/audit fields metadata-only and bounded."""
    if isinstance(value, str) and SAFE_CODE.fullmatch(value):
        return value
    return fallback


# @chain-region _event_timestamp | calls: dt.timedelta, event.get, parse_time
def _event_timestamp(event: dict, current: dt.datetime) -> str | None:
    value = event.get("timestamp")
    parsed = parse_time(value)
    return value if parsed is not None and parsed <= current + dt.timedelta(seconds=60) else None


# @chain-region _lifecycle_result | calls: (previous or {}).get, copy.deepcopy, hashlib.sha256, hashlib.sha256(source.encode('utf-8')).hexdigest, json.dumps, path.resolve, result.get, result.update …
def _lifecycle_result(seat: dict, previous: dict | None, kind: str, path: Path) -> dict:
    # File/session changes must not inherit an old offset or recovery evidence.
    source = json.dumps([kind, str(path.resolve()), seat.get("thread_id"),
                         seat.get("native_session_id"), seat.get("session_id")])
    source_id = hashlib.sha256(source.encode("utf-8")).hexdigest()
    result = copy.deepcopy(previous or {}) if (previous or {}).get("source_id") == source_id else {}
    result.update({
        "source_id": source_id, "seat_id": seat.get("seat_id"),
        "thread_id": seat.get("thread_id"), "label": seat.get("label"), "kind": kind,
        "state": result.get("state", "unknown"), "interruption": result.get("interruption"),
        "continue_target": seat.get("continue_target"),
    })
    if seat.get("native_session_id"):
        result["native_session_id"] = seat["native_session_id"]
    elif kind == "codex" and seat.get("thread_id"):
        result["native_session_id"] = seat["thread_id"]
    if seat.get("session_id"):
        result["session_id"] = seat["session_id"]
    return result


# @chain-region _session_identity | calls: SAFE_CODE.fullmatch, isinstance, seat.get
def _session_identity(seat: dict) -> str | None:
    value = seat.get("native_session_id") or seat.get("session_id") or seat.get("thread_id")
    return value if isinstance(value, str) and SAFE_CODE.fullmatch(value) else None


# @chain-region _continue_recovery | calls: continuation.get, copy.deepcopy, isinstance, parse_time, result.get
def _continue_recovery(result: dict, timestamp: str) -> None:
    """Mark activity after a continue attempt as observed, never as delivery success."""
    continuation = result.get("continue")
    if not isinstance(continuation, dict) or not continuation.get("attempted"):
        return
    attempted = parse_time(continuation.get("attempted_at"))
    activity = parse_time(timestamp)
    if attempted is None or activity is None or activity <= attempted:
        return
    continuation = copy.deepcopy(continuation)
    continuation["recovery_observed_at"] = timestamp
    continuation["result"] = "activity_observed"
    result["continue"] = continuation


# @chain-region claude_lifecycle_state | calls: Path, SAFE_CODE.fullmatch, _continue_recovery, _event_timestamp, _lifecycle_result, age_seconds, event.get, float …
def claude_lifecycle_state(
    seat: dict, previous: dict | None = None, current: dt.datetime | None = None
) -> dict:
    """Read a Claude hook event log containing lifecycle metadata only.

    The hook never writes prompts, transcripts, tool arguments or error text to
    this file. A missing file is unknown evidence; explicit Stop/SessionEnd is
    offline, Stop is idle, a failure event is error, and an old running event is stale.
    """
    current = current or utc_now()
    path = Path(str(seat.get("event_log", "")))
    result = _lifecycle_result(seat, previous, "claude", path)
    if not path.is_file():
        result.update(
            state="unknown",
            interruption=None,
            last_error="event_log_missing",
            observed_at=iso(current),
            silence_seconds=None,
        )
        return result
    try:
        size = path.stat().st_size
        offset = int(result.get("event_offset", 0))
        if offset < 0 or size < offset:
            offset = 0
            result.update(state="unknown", interruption=None)
        with path.open("rb") as source:
            source.seek(offset)
            while True:
                line = source.readline()
                if not line or not line.endswith(b"\n"):
                    break
                offset = source.tell()
                try:
                    event = json.loads(line)
                except (TypeError, ValueError):
                    result.update(state="unknown", interruption=None, last_error="invalid_event_line")
                    continue
                if not isinstance(event, dict):
                    continue
                event_type = event.get("event")
                if event_type not in CLAUDE_ACTIVE_EVENTS | CLAUDE_IDLE_EVENTS | CLAUDE_ERROR_EVENTS | CLAUDE_OFFLINE_EVENTS:
                    continue
                foreign = False
                for key in ("native_session_id", "session_id"):
                    expected = seat.get(key) or result.get(key)
                    actual = event.get(key)
                    if expected and actual != expected:
                        foreign = True
                    if actual is not None and (not isinstance(actual, str) or not SAFE_CODE.fullmatch(actual)):
                        foreign = True
                if foreign:
                    continue
                timestamp = _event_timestamp(event, current)
                if timestamp is None:
                    result.update(state="unknown", interruption=None, last_error="invalid_event_timestamp")
                    continue
                result["last_seen_at"] = timestamp
                result["last_event_type"] = event_type
                result["last_activity_at"] = timestamp
                if isinstance(event.get("native_session_id"), str):
                    result["native_session_id"] = event["native_session_id"]
                if isinstance(event.get("session_id"), str):
                    result["session_id"] = event["session_id"]
                if event_type in CLAUDE_ERROR_EVENTS:
                    result.update(
                        state="error",
                        interruption="error",
                        last_error=safe_code(event.get("error_code"), "claude_hook_failure"),
                        last_error_at=timestamp,
                    )
                elif event_type in CLAUDE_OFFLINE_EVENTS:
                    result.update(state="offline", interruption="offline", last_error=None)
                elif event_type in CLAUDE_IDLE_EVENTS:
                    result.update(state="idle", interruption=None, last_error=None)
                elif event_type in CLAUDE_ACTIVE_EVENTS:
                    result.update(state="running", interruption=None, last_error=None)
                    _continue_recovery(result, timestamp)
    except (OSError, ValueError, TypeError):
        result.update(state="unknown", interruption=None, last_error="event_log_unavailable")
        return result
    result["event_offset"] = offset
    result["observed_at"] = iso(current)
    activity_age = age_seconds(result.get("last_activity_at"), current)
    result["silence_seconds"] = activity_age
    if result.get("state") == "running" and (
        activity_age is None or activity_age > float(seat.get("stale_seconds", 180))
    ):
        result.update(state="stale", interruption="stale", last_error="lifecycle_stale")
    return result


# @chain-region InstanceLock | calls: RuntimeError, fcntl.flock, msvcrt.locking, os.fstat, path.open, path.parent.mkdir, self.file.close, self.file.fileno …
class InstanceLock:
    """Hold an OS file lock so two watchdogs cannot emit duplicate triggers."""

    # @chain-region InstanceLock.__init__ | calls: RuntimeError, fcntl.flock, msvcrt.locking, os.fstat, path.open, path.parent.mkdir, self.file.close, self.file.fileno …
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.file = path.open("a+b")
        try:
            if os.name == "nt":
                import msvcrt

                self.file.seek(0)
                if os.fstat(self.file.fileno()).st_size == 0:
                    self.file.write(b"0")
                    self.file.flush()
                self.file.seek(0)
                msvcrt.locking(self.file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(self.file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self.file.close()
            raise RuntimeError("watchdog_already_running") from None

    # @chain-region InstanceLock.close | calls: self.file.close
    def close(self) -> None:
        self.file.close()


# @chain-region lifecycle_state | calls: Path, _continue_recovery, _event_timestamp, _lifecycle_result, _session_identity, age_seconds, claude_lifecycle_state, event.get …
def lifecycle_state(
    seat: dict, previous: dict | None = None, current: dt.datetime | None = None
) -> dict:
    """Consume only event type/timestamps from one rollout file."""
    if seat.get("kind") == "claude":
        return claude_lifecycle_state(seat, previous, current)
    current = current or utc_now()
    path = Path(str(seat.get("rollout", "")))
    result = _lifecycle_result(seat, previous, "codex", path)
    if not path.is_file():
        result.update(state="unknown", interruption=None, last_error="rollout_missing", observed_at=iso(current))
        return result
    try:
        size = path.stat().st_size
        offset = int(result.get("offset", 0))
        if offset < 0 or size < offset:
            offset = 0
            result.update(state="unknown", interruption=None, turn_id=None)
        with path.open("rb") as source:
            source.seek(offset)
            while True:
                line = source.readline()
                if not line or not line.endswith(b"\n"):
                    break
                offset = source.tell()
                try:
                    event = json.loads(line)
                except (TypeError, ValueError):
                    result.update(state="unknown", interruption=None, last_error="invalid_lifecycle_line")
                    continue
                if not isinstance(event, dict):
                    continue
                event_type = event.get("type")
                payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
                kind = payload.get("type")
                if event_type == "session_meta":
                    native = payload.get("id")
                    if native != _session_identity(result):
                        result.update(state="unknown", interruption=None, last_error="native_session_mismatch")
                        break
                    continue
                if event_type not in {"event_msg", "response_item"}:
                    continue
                timestamp = _event_timestamp(event, current)
                if timestamp is None:
                    result.update(state="unknown", interruption=None, last_error="invalid_event_timestamp")
                    continue
                result["last_activity_at"] = timestamp
                result["last_event_type"] = safe_code(kind or event_type, "unknown_event")
                if event_type == "event_msg" and kind == "task_started":
                    result.update(state="running", interruption=None, last_error=None,
                                  turn_id=safe_code(payload.get("turn_id"), "unknown_turn"))
                    _continue_recovery(result, timestamp)
                elif event_type == "event_msg" and kind in {"error", "task_failed", "turn_failed"}:
                    result.update(state="error", interruption="error", last_error_at=timestamp,
                                  last_error=safe_code(payload.get("error_code"), "codex_failure"))
                elif event_type == "event_msg" and kind in {"session_end", "session_ended", "shutdown"}:
                    result.update(state="offline", interruption="offline", last_error=None, turn_id=None)
                elif event_type == "event_msg" and kind == "turn_aborted":
                    # A user stopping a turn must not be undone by an automatic continue.
                    result.update(state="paused", interruption=None, last_error=None, turn_id=None)
                elif event_type == "event_msg" and kind in {
                    "task_complete",
                    "task_completed",
                }:
                    result.update(state="idle", interruption=None, last_error=None, turn_id=None)
                elif result.get("state") in {"running", "stale", "error"}:
                    result.update(state="running", interruption=None, last_error=None)
                    _continue_recovery(result, timestamp)
    except (OSError, ValueError, TypeError) as error:
        result.update(state="unknown", interruption=None, last_error=type(error).__name__)
        return result
    result["offset"] = offset
    result["observed_at"] = iso(current)
    activity_age = age_seconds(result.get("last_activity_at"), current)
    result["silence_seconds"] = activity_age
    if result.get("state") == "running" and (
        activity_age is None or activity_age > float(seat.get("stale_seconds", 180))
    ):
        result.update(state="stale", interruption="stale", last_error="lifecycle_stale")
    return result


# @chain-region read_quota | calls: Path, age_seconds, config.get, float, isinstance, json.loads, path.is_file, path.read_text …
def read_quota(config: dict, current: dt.datetime | None = None) -> dict:
    current = current or utc_now()
    path = Path(str(config.get("quota_file", "")))
    if not path.is_file():
        return {"state": "unknown", "reason": "quota_evidence_missing", "observed_at": None}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"state": "unknown", "reason": "quota_evidence_invalid", "observed_at": None}
    if not isinstance(value, dict) or value.get("scope") != "sub2_5x_team":
        observed = value.get("observed_at") if isinstance(value, dict) else None
        return {"state": "unknown", "reason": "quota_scope_unverified", "observed_at": observed}
    observed_age = age_seconds(value.get("observed_at"), current)
    if observed_age is None or observed_age > float(config.get("quota_stale_seconds", 300)):
        return {
            "state": "unknown",
            "reason": "quota_evidence_stale",
            "observed_at": value.get("observed_at"),
        }
    if value.get("exhausted") is True and value.get("route_verified") is True:
        return {
            "state": "exhausted",
            "reason": value.get("reason", "verified_zero"),
            "observed_at": value.get("observed_at"),
        }
    if value.get("exhausted") is False:
        return {
            "state": "available",
            "reason": value.get("reason", "verified_available"),
            "observed_at": value.get("observed_at"),
        }
    return {
        "state": "unknown",
        "reason": "quota_exhaustion_not_proven",
        "observed_at": value.get("observed_at"),
    }


# @chain-region remaining_work | calls: config.get, isinstance, snapshot.get, task.get
def remaining_work(snapshot: dict, config: dict) -> bool:
    if config.get("work_remaining") is True:
        return True
    for task in snapshot.get("tasks", []) if isinstance(snapshot, dict) else []:
        if isinstance(task, dict) and task.get("status") in {"planned", "doing", "blocked"}:
            return True
    return False


# @chain-region evaluate | calls: age_seconds, any, config.get, continue_ready, continue_summary, float, interruption_summary, iso …
def evaluate(
    seats: list[dict], snapshot: dict, config: dict, state: dict, current: dt.datetime | None = None
) -> dict:
    current = current or utc_now()
    quota = read_quota(config, current)
    result = {
        "schema_version": SCHEMA_VERSION,
        "observed_at": iso(current),
        "enabled": config.get("enabled") is True,
        "quota": quota,
        "remaining_work": remaining_work(snapshot, config),
        "leader_target": config.get("leader_target"),
        "seats": seats,
        "active_trigger": state.get("active_trigger"),
        "interruptions": interruption_summary(seats),
        "continue_ready": continue_ready(seats, config),
        "continue_attempts": continue_summary(state.get("continue_history", {})),
        "audit": list(state.get("audit", []))[-20:],
        "last_error": None,
    }
    if not result["enabled"]:
        result.update(state="disabled", reason="watchdog_disabled")
        return result
    if quota["state"] == "exhausted":
        result.update(state="quota_exhausted", reason="verified_sub2_5x_zero")
        return result
    if not result["remaining_work"]:
        result.update(state="idle_no_work", reason="no_open_task")
        return result
    if result["active_trigger"]:
        delivery_state = result["active_trigger"].get("delivery_state")
        if delivery_state in UNKNOWN_DELIVERY:
            result.update(state="trigger_unknown", reason="trigger_delivery_unknown")
        elif delivery_state in TERMINAL_DELIVERY:
            result.update(state="cooldown", reason="trigger_completed")
        else:
            result.update(state="trigger_pending", reason="awaiting_leader_receipt")
        return result
    if not seats or any(seat.get("state") != "idle" for seat in seats):
        result.update(state="observing", reason="not_all_seats_explicitly_idle")
        return result
    min_silence = min((seat.get("silence_seconds") or 0) for seat in seats)
    if min_silence < float(config.get("silence_seconds", 60)):
        result.update(state="observing", reason="silence_threshold_not_reached")
        return result
    last_trigger_at = age_seconds(state.get("last_trigger_at"), current)
    if last_trigger_at is not None and last_trigger_at < float(config.get("cooldown_seconds", 300)):
        result.update(state="cooldown", reason="trigger_cooldown")
        return result
    reason = "all_seats_idle_with_open_work"
    if quota["state"] == "unknown":
        reason += "_quota_unknown"
    result.update(state="trigger_ready", reason=reason)
    return result


# @chain-region interruption_summary | calls: copy.deepcopy, rows.append, seat.get
def interruption_summary(seats: list[dict]) -> list[dict]:
    """Return safe per-seat interruption metadata for APIs and Link views."""
    rows = []
    for seat in seats:
        interruption = seat.get("interruption")
        if interruption not in {"stale", "error", "offline"}:
            continue
        rows.append(
            {
                "seat_id": seat.get("seat_id"),
                "kind": seat.get("kind", "codex"),
                "state": seat.get("state"),
                "interruption": interruption,
                "last_activity_at": seat.get("last_activity_at"),
                "last_error_at": seat.get("last_error_at"),
                "last_event_type": seat.get("last_event_type"),
                "silence_seconds": seat.get("silence_seconds"),
                "continue": copy.deepcopy(seat.get("continue")),
            }
        )
    return rows


# @chain-region continue_ready | calls: SAFE_CODE.fullmatch, _session_identity, any, config.get, isinstance, seat.get, seat.get('continue', {}).get
def continue_ready(seats: list[dict], config: dict) -> bool:
    if config.get("enabled") is not True:
        return False
    return any(
        seat.get("kind") in {"claude", "codex"}
        and seat.get("interruption") in {"stale", "error"}
        and isinstance(seat.get("continue_target") or config.get("continue_target"), str)
        and SAFE_CODE.fullmatch(seat.get("continue_target") or config.get("continue_target"))
        and (seat.get("continue_target") or config.get("continue_target")) != "all"
        and _session_identity(seat) is not None
        and not seat.get("continue", {}).get("attempted")
        and seat.get("continue", {}).get("result") not in {
            "cooldown", "awaiting_prior_delivery", "quota_exhausted", "delivery_unavailable"
        }
        for seat in seats
    )


# @chain-region continue_summary | calls: history.values, isinstance, rows.append, value.get
def continue_summary(history: object) -> list[dict]:
    if not isinstance(history, dict):
        return []
    rows = []
    for value in history.values():
        if not isinstance(value, dict):
            continue
        rows.append(
            {
                "seat_id": value.get("seat_id"),
                "request_id": value.get("request_id"),
                "delivery_id": value.get("delivery_id"),
                "delivery_state": value.get("delivery_state"),
                "attempted": value.get("attempted", False),
                "attempted_at": value.get("attempted_at"),
                "result": value.get("result"),
                "failure_code": value.get("failure_code"),
                "recovery_observed_at": value.get("recovery_observed_at"),
                "cooldown_until": value.get("cooldown_until"),
            }
        )
    return rows[-50:]


# @chain-region request_json | calls: RuntimeError, isinstance, json.dumps, json.dumps(data, ensure_ascii=False).encode, json.loads, response.read, response.read().decode, urllib.request.Request …
def request_json(
    url: str, method: str = "GET", data: dict | None = None, headers: dict | None = None
) -> dict:
    body = None if data is None else json.dumps(data, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    with urllib.request.urlopen(request, timeout=20) as response:
        value = json.loads(response.read().decode("utf-8"))
    if not isinstance(value, dict):
        raise RuntimeError("invalid_json_response")
    return value


# @chain-region poll_local | calls: config.get, request_json, session.get, str, str(config.get('base_url', 'http://127.0.0.1:17910')).rstrip
def poll_local(config: dict) -> tuple[dict, dict]:
    base = str(config.get("base_url", "http://127.0.0.1:17910")).rstrip("/")
    session = request_json(base + "/api/session")
    snapshot = request_json(base + "/api/snapshot")
    return snapshot, {"base_url": base, "csrf": session.get("csrf")}


# @chain-region deliver_trigger | calls: RuntimeError, delivery.get, isinstance, iso, request_json, result.get, status.get, str
def deliver_trigger(config: dict, http: dict, status: dict, counter: int) -> dict:
    request_id = f"five-seat-watchdog-trigger-{counter:06d}"
    body = (
        "[Five-seat watchdog Trigger]\n"
        "五个既有工位均已明确 idle，仍有未完成任务。请领导读取 docs/five-seat-plan.md，"
        "核对每席实际回执后分派下一批可验收工作；不要把沉默、入队或未知结果当作完成。"
        f"\nwatchdog_state={status.get('state')} observed_at={status.get('observed_at')}"
    )
    result = request_json(
        str(http["base_url"]) + "/api/chat",
        method="POST",
        data={"request_id": request_id, "target": config["leader_target"], "body": body},
        headers={
            "Content-Type": "application/json",
            "Origin": http["base_url"],
            "X-Control-CSRF": http["csrf"],
        },
    )
    delivery = result.get("delivery")
    if not isinstance(delivery, dict) or not isinstance(delivery.get("id"), str):
        raise RuntimeError("trigger_delivery_missing")
    return {
        "request_id": request_id,
        "delivery_id": delivery["id"],
        "delivery_state": delivery.get("state", "pending"),
        "created_at": iso(),
    }


# @chain-region update_delivery | calls: active.get, copy.deepcopy, isinstance, iso, item.get, snapshot.get
def update_delivery(snapshot: dict, active: dict | None) -> dict | None:
    if not active:
        return None
    delivery_id = active.get("delivery_id")
    for item in snapshot.get("deliveries", []) if isinstance(snapshot, dict) else []:
        if isinstance(item, dict) and item.get("id") == delivery_id:
            active = copy.deepcopy(active)
            active["delivery_state"] = item.get("state", "unknown")
            active["last_checked_at"] = iso()
            return active
    return active


# @chain-region continue_request_id | calls: _session_identity, hashlib.sha256, hashlib.sha256(identity.encode('utf-8')).hexdigest, identity.encode, json.dumps, seat.get
def continue_request_id(seat: dict) -> tuple[str, str]:
    marker = seat.get("last_error_at") if seat.get("interruption") == "error" else seat.get("last_activity_at")
    identity = json.dumps([seat.get("seat_id"), _session_identity(seat), seat.get("interruption"), marker])
    digest = hashlib.sha256(identity.encode("utf-8")).hexdigest()
    return "watchdog-continue-" + digest[:32], digest


# @chain-region update_continue_delivery | calls: attempt.get, copy.deepcopy, isinstance, iso, item.get, snapshot.get
def update_continue_delivery(snapshot: dict, attempt: dict | None) -> dict | None:
    if not attempt or not attempt.get("delivery_id"):
        return attempt
    delivery_id = attempt.get("delivery_id")
    for item in snapshot.get("deliveries", []) if isinstance(snapshot, dict) else []:
        if isinstance(item, dict) and item.get("id") == delivery_id:
            updated = copy.deepcopy(attempt)
            updated["delivery_state"] = item.get("state", "unknown")
            updated["last_checked_at"] = iso()
            return updated
    return attempt


# @chain-region deliver_continue | calls: RuntimeError, SAFE_CODE.fullmatch, _session_identity, config.get, continue_request_id, delivery.get, isinstance, iso …
def deliver_continue(config: dict, http: dict, seat: dict, current: dt.datetime) -> dict:
    request_id, digest = continue_request_id(seat)
    target = seat.get("continue_target") or config.get("continue_target")
    if not isinstance(target, str) or not SAFE_CODE.fullmatch(target) or target == "all":
        raise RuntimeError("continue_target_missing")
    result = request_json(
        str(http["base_url"]) + "/api/chat",
        method="POST",
        data={"request_id": request_id, "target": target, "body": "继续",
              "expected_native_session_id": _session_identity(seat)},
        headers={
            "Content-Type": "application/json",
            "Origin": http["base_url"],
            "X-Control-CSRF": http["csrf"],
        },
    )
    delivery = result.get("delivery")
    if not isinstance(delivery, dict) or not isinstance(delivery.get("id"), str):
        raise RuntimeError("continue_delivery_missing")
    return {
        "seat_id": seat.get("seat_id"),
        "native_session_id": _session_identity(seat),
        "request_id": request_id,
        "request_sha256": digest,
        "delivery_id": delivery["id"],
        "delivery_state": delivery.get("state", "pending"),
        "attempted": True,
        "attempted_at": iso(current),
        "result": "queued",
        "failure_code": None,
        "recovery_observed_at": None,
        "cooldown_until": None,
    }


# @chain-region _audit | calls: entry.get, isinstance, iso, rows.append, safe_code, state.setdefault
def _audit(state: dict, entry: dict) -> None:
    rows = state.setdefault("audit", [])
    if not isinstance(rows, list):
        rows = []
        state["audit"] = rows
    rows.append(
        {
            "at": entry.get("at", iso()),
            "kind": safe_code(entry.get("kind"), "watchdog"),
            "seat_id": entry.get("seat_id"),
            "request_id": entry.get("request_id"),
            "delivery_id": entry.get("delivery_id"),
            "result": safe_code(entry.get("result"), "unknown"),
            "failure_code": safe_code(entry.get("failure_code"), "")
            if entry.get("failure_code")
            else None,
        }
    )
    del rows[:-100]


# @chain-region observe_continuations | calls: SAFE_CODE.fullmatch, _audit, _session_identity, any, attempt.get, attempt.update, config.get, continuation.get …
def observe_continuations(
    config: dict,
    http: dict | None,
    snapshot: dict,
    seats: list[dict],
    state: dict,
    current: dt.datetime,
) -> None:
    """Attempt at most once per interruption identity and retain the audit."""
    history = state.setdefault("continue_history", {})
    if not isinstance(history, dict):
        history = {}
        state["continue_history"] = history
    cooldown = max(0.0, float(config.get("cooldown_seconds", 300)))
    quota_exhausted = read_quota(config, current)["state"] == "exhausted"
    for digest, attempt in list(history.items()):
        if isinstance(attempt, dict):
            updated = update_continue_delivery(snapshot, attempt)
            history[digest] = updated
            if updated.get("delivery_state") != attempt.get("delivery_state"):
                _audit(state, {"kind": "continue_delivery", "seat_id": attempt.get("seat_id"),
                               "request_id": attempt.get("request_id"), "delivery_id": attempt.get("delivery_id"),
                               "result": updated.get("delivery_state")})
    for seat in seats:
        if seat.get("kind") not in {"claude", "codex"}:
            continue
        continuation = seat.get("continue")
        if isinstance(continuation, dict) and continuation.get("request_sha256") in history:
            digest = continuation["request_sha256"]
            attempt = history[digest]
            if continuation.get("recovery_observed_at") and not attempt.get("recovery_observed_at"):
                attempt.update(result="activity_observed", recovery_observed_at=continuation["recovery_observed_at"])
                _audit(state, {"kind": "continue", "seat_id": seat.get("seat_id"),
                               "request_id": attempt.get("request_id"), "result": "activity_observed"})
            seat["continue"] = copy.deepcopy(attempt)
        interruption = seat.get("interruption")
        if interruption not in {"stale", "error", "offline"}:
            continue
        request_id, digest = continue_request_id(seat)
        previous = history.get(digest)
        retriable_observation = isinstance(previous, dict) and config.get("enabled") is True and previous.get(
            "result"
        ) in {"watchdog_disabled", "target_missing", "session_missing", "cooldown",
              "quota_exhausted", "delivery_unavailable", "awaiting_prior_delivery"}
        if isinstance(previous, dict) and not retriable_observation:
            old_marker = (
                previous.get("delivery_state"), previous.get("result"),
                previous.get("recovery_observed_at"), previous.get("failure_code"),
            )
            attempt = update_continue_delivery(snapshot, previous)
            # Preserve one request per interruption identity. The cooldown is
            # kept as auditable metadata while later runs only observe the
            # original delivery and never blindly resend it.
            if attempt.get("attempted") and attempt.get("attempted_at"):
                attempted_at = parse_time(attempt.get("attempted_at"))
                if attempted_at is not None:
                    attempt["cooldown_until"] = iso(
                        attempted_at + dt.timedelta(seconds=cooldown)
                    )
            history[digest] = attempt
            seat["continue"] = copy.deepcopy(attempt)
            new_marker = (
                attempt.get("delivery_state"), attempt.get("result"),
                attempt.get("recovery_observed_at"), attempt.get("failure_code"),
            )
            if new_marker != old_marker:
                _audit(state, {"kind": "continue", "seat_id": seat.get("seat_id"), "result": attempt.get("result")})
            continue
        if interruption == "offline":
            attempt = {
                "seat_id": seat.get("seat_id"),
                "request_id": request_id,
                "request_sha256": digest,
                "delivery_id": None,
                "delivery_state": None,
                "attempted": False,
                "attempted_at": None,
                "result": "ineligible_offline",
                "failure_code": None,
                "recovery_observed_at": None,
                "cooldown_until": None,
            }
            history[digest] = attempt
            seat["continue"] = copy.deepcopy(attempt)
            _audit(state, {"kind": "continue", "seat_id": seat.get("seat_id"), "result": attempt["result"]})
            continue
        if config.get("enabled") is not True:
            attempt = {
                "seat_id": seat.get("seat_id"),
                "request_id": request_id,
                "request_sha256": digest,
                "delivery_id": None,
                "delivery_state": None,
                "attempted": False,
                "attempted_at": None,
                "result": "watchdog_disabled",
                "failure_code": None,
                "recovery_observed_at": None,
                "cooldown_until": None,
            }
            history[digest] = attempt
            seat["continue"] = copy.deepcopy(attempt)
            _audit(state, {"kind": "continue", "seat_id": seat.get("seat_id"), "result": attempt["result"]})
            continue
        target = seat.get("continue_target") or config.get("continue_target")
        if not isinstance(target, str) or not SAFE_CODE.fullmatch(target) or target == "all":
            attempt = {
                "seat_id": seat.get("seat_id"),
                "request_id": request_id,
                "request_sha256": digest,
                "delivery_id": None,
                "delivery_state": None,
                "attempted": False,
                "attempted_at": None,
                "result": "target_missing",
                "failure_code": "continue_target_missing",
                "recovery_observed_at": None,
                "cooldown_until": None,
            }
            history[digest] = attempt
            seat["continue"] = copy.deepcopy(attempt)
            _audit(
                state,
                {
                    "kind": "continue",
                    "seat_id": seat.get("seat_id"),
                    "result": attempt["result"],
                    "failure_code": attempt["failure_code"],
                },
            )
            continue
        native = _session_identity(seat)
        deferred = None
        if native is None:
            deferred = "session_missing"
        elif quota_exhausted:
            deferred = "quota_exhausted"
        elif http is None:
            deferred = "delivery_unavailable"
        prior_attempts = [attempt for attempt in history.values() if isinstance(attempt, dict)
                          and attempt.get("seat_id") == seat.get("seat_id")
                          and attempt.get("native_session_id") == native and attempt.get("attempted")]
        cooldown_until = max((parse_time(attempt.get("attempted_at")) + dt.timedelta(seconds=cooldown)
                              for attempt in prior_attempts if parse_time(attempt.get("attempted_at"))), default=None)
        if not deferred and cooldown_until and current < cooldown_until:
            deferred = "cooldown"
        if not deferred and any(attempt.get("result") != "activity_observed"
                                and attempt.get("delivery_state") not in CONTINUE_TERMINAL for attempt in prior_attempts):
            deferred = "awaiting_prior_delivery"
        if deferred:
            attempt = {"seat_id": seat.get("seat_id"), "native_session_id": native,
                       "request_id": request_id, "request_sha256": digest,
                       "attempted": False, "result": deferred,
                       "cooldown_until": iso(cooldown_until) if cooldown_until else None}
            history[digest] = attempt
            seat["continue"] = copy.deepcopy(attempt)
            if not isinstance(previous, dict) or previous.get("result") != deferred:
                _audit(state, {"kind": "continue", "seat_id": seat.get("seat_id"), "result": deferred})
            continue
        if http is None:
            # The poll failed before delivery; retain the observation for the next run.
            seat["continue"] = {"attempted": False, "result": "delivery_unavailable"}
            continue
        try:
            attempt = deliver_continue(config, http, seat, current)
        except Exception as error:
            attempt = {
                "seat_id": seat.get("seat_id"),
                "native_session_id": native,
                "request_id": request_id,
                "request_sha256": digest,
                "delivery_id": None,
                "delivery_state": "unknown",
                "attempted": True,
                "attempted_at": iso(current),
                "result": "failed",
                "failure_code": safe_code(type(error).__name__),
                "recovery_observed_at": None,
                "cooldown_until": iso(current + dt.timedelta(seconds=cooldown)),
            }
        if attempt.get("attempted") and not attempt.get("cooldown_until"):
            attempt["cooldown_until"] = iso(current + dt.timedelta(seconds=cooldown))
        history[digest] = attempt
        seat["continue"] = copy.deepcopy(attempt)
        _audit(
            state,
            {
                "kind": "continue",
                "seat_id": seat.get("seat_id"),
                "request_id": attempt.get("request_id"),
                "delivery_id": attempt.get("delivery_id"),
                "result": attempt.get("result"),
                "failure_code": attempt.get("failure_code"),
            },
        )


# @chain-region run_once | calls: config.get, continue_ready, continue_summary, deliver_trigger, evaluate, int, interruption_summary, isinstance …
def run_once(config: dict, state: dict) -> dict:
    current = utc_now()
    state = {**(state if isinstance(state, dict) else {})}
    state["schema_version"] = SCHEMA_VERSION
    state.setdefault("continue_history", {})
    state.setdefault("audit", [])
    http = None
    try:
        previous = {
            item.get("seat_id"): item for item in state.get("seats", []) if isinstance(item, dict)
        }
        seats = [
            lifecycle_state(seat, previous.get(seat.get("seat_id")), current)
            for seat in config.get("seats", [])
        ]
        state["seats"] = seats
        poll_error = None
        try:
            snapshot, http = poll_local(config)
        except Exception as error:
            snapshot, poll_error = {}, safe_code(type(error).__name__)
        observe_continuations(config, http, snapshot, seats, state, current)
        status = evaluate(seats, snapshot, config, state, current)
        if state.get("active_trigger"):
            status["active_trigger"] = update_delivery(snapshot, state["active_trigger"])
            state["active_trigger"] = status["active_trigger"]
        if (
            status["state"] == "cooldown"
            and state.get("active_trigger", {}).get("delivery_state") in TERMINAL_DELIVERY
        ):
            state["last_trigger_at"] = state["active_trigger"].get("created_at")
            state["active_trigger"] = None
        if http is not None and status["state"] == "trigger_ready" and not state.get("active_trigger"):
            counter = int(state.get("trigger_count", 0)) + 1
            active = deliver_trigger(config, http, status, counter)
            state.update(
                active_trigger=active, trigger_count=counter, last_trigger_at=active["created_at"]
            )
            status["state"] = "trigger_pending"
            status["reason"] = "trigger_queued"
            status["active_trigger"] = active
        status["trigger_count"] = state.get("trigger_count", 0)
        status["last_trigger_at"] = state.get("last_trigger_at")
        status["active_trigger"] = state.get("active_trigger")
        status["interruptions"] = interruption_summary(seats)
        status["continue_ready"] = continue_ready(seats, config)
        status["continue_attempts"] = continue_summary(state.get("continue_history", {}))
        status["audit"] = list(state.get("audit", []))[-20:]
        status["seats"] = seats
        if poll_error:
            status.update(state="unknown", reason="control_unavailable", last_error=poll_error, continue_ready=False)
        state["last_error"] = poll_error
        state["updated_at"] = iso(current)
        return {"state": state, "status": status}
    except Exception as error:
        state = {**state, "updated_at": iso(current), "last_error": type(error).__name__}
        return {
            "state": state,
            "status": {
                "schema_version": SCHEMA_VERSION,
                "observed_at": iso(current),
                "state": "unknown",
                "reason": type(error).__name__,
                "interruptions": interruption_summary(state.get("seats", [])),
                "continue_ready": continue_ready(state.get("seats", []), config),
                "continue_attempts": continue_summary(state.get("continue_history", {})),
                "audit": list(state.get("audit", []))[-20:],
                "seats": state.get("seats", []),
            },
        }


# @chain-region main | calls: InstanceLock, Path, argparse.ArgumentParser, args.config.read_text, atomic_write, config.get, int, json.dumps …
def main() -> int:
    parser = argparse.ArgumentParser(description="Aieyra Control five-seat lifecycle watchdog")
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    config = json.loads(args.config.read_text(encoding="utf-8-sig"))
    state_path = Path(config.get("state_path", args.config.parent / ".runtime/watchdog/state.json"))
    lock = InstanceLock(Path(config.get("lock_path", str(state_path) + ".lock")))
    stop = threading.Event()
    for signum in (signal.SIGINT, signal.SIGTERM):
        try:
            signal.signal(signum, lambda *_: stop.set())
        except (ValueError, OSError):
            pass
    try:
        try:
            state = (
                json.loads(state_path.read_text(encoding="utf-8"))
                if state_path.is_file()
                else {
                    "schema_version": SCHEMA_VERSION,
                    "trigger_count": 0,
                    "active_trigger": None,
                    "continue_history": {},
                    "audit": [],
                }
            )
        except (OSError, ValueError):
            state = {
                "schema_version": SCHEMA_VERSION,
                "trigger_count": 0,
                "active_trigger": None,
                "continue_history": {},
                "audit": [],
                "last_error": "state_invalid",
            }
        while True:
            result = run_once(config, state)
            state = result["state"]
            atomic_write(state_path, {**state, "status": result["status"]})
            print(json.dumps(result["status"], ensure_ascii=False), flush=True)
            if args.once or stop.wait(max(5, int(config.get("poll_seconds", 30)))):
                break
    finally:
        lock.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
