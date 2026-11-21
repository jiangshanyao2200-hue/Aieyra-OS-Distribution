# @file-map:start
# 文件: link/office/service/main.py
# 位置: 二环·工位服务 | 本机控制、接入、凭据、工位与租约的HTTP服务。
# 约束: 服务绑定本机并核对所有者身份；凭据与工作正文不因短暂失联清空；关闭使用租约排空
# 下游: link/office/service/agent_access.py, link/office/service/agent_protocol.py, link/office/service/catalog.py, link/office/service/cloud_link.py, link/office/service/cloud_session.py, link/office/service/collaboration.py, link/office/service/delivery_store.py, link/office/service/device_link.py, link/office/service/discovery.py, link/office/service/evidence.py, link/office/service/feature_stage.py, link/office/service/feedback.py, link/office/service/growth.py, link/office/service/http_drain.py, link/office/service/hub_client.py, link/office/service/human_requests.py, link/office/service/local_hub.py, link/office/service/monitor.py, link/office/service/native_host.py, link/office/service/native_presence.py, link/office/service/office_extensions.py, link/office/service/office_runtime.py, link/office/service/os_owner.py, link/office/service/os_sessions.py, link/office/service/paths.py, link/office/service/product_commands.py, link/office/service/product_jobs.py, link/office/service/project_memory.py, link/office/service/request_intake.py, link/office/service/requirement_delivery.py, link/office/service/runtime_observer.py, link/office/service/self_heal.py, link/office/service/service_common.py, link/office/service/station_keepalive.py, link/office/service/station_notifications.py
# 上游: link/office/service/agent_access.py, link/office/service/link_owner.py
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: python -X utf8 -B -m unittest discover -s link/office/tests/service
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   _public_watchdog_continue | function
#   _public_watchdog_seats | function
#   _public_watchdog_list | function
#   _public_watchdog_interruptions | function
#   validate_resource | function
#   Application | class
#   Application.__init__ | function
#   Application.self_heal_toggle | function
#   Application.sync_project_memory | function
#   Application.refresh_resources | function
#   Application.register_resource | function
#   Application.hub_failure | function
#   Application.brief | function
#   Application.watchdog | function
#   Application.snapshot | function
#   Application.registry | function
#   Application.local_agents | function
#   Application.host_operations | function
#   Application.management | function
#   Application.submit | function
#   Application.delivery_bindings | function
#   Application.delivery_binding | function
#   Application.requirement_current | function
#   Application.run_queue | function
#   Application.dispatch_one | function
#   Application.refresh_hub | function
#   Application._refresh_hub | function
#   Application.wake_workers | function
#   Application.sync_interval | function
#   Application.tick | function
#   Application.run | function
#   Application.cloud_monitor | function
#   Application.monitor | function
#   Application.reconnect_hub | function
#   Application.monitor_collaboration | function
#   Server | class
#   Server.__init__ | function
#   Server.server_close | function
#   Handler | class
#   Handler.log_message | function
#   Handler.setup | function
#   Handler.finish | function
#   Handler.send | function
#   Handler.guard | function
#   Handler.agent_guard | function
#   Handler.agent_get | function
#   Handler.memory_get | function
#   Handler.do_GET | function
#   Handler.do_POST | function
#   Handler.do_POST.unique_object | function
#   Handler.do_POST.invalid_constant | function
#   main | function
#   main.feedback_monitor | function
#   main.finish | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""本机协作客户端网关：中心是共享事实来源，本地保存资源与投递收据。"""

from __future__ import annotations

import argparse
import copy
import datetime as dt
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "runtime"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from service_common import (
    REGISTRY_ACTIONS,
    ID,
    Problem as Problem,
    now as now,
    delivery_message as delivery_message,
)
from http_drain import drain_rejected_body
from feature_stage import release_stage
from delivery_store import Store as Store
from runtime_observer import RuntimeObserver as RuntimeObserver, WakeupChecks
from hub_client import Hub as Hub
from catalog import collect
from monitor import collect_monitors
from evidence import read_brief
from discovery import discover
from collaboration import Projection
from product_commands import ProductCommands, ProductCommandError
from human_requests import HumanRequests, HumanError
from os_sessions import OSSessions
import native_presence
from native_host import NativeHostObserver
from office_runtime import DEFAULT_PORT, InstanceLock, OfficeRuntime
from self_heal import SelfHeal
from product_jobs import ProductJobs
from request_intake import RequestIntake, IntakeError, ROUTES as INTAKE_READS
from requirement_delivery import RequirementDeliveries, RequirementDeliveryError
from agent_access import AgentAccess, AgentError, READS as AGENT_READS, WRITES as AGENT_WRITES
from agent_protocol import openapi as agent_openapi
from station_notifications import StationNotifications
from station_keepalive import StationKeepalive
from project_memory import ProjectMemory, MemoryError
from office_extensions import OfficeExtensions
from cloud_link import CloudLink, CloudError
from device_link import DeviceLink, LinkError
from cloud_session import SessionVault
from feedback import Feedback, FeedbackError
from growth import Growth
from local_hub import create_local_hub
from paths import (
    shared_directory,
    configuration_file,
    external_path,
    initialize as initialize_paths,
    user_storage_base,
)

VERSION = "0.7.1"
ROOT = Path(__file__).resolve().parent.parent
LOCAL_PORTRAITS = {
    "/portraits/iris.png": "frieren.png",
    "/portraits/ember.png": "frieren.png",
    "/portraits/jade.png": "miku.png",
    "/portraits/tide.png": "miku.png",
}


# @chain-region _public_watchdog_continue | calls: isinstance, value.get
def _public_watchdog_continue(value):
    if not isinstance(value, dict):
        return None
    fields = (
        "request_id",
        "delivery_id",
        "delivery_state",
        "attempted",
        "attempted_at",
        "result",
        "failure_code",
        "recovery_observed_at",
        "cooldown_until",
    )
    return {key: value.get(key) for key in fields if key in value}


# @chain-region _public_watchdog_seats | calls: _public_watchdog_continue, isinstance, rows.append, seat.get
def _public_watchdog_seats(value):
    """Project watchdog seats without paths, credentials, prompts or bodies."""
    if not isinstance(value, list):
        return []
    fields = (
        "seat_id",
        "thread_id",
        "label",
        "kind",
        "state",
        "interruption",
        "last_activity_at",
        "last_error_at",
        "last_event_type",
        "silence_seconds",
    )
    rows = []
    for seat in value:
        if not isinstance(seat, dict):
            continue
        row = {key: seat.get(key) for key in fields if key in seat}
        if isinstance(seat.get("continue"), dict):
            row["continue"] = _public_watchdog_continue(seat["continue"])
        rows.append(row)
    return rows


# @chain-region _public_watchdog_list | calls: isinstance
def _public_watchdog_list(value, fields):
    if not isinstance(value, list):
        return []
    return [
        {key: item[key] for key in fields if key in item}
        for item in value
        if isinstance(item, dict)
    ]


# @chain-region _public_watchdog_interruptions | calls: _public_watchdog_continue, isinstance, item.get, rows.append
def _public_watchdog_interruptions(value):
    if not isinstance(value, list):
        return []
    fields = (
        "seat_id",
        "kind",
        "state",
        "interruption",
        "last_activity_at",
        "last_error_at",
        "last_event_type",
        "silence_seconds",
    )
    rows = []
    for item in value:
        if not isinstance(item, dict):
            continue
        row = {key: item.get(key) for key in fields if key in item}
        if isinstance(item.get("continue"), dict):
            row["continue"] = _public_watchdog_continue(item["continue"])
        rows.append(row)
    return rows


# @chain-region validate_resource | calls: ID.fullmatch, Path, Path(row['location']).is_absolute, Problem, isinstance, item.get, item['details'].items, len …
def validate_resource(item):
    if not isinstance(item, dict):
        raise Problem("invalid_resource", "资源需为JSON对象。")
    row = {
        k: str(item.get(k, "")).strip()
        for k in ("id", "name", "kind", "project", "location", "summary")
    }
    if (
        not ID.fullmatch(row["id"])
        or not row["name"]
        or len(row["name"]) > 120
        or len(row["summary"]) > 1000
    ):
        raise Problem("invalid_resource", "请填写有效资源编号、名称和简短说明。")
    if (
        row["kind"] not in ("document", "directory", "repository", "server", "github")
        or not row["location"]
        or len(row["location"]) > 2048
    ):
        raise Problem("invalid_resource", "资源类型或位置无效。")
    if "\n" in row["location"] or "\r" in row["location"]:
        raise Problem("invalid_resource", "资源位置不能换行。")
    if "://" in row["location"]:
        url = urlsplit(row["location"])
        if (
            url.scheme not in (("https", "ssh") if row["kind"] == "server" else ("https",))
            or not url.hostname
            or url.username
            or url.password
            or url.query
            or url.fragment
        ):
            raise Problem("invalid_resource_url", "请填写不含凭据、查询参数的HTTPS资源地址。")
    elif not Path(row["location"]).is_absolute():
        raise Problem("invalid_resource_path", "本地资源需使用绝对路径。")
    row["sensitivity"] = "metadata_only"
    for key in ("source_ref", "source_sha256"):
        if key in item:
            row[key] = str(item[key])[:2048]
    if isinstance(item.get("details"), dict):
        row["details"] = {str(k)[:80]: str(v)[:500] for k, v in list(item["details"].items())[:20]}
    return row


# @chain-region Application | calls: (actor.get('runtime') or {}).get, (dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(metric['observed_at'])).total_seconds, (external or self.observer.bindings[target]).get, AgentAccess, AgentError, CloudLink, DeviceLink, Feedback …
class Application:
    # @chain-region Application.__init__ | calls: AgentAccess, CloudLink, DeviceLink, Feedback, Growth, Hub, HumanRequests, NativeHostObserver …
    def __init__(self, config, data_dir, hub=None, queue_runner=None):
        self.config = config
        self.device_link = DeviceLink(
            data_dir.parent if data_dir.name == "shared" else data_dir, ROOT
        )
        self.cloud = CloudLink(
            vault=SessionVault(
                (data_dir.parent if data_dir.name == "shared" else data_dir) / "config"
            )
        )
        self.store = Store(data_dir / "control.sqlite")
        self.store.recover()
        self.feedback = Feedback(self)
        self.growth = Growth(self)
        self.os_sessions = OSSessions(config, data_dir, ROOT, self.store)
        self.collaboration = Projection(
            self.store, config, source_provider=self.os_sessions.sources
        )
        self.product_commands = ProductCommands(self.os_sessions.sources)
        self.product_jobs = ProductJobs(self.store, self.product_commands)
        self.hub = hub or (
            create_local_hub(config, data_dir, Hub)
            if config.get("coordination_mode", "local") == "local"
            else Hub(config)
        )
        self.intake = RequestIntake(self.hub)
        self.humans = HumanRequests(self.store, self.hub, config, self.product_commands)
        self.observer = RuntimeObserver(config, self.store.delivery)
        self.requirement_deliveries = RequirementDeliveries(
            self.store, self.hub, self.delivery_bindings, data_dir
        )
        self.queue_runner = queue_runner or self.run_queue
        self.lock = threading.RLock()
        self.stop = threading.Event()
        self.native_host = NativeHostObserver(config.get("codex_executable"), self.stop)
        self.sync_wake = threading.Event()
        self.cloud_wake = threading.Event()
        self.feedback_wake = threading.Event()
        self.collaboration_wake = threading.Event()
        self.hub_refresh_lock = threading.Lock()
        self.hub_refreshed_at = 0.0
        self.csrf = secrets.token_urlsafe(32)
        self.hub_snapshot = self.store.cache() or {}
        self.connection = {
            "state": "offline",
            "last_success_at": self.hub_snapshot.get("_fetched_at"),
            "error": "等待连接协作中心",
            "source": "coordination",
        }
        self.resource_rows = []
        self.next_dispatch = 0
        self.next_resource_refresh = 0
        self.delivery_failures = 0
        self.metrics = {}
        self._discovery = None
        self._discovery_at = 0.0
        self.agent_access = AgentAccess(self)
        self.wakeup_checks = WakeupChecks(self)
        self.station_notifications = StationNotifications(self)
        self.station_keepalive = StationKeepalive(self)
        self.project_memory = ProjectMemory(self.store, config.get("local_projects", []))
        self.office = OfficeExtensions(self, data_dir)
        for credential in self.agent_access.listing()["credentials"]:
            if not credential["revoked"]:
                self.project_memory.register({"id": credential["project"]})
        self.sync_project_memory()
        self.self_heal = SelfHeal(self, data_dir)
        configured_watchdog = config.get("watchdog_state_path")
        self.watchdog_state_path = Path(configured_watchdog) if configured_watchdog else None
        with self.store.db() as db:
            for resource in config.get("resources", []):
                row = validate_resource(resource)
                db.execute(
                    "INSERT OR IGNORE INTO resources VALUES(?,?)",
                    (row["id"], json.dumps(row, ensure_ascii=False)),
                )
        self.refresh_resources()

    # @chain-region Application.self_heal_toggle | calls: AgentError, g.get, registry.get, self.agent_access.remote, self.agent_access.session, self.agent_access.validate_center, self.self_heal.set_enabled, set …
    def self_heal_toggle(self, peer, value):
        """工位自愈开关：只有该项目的领导能开关（用户要求时由领导开启）。"""
        if set(value) - {"session_id", "enabled"} or type(value.get("enabled")) is not bool:
            raise AgentError("invalid_self_heal")
        session = self.agent_access.session(peer, value.get("session_id"))
        self.agent_access.validate_center(peer, session)
        registry = self.agent_access.remote(peer["identity"], "registry")
        leaders = {
            g["actor_id"]
            for g in registry.get("governance", [])
            if g.get("active")
            and g.get("role") == "leader"
            and (peer["project"] in g.get("projects", []) or "*" in g.get("projects", []))
        }
        if peer["actor_id"] not in leaders:
            raise AgentError("leader_required", 403)
        return {"self_heal": self.self_heal.set_enabled(value["enabled"], peer["actor_id"])}

    # @chain-region Application.sync_project_memory | calls: getattr, self.hub.registry, self.hub.registry().get, self.project_memory.register
    def sync_project_memory(self, project=None):
        """Project registry owns local metadata; never inspect roots or rewrite revisions."""
        if getattr(self.hub, "is_local", False):
            with self.lock:
                for row in self.hub.registry().get("projects", []):
                    if project is None or row["id"] == project:
                        self.project_memory.register({k: row[k] for k in ("id", "name", "root")})

    # @chain-region Application.refresh_resources | calls: Path, collect, copy.deepcopy, db.execute, dt.datetime.fromtimestamp, dt.datetime.fromtimestamp(stat.st_mtime, dt.timezone.utc).isoformat, json.loads, now …
    def refresh_resources(self):
        with self.store.db() as db:
            rows = [
                json.loads(x[0]) for x in db.execute("SELECT payload FROM resources ORDER BY id")
            ]
        imported, errors = collect(self.config.get("resource_sources", []))
        rows.extend(validate_resource(x) for x in imported)
        for row in rows:
            row.update(observed_at=now(), size=None)
            row["brief_available"] = row["id"] in self.config.get("briefs", {})
            if "://" in row["location"]:
                row["status"] = "registered"
            else:
                path = Path(row["location"])
                try:
                    stat = path.stat()
                    row.update(
                        status="available",
                        size=stat.st_size if path.is_file() else None,
                        modified_at=dt.datetime.fromtimestamp(
                            stat.st_mtime, dt.timezone.utc
                        ).isoformat(),
                    )
                except OSError:
                    row["status"] = "missing"
        with self.lock:
            self.resource_rows = rows
            self.resource_errors = errors
        return copy.deepcopy(rows)

    # @chain-region Application.register_resource | calls: Problem, db.execute, db.execute('SELECT payload FROM resources WHERE id=?', (row['id'],)).fetchone, json.dumps, json.loads, next, self.refresh_resources, self.store.db …
    def register_resource(self, item):
        row = validate_resource(item)
        with self.store.db() as db:
            old = db.execute("SELECT payload FROM resources WHERE id=?", (row["id"],)).fetchone()
            if old and json.loads(old[0]) != row:
                raise Problem("resource_conflict", "该编号已登记其他资源，请换一个编号。", 409)
            db.execute(
                "INSERT OR IGNORE INTO resources VALUES(?,?)",
                (row["id"], json.dumps(row, ensure_ascii=False)),
            )
            self.store.event(db, "resource.registered", row["id"])
        return next(x for x in self.refresh_resources() if x["id"] == row["id"])

    # @chain-region Application.hub_failure | calls: Problem, int, re.fullmatch, str
    @staticmethod
    def hub_failure(error, fallback_code, fallback_message):
        # coord.py deliberately exposes only status:code; preserve safe center
        # conflicts (403/409) for the UI without leaking tracebacks or payloads.
        match = re.fullmatch(r"([1-5][0-9]{2}):([A-Za-z0-9_.-]{1,80})", str(error))
        if match:
            status = int(match[1])
            code = match[2]
            if status in (400, 401, 403, 404, 409, 413, 415, 429):
                return Problem(code, "中心拒绝或未接受该管理请求。", status)
        return Problem(fallback_code, fallback_message, 503)

    # @chain-region Application.brief | calls: Problem, read_brief, self.config.get, self.config.get('briefs', {}).get
    def brief(self, resource_id):
        configuration = self.config.get("briefs", {}).get(resource_id)
        if not configuration:
            raise Problem("brief_not_registered", "该资源未登记可查看的工程简报。", 404)
        try:
            return read_brief(configuration)
        except (OSError, ValueError, TypeError, KeyError):
            raise Problem(
                "brief_unavailable", "简报暂不可用，请检查登记的来源文件。", 503
            ) from None

    # @chain-region Application.watchdog | calls: _public_watchdog_interruptions, _public_watchdog_list, _public_watchdog_seats, isinstance, json.loads, now, self.watchdog_state_path.read_text, status.get …
    def watchdog(self):
        """Return a persisted, metadata-only watchdog state if configured."""
        if self.watchdog_state_path is None:
            return {
                "schema_version": 1,
                "state": "not_configured",
                "enabled": False,
                "observed_at": now(),
                "seats": [],
                "active_trigger": None,
                "interruptions": [],
                "continue_ready": False,
                "continue_attempts": [],
                "audit": [],
            }
        try:
            value = json.loads(self.watchdog_state_path.read_text(encoding="utf-8"))
        except (OSError, ValueError, TypeError):
            return {
                "schema_version": 1,
                "state": "unknown",
                "enabled": None,
                "observed_at": now(),
                "reason": "watchdog_state_unavailable",
                "seats": [],
                "active_trigger": None,
                "interruptions": [],
                "continue_ready": None,
                "continue_attempts": [],
                "audit": [],
            }
        if not isinstance(value, dict):
            return {
                "schema_version": 1,
                "state": "unknown",
                "enabled": None,
                "observed_at": now(),
                "reason": "watchdog_state_invalid",
                "seats": [],
                "active_trigger": None,
                "interruptions": [],
                "continue_ready": None,
                "continue_attempts": [],
                "audit": [],
            }
        status = value.get("status") if isinstance(value.get("status"), dict) else {}
        # The public state contains lifecycle timestamps and IDs only; the
        # watchdog never writes message text, keys, or reasoning into it.
        return {
            "schema_version": value.get("schema_version", 1),
            "state": status.get("state", "unknown"),
            "enabled": status.get("enabled"),
            "observed_at": status.get("observed_at", value.get("updated_at", now())),
            "reason": status.get("reason"),
            "quota": status.get("quota", {"state": "unknown", "reason": "not_reported"}),
            "remaining_work": status.get("remaining_work"),
            "leader_target": status.get("leader_target"),
            "trigger_count": status.get("trigger_count", value.get("trigger_count", 0)),
            "last_trigger_at": status.get("last_trigger_at", value.get("last_trigger_at")),
            "active_trigger": status.get("active_trigger", value.get("active_trigger")),
            "interruptions": _public_watchdog_interruptions(status.get("interruptions")),
            "continue_ready": status.get("continue_ready"),
            "continue_attempts": _public_watchdog_list(
                status.get("continue_attempts"),
                (
                    "seat_id",
                    "request_id",
                    "delivery_id",
                    "delivery_state",
                    "attempted",
                    "attempted_at",
                    "result",
                    "failure_code",
                    "recovery_observed_at",
                    "cooldown_until",
                ),
            )[-50:],
            "audit": _public_watchdog_list(
                status.get("audit"),
                (
                    "at",
                    "kind",
                    "seat_id",
                    "request_id",
                    "delivery_id",
                    "result",
                    "failure_code",
                ),
            )[-20:],
            "seats": _public_watchdog_seats(status.get("seats", [])),
        }

    # @chain-region Application.snapshot | calls: (actor.get('runtime') or {}).get, (dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(metric['observed_at'])).total_seconds, actor.get, agents.append, assignment.get, assignment.update, binding.get, copy.deepcopy …
    def snapshot(self):
        # Local reads observe current leases and committed writes even while the
        # background worker sleeps. Coalesce simultaneous window requests.
        if getattr(self.hub, "is_local", False):
            self.refresh_hub(max_age=1)
        with self.lock:
            value = copy.deepcopy(self.hub_snapshot)
            agents = value.get("agents", [])
            for actor in agents:
                actor["runtime"] = self.observer.snapshot(actor["id"])
                actor["heartbeat_observed_at"] = value.get("_fetched_at")
                if self.connection["state"] != "online":
                    actor["last_known_online"] = actor.get("online")
                    actor["online"] = None
            for actor_id, external in self.agent_access.runtimes().items():
                existing = next((a for a in agents if a["id"] == actor_id), None)
                if existing:
                    existing["runtime"] = external["runtime"]
                else:
                    agents.append({**external, "role": "agent", "online": None})
            # 4.6：站点客户端每次调用完就断开，传输租约看不出谁在干活；
            # 再看一眼工位原生会话文件的活动（只读时间与回合边界）。
            try:
                natives = self.agent_access.native_bindings(include_versions=True)
            except Exception:
                natives = {}
            for actor in agents:
                binding = natives.get(actor["id"]) or {}
                native = binding.get("native_session_id") or (actor.get("runtime") or {}).get(
                    "native_session_id"
                )
                presence = self.native_host.observe(
                    native, actor["id"], binding.get("version")
                ) or native_presence.observe(native)
                if presence:
                    actor["presence"] = presence
            projects = value.get("projects", [])
            known_projects = {item["id"] for item in projects}
            projects.extend(
                copy.deepcopy(item)
                for item in self.config.get("local_projects", [])
                if item["id"] not in known_projects
            )
            governance = copy.deepcopy(self.config.get("governance", {}))
            tasks = {item["id"]: item for item in value.get("tasks", [])}
            for assignment in governance.get("assignments", []):
                task = tasks.get(assignment.get("task_id"))
                if task:
                    assignment.update(
                        status=task["status"],
                        task_owner=task.get("owner"),
                        observed_at=value.get("_fetched_at"),
                    )
            result = {
                "version": VERSION,
                "observed_at": now(),
                "connection": dict(self.connection),
                "projects": projects,
                "agents": agents,
                "tasks": value.get("tasks", []),
                "messages": value.get("messages", []),
                "resources": copy.deepcopy(self.resource_rows),
                "resource_errors": copy.deepcopy(self.resource_errors),
                "watchdog": self.watchdog(),
                "self_heal": self.self_heal.public(),
                "governance": governance,
                "deliveries": self.store.deliveries(),
                "wakeup_checks": self.wakeup_checks.snapshot(),
                "capabilities": {
                    "chat": True,
                    "runtime_dispatch": True,
                    "resource_refresh": True,
                    "resource_register": True,
                    "agent_access": True,
                    "wakeup_consumption_checks": True,
                    "project_memory": True,
                    "mobile_pairing": False,
                    "remote_execution": False,
                },
            }
            for resource in result["resources"]:
                if resource["location"] in self.metrics:
                    metric = copy.deepcopy(self.metrics[resource["location"]])
                    try:
                        age = (
                            dt.datetime.now(dt.timezone.utc)
                            - dt.datetime.fromisoformat(metric["observed_at"])
                        ).total_seconds()
                    except (ValueError, KeyError, TypeError):
                        age = float("inf")
                    if metric.get("state") == "sampled" and age > max(
                        120, self.config.get("monitoring", {}).get("interval_seconds", 60) * 2 + 12
                    ):
                        metric = {key: metric.get(key) for key in ("observed_at", "source")}
                        metric.update(
                            state="unavailable",
                            stale=True,
                            error="采样记录已过期，等待下一次更新。",
                        )
                    resource["metrics"] = metric
        return result

    # @chain-region Application.registry | calls: Problem, dict, isinstance, now, self.agent_access.station_registry, self.hub.registry, self.hub_failure, value.get
    def registry(self):
        try:
            value = self.hub.registry()
        except Exception as error:
            raise self.hub_failure(
                error, "registry_unavailable", "中心工位注册表暂不可用。"
            ) from None
        if (
            not isinstance(value, dict)
            or not isinstance(value.get("hosts"), list)
            or not isinstance(value.get("seats"), list)
        ):
            raise Problem("registry_invalid", "中心返回的工位注册表无效。", 502)
        value["connection"] = dict(self.connection)
        value["observed_at"] = now()
        return self.agent_access.station_registry(value)

    # @chain-region Application.local_agents | calls: copy.deepcopy, discover, time.monotonic
    def local_agents(self):
        with self.lock:
            if self._discovery is not None and time.monotonic() - self._discovery_at < 30:
                return copy.deepcopy(self._discovery)
        value = discover(self.config)
        with self.lock:
            self._discovery = value
            self._discovery_at = time.monotonic()
        return copy.deepcopy(value)

    # @chain-region Application.host_operations | calls: ID.fullmatch, Problem, isinstance, now, self.hub.host_operations, self.hub_failure, value.get
    def host_operations(self, host_id):
        if not isinstance(host_id, str) or not ID.fullmatch(host_id):
            raise Problem("invalid_host_id", "工位主机编号无效。", 400)
        try:
            value = self.hub.host_operations(host_id)
        except Problem:
            raise
        except Exception as error:
            raise self.hub_failure(
                error, "host_operations_unavailable", "主机待处理操作暂不可用。"
            ) from None
        if not isinstance(value, dict) or not isinstance(value.get("operations"), list):
            raise Problem("host_operations_invalid", "中心返回的操作队列无效。", 502)
        value["observed_at"] = now()
        return value

    # @chain-region Application.management | calls: ID.fullmatch, Problem, isinstance, payload.get, self.hub.management, self.hub_failure, self.sync_project_memory
    def management(self, action, payload):
        if action not in REGISTRY_ACTIONS:
            raise Problem("unsupported_management_action", "管理动作不在白名单内。", 400)
        if not isinstance(payload.get("request_id"), str) or not ID.fullmatch(
            payload["request_id"]
        ):
            raise Problem("invalid_request_id", "管理请求必须携带固定 request_id。", 400)
        try:
            result = self.hub.management(action, payload)
            if action == "project-register":
                self.sync_project_memory(payload.get("id"))
            return result
        except Problem:
            raise
        except Exception as error:
            raise self.hub_failure(
                error, "management_unavailable", "中心管理接口暂不可用；未确认写入结果。"
            ) from None

    # @chain-region Application.submit | calls: (external or self.observer.bindings[target]).get, ID.fullmatch, Problem, binding.get, isinstance, self.agent_access.binding, self.agent_access.validate_binding, self.observer.bindings.get …
    def submit(self, value):
        target = value.get("target", "all")
        external = self.agent_access.binding(target) if target != "all" else None
        if target != "all" and target not in self.observer.bindings and not external:
            raise Problem("unbound_runtime", "该工位尚未绑定可投递会话。", 409)
        if external:
            self.agent_access.validate_binding(external)
        expected_native = value.get("expected_native_session_id")
        if expected_native is not None:
            binding = external or self.observer.bindings.get(target, {})
            native = binding.get("native_session_id") or binding.get("thread_id")
            if (
                not isinstance(expected_native, str)
                or not ID.fullmatch(expected_native)
                or target == "all"
                or native != expected_native
            ):
                raise Problem(
                    "native_session_mismatch", "目标原生会话已变化；未投递到新会话。", 409
                )
        thread_id = (
            None
            if target == "all"
            else (external or self.observer.bindings[target]).get("thread_id")
        )
        if target != "all" and (not isinstance(thread_id, str) or not ID.fullmatch(thread_id)):
            raise Problem("unbound_runtime", "该工位尚未绑定有效的目标会话。", 409)
        return self.store.submit(value.get("request_id"), target, value.get("body"), thread_id)

    # @chain-region Application.delivery_bindings | calls: dict, self.agent_access.binding, self.agent_access.runtimes, self.agent_access.runtimes().items
    def delivery_bindings(self):
        bindings = dict(self.observer.bindings)
        for actor, value in self.agent_access.runtimes().items():
            if value["runtime"]["bound"]:
                binding = self.agent_access.binding(actor)
                if binding:
                    bindings[actor] = binding
        return bindings

    # @chain-region Application.delivery_binding | calls: binding.get, delivery.get, delivery_message, delivery_message(delivery).encode, dict, hashlib.sha256, hashlib.sha256(delivery_message(delivery).encode('utf-8')).hexdigest, self.agent_access.binding …
    def delivery_binding(self, delivery):
        binding = (
            self.agent_access.binding(delivery["target"])
            if str(delivery.get("target_thread_id", "")).startswith("bridge:")
            else self.observer.bindings.get(delivery["target"])
        )
        if (
            not delivery.get("target_thread_id")
            or not binding
            or binding.get("thread_id") != delivery["target_thread_id"]
        ):
            self.store.transition(
                delivery["id"],
                "unknown",
                error="原投递缺少固定会话或工位绑定已变化；未向新会话投递，只查询原记录。",
            )
            return None
        if (
            delivery.get("body_sha256")
            and delivery["body_sha256"]
            != hashlib.sha256(delivery_message(delivery).encode("utf-8")).hexdigest()
        ):
            self.store.transition(
                delivery["id"], "unknown", error="投递正文摘要与原意图不符，已停止；未重新投递。"
            )
            return None
        return dict(binding)

    # @chain-region Application.requirement_current | calls: delivery.get, json.loads, self.requirement_deliveries.check, self.store.transition, time.monotonic
    def requirement_current(self, delivery):
        if not delivery.get("intake_context"):
            return True
        try:
            self.requirement_deliveries.check(json.loads(delivery["intake_context"]))
            return True
        except RequirementDeliveryError as error:
            self.store.transition(
                delivery["id"], "pending" if error.status == 503 else "unknown", error=error.code
            )
            if error.status == 503:
                self.next_dispatch = time.monotonic() + 10
            return False

    # @chain-region Application.run_queue | calls: Problem, delivery_message, re.search, subprocess.run
    def run_queue(self, binding, delivery):
        message = delivery_message(delivery)
        result = subprocess.run(
            [
                self.config["codex_executable"],
                "queue",
                "--thread",
                binding["thread_id"],
                "--message",
                message,
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=20,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
        match = re.search(
            r"Queued message ([A-Za-z0-9-]+) for thread ([A-Za-z0-9-]+)", result.stdout
        )
        if result.returncode != 0 or not match or match[2] != binding["thread_id"]:
            raise Problem("queue_unconfirmed", "运行时未返回可核对的队列回执，未自动重发。", 502)
        return match[1]

    # @chain-region Application.dispatch_one | calls: ID.fullmatch, ValueError, binding.get, delivery.get, isinstance, min, now, receipt.get …
    def dispatch_one(self):
        if time.monotonic() < self.next_dispatch:
            return
        delivery = self.store.claim_pending()
        if delivery is None:
            return
        if delivery["target"] != "all" and self.delivery_binding(delivery) is None:
            return
        if str(delivery.get("target_thread_id", "")).startswith("bridge:"):
            binding = self.delivery_binding(delivery)
            if binding is None:
                return
            try:
                self.agent_access.validate_binding(binding)
            except AgentError as error:
                self.store.transition(
                    delivery["id"],
                    "pending" if error.status == 503 else "unknown",
                    error=error.code,
                )
                self.next_dispatch = time.monotonic() + 10
                return
        if not self.requirement_current(delivery):
            return
        try:
            receipt = self.hub.message(delivery)
            if (
                not isinstance(receipt, dict)
                or not isinstance(receipt.get("id"), str)
                or not receipt["id"]
            ):
                raise ValueError("invalid_hub_receipt")
        except Exception:
            # 沿用同一云端request_id，下一次工作循环可对账重试。
            self.store.transition(
                delivery["id"], "pending", error="协作中心暂不可达，已保存在本机待发送。"
            )
            self.delivery_failures += 1
            self.next_dispatch = time.monotonic() + min(60, 2 ** min(self.delivery_failures, 6))
            return
        self.delivery_failures = 0
        self.next_dispatch = 0
        if delivery["target"] == "all":
            self.store.transition(delivery["id"], "stored", message_id=receipt["id"], error=None)
            return
        binding = self.delivery_binding(delivery)
        if binding is None or not self.requirement_current(delivery):
            return
        if binding.get("bridge"):
            try:
                self.agent_access.validate_binding(binding)
                wakeup = self.wakeup_checks.prepare_internal(binding, delivery, receipt["id"])
                self.agent_access.enqueue(binding, delivery, receipt["id"])
                self.wakeup_checks.commit_internal(wakeup, "bridge:" + delivery["id"])
            except (AgentError, Problem) as error:
                self.store.transition(
                    delivery["id"],
                    "pending" if error.status == 503 else "unknown",
                    message_id=receipt["id"],
                    error=error.code,
                )
                self.next_dispatch = time.monotonic() + 10
                return
            return
        self.store.transition(
            delivery["id"], "queue_submitting", message_id=receipt["id"], error=None
        )
        try:
            wakeup = self.wakeup_checks.prepare_internal(binding, delivery, receipt["id"])
            queue_id = self.queue_runner(binding, delivery)
            if not isinstance(queue_id, str) or not ID.fullmatch(queue_id):
                raise ValueError("invalid_queue_receipt")
            self.store.transition(
                delivery["id"], "queued", queue_id=queue_id, queued_at=now(), error=None
            )
            self.wakeup_checks.commit_internal(wakeup, queue_id)
        except Exception:
            self.store.transition(
                delivery["id"], "unknown", error="运行时投递结果待核对，未自动重发。"
            )

    # @chain-region Application.refresh_hub | calls: self._refresh_hub, time.monotonic
    def refresh_hub(self, max_age=0):
        with self.hub_refresh_lock:
            if max_age and time.monotonic() - self.hub_refreshed_at < max_age:
                return
            self._refresh_hub()

    # @chain-region Application._refresh_hub | calls: now, self.connection.update, self.hub.status, self.hub_snapshot.items, self.store.cache, snapshot.items, time.monotonic
    def _refresh_hub(self):
        try:
            snapshot = self.hub.status()
            snapshot["_fetched_at"] = now()
            # Clock-only observations stay in memory. Persist real state changes
            # without repeatedly rewriting the full cached office to SQLite.
            previous = {
                k: v
                for k, v in self.hub_snapshot.items()
                if k not in ("server_time", "_fetched_at")
            }
            current = {k: v for k, v in snapshot.items() if k not in ("server_time", "_fetched_at")}
            if current != previous:
                self.store.cache(snapshot)
            with self.lock:
                self.hub_snapshot = snapshot
                self.connection = {
                    "state": "online",
                    "last_success_at": snapshot["_fetched_at"],
                    "error": None,
                    "source": "coordination",
                }
                self.hub_refreshed_at = time.monotonic()
        except Exception:
            with self.lock:
                self.connection.update(
                    state="offline", error="协作中心暂时不可达，显示最近成功数据。"
                )

    # @chain-region Application.wake_workers | calls: any, event.set, events.append, events.extend, path.startswith
    def wake_workers(self, path=None):
        events = [self.sync_wake]
        if path is None or path.startswith(("/api/cloud/", "/api/agent/v1/cloud/")):
            events.extend((self.cloud_wake, self.feedback_wake))
        if (
            path is None
            or path == "/api/management"
            or any(
                name in path for name in ("human", "product", "seat", "host", "adapter", "project")
            )
        ):
            events.append(self.collaboration_wake)
        for event in events:
            event.set()

    # @chain-region Application.sync_interval | calls: getattr, self.store.deliveries
    def sync_interval(self):
        # External runtime files and outstanding deliveries retain the original
        # latency. The local office otherwise wakes on writes, with a bounded
        # fallback for lease expiry and out-of-process changes.
        if (
            not getattr(self.hub, "is_local", False)
            or self.connection["state"] != "online"
            or self.observer.bindings
            or self.store.deliveries(("pending", "sending", "queued", "received", "unknown"))
        ):
            return 3
        return 30

    # @chain-region Application.tick | calls: any, delivery.get, delivery_message, delivery_message(delivery).encode, dict, evidence.items, hashlib.sha256, hashlib.sha256(delivery_message(delivery).encode()).hexdigest …
    def tick(self):
        self.refresh_hub()
        with self.lock:
            self.observer.observe()
            receipts = dict(self.observer.receipts)
        for delivery in self.store.deliveries(("queued", "received", "unknown")):
            receipt = receipts.get((delivery["target"], delivery["id"]), {})
            state = (
                receipt.get("state")
                if (
                    delivery.get("target_thread_id")
                    and receipt.get("thread_id") == delivery["target_thread_id"]
                    and receipt.get("message_hash")
                    == hashlib.sha256(delivery_message(delivery).encode()).hexdigest()
                )
                else None
            )
            if delivery.get("turn_id") and receipt.get("turn_id") != delivery["turn_id"]:
                continue
            if (
                delivery.get("native_event_id")
                and receipt.get("native_event_id") != delivery["native_event_id"]
            ):
                continue
            evidence = {
                key: receipt[key]
                for key in (
                    "native_event_id",
                    "native_received_at",
                    "native_start_event_id",
                    "native_started_at",
                )
                if receipt.get(key) is not None
            }
            if state and (
                state != delivery["state"]
                or receipt.get("turn_id") != delivery.get("turn_id")
                or any(delivery.get(key) != value for key, value in evidence.items())
            ):
                reply = (
                    {
                        key: receipt[key]
                        for key in ("reply", "reply_at", "reply_truncated")
                        if key in receipt
                    }
                    if state in ("completed", "interrupted")
                    else {}
                )
                self.store.transition(
                    delivery["id"],
                    state,
                    turn_id=receipt.get("turn_id"),
                    error=receipt.get("error"),
                    **reply,
                    **evidence,
                )
        if time.monotonic() >= self.next_resource_refresh:
            self.refresh_resources()
            self.next_resource_refresh = time.monotonic() + 30
        self.dispatch_one()
        self.wakeup_checks.tick()
        self.station_notifications.tick()
        self.station_keepalive.tick()
        self.requirement_deliveries.sync()

    # @chain-region Application.run | calls: self.connection.update, self.stop.is_set, self.sync_interval, self.sync_wake.clear, self.sync_wake.wait, self.tick
    def run(self):
        while not self.stop.is_set():
            self.sync_wake.clear()
            delay = 3
            try:
                self.tick()
                delay = self.sync_interval()
            except Exception:
                with self.lock:
                    self.connection.update(error="本地同步暂时失败，将保留记录并重试。")
            self.sync_wake.wait(delay)

    # @chain-region Application.cloud_monitor | calls: self.cloud.background_check, self.cloud_wake.clear, self.cloud_wake.wait, self.stop.is_set
    def cloud_monitor(self):
        while not self.stop.is_set():
            self.cloud_wake.clear()
            self.cloud.background_check()
            self.cloud_wake.wait(60 if not self.cloud.session else 15)

    # @chain-region Application.monitor | calls: collect_monitors, configuration.get, max, self.config.get, self.stop.is_set, self.stop.wait
    def monitor(self):
        configuration = self.config.get("monitoring")
        if not configuration:
            return
        while not self.stop.is_set():
            try:
                metrics = collect_monitors(configuration)
                with self.lock:
                    self.metrics = metrics
            except Exception:
                pass
            self.stop.wait(max(30, configuration.get("interval_seconds", 60)))

    # @chain-region Application.reconnect_hub | calls: hasattr, self.config.get, self.hub.reconnect, self.stop.wait
    def reconnect_hub(self):
        if not self.config.get("hub_reconnect", False) or not hasattr(self.hub, "reconnect"):
            return
        while not self.stop.wait(30):
            with self.lock:
                offline = self.connection["state"] == "offline"
            if offline:
                try:
                    self.hub.reconnect()
                except Exception:
                    pass
                self.stop.wait(30)

    # @chain-region Application.monitor_collaboration | calls: self.collaboration.poll, self.collaboration_wake.clear, self.collaboration_wake.wait, self.humans.poll, self.os_sessions.refresh, self.product_jobs.poll, self.stop.is_set
    def monitor_collaboration(self):
        while not self.stop.is_set():
            self.collaboration_wake.clear()
            try:
                self.os_sessions.refresh()
                self.collaboration.poll()
                self.humans.poll()
                self.product_jobs.poll()
            except Exception:
                pass
            self.collaboration_wake.wait(
                3
                if self.collaboration.sources
                or self.humans.projects
                or self.product_commands.sources
                else 30
            )


# @chain-region Server | calls: (web_root or ROOT / 'web').resolve, self.app.device_link.close, self.app.device_link.start, str, super, super().__init__, super().server_close
class Server(ThreadingHTTPServer):
    daemon_threads = False
    block_on_close = True

    # @chain-region Server.__init__ | calls: (web_root or ROOT / 'web').resolve, self.app.device_link.start, str, super, super().__init__
    def __init__(self, port, application, web_root=None):
        self.app = application
        self.web_root = (web_root or ROOT / "web").resolve()
        super().__init__(("127.0.0.1", port), Handler)
        self.origin = "http://127.0.0.1:" + str(self.server_address[1])
        self.app.device_link.start(self.origin)

    # @chain-region Server.server_close | calls: self.app.device_link.close, super, super().server_close
    def server_close(self):
        super().server_close()
        self.app.device_link.close()


# @chain-region Handler | calls: (self.server.web_root / ('index.html' if path == '/' else path.lstrip('/'))).resolve, AgentError, CloudError, IntakeError, LOCAL_PORTRAITS.get, LinkError, MemoryError, Problem …
class Handler(BaseHTTPRequestHandler):
    # @chain-region Handler.log_message
    def log_message(self, *args):
        pass

    # @chain-region Handler.setup | calls: self.connection.settimeout, super, super().setup
    def setup(self):
        super().setup()
        self.connection.settimeout(15)

    # @chain-region Handler.finish | calls: drain_rejected_body, super, super().finish
    def finish(self):
        try:
            drain_rejected_body(self)
        finally:
            super().finish()

    # @chain-region Handler.send | calls: isinstance, json.dumps, json.dumps(data, ensure_ascii=False).encode, len, self.end_headers, self.send_header, self.send_response, self.wfile.write …
    def send(self, status, data, content_type="application/json; charset=utf-8"):
        raw = data if isinstance(data, bytes) else json.dumps(data, ensure_ascii=False).encode()
        try:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(raw)))
            if self.close_connection:
                self.send_header("Connection", "close")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header(
                "Content-Security-Policy",
                "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
            )
            self.end_headers()
            self.wfile.write(raw)
        except (ConnectionError, TimeoutError):
            # The operation may already be committed. A disconnected response
            # cannot become a second write_failed response or undo its receipt.
            self.close_connection = True

    # @chain-region Handler.guard | calls: Problem, any, len, secrets.compare_digest, self.headers.get, self.headers.get_all, self.server.origin.removeprefix
    def guard(self, write=False):
        if any(
            len(self.headers.get_all(key, [])) > 1
            for key in (
                "Host",
                "Origin",
                "Sec-Fetch-Site",
                "X-Control-CSRF",
                "Authorization",
                "Content-Length",
                "Content-Type",
                "Transfer-Encoding",
            )
        ):
            raise Problem("duplicate_header", "请求头不能重复。")
        if self.headers.get("Host") != self.server.origin.removeprefix(
            "http://"
        ) or self.headers.get("Origin") not in (None, self.server.origin):
            raise Problem("origin_rejected", "来源不受信任。", 403)
        if self.headers.get("Sec-Fetch-Site") in ("cross-site", "same-site"):
            raise Problem("origin_rejected", "来源不受信任。", 403)
        if write and (
            self.headers.get("Origin") != self.server.origin
            or not secrets.compare_digest(
                self.headers.get("X-Control-CSRF", ""), self.server.app.csrf
            )
        ):
            raise Problem("csrf_rejected", "会话已失效，请刷新后重试。", 403)

    # @chain-region Handler.agent_guard | calls: AgentError, authorization.startswith, self.guard, self.headers.get, self.server.app.agent_access.authenticate
    def agent_guard(self):
        self.guard()
        if self.headers.get("Origin") or self.headers.get("Sec-Fetch-Site"):
            raise AgentError("agent_browser_access_denied", 403)
        authorization = self.headers.get("Authorization", "")
        if not authorization.startswith("Bearer "):
            raise AgentError("agent_unauthorized", 401)
        return self.server.app.agent_access.authenticate(authorization[7:])

    # @chain-region Handler.agent_get | calls: AgentError, access.center, access.inbox, access.require_leader, access.seats, access.session, access.store.db, access.store.delivery …
    def agent_get(self, path, peer):
        access = self.server.app.agent_access
        try:
            query = parse_qs(urlsplit(self.path).query, keep_blank_values=True, max_num_fields=16)
        except ValueError:
            raise AgentError("invalid_agent_query") from None
        if any(len(values) != 1 for values in query.values()):
            raise AgentError("duplicate_query")
        if path == "office":
            return self.server.app.office.status(self.server.origin, peer)
        if path == "office/guide":
            return self.server.app.office.guide(self.server.origin)
        if path == "office/deliveries":
            return self.server.app.office.deliveries(peer, query)
        if path == "info":
            return {
                "protocol": "aieyra-agent/1",
                "actor_id": peer["actor_id"],
                "project": peer["project"],
                "center_reads": sorted(AGENT_READS),
                "center_writes": sorted(AGENT_WRITES),
                "os_primary": True,
                "office": {
                    "status": "office",
                    "guide": "office/guide",
                    "deliveries": "office/deliveries",
                    "writes": [
                        "reload",
                        "check",
                        "send",
                        "ack",
                        "archive",
                        "verify-archive",
                        "organize",
                    ],
                    "protocol": "aieyra-office-adapter/1",
                    "verification": ["self", "peer_in", "peer_out"],
                    "automatic_replay": False,
                },
                "link": {
                    "tool": "aieyra_link",
                    "route": "link",
                    "authorization": "owner_grants_selected_sessions",
                    "automatic_replay": False,
                },
                "center_stream": {
                    "scope": "project_view",
                    "epoch": "persistent_database_and_view"
                    if getattr(self.server.app.hub, "is_local", False)
                    else "unavailable",
                    "expected_epoch_query": "stream_epoch",
                    "automatic_cursor_reset": False,
                },
                "lease_seconds": 90,
                "heartbeat_runtime_states": [
                    "idle",
                    "running",
                    "paused",
                    "waiting_user",
                    "unknown",
                ],
                "openapi": "/api/agent-openapi",
                "leader_notifications": {
                    "submit": "station/notify-leader",
                    "read": "station/notifications",
                    "ack": "station/notification-ack",
                    "native_wakeup": "configured_leaders_only",
                    "delivery_is_not_read_or_handled": True,
                    "cursor_pagination": True,
                    "sent_history": True,
                    "previous_binding_review": "explicit_current_version_and_reason",
                },
                "project_memory": {
                    "read": "memory?project=" + peer["project"],
                    "write": "memory",
                    "history": "memory?project=" + peer["project"] + "&history=1",
                    "storage": "local_control",
                    "conditional_read": "version_and_sha256",
                },
            }
        if path == "cloud/status":
            return self.server.app.cloud.status()
        if path == "cloud/growth":
            return self.server.app.growth.status(peer)
        if path == "cloud/community":
            return self.server.app.cloud.call("/v1/community")
        if path == "cloud/feedback":
            access.require_leader(peer)
            return self.server.app.feedback.list(peer)
        if path == "memory":
            project = query.get("project", [peer["project"]])[0]
            if project != peer["project"]:
                raise AgentError("memory_project_denied", 403)
            return self.memory_get(query, project)
        if path == "seats":
            return access.seats(peer)
        if path == "station/wakeup-checks":
            if query:
                raise AgentError("invalid_wakeup_query")
            return self.server.app.wakeup_checks.read(peer)
        if path == "station/keepalive":
            if query:
                raise AgentError("invalid_keepalive_query")
            return self.server.app.station_keepalive.read(peer)
        if path == "station/notifications":
            return self.server.app.station_notifications.read(
                peer, query={k: v[0] for k, v in query.items()}
            )
        if path.startswith("station/notifications/"):
            return self.server.app.station_notifications.read(
                peer, path[22:], query={k: v[0] for k, v in query.items()}
            )
        if path == "inbox":
            if set(query) != {"session_id"}:
                raise AgentError("session_id_required")
            return access.inbox(peer, query["session_id"][0])
        if path.startswith("sessions/"):
            return {"session": access.session(peer, path[9:], False)}
        if path.startswith("deliveries/"):
            row = access.store.delivery(path[11:])
            if (
                not row
                or row["target"] != peer["actor_id"]
                or not str(row.get("target_thread_id", "")).startswith("bridge:")
            ):
                raise AgentError("agent_delivery_missing", 404)
            session = access.session(peer, row["target_thread_id"][7:], False)
            return {
                "delivery": row,
                "session_state": session["state"],
                "evidence_source": "agent_report",
            }
        if path.startswith("requests/"):
            with access.store.db() as db:
                row = db.execute(
                    "SELECT response FROM agent_requests WHERE credential_id=? AND id=?",
                    (peer["id"], path[9:]),
                ).fetchone()
            if not row:
                raise AgentError("agent_request_missing", 404)
            return {"receipt": json.loads(row["response"]), "replay_allowed": False}
        if path.startswith("center/"):
            return access.center(peer, path[7:], query=query)
        raise AgentError("agent_route_not_supported", 404)

    # @chain-region Handler.memory_get | calls: MemoryError, ValueError, any, int, len, memory.history, memory.listing, memory.read …
    def memory_get(self, query, project=None):
        if set(query) - {
            "project",
            "version",
            "history",
            "before",
            "if_version",
            "if_sha256",
        } or any(len(v) != 1 for v in query.values()):
            raise MemoryError("invalid_memory_query")
        memory = self.server.app.project_memory
        project = project or query.get("project", [""])[0]
        if not project:
            if query:
                raise MemoryError("memory_project_required")
            return memory.listing()
        try:
            if "if_version" in query or "if_sha256" in query:
                if (
                    not {"if_version", "if_sha256"} <= set(query)
                    or {"version", "history", "before"} & set(query)
                    or not re.fullmatch(r"[1-9][0-9]{0,9}", query["if_version"][0])
                ):
                    raise ValueError()
                return memory.read(
                    project,
                    if_version=int(query["if_version"][0]),
                    if_sha256=query["if_sha256"][0],
                )
            if "history" in query:
                if query["history"] != ["1"] or "version" in query:
                    raise ValueError()
                return memory.history(
                    project, int(query["before"][0]) if "before" in query else None
                )
            if "before" in query:
                raise ValueError()
            return memory.read(project, int(query["version"][0]) if "version" in query else None)
        except ValueError:
            raise MemoryError("invalid_memory_query") from None

    # @chain-region Handler.do_GET | calls: (self.server.web_root / ('index.html' if path == '/' else path.lstrip('/'))).resolve, AgentError, IntakeError, LOCAL_PORTRAITS.get, MemoryError, Problem, RequirementDeliveryError, ValueError …
    def do_GET(self):
        try:
            self.guard()
            path = unquote(urlsplit(self.path).path)
            if path.startswith("/api/agent/v1/"):
                return self.send(200, self.agent_get(path[14:], self.agent_guard()))
            if self.headers.get("Authorization"):
                raise AgentError("agent_token_wrong_endpoint", 403)
            if path == "/api/features":
                return self.send(200, release_stage())
            if path == "/api/office":
                return self.send(200, self.server.app.office.status(self.server.origin))
            if path == "/api/office/guide":
                return self.send(200, self.server.app.office.guide(self.server.origin))
            if path == "/api/agent-access":
                return self.send(200, self.server.app.agent_access.listing())
            if path == "/api/cloud":
                return self.send(200, self.server.app.cloud.status())
            if path == "/api/link":
                return self.send(200, self.server.app.device_link.status())
            if path == "/api/link/view":
                query = parse_qs(
                    urlsplit(self.path).query, keep_blank_values=True, max_num_fields=4
                )
                return self.send(200, self.server.app.device_link.view(query))
            if path == "/api/project-memory":
                try:
                    query = parse_qs(
                        urlsplit(self.path).query, keep_blank_values=True, max_num_fields=6
                    )
                except ValueError:
                    raise MemoryError("invalid_memory_query") from None
                return self.send(200, self.memory_get(query))
            if path == "/api/agent-openapi":
                return self.send(200, agent_openapi(self.server.origin))
            if path in ("/api/health", "/health"):
                return self.send(
                    200,
                    {
                        "service": "aieyra-together-link",
                        "version": VERSION,
                        "os_managed": bool(getattr(self.server.app, "os_owner", None)),
                        "owner_kind": getattr(self.server.app, "owner_kind", "os"),
                        "profile_scope": getattr(self.server.app, "profile_scope", ""),
                    },
                )
            if path == "/api/session":
                return self.send(200, {"csrf": self.server.app.csrf, "version": VERSION})
            if path == "/api/snapshot":
                return self.send(200, self.server.app.snapshot())
            if path == "/api/chat-history":
                try:
                    query = parse_qs(
                        urlsplit(self.path).query, keep_blank_values=True, max_num_fields=1
                    )
                    if set(query) - {"before"} or any(len(v) != 1 for v in query.values()):
                        raise ValueError("query")
                    raw = query.get("before", [None])[0]
                    if raw is not None and not re.fullmatch(r"[1-9][0-9]{0,18}", raw):
                        raise ValueError("cursor")
                    before = int(raw) if raw else None
                    if before is not None and before > 9223372036854775807:
                        raise ValueError("cursor")
                except ValueError:
                    raise Problem("invalid_chat_cursor", "聊天历史游标无效。") from None
                try:
                    return self.send(200, self.server.app.hub.chat_history(before))
                except Exception as error:
                    raise self.server.app.hub_failure(
                        error, "chat_history_unavailable", "群聊记录暂时无法读取。"
                    ) from None
            match = re.fullmatch(r"/api/deliveries/([A-Za-z0-9_.:-]{1,128})", path)
            if match:
                delivery = self.server.app.store.delivery(match[1])
                if delivery is None:
                    raise Problem("delivery_not_found", "尚未查到这条请求。", 404)
                return self.send(200, {"delivery": delivery})
            if path == "/api/requirement-dispatch":
                try:
                    query = parse_qs(
                        urlsplit(self.path).query, keep_blank_values=True, max_num_fields=2
                    )
                except ValueError:
                    raise RequirementDeliveryError(
                        "invalid_requirement_dispatch_query", 400
                    ) from None
                if set(query) != {"request_id"} or len(query["request_id"]) != 1:
                    raise RequirementDeliveryError("invalid_requirement_dispatch_query", 400)
                return self.send(
                    200, self.server.app.requirement_deliveries.status(query["request_id"][0])
                )
            if path.startswith("/api/") and path[5:] in INTAKE_READS:
                try:
                    query = parse_qs(
                        urlsplit(self.path).query, keep_blank_values=True, max_num_fields=16
                    )
                except ValueError:
                    raise IntakeError("invalid_intake_query") from None
                return self.send(200, self.server.app.intake.read(path[5:], query))
            if path == "/api/collaboration":
                return self.send(200, self.server.app.collaboration.snapshot())
            if path == "/api/product-jobs":
                return self.send(200, self.server.app.product_jobs.snapshot())
            if path in ("/api/collaboration/command", "/api/collaboration/matrix"):
                query = parse_qs(urlsplit(self.path).query)
                source = query.get("source_id", [""])[0]
                commands = self.server.app.product_commands
                result = (
                    commands.matrix_status(source)
                    if path.endswith("/matrix")
                    else commands.status(source, query.get("request_id", [""])[0])
                )
                return self.send(200, result)
            if path == "/api/human-requests":
                return self.send(200, self.server.app.humans.snapshot())
            match = re.fullmatch(r"/api/human-requests/([A-Za-z0-9_.:-]{1,100})", path)
            if match:
                return self.send(200, self.server.app.humans.detail(match[1]))
            match = re.fullmatch(r"/api/human-decisions/([A-Za-z0-9_.:-]{1,100})", path)
            if match:
                return self.send(200, self.server.app.humans.decision_status(match[1]))
            if path == "/api/registry":
                return self.send(200, self.server.app.registry())
            if path == "/api/local-agents":
                return self.send(200, self.server.app.local_agents())
            if path == "/api/host-operations":
                host_id = parse_qs(urlsplit(self.path).query).get("host_id", [""])[0]
                return self.send(200, self.server.app.host_operations(host_id))
            if path == "/api/watchdog":
                return self.send(200, self.server.app.watchdog())
            match = re.fullmatch(r"/api/resources/([A-Za-z0-9_.:-]{1,100})/brief", path)
            if match:
                return self.send(200, self.server.app.brief(match[1]))
            if path == "/api/events":
                try:
                    after = max(0, int(parse_qs(urlsplit(self.path).query).get("after", ["0"])[0]))
                except ValueError:
                    raise Problem("invalid_cursor", "事件游标无效。")
                with self.server.app.store.db() as db:
                    rows = [
                        dict(x)
                        for x in db.execute(
                            "SELECT * FROM events WHERE seq>? ORDER BY seq LIMIT 100", (after,)
                        )
                    ]
                return self.send(
                    200, {"events": rows, "next_cursor": rows[-1]["seq"] if rows else after}
                )
            if path.startswith("/api/"):
                raise Problem("not_found", "接口不存在。", 404)
            # Exact public UI assets only; no general Desktop directory route.
            shared_ui = {
                "/ui-foundation.css": ("ui-foundation.css", "text/css"),
                "/ui-ticker.mjs": ("ticker.mjs", "text/javascript"),
                "/motion.mjs": ("motion.mjs", "text/javascript"),
                "/tooltip.mjs": ("tooltip.mjs", "text/javascript"),
                "/tooltip-content.mjs": ("tooltip-content.mjs", "text/javascript"),
                "/model-card.mjs": ("model-card.mjs", "text/javascript"),
                "/preview-card.mjs": ("preview-card.mjs", "text/javascript"),
            }.get(path)
            if shared_ui:
                name, kind = shared_ui
                asset = self.server.web_root / path.lstrip("/")
                if not asset.is_file():
                    raise Problem("not_found", "界面资源暂不可用。", 404)
                return self.send(200, asset.read_bytes(), kind + "; charset=utf-8")
            if (portrait := LOCAL_PORTRAITS.get(path)) is not None:
                folder = user_storage_base() / "Aieyra Together Link" / "portraits"
                asset = folder / portrait
                try:
                    if not asset.is_symlink() and asset.is_file():
                        with asset.open("rb") as source:
                            image = source.read(262145)
                        if len(image) <= 262144 and image.startswith(b"\x89PNG\r\n\x1a\n"):
                            return self.send(200, image, "image/png")
                except OSError:
                    pass
            file = (
                self.server.web_root / ("index.html" if path == "/" else path.lstrip("/"))
            ).resolve()
            if not file.is_relative_to(self.server.web_root) or not file.is_file():
                raise Problem("not_found", "页面尚未就绪或不存在。", 404)
            # Windows registry associations can label .mjs as text/plain.
            # ES modules require a JavaScript MIME type regardless of host defaults.
            kind = (
                "text/javascript"
                if file.suffix.lower() in {".js", ".mjs"}
                else mimetypes.guess_type(str(file))[0] or "application/octet-stream"
            )
            return self.send(
                200,
                file.read_bytes(),
                kind
                + (
                    "; charset=utf-8"
                    if kind.startswith("text/") or kind == "application/javascript"
                    else ""
                ),
            )
        except (CloudError, FeedbackError, LinkError) as error:
            self.send(error.status, {"error": error.code, "code": error.code})
        except MemoryError as error:
            self.send(
                error.status, {"code": error.code, "error": error.code, "replay_allowed": False}
            )
        except AgentError as error:
            self.send(
                error.status, {"code": error.code, "error": error.code, "replay_allowed": False}
            )
        except RequirementDeliveryError as error:
            self.send(
                error.status,
                {
                    "error": "需求投递状态未确认，请查询原请求。",
                    "code": error.code,
                    "replay_allowed": False,
                },
            )
        except IntakeError as error:
            self.send(
                error.status,
                {
                    "error": "需求入口暂不可读取，请保留原记录并查询。",
                    "code": error.code,
                    "available": False,
                    "stale": True,
                },
            )
        except HumanError as error:
            self.send(
                error.status, {"error": "人工事项状态未确认，请查询原请求。", "code": error.code}
            )
        except ProductCommandError as error:
            self.send(409, {"error": "产品动作状态未确认，请查看原请求记录。", "code": str(error)})
        except Problem as error:
            self.send(error.status, {"error": error.message, "code": error.code})
        except (ConnectionError, TimeoutError):
            self.close_connection = True
        except Exception:
            self.send(500, {"error": "读取失败，请稍后重试。", "code": "read_failed"})

    # @chain-region Handler.do_POST | calls: AgentError, CloudError, LinkError, Problem, ValueError, access.session, access.validate_center, action.startswith …
    def do_POST(self):
        self._unread_post_body = True
        authorized = False
        try:
            path = urlsplit(self.path).path
            self.guard()
            peer = self.agent_guard() if path.startswith("/api/agent/v1/") else None
            if peer is None:
                if self.headers.get("Authorization"):
                    raise AgentError("agent_token_wrong_endpoint", 403)
                self.guard(write=True)
            if urlsplit(self.path).query:
                raise Problem("unexpected_query", "写入接口不接受查询参数。")
            if (
                self.headers.get("Transfer-Encoding")
                or self.headers.get_content_type() != "application/json"
            ):
                raise Problem("json_required", "请使用JSON请求。")
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                raise Problem("invalid_length", "请求长度无效。")
            if not 0 < length <= 32768:
                raise Problem("body_limit", "请求过长。", 413)
            raw = self.rfile.read(length)
            self._unread_post_body = False
            if len(raw) != length:
                raise Problem("incomplete_body", "请求内容未完整送达。")

            # @chain-region Handler.do_POST.unique_object | calls: ValueError
            def unique_object(pairs):
                value = {}
                for key, item in pairs:
                    if key in value:
                        raise ValueError("duplicate_json_key")
                    value[key] = item
                return value

            # @chain-region Handler.do_POST.invalid_constant | calls: ValueError
            def invalid_constant(value):
                raise ValueError("nonfinite_json_number")

            value = json.loads(
                raw, object_pairs_hook=unique_object, parse_constant=invalid_constant
            )
            if not isinstance(value, dict):
                raise Problem("invalid_json", "请求需为JSON对象。")
            authorized = True
            if peer:
                action = path[14:]
                if action.startswith("office/"):
                    return self.send(200, self.server.app.office.agent(peer, action[7:], value))
                if action == "link":
                    access = self.server.app.agent_access
                    session = access.session(peer, value.get("session_id"))
                    access.validate_center(peer, session)
                    return self.send(200, self.server.app.device_link.agent_action(peer, value))
                if action in (
                    "station/wakeup-policy",
                    "station/wakeup-prepare",
                    "station/wakeup-commit",
                ):
                    checks = self.server.app.wakeup_checks
                    method = {
                        "station/wakeup-policy": checks.policy_action,
                        "station/wakeup-prepare": checks.prepare,
                        "station/wakeup-commit": checks.commit,
                    }[action]
                    return self.send(200, method(peer, value))
                if action == "station/self-heal":
                    return self.send(200, self.server.app.self_heal_toggle(peer, value))
                if action == "station/keepalive":
                    return self.send(200, self.server.app.station_keepalive.action(peer, value))
                result = (
                    self.server.app.station_notifications.submit(peer, value)
                    if action == "station/notify-leader"
                    else self.server.app.station_notifications.acknowledge(peer, value)
                    if action == "station/notification-ack"
                    else self.server.app.agent_access.station_action(peer, action[8:], value)
                    if action.startswith("station/")
                    else self.server.app.agent_access.cloud_action(peer, action[6:], value)
                    if action.startswith("cloud/")
                    else self.server.app.agent_access.save_memory(peer, value)
                    if action == "memory"
                    else self.server.app.agent_access.center(peer, action[7:], body=value)
                    if action.startswith("center/")
                    else self.server.app.agent_access.mutate(peer, action, value)
                )
                return self.send(200, result)
            if path == "/api/office/cloud":
                return self.send(200, self.server.app.office.configure_cloud(value))
            if path.startswith("/api/link/"):
                if path == "/api/link/grant":
                    credentials = self.server.app.agent_access.listing()["credentials"]
                    if not any(
                        c["actor_id"] == value.get("actor_id")
                        and c["project"] == value.get("project")
                        and not c["revoked"]
                        for c in credentials
                    ):
                        raise LinkError("link_agent_credential_not_active", 403)
                return self.send(200, self.server.app.device_link.action(path[10:], value))
            if path.startswith("/api/cloud/"):
                methods = {
                    "login": self.server.app.cloud.start,
                    "poll": self.server.app.cloud.poll,
                    "logout": self.server.app.cloud.logout,
                    "check": self.server.app.cloud.check,
                }
                if value or path[11:] not in methods:
                    raise CloudError("invalid_cloud_action")
                return self.send(200, methods[path[11:]]())
            if path == "/api/project-memory":
                return self.send(200, self.server.app.project_memory.save(value, "local-owner"))
            if self.path == "/api/agent-access/enroll":
                return self.send(200, self.server.app.agent_access.enroll(value))
            if self.path == "/api/agent-access/revoke":
                return self.send(200, self.server.app.agent_access.revoke(value))
            if self.path == "/api/agent-access/handoff":
                return self.send(200, self.server.app.agent_access.owner_handoff(value))
            if self.path == "/api/agent-access/exchange":
                return self.send(200, self.server.app.agent_access.owner_exchange(value))
            if self.path == "/api/chat":
                return self.send(200, {"delivery": self.server.app.submit(value)})
            if self.path == "/api/requirement-dispatch":
                return self.send(
                    200, {"delivery": self.server.app.requirement_deliveries.submit(value)}
                )
            match = re.fullmatch(
                r"/api/human-requests/([A-Za-z0-9_.:-]{1,100})/decision", self.path
            )
            if match:
                return self.send(200, self.server.app.humans.decide(match[1], value))
            if self.path == "/api/collaboration/command":
                return self.send(200, self.server.app.product_commands.command(value))
            if self.path == "/api/collaboration/dispatch":
                return self.send(200, self.server.app.product_commands.dispatch(value))
            if self.path == "/api/resources/refresh":
                return self.send(200, {"resources": self.server.app.refresh_resources()})
            if self.path == "/api/resources":
                return self.send(200, {"resource": self.server.app.register_resource(value)})
            if self.path == "/api/management":
                action = value.get("action")
                payload = value.get("payload")
                if not isinstance(action, str) or not isinstance(payload, dict):
                    raise Problem("invalid_management_request", "管理请求需包含动作和对象参数。")
                return self.send(200, {"result": self.server.app.management(action, payload)})
            raise Problem("not_found", "接口不存在。", 404)
        except (CloudError, FeedbackError, LinkError) as error:
            self.send(error.status, {"error": error.code, "code": error.code})
        except MemoryError as error:
            self.send(
                error.status, {"code": error.code, "error": error.code, "replay_allowed": False}
            )
        except AgentError as error:
            self.send(
                error.status, {"code": error.code, "error": error.code, "replay_allowed": False}
            )
        except RequirementDeliveryError as error:
            self.send(
                error.status,
                {
                    "error": "需求投递未获确认，请查询原请求。",
                    "code": error.code,
                    "replay_allowed": False,
                },
            )
        except HumanError as error:
            self.send(
                error.status, {"error": "人工决定尚未确认，请查询原请求。", "code": error.code}
            )
        except ProductCommandError as error:
            self.send(409, {"error": "产品动作状态未确认，请查看原请求记录。", "code": str(error)})
        except Problem as error:
            self.send(error.status, {"error": error.message, "code": error.code})
        except (ConnectionError, TimeoutError):
            self.close_connection = True
        except (ValueError, TypeError):
            self.send(400, {"error": "请求内容无效。", "code": "invalid_json"})
        except Exception:
            self.send(500, {"error": "保存失败，请稍后重试。", "code": "write_failed"})
        finally:
            if authorized:
                self.server.app.wake_workers(path)


# 清理失败时保留数据锁引用，直到所有非 daemon 写者结束且进程真正退出。
_failed_instance_locks = []


# @chain-region main | calls: Application, InstanceLock, OSOwner, OfficeRuntime, RuntimeError, Server, _failed_instance_locks.append, action …
def main():
    parser = argparse.ArgumentParser(description="Aieyra Together Link 本机协作服务")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--config", type=Path)
    parser.add_argument("--data-dir", type=Path)
    parser.add_argument("--os-managed", action="store_true")
    parser.add_argument("--os-owner-stdin", action="store_true")
    # 生命周期持有者：Aieyra OS，或独立运行的 Aieyra Link。两者都必须提供 owner 租约。
    parser.add_argument("--owner-kind", choices=("os", "link"), default="os")
    args = parser.parse_args()
    if not args.os_managed or not args.os_owner_stdin:
        parser.error("Control 需要由 Aieyra OS 或 Aieyra Link 启动")
    from os_owner import OSOwner

    try:
        owner = OSOwner()
    except ValueError as error:
        print(str(error), file=sys.stderr, flush=True)
        return 1
    instance = None
    office_runtime = None
    server = None
    workers = []
    serving = None
    application = None
    try:
        if owner.lost.is_set():
            return 0
        args.data_dir = external_path(args.data_dir or shared_directory())
        args.config = external_path(args.config or configuration_file())
        # Claim the machine runtime before creating storage or opening any database.
        # A second data root or port must not form another, apparently empty office.
        office_runtime = OfficeRuntime(args.port)
        if args.config == configuration_file():
            initialize_paths()
        instance = InstanceLock(args.data_dir)
        config = json.loads(args.config.read_text(encoding="utf-8-sig"))
        application = Application(config, args.data_dir)
        application.os_owner = owner
        application.owner_kind = args.owner_kind
        application.profile_scope = os.environ.get("AIEYRA_CONTROL_SCOPE", "")
        server = Server(args.port, application)

        # @chain-region main.feedback_monitor | calls: application.feedback.flush, application.feedback_wake.clear, application.feedback_wake.wait, application.stop.is_set
        def feedback_monitor():
            while not application.stop.is_set():
                application.feedback_wake.clear()
                try:
                    application.feedback.flush()
                except Exception:
                    pass
                if application.stop.is_set():
                    break
                application.feedback_wake.wait(60 if not application.cloud.session else 10)

        for target, name in (
            (application.run, "control-sync"),
            (application.cloud_monitor, "control-cloud-opt-in"),
            (feedback_monitor, "control-private-feedback"),
            (application.monitor, "control-monitor"),
            (application.reconnect_hub, "control-hub-reconnect"),
            (application.monitor_collaboration, "control-collaboration"),
            (application.office.run, "control-office-cloud"),
        ):
            worker = threading.Thread(target=target, name=name)
            workers.append(worker)
            worker.start()
        application.self_heal.start()
        serving = threading.Thread(target=server.serve_forever, name="control-http")
        serving.start()
        office_runtime.publish(ready=True, port=server.server_address[1])
        print(
            json.dumps(
                {
                    "type": "control.ready",
                    "owned": True,
                    "owner_id": owner.owner_id,
                    "service": "aieyra-together-link",
                    "url": server.origin,
                    "pid": os.getpid(),
                }
            ),
            flush=True,
        )
        owner.lost.wait()
        return 0
    except KeyboardInterrupt:
        return 0
    except Problem as error:
        print(
            json.dumps(
                {"type": "control.error", "code": error.code, "error": error.message},
                ensure_ascii=False,
            ),
            flush=True,
        )
        return 1
    finally:
        if application:
            application.stop.set()
            application.wake_workers()
        cleanup_errors = []

        # @chain-region main.finish | calls: action, cleanup_errors.append, type
        def finish(action):
            try:
                action()
            except Exception as error:
                cleanup_errors.append(type(error).__name__)

        if server:
            if serving and serving.is_alive():
                finish(server.shutdown)
            finish(server.server_close)
        if serving:
            finish(serving.join)
        for worker in workers:
            finish(worker.join)
        if application:
            finish(application.device_link.close)
        # 数据锁在所有请求、写入和 Link 子进程退出以后才释放。
        if instance:
            if cleanup_errors:
                _failed_instance_locks.append(instance)
            else:
                finish(instance.close)
        if office_runtime:
            if cleanup_errors:
                _failed_instance_locks.append(office_runtime)
            else:
                finish(office_runtime.close)
        finish(owner.close)
        if cleanup_errors:
            print(
                json.dumps(
                    {"type": "control.error", "code": "cleanup_failed", "failures": cleanup_errors}
                ),
                flush=True,
            )
            raise RuntimeError("Control cleanup did not complete normally")


if __name__ == "__main__":
    raise SystemExit(main())
