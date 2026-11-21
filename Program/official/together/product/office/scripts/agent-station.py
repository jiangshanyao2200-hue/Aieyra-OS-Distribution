#!/usr/bin/env python3
# @file-map:start
# 文件: link/office/scripts/agent-station.py
# 位置: 二环·工位CLI | 工位 Agent 接入、原编号投递回执、续接及本地工单工作区。
# 约束: 从当前响应读取身份与可用端点；日志脱敏且有界，不以命令返回替代实际工位状态
# 下游: link/office/scripts/agent-client.py, link/office/scripts/enroll-agent.py, link/office/scripts/project_space.py, link/office/scripts/task_delegation.py, link/office/scripts/task_worktree.py
# 上游: link/office/scripts/agent-adapter.py, link/office/scripts/claude-station-hook.py, link/office/scripts/station-transfer.py
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: python -X utf8 -B -m unittest discover -s link/office/tests/service -p test_agent_client.py
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   _SkipCoordination | class
#   read_json | function
#   atomic | function
#   lock | function
#   create_station | function
#   Station | class
#   Station.__init__ | function
#   Station.state | function
#   Station.seat | function
#   Station.require_live_binding | function
#   Station.registered_project_path | function
#   Station.project_space | function
#   Station.project_space.leader | function
#   Station.project_space.authorize | function
#   Station.workspace | function
#   Station.workspace.authorized_task | function
#   Station.doctor | function
#   Station.os_doctor | function
#   Station.context | function
#   Station.memory_probe | function
#   Station.ensure | function
#   Station.ensure.bounded | function
#   Station.start_lease | function
#   Station.finish | function
#   Station.hook | function
#   Station.watch | function
#   Station.watch.ActivityStop | class
#   Station.watch.ActivityStop.wait | function
#   Station.watch.probe | function
#   configure | function
#   configure.psquote | function
#   configure.merge | function
#   keepalive_wait | function
#   main | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Restore a stable Control station from explicit local host lifecycle events.

Explicit create enrolls a new identity; join never enrolls or changes ownership.
No model calls, transcript reads, task replay or automatic handoff.
Profiles contain credential file references, never copied tokens.
"""

from __future__ import annotations

import argparse
from contextlib import contextmanager
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import threading
import time
import uuid
from urllib.request import Request
from urllib.error import HTTPError, URLError

SPEC = importlib.util.spec_from_file_location(
    "station_client", Path(__file__).with_name("agent-client.py")
)
CLIENT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CLIENT)
SPEC = importlib.util.spec_from_file_location(
    "station_enrollment", Path(__file__).with_name("enroll-agent.py")
)
ENROLL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ENROLL)
Error = CLIENT.ClientError


# @chain-region _SkipCoordination
class _SkipCoordination(Exception):
    """Internal: the caller reads coordination messages itself."""


ID = re.compile(r"[A-Za-z0-9_.:-]{1,100}\Z")
HOSTS = ("codex", "claude", "cursor", "os", "generic")
EVENTS = {
    "claude": {
        "SessionStart": "join",
        "UserPromptSubmit": "work",
        "PreToolUse": "work",
        "PostToolUse": "work",
        "PostToolUseFailure": "work",
        "PreCompact": "work",
        "PostCompact": "join",
        "Stop": "finish",
        "StopFailure": "finish",
        "SessionEnd": "finish",
    },
    "cursor": {
        "sessionStart": "join",
        "beforeSubmitPrompt": "work",
        "preToolUse": "work",
        "postToolUse": "work",
        "postToolUseFailure": "work",
        "preCompact": "work",
        "stop": "finish",
        "sessionEnd": "finish",
    },
}


# @chain-region read_json | calls: Error, Path, Path(path).read_text, isinstance, json.loads
def read_json(path):
    value = json.loads(Path(path).read_text(encoding="utf-8-sig"))
    if not isinstance(value, dict):
        raise Error("invalid_json_object")
    return value


# @chain-region atomic | calls: Path, json.dumps, os.chmod, os.fsync, os.replace, path.parent.mkdir, path.with_name, stream.fileno …
def atomic(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        with tmp.open("x", encoding="utf-8", newline="\n") as stream:
            os.chmod(tmp, 0o600)
            stream.write(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


# @chain-region lock | calls: Error, fcntl.flock, msvcrt.locking, path.open, path.parent.mkdir, stream.fileno, stream.flush, stream.seek …
@contextmanager
def lock(path, seconds=5):
    """Kernel lock, released even on process death; no stale PID deletion."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+b") as stream:
        if stream.tell() == 0:
            stream.write(b"0")
            stream.flush()
        deadline = time.monotonic() + seconds
        while True:
            try:
                stream.seek(0)
                if os.name == "nt":
                    import msvcrt

                    msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl

                    fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except OSError:
                if time.monotonic() >= deadline:
                    raise Error("station_busy_retry_at_next_work_boundary") from None
                time.sleep(0.05)
        try:
            yield
        finally:
            stream.seek(0)
            if os.name == "nt":
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


# @chain-region create_station | calls: (state_dir / 'connection.json').exists, CLIENT.AgentClient, CLIENT.AgentClient.read_response, CLIENT.AgentClient.read_response(error).get, ENROLL.enroll, ENROLL.external_path, ENROLL.save_new, Error …
def create_station(
    profile_path,
    *,
    name,
    project,
    root,
    host,
    native,
    port=17930,
    resume=False,
    lease=True,
    working=True,
):
    """Explicit local bootstrap with a durable intent and a dedicated credential."""
    if (
        not isinstance(name, str)
        or not name.strip()
        or len(name) > 80
        or any(ord(c) < 32 for c in name)
        or not isinstance(project, str)
        or not ID.fullmatch(project)
        or host not in HOSTS
        or not isinstance(native, str)
        or not ID.fullmatch(native)
        or type(port) is not int
        or not 1 <= port <= 65535
        or type(lease) is not bool
        or type(working) is not bool
    ):
        raise Error("invalid_station_creation")
    path = ENROLL.external_path(Path(profile_path).absolute())
    root = Path(root).resolve()
    if not root.is_dir():
        raise Error("project_root_missing")
    state_dir = ENROLL.external_path(path.parent / (path.stem + ".state"))
    intent_path = state_dir / "create.json"
    config_path = state_dir / "credential.json"
    if path == config_path or path == intent_path or state_dir in path.parents:
        raise Error("invalid_station_profile_path")
    requested = {
        "name": name,
        "project": project,
        "root": str(root),
        "host": host,
        "native_session_id": native,
        "port": port,
        "lease": lease,
        "profile": str(path),
    }
    with lock(state_dir / "create.lock"):
        if resume:
            if not intent_path.is_file():
                raise Error("station_creation_intent_missing_use_join_for_existing_profile")
            intent = read_json(intent_path)
            if intent.get("requested") != requested:
                raise Error("station_creation_resume_mismatch")
        else:
            if path.exists():
                raise Error("station_profile_exists_use_join")
            if (
                intent_path.exists()
                or config_path.exists()
                or (state_dir / "connection.json").exists()
            ):
                raise Error("station_creation_exists_use_resume")
            intent = {"requested": requested, "request_id": "create-" + uuid.uuid4().hex}
            atomic(intent_path, intent)
        # A profile can only be adopted from this exact completed creation.
        if path.exists():
            if not intent.get("profile") or read_json(path) != intent["profile"]:
                raise Error("station_creation_profile_conflict")
            station = Station(path)
        else:
            try:
                result = ENROLL.enroll(
                    name,
                    project,
                    config_path,
                    port=port,
                    request_id=intent["request_id"],
                    resume=config_path.exists(),
                )
            except HTTPError as error:
                try:
                    with error:
                        code = CLIENT.AgentClient.read_response(error).get("code", "")
                    if not isinstance(code, str) or not re.fullmatch(
                        r"[A-Za-z0-9_.-]{1,100}", code
                    ):
                        code = "station_enrollment_unconfirmed_retry_create_with_resume"
                except (Error, OSError, ValueError):
                    code = "station_enrollment_unconfirmed_retry_create_with_resume"
                raise Error(code, error.code) from None
            except (OSError, URLError):
                raise Error("station_enrollment_unconfirmed_retry_create_with_resume") from None
            credential = result["credential"]
            if (
                result["state"] != "ready"
                or credential.get("revoked")
                or credential.get("project") != project
            ):
                raise Error("station_enrollment_not_ready")
            client = CLIENT.AgentClient(read_json(config_path))
            seats = client.call("seats")
            if seats.get("actor_id") != credential["actor_id"]:
                raise Error("credential_actor_mismatch")
            matching = [s for s in seats["seats"] if s.get("project") == project]
            if len(matching) != 1:
                raise Error("station_enrollment_seat_ambiguous")
            profile = {
                "schema": 1,
                "host": host,
                "project": project,
                "root": str(root),
                "config_file": str(config_path),
                "actor_id": credential["actor_id"],
                "seat_id": matching[0]["id"],
                "lease": lease,
            }
            if intent.get("profile") and intent["profile"] != profile:
                raise Error("station_creation_identity_changed")
            intent["profile"] = profile
            atomic(intent_path, intent)
            # Never replace an existing profile, including one written concurrently.
            ENROLL.save_new(path, profile)
            station = Station(path)
        joined = station.ensure(native, working)
        return {
            **joined,
            "profile": str(path),
            "config_file": str(config_path),
            "actor_id": station.p["actor_id"],
            "enrollment_request_id": intent["request_id"],
            "creation_resumed": resume,
        }


# @chain-region Station | calls: (native + ':' + str(binding['version'])).encode, (self.state_dir / (sid + '.active')).unlink, (self.state_dir / (sid + '.lease.log')).open, ActivityStop, CLIENT.AgentClient, CLIENT.finish_session, CLIENT.keep_lease, ENROLL.external_path …
class Station:
    # @chain-region Station.__init__ | calls: CLIENT.AgentClient, ENROLL.external_path, Error, ID.fullmatch, Path, Path(executable).is_absolute, Path(profile_path).absolute, Path(self.p['root']).resolve …
    def __init__(self, profile_path):
        self.path = ENROLL.external_path(Path(profile_path).absolute())
        self.p = read_json(self.path)
        required = {"schema", "host", "project", "root", "config_file", "actor_id", "seat_id"}
        if (
            not required <= self.p.keys()
            or set(self.p)
            - required
            - {
                "max_seconds",
                "idle_seconds",
                "lease",
                "native_status_executable",
                "native_status_connection",
                "native_probe_grace_seconds",
            }
            or self.p["schema"] != 1
            or self.p["host"] not in HOSTS
            or type(self.p.get("lease", True)) is not bool
        ):
            raise Error("invalid_station_profile")
        for key in ("project", "actor_id", "seat_id"):
            if not isinstance(self.p[key], str) or not ID.fullmatch(self.p[key]):
                raise Error("invalid_station_profile")
        for key in ("root", "config_file"):
            if not isinstance(self.p[key], str) or not Path(self.p[key]).is_absolute():
                raise Error("absolute_profile_paths_required")
        executable = self.p.get("native_status_executable")
        native_connection = self.p.get("native_status_connection")
        if native_connection is not None and (
            not isinstance(native_connection, dict)
            or not isinstance(native_connection.get("binding"), dict)
            or native_connection["binding"].get("actor_id") != self.p["actor_id"]
        ):
            raise Error("native_status_connection_identity_invalid")
        if executable is not None and (
            not isinstance(executable, str)
            or len(executable) > 1024
            or not Path(executable).is_absolute()
        ):
            raise Error("absolute_native_status_executable_required")
        self.root = Path(self.p["root"]).resolve()
        if not self.root.is_dir():
            raise Error("project_root_missing")
        self.state_dir = ENROLL.external_path(self.path.parent / (self.path.stem + ".state"))
        self.state_file = self.state_dir / "connection.json"
        config_path = ENROLL.external_path(self.p["config_file"])
        self.client = CLIENT.AgentClient(read_json(config_path))
        self.client.timeout = 3
        self._lease_helpers = {}
        for key, default, low, high in (
            ("max_seconds", 3600, 30, 14400),
            ("idle_seconds", 300, 30, 600),
            ("native_probe_grace_seconds", 90, 15, 300),
        ):
            value = self.p.get(key, default)
            if type(value) is not int or not low <= value <= high:
                raise Error("lease_duration_out_of_bounds")
            self.p[key] = value

    # @chain-region Station.state | calls: read_json, self.state_file.exists
    def state(self):
        return read_json(self.state_file) if self.state_file.exists() else {}

    # @chain-region Station.seat | calls: Error, next, result.get, seat.get, self.client.call
    def seat(self):
        result = self.client.call("seats")
        if result.get("actor_id") != self.p["actor_id"]:
            raise Error("credential_actor_mismatch")
        seat = next((s for s in result["seats"] if s["id"] == self.p["seat_id"]), None)
        if not seat or seat.get("project") != self.p["project"]:
            raise Error("credential_project_or_seat_mismatch")
        return seat

    # @chain-region Station.require_live_binding | calls: Error, binding.get, seat.get, self.seat, self.state, state.get
    def require_live_binding(self, native):
        seat = self.seat()
        binding = seat.get("station_binding") or {}
        state = self.state()
        sid = seat.get("session_id")
        if (
            not sid or state.get("status") != "connected" or state.get("session_id") != sid
            or state.get("native_session_id") != native or binding.get("native_session_id") != native
        ):
            raise Error("join_own_current_native_first")
        return seat

    # @chain-region Station.registered_project_path | calls: Error, Path, Path(registered).is_absolute, Path(registered).is_dir, guide.get, next, project.get, self.client.call
    def registered_project_path(self):
        guide = self.client.call("office/guide")
        registered = next(
            (project.get("root") for project in guide.get("projects", []) if project.get("id") == self.p["project"]),
            None,
        )
        if not registered or not Path(registered).is_absolute() or not Path(registered).is_dir():
            raise Error("workspace_project_repository_not_registered")
        return Path(registered)

    # @chain-region Station.project_space | calls: Error, ID.fullmatch, Path, Path(git(registered, 'rev-parse', '--show-toplevel')).resolve, ProjectSpace, any, common_directory, git …
    def project_space(self, operation, native, name, revision):
        from project_space import ProjectSpace
        from task_worktree import common_directory, git

        if not ID.fullmatch(native):
            raise Error("invalid_task_or_native_id")
        self.require_live_binding(native)
        project = self.p["project"]
        registered = self.registered_project_path()
        repository = Path(git(registered, "rev-parse", "--show-toplevel")).resolve()
        if common_directory(self.root) != common_directory(repository):
            raise Error("workspace_station_repository_mismatch")
        space = ProjectSpace(repository, self.client.url, project, lock=lock, atomic=atomic, read=read_json)
        status = space.status()

        # @chain-region Station.project_space.leader | calls: Error, any, grant.get, leaders.pop, len, registry.get, self.client.local_registry
        def leader():
            registry = self.client.local_registry()
            leaders = {
                grant["actor_id"] for grant in registry.get("governance", [])
                if grant.get("active") is True and grant.get("role") == "leader"
                and any(scope in (project, "*") for scope in grant.get("projects", []))
            }
            if len(leaders) != 1:
                raise Error("project_requires_one_registered_leader")
            return leaders.pop()

        if operation == "status":
            return {**status, "leader": leader()}

        # @chain-region Station.project_space.authorize | calls: Error, leader, self.require_live_binding
        def authorize():
            self.require_live_binding(native)
            actor = self.p["actor_id"]
            if leader() != actor:
                raise Error("project_space_leader_required")
            return actor

        return space.snapshot(name, revision, authorize)

    # @chain-region Station.workspace | calls: Error, ID.fullmatch, Path, ProjectSpace, authorized_task, bool, current.get, self.client.call …
    def workspace(self, operation, task_id, native, base, workspace_root):
        from project_space import ProjectSpace
        from task_delegation import TERMINAL
        from task_worktree import WorkspaceError, task_worktree

        if not ID.fullmatch(task_id) or not ID.fullmatch(native):
            raise Error("invalid_task_or_native_id")

        # @chain-region Station.workspace.authorized_task | calls: Error, bool, self.client.call, self.require_live_binding, task.get, time.time
        def authorized_task():
            self.require_live_binding(native)
            task = self.client.call("center/task", query={"id": task_id})
            if task.get("id") != task_id or task.get("project") != self.p["project"]:
                raise Error("workspace_task_outside_station_project")
            actor = self.p["actor_id"]
            owner = task.get("owner")
            owner_live = bool(owner and (task.get("lease_until") or 0) > time.time())
            assignee = task.get("assignee")
            if (assignee != actor and (assignee or not owner_live or owner != actor)) or (
                owner_live and owner != actor
            ):
                raise Error("workspace_task_not_assigned_to_station")
            if operation == "prepare" and task.get("status") in TERMINAL:
                raise Error("workspace_task_closed")
            return task

        task = authorized_task()
        registered = self.registered_project_path()
        try:
            result = task_worktree(
                registered, self.root, self.client.url, task, operation, base, workspace_root,
                lock=lock, atomic=atomic, read=read_json,
            )
        except WorkspaceError as error:
            raise Error(str(error)) from None
        current = authorized_task()
        record = {
            **result,
            "actor_id": self.p["actor_id"],
            "seat_id": self.p["seat_id"],
            "task_version": current.get("version"),
        }
        if operation == "prepare" and result["state"] == "ready":
            space = ProjectSpace(Path(result["repository"]), self.client.url, self.p["project"],
                                 lock=lock, atomic=atomic, read=read_json)
            space.record_workspace(current, record)
        return record

    # @chain-region Station.doctor | calls: binding.get, seat.get, self.client.call, self.seat, self.state, self.state().get
    def doctor(self):
        seat = self.seat()
        binding = seat.get("station_binding") or {}
        memory = self.client.call("memory", query={"project": self.p["project"]})
        return {
            "status": "ready" if seat["selectable"] else seat["reason"],
            "office_state": "online",
            "transport_state": seat.get("transport_state", "connected" if seat.get("session_id") else "unobserved"),
            "lease_until": seat.get("lease_until"),
            "host": self.p["host"],
            "actor_id": self.p["actor_id"],
            "seat_id": seat["id"],
            "session_id": seat.get("session_id"),
            "binding_version": binding.get("version"),
            "native_session_id": binding.get("native_session_id"),
            "memory_version": memory["memory"]["version"],
            "missing_sections": memory["missing_sections"],
            "last_adapter_result": self.state().get("status"),
            "execution_state": "unknown",
            "automatic_wakeup": False,
        }

    # @chain-region Station.os_doctor | calls: Error, Request, advertised.get, any, isinstance, item.get, rows.append, self.client.opener.open …
    def os_doctor(self):
        """Read the existing explicit runtime projection; do not discover private sessions."""
        try:
            with self.client.opener.open(
                Request(self.client.url + "/api/collaboration"), timeout=3
            ) as response:
                snapshot = self.client.read_response(response)
        except (OSError, URLError):
            raise Error("os_projection_unavailable") from None
        matrices = snapshot.get("matrices")
        if not isinstance(matrices, list):
            raise Error("invalid_os_projection")
        rows = []
        for item in matrices[:16]:
            if not isinstance(item, dict):
                raise Error("invalid_os_projection")
            fresh = item.get("available") is True and item.get("stale") is False
            advertised = item.get("capabilities", {})
            rows.append(
                {
                    "id": item.get("id"),
                    "available": fresh,
                    "stale": not fresh,
                    "capabilities": {
                        k: fresh and advertised.get(k) is True
                        for k in (
                            "observe",
                            "dispatch",
                            "matrix_send",
                            "matrix_cancel",
                            "agent_send",
                            "agent_cancel",
                        )
                    },
                }
            )
        return {
            "status": "available" if any(x["available"] for x in rows) else "no_verified_runtime",
            "source": "explicit_os_sessions",
            "runtimes": rows,
            "observed_at": snapshot.get("observed_at"),
            "model_started": False,
            "private_sessions_scanned": False,
            "note": "OS runtime registrations and development-agent office memberships are distinct.",
        }

    # @chain-region Station.context | calls: json.dumps
    def context(self, result):
        return (
            "Aieyra Control station: "
            + json.dumps(result, ensure_ascii=False)
            + ". Read project AGENTS.md and memory, runtime inbox, and center/history or center/inbox "
            "through agent-client.py. Coordination chat is separate from runtime deliveries. "
            "Read relevant messages before center/ack; reply with verified outcomes when requested. "
            "Save the five memory sections with CAS before finishing. Report confirmed station defects. "
            "A new native identity requires explicit handoff; never replay old deliveries. "
            "Communication presence is not proof of execution or authorization."
        )

    # @chain-region Station.memory_probe | calls: atomic, cache.exists, doc.get, isinstance, memory.get, query.update, re.fullmatch, read_json …
    def memory_probe(self, full=False):
        """Hot paths only confirm the memory version.

        Paired if_version/if_sha256 lets the service omit unchanged sections
        (AIDEBUG link-costs: 9,042 -> 697 bytes). Explicit resume still reads all
        five sections. The cache keeps only version and hash, never content.
        """
        cache = self.state_dir / "memory-probe.json"
        seen = read_json(cache) if cache.exists() and not full else {}
        query = {"project": self.p["project"]}
        if (
            type(seen.get("version")) is int
            and 1 <= seen["version"] <= 2147483647
            and isinstance(seen.get("sha256"), str)
            and re.fullmatch(r"[a-f0-9]{64}", seen["sha256"])
        ):
            query.update(if_version=seen["version"], if_sha256=seen["sha256"])
        try:
            memory = self.client.call("memory", query=query)
        except Error as error:
            # Only an older service's explicit parameter rejection allows one full read.
            if "if_version" not in query or error.status != 400:
                raise
            memory = self.client.call("memory", query={"project": self.p["project"]})
        doc = memory.get("memory") or {}
        if type(doc.get("version")) is int and isinstance(doc.get("sha256"), str):
            if seen.get("version") != doc["version"] or seen.get("sha256") != doc["sha256"]:
                atomic(cache, {"version": doc["version"], "sha256": doc["sha256"]})
        return memory

    # @chain-region Station.ensure | calls: (native + ':' + str(binding['version'])).encode, Error, ID.fullmatch, Path, Path(__file__).resolve, atomic, binding.get, bool …
    def ensure(
        self,
        native,
        working=False,
        *,
        resume=False,
        after=0,
        limit=20,
        stream_epoch=None,
        coordination_read=True,
        require_existing_binding=False,
    ):
        if not isinstance(native, str) or not ID.fullmatch(native):
            raise Error("real_native_session_id_required")
        if (
            type(after) is not int
            or not 0 <= after <= 9223372036854775807
            or type(limit) is not int
            or not 1 <= limit <= 100
        ):
            raise Error("invalid_resume_cursor")
        if stream_epoch is not None and (
            not resume
            or not isinstance(stream_epoch, str)
            or not re.fullmatch(r"[a-f0-9]{64}", stream_epoch)
        ):
            raise Error("invalid_resume_stream_epoch")
        with lock(self.state_dir / "station.lock"):
            seat = self.seat()
            binding = seat.get("station_binding") or {}
            if require_existing_binding and binding.get("native_session_id") != native:
                raise Error("station_binding_changed")
            if binding.get("native_session_id") and binding["native_session_id"] != native:
                result = {
                    "status": "handoff_required",
                    "actor_id": self.p["actor_id"],
                    "seat_id": seat["id"],
                    "requested_native_session_id": native,
                    "expected_version": binding["version"],
                    "automatic_handoff": False,
                }
                # Announce once, persist intent before sending. This is a request
                # for explicit governance, never an implicit change of identity.
                request = self.state_dir / (
                    "handoff-"
                    + hashlib.sha256((native + ":" + str(binding["version"])).encode()).hexdigest()[
                        :24
                    ]
                    + ".json"
                )
                if not request.exists():
                    intent = {
                        "status": "pending",
                        "request_id": "handoff-request-" + uuid.uuid4().hex,
                        "requested_native_session_id": native,
                        "expected_version": binding["version"],
                    }
                    atomic(request, intent)
                intent = read_json(request)
                if intent["status"] != "sent":
                    try:
                        receipt = self.client.call(
                            "center/message",
                            {
                                "request_id": intent["request_id"],
                                "project": self.p["project"],
                                "kind": "blocker",
                                "body": "Station recovery requests explicit CAS handoff: "
                                + json.dumps(result)
                                + ". Verify the current owner and pending deliveries; no automatic takeover or task replay.",
                            },
                        )
                        intent.update(status="sent", receipt=receipt)
                        atomic(request, intent)
                    except Error:
                        pass
                if intent.get("status") == "sent" and "leader_notification" not in intent:
                    # The new route binds the leader server-side. The same ID/body
                    # is safe after response loss; native unknown results never replay.
                    try:
                        notice = self.client.call(
                            "station/notify-leader",
                            {
                                "request_id": intent["request_id"],
                                "body": "Station recovery requests explicit CAS handoff: "
                                + json.dumps(result)
                                + ". Verify the current owner and pending deliveries; no automatic takeover or task replay.",
                            },
                        )
                        intent["leader_notification"] = notice["notification"]["id"]
                        atomic(request, intent)
                    except Error as error:
                        result["leader_notification_error"] = error.code
                if intent.get("leader_notification"):
                    result["leader_notification_id"] = intent["leader_notification"]
                result["handoff_notice"] = read_json(request)["status"]
                return result
            state = self.state()
            sid = seat.get("session_id")
            if sid:
                session = self.client.call("sessions/" + sid)["session"]
                if session.get("native_session_id") != native or session["seat_id"] != seat["id"]:
                    return {"status": "occupied_by_other_session", "automatic_takeover": False}
            else:
                if state.get("status") == "connect_pending":
                    # Persisted intent survives response loss and process death. Query only.
                    try:
                        self.client.call("requests/" + state["request_id"])
                        session = self.client.call("sessions/" + state["session_id"])["session"]
                    except Error:
                        return {
                            "status": "connect_unconfirmed",
                            "request_id": state["request_id"],
                            "session_id": state["session_id"],
                            "automatic_replay": False,
                        }
                    if session["state"] == "connected":
                        sid = session["id"]
                    else:
                        state["status"] = "closed"
                        atomic(self.state_file, state)
                if not sid:
                    if not seat["selectable"]:
                        return {"status": seat["reason"], "automatic_takeover": False}
                    sid = "station-" + self.p["host"] + "-" + uuid.uuid4().hex
                    state = {
                        "session_id": sid,
                        "native_session_id": native,
                        "request_id": "join-" + uuid.uuid4().hex,
                        "status": "connect_pending",
                    }
                    atomic(self.state_file, state)
                    try:
                        session = self.client.call(
                            "connect",
                            {
                                "request_id": state["request_id"],
                                "session_id": sid,
                                "seat_id": seat["id"],
                                "seat_epoch": seat["epoch"],
                                "native_session_id": native,
                            },
                        )["session"]
                    except Error:
                        try:
                            session = self.client.call("sessions/" + sid)["session"]
                        except Error:
                            return {
                                "status": "connect_unconfirmed",
                                "request_id": state["request_id"],
                                "session_id": sid,
                                "automatic_replay": False,
                            }
                    if session.get("state") != "connected":
                        raise Error("connect_not_live")
            if session.get("native_session_id") != native:
                raise Error("native_readback_mismatch")
            state.update(session_id=sid, native_session_id=native, status="connected")
            atomic(self.state_file, state)
            # These are real host activity events, not a timer manufacturing presence.
            self.client.call(
                "heartbeat",
                {
                    "request_id": "event-" + uuid.uuid4().hex,
                    "session_id": sid,
                    "runtime_state": "running" if working else "idle",
                },
            )
            marker = self.state_dir / (sid + ".active")
            marker.touch()
            if self.p.get("lease", True) and sid.startswith("station-"):
                self.start_lease(sid, state)
            memory = self.memory_probe(full=resume)
            inbox = self.client.call("inbox", query={"session_id": sid})
            coordination = {"status": "unavailable"}
            history = None
            try:
                if not coordination_read and not resume:
                    # Hot tool events: the message hook reads center/inbox incrementally right
                    # after this, so do not fetch the chat twice (AIDEBUG link-costs).
                    raise _SkipCoordination
                if resume:
                    query = {"after": after, "limit": limit}
                    if stream_epoch is not None:
                        query["stream_epoch"] = stream_epoch
                    try:
                        history = self.client.call(
                            "center/inbox",
                            query={
                                **query,
                                "project": self.p["project"],
                                "include_coordination": 1,
                            },
                        )
                    except Error as error:
                        if (
                            stream_epoch is not None
                            or error.status != 400
                            or error.code
                            not in (
                                "unsupported_query_parameter",
                                "unknown_query_parameter",
                            )
                        ):
                            raise
                        history = self.client.call("center/inbox", query=query)
                    if stream_epoch is not None and (
                        history.get("stream_epoch") != stream_epoch
                        or history.get("epoch_checked") is not True
                    ):
                        raise Error("center_stream_epoch_unconfirmed")
                    if "filter_mode" not in history:
                        # Older Control may ignore project parameters. Keep its
                        # global scan cursor, including on empty relevant pages.
                        history = {
                            **history,
                            "filter_mode": "legacy_scan",
                            "stream_epoch": None,
                            "epoch_checked": False,
                            "filter": {"project": self.p["project"], "include_coordination": True},
                            "has_more": history.get(
                                "has_more", len(history.get("messages", [])) >= limit
                            ),
                        }
                else:
                    history = self.client.call("center/history")
                messages = history.get("messages", [])
                coordination = {
                    "status": "observed",
                    "unread_in_recent_window": sum(
                        item.get("sender") != self.p["actor_id"]
                        and not item.get("read_at")
                        and item.get("project") in (self.p["project"], "coordination")
                        for item in messages
                    ),
                    "window_size": len(messages),
                    "latest_seq": max((item["seq"] for item in messages), default=0),
                    "older_messages_available": bool(history.get("has_more")),
                }
            except _SkipCoordination:
                history = None
                coordination = {"status": "incremental_via_message_hook"}
            except Error as error:
                # Chat availability must not turn an established connection into a failure.
                history = None
                coordination = {"status": "unavailable", "code": error.code}
            result = {
                "status": "connected",
                "project": self.p["project"],
                "transport_session_id": sid,
                "session_id": sid,
                "seat_id": seat["id"],
                "native_session_id": native,
                "memory_version": memory["memory"]["version"],
                "unconfirmed_deliveries": len(inbox.get("deliveries", [])),
                "coordination": coordination,
                "tasks_replayed": False,
                "memory_saved": False,
                "office_adapter": {
                    "guide": str(
                        Path(__file__).resolve().parents[3] / "docs" / "Link接入与私有适配.md"
                    ),
                    "status_route": "office",
                    "guide_route": "office/guide",
                    "required": [
                        "install_own_host_adapter",
                        "self_receipt",
                        "peer_receive_receipt",
                        "peer_send_receipt",
                        "tasks_and_memory",
                        "finish_and_resume",
                    ],
                    "registration_is_verification": False,
                },
            }
            if resume:
                # Only explicit CLI requests expose private project bodies. Hooks
                # keep the compact result. Returned cursors are never auto-saved
                # and reading this bundle does not acknowledge or execute anything.
                # @chain-region Station.ensure.bounded | calls: json.dumps, json.dumps(value, ensure_ascii=False).encode, len
                def bounded(value, fallback):
                    if len(json.dumps(value, ensure_ascii=False).encode("utf-8")) <= 131072:
                        return value
                    return {"truncated": True, "read_separately": fallback}

                relevant = (
                    None
                    if history is None
                    else {
                        **history,
                        "messages": [
                            item
                            for item in history.get("messages", [])
                            if item.get("project") in (self.p["project"], "coordination")
                        ],
                        "scanned_count": history.get(
                            "scanned_count", len(history.get("messages", []))
                        ),
                        "limit": limit,
                        "after": after,
                        "order": "ascending",
                    }
                )
                result["resume"] = {
                    "schema_version": 1,
                    "read_order": ["memory", "runtime_inbox", "coordination"],
                    "memory": bounded(memory, "memory"),
                    "runtime_inbox": bounded(inbox, "inbox"),
                    "coordination": bounded(relevant, "center/inbox"),
                    "ack_required_after_read": True,
                    "cursor_persisted": False,
                    "content_is_project_data": True,
                }
            return result

    # @chain-region Station.start_lease | calls: (self.state_dir / (sid + '.lease.log')).open, Path, Path(__file__).resolve, alive.exists, alive.stat, atomic, state.get, state.update …
    def start_lease(self, sid, state):
        alive = self.state_dir / (sid + ".worker")
        if alive.exists() and time.time() - alive.stat().st_mtime < 55:
            return
        if state.get("helper_session") == sid and time.time() - state.get("helper_started", 0) < 10:
            return
        with (self.state_dir / (sid + ".lease.log")).open("ab") as log:
            helper = subprocess.Popen(
                [
                    sys.executable,
                    "-X",
                    "utf8",
                    str(Path(__file__).resolve()),
                    "--profile",
                    str(self.path),
                    "watch",
                    "--session-id",
                    sid,
                ],
                stdin=subprocess.DEVNULL,
                stdout=log,
                stderr=log,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
                start_new_session=os.name != "nt",
            )
        threading.Thread(target=helper.wait, daemon=True, name="station-lease-reaper").start()
        self._lease_helpers[sid] = helper
        state.update(helper_session=sid, helper_started=time.time(), helper_pid=helper.pid)
        atomic(self.state_file, state)

    # @chain-region Station.finish | calls: (self.state_dir / (sid + '.active')).unlink, CLIENT.finish_session, Error, ID.fullmatch, atomic, helper.wait, isinstance, lock …
    def finish(self, native):
        if not isinstance(native, str) or not ID.fullmatch(native):
            raise Error("real_native_session_id_required")
        with lock(self.state_dir / "station.lock"):
            state = self.state()
            identity = {
                "schema_version": 1,
                "operation": "finish",
                "project": self.p["project"],
                "host": self.p["host"],
                "actor_id": self.p["actor_id"],
                "seat_id": self.p["seat_id"],
                "native_session_id": native,
            }
            if not state or state.get("native_session_id") != native:
                return {
                    **identity,
                    "status": "no_owned_transport",
                    "session_id": None,
                    "transport_session_id": None,
                    "lease_released": False,
                }
            sid = state["session_id"]
            result = CLIENT.finish_session(self.client, sid, "finish-" + sid)
            # Finish must first read its pending inbox and memory while the
            # transport is connected. The helper may disconnect as soon as this
            # marker disappears, so signal it only after the finish receipt.
            (self.state_dir / (sid + ".active")).unlink(missing_ok=True)
            receipt = {
                **result,
                **identity,
                "transport_session_id": sid,
                "status": "closed" if result["lease_released"] else "release_unconfirmed",
            }
            helper = self._lease_helpers.get(sid)
            if helper is not None:
                # Only wait for the child this instance created. A stored PID is
                # never authority to terminate another process.
                try:
                    helper.wait(timeout=5)
                    receipt["helper_stopped"] = True
                    self._lease_helpers.pop(sid, None)
                except subprocess.TimeoutExpired:
                    receipt["helper_stopped"] = False
            state.update(status=receipt["status"], finish=receipt)
            atomic(self.state_file, state)
            return receipt

    # @chain-region Station.hook | calls: EVENTS.get, EVENTS.get(host, {}).get, Error, ID.fullmatch, Path, Path(cwd).is_absolute, Path(cwd).resolve, Path(cwd).resolve().is_relative_to …
    def hook(self, payload, *, coordination_read=True):
        if not isinstance(payload, dict):
            raise Error("invalid_hook_payload")
        host = self.p["host"]
        event = payload.get("hook_event_name")
        action = EVENTS.get(host, {}).get(event)
        if not action:
            raise Error("unsupported_hook_event")
        if (
            payload.get("agent_id")
            or payload.get("subagent_id")
            or payload.get("parent_conversation_id")
        ):
            return {"status": "subagent_ignored"}, {}
        if host == "claude":
            native = payload.get("session_id")
            cwd = payload.get("cwd")
            if (
                not isinstance(cwd, str)
                or not Path(cwd).is_absolute()
                or not Path(cwd).resolve().is_relative_to(self.root)
            ):
                raise Error("hook_project_mismatch")
        else:
            native = payload.get("conversation_id")
            roots = payload.get("workspace_roots")
            if not isinstance(roots, list) or str(self.root) not in [
                str(Path(x).resolve())
                for x in roots
                if isinstance(x, str) and Path(x).is_absolute()
            ]:
                raise Error("hook_project_mismatch")
            if payload.get("session_id") and payload["session_id"] != native:
                raise Error("native_hook_identity_mismatch")
        if not isinstance(native, str) or not ID.fullmatch(native):
            raise Error("real_native_session_id_required")
        result = (
            self.finish(native)
            if action == "finish"
            else self.ensure(native, action == "work", coordination_read=coordination_read)
        )
        output = {}
        if host == "claude" and event in (
            "SessionStart",
            "UserPromptSubmit",
            "PreToolUse",
            "PostToolUse",
            "PostToolUseFailure",
            "PostCompact",
        ):
            output = {
                "hookSpecificOutput": {
                    "hookEventName": event,
                    "additionalContext": self.context(result),
                }
            }
        elif host == "cursor" and event in ("sessionStart", "postToolUse", "postToolUseFailure"):
            output = {"additional_context": self.context(result)}
        elif host == "cursor" and event == "beforeSubmitPrompt":
            output = {"continue": True}
        # Never block a prompt, inject a followup, auto-run tasks or claim memory was saved.
        atomic(
            self.state_dir / "last-hook.json",
            {"host": host, "event": event, "result": result, "observed_at": time.time()},
        )
        return result, output

    # @chain-region Station.watch | calls: ActivityStop, CLIENT.keep_lease, Error, Path, Path(__file__).resolve, active.is_file, any, atomic …
    def watch(self, sid):
        if not re.fullmatch(r"station-[A-Za-z0-9-]{1,70}", sid):
            raise Error("invalid_adapter_session")
        with lock(self.state_dir / (sid + ".watch.lock"), seconds=0):
            worker = self.state_dir / (sid + ".worker")
            active = self.state_dir / (sid + ".active")

            # @chain-region Station.watch.ActivityStop | calls: active.is_file, min, self.is_set, super, super().wait, time.monotonic, worker.touch
            class ActivityStop(threading.Event):
                # @chain-region Station.watch.ActivityStop.wait | calls: active.is_file, min, self.is_set, super, super().wait, time.monotonic, worker.touch
                def wait(self, timeout=None):
                    worker.touch()
                    deadline = None if timeout is None else time.monotonic() + timeout
                    while active.is_file():
                        remaining = None if deadline is None else deadline - time.monotonic()
                        if remaining is not None and remaining <= 0:
                            return self.is_set()
                        if super().wait(0.25 if remaining is None else min(0.25, remaining)):
                            return True
                    # Finish removes this session's marker. Observe it promptly
                    # without waiting the full 25-second renewal interval.
                    return True

            worker.touch()
            result = None
            native = self.state().get("native_session_id")
            dispatch = self.client.task_dispatch_config or {}
            sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "service"))
            from native_host import read_codex_state

            cached = [None, -1e9]

            # @chain-region Station.watch.probe | calls: Error, any, dispatch.get, isinstance, native_connection.get, native_connection['binding'].get, profile.get, read_codex_state …
            def probe():
                if time.monotonic() - cached[1] >= 15:
                    cached[:] = [None, time.monotonic()]
                    # create starts this worker before install can publish the WSL
                    # route. Read only our current profile at each bounded probe;
                    # never disconnect, rebind or resume the native to refresh it.
                    profile = read_json(self.path)
                    if any(profile.get(key) != self.p[key] for key in (
                        "schema", "host", "project", "root", "config_file", "actor_id", "seat_id"
                    )):
                        raise Error("native_status_profile_identity_changed")
                    native_connection = profile.get("native_status_connection")
                    executable = profile.get("native_status_executable") or dispatch.get("executable")
                    if native_connection is not None and (
                        not isinstance(native_connection, dict)
                        or not isinstance(native_connection.get("binding"), dict)
                        or native_connection["binding"].get("actor_id") != self.p["actor_id"]
                        or native_connection["binding"].get("native_session_id") != native
                    ):
                        raise Error("native_status_connection_identity_invalid")
                    if native_connection or (self.p["host"] == "codex" and executable):
                        cached[0] = read_codex_state(executable, native, **(
                            {"connection_config": native_connection} if native_connection else {}
                        ))
                    else:
                        cached[0] = {"configured": False}
                return cached[0]

            try:
                result = CLIENT.keep_lease(
                    self.client,
                    sid,
                    self.state_dir / (sid + ".active"),
                    self.p["max_seconds"],
                    self.p["idle_seconds"],
                    ActivityStop(),
                    activity_probe=probe,
                    probe_grace_seconds=self.p["native_probe_grace_seconds"],
                )
                return result
            finally:
                worker.unlink(missing_ok=True)
                with lock(self.state_dir / "station.lock"):
                    state = self.state()
                    if state.get("session_id") == sid:
                        try:
                            session = self.client.call("sessions/" + sid)["session"]
                            state.update(
                                status="connected" if session["state"] == "connected" else "closed",
                                lease_until=session["lease_until"],
                                session_state=session["state"],
                            )
                        except Error:
                            state.update(status="unconfirmed")
                        state.update(
                            helper_result=result
                            or {"reason": "helper_failed", "lease_released": False},
                            helper_exited_at=time.time(),
                        )
                        state.pop("helper_pid", None)
                        atomic(self.state_file, state)


# @chain-region configure | calls: (station.state_dir / 'installation.json').exists, Error, Path, Path(__file__).resolve, Path(script).with_name, after.encode, atomic, backup.mkdir …
def configure(station, remove=False):
    """Merge only our entries, preserve unrelated settings, refuse changed ownership."""
    p, root = station.p, station.root
    saved_manifest = station.state_dir / "installation.json"
    key = (read_json(saved_manifest).get("key") if saved_manifest.exists() else None) or (
        "aieyra-control-" + hashlib.sha256(str(station.path).encode()).hexdigest()[:12]
    )
    script = str(Path(__file__).resolve())
    args = ["-X", "utf8", script, "--profile", str(station.path), "hook"]
    mcp = {
        "command": sys.executable,
        "args": [
            "-X",
            "utf8",
            str(Path(script).with_name("agent-client.py")),
            "--config",
            p["config_file"],
            "mcp",
        ],
    }
    software_project = root == Path(__file__).resolve().parents[1]
    if software_project:
        sys.path.insert(0, str(root / "service"))
        from paths import data_root

        if station.path.parent != data_root() / "agents/stations":
            raise Error("software_station_profile_must_use_external_storage")
        mcp = {
            "command": "python" if os.name == "nt" else "python3",
            "args": [
                "-X",
                "utf8",
                "scripts/agent-client.py",
                "--station",
                station.path.stem,
                "mcp",
            ],
        }
    contributions = {}
    if p["host"] == "claude":
        # Official exec form avoids shell expansion of paths on every platform.
        handler = {"type": "command", "command": sys.executable, "args": args, "timeout": 30}
        contributions[".claude/settings.local.json"] = {
            "hooks": {event: [{"hooks": [handler]}] for event in EVENTS["claude"]}
        }
        contributions[".mcp.json"] = {"mcpServers": {key: mcp}}
    elif p["host"] == "cursor":
        # Cursor only supports command strings. Encode static Windows PowerShell
        # invocation; untrusted hook payload always stays on stdin, never in shell.
        if os.name == "nt":
            import base64

            # @chain-region configure.psquote | calls: value.replace
            def psquote(value):
                return "'" + value.replace("'", "''") + "'"

            # ProcessStartInfo avoids PowerShell 5.1 native-pipeline/window-style
            # stalls, explicitly closes stdin, and keeps both processes hidden.
            command = (
                "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; "
                "[Console]::InputEncoding=[System.Text.Encoding]::UTF8; [Console]::OutputEncoding=[System.Text.Encoding]::UTF8; "
                "$stationInput=[Console]::In.ReadToEnd(); "
                "$s=New-Object System.Diagnostics.ProcessStartInfo; "
                "$s.FileName=" + psquote(sys.executable) + "; "
                "$s.Arguments=" + psquote(subprocess.list2cmdline(args)) + "; "
                "$s.UseShellExecute=$false; $s.CreateNoWindow=$true; "
                "$s.RedirectStandardInput=$true; $s.RedirectStandardOutput=$true; "
                "$s.RedirectStandardError=$true; "
                "$u=New-Object System.Text.UTF8Encoding($false); "
                "$s.StandardOutputEncoding=$u; $s.StandardErrorEncoding=$u; "
                "$p=[System.Diagnostics.Process]::Start($s); "
                "$out=$p.StandardOutput.ReadToEndAsync(); $err=$p.StandardError.ReadToEndAsync(); "
                "$bytes=$u.GetBytes($stationInput); $p.StandardInput.BaseStream.Write($bytes,0,$bytes.Length); $p.StandardInput.Close(); "
                "$p.WaitForExit(); [Console]::Out.Write($out.Result); [Console]::Error.Write($err.Result); "
                "exit $p.ExitCode"
            )
            encoded = base64.b64encode(command.encode("utf-16-le")).decode("ascii")
            command = "powershell.exe -NoProfile -NonInteractive -EncodedCommand " + encoded
        else:
            command = shlex.join([sys.executable, *args])
        contributions[".cursor/hooks.json"] = {
            "version": 1,
            "hooks": {event: [{"command": command}] for event in EVENTS["cursor"]},
        }
        contributions[".cursor/mcp.json"] = {"mcpServers": {key: mcp}}

    text_parts = {
        "AGENTS.md": (
            "## Persistent Aieyra Control station\n\n"
            f"Project `{p['project']}`, host `{p['host']}`, actor `{p['actor_id']}`, seat `{p['seat_id']}`.\n"
            "Use this profile only when continuing this assigned responsibility; if several station blocks exist, "
            "select your own role rather than joining all of them.\n"
            f"Private profile reference: `{station.path}` (never copy credentials into documentation).\n"
            f"At session start, resume and after compaction, run `{sys.executable}` with arguments "
            f"`-X utf8`, `{script}`, `--profile`, `{station.path}`, `join`, `--native-session-id`, "
            "and the real current native session ID. Do not reuse an old transport ID.\n"
            "Then read project memory, runtime inbox, and coordination chat via agent-client.py "
            "call center/history or call center/inbox (continue with next_cursor as after). "
            "Only after reading relevant messages use call center/ack with their IDs; reply with "
            "verified outcomes when requested. Chat reading does not execute tasks. A changed native ID "
            "requires explicit CAS handoff by the leader; an occupied station must not be taken over. "
            "Read this profile's state/connection.json for the actual transport ID; refresh through join "
            "at real work boundaries only. Before final response save five memory sections using current "
            "version/CAS, then station finish with the same native ID. Report confirmed station problems "
            "through the existing Control channel. This adds no model, production or deployment authority.\n"
        )
    }
    if p["host"] == "claude":
        text_parts["CLAUDE.md"] = (
            "Read and follow the persistent Control station instructions:\n\n"
            "@AGENTS.md\n"
        )
    if software_project:
        text_parts["AGENTS.md"] = (
            "## Private collaboration storage\n\n"
            "Software and private data use separate directories. Resolve storage.json or "
            "AIEYRA_CONTROL_DATA as described in README.md. Existing station profiles and "
            "their state live in that data root under agents/stations. Read the assigned "
            "profile before connecting, and preserve its actor, seat and native-session "
            "handoff requirements. Never store credentials, conversation history, private "
            "project records or machine-specific paths in the software directory.\n"
        )
    if p["host"] == "cursor":
        text_parts[".cursor/rules/" + key + ".mdc"] = (
            "---\ndescription: Persistent Aieyra Control station\nalwaysApply: true\n---\n"
            "Read @AGENTS.md at each new or resumed conversation and after compaction. "
            "Use the real conversation_id for station recovery. Save project memory before finishing.\n"
        )
    if p["host"] == "codex":
        import tomllib

        target = root / ".codex/config.toml"
        existing = target.read_text(encoding="utf-8-sig") if target.exists() else ""
        parsed = tomllib.loads(existing)
        if (
            key in parsed.get("mcp_servers", {})
            and not (station.state_dir / "installation.json").exists()
        ):
            raise Error("existing_mcp_entry_not_owned")
        text_parts[".codex/config.toml"] = (
            f"[mcp_servers.{key}]\ncommand = {json.dumps(mcp['command'])}\n"
            f"args = {json.dumps(mcp['args'], ensure_ascii=False)}\n"
        )

    # @chain-region configure.merge | calls: Error, current.get, current.setdefault, found.append, found.remove, isinstance, merge, wanted.items
    def merge(current, wanted, delete=False):
        if not isinstance(current, dict):
            raise Error("configuration_shape_conflict")
        for name, value in wanted.items():
            if isinstance(value, dict):
                if name not in current:
                    if delete:
                        continue
                    current[name] = {}
                merge(current[name], value, delete)
                if delete and not current[name]:
                    del current[name]
            elif isinstance(value, list):
                found = current.setdefault(name, [])
                if not isinstance(found, list):
                    raise Error("configuration_shape_conflict")
                for item in value:
                    if delete:
                        if item not in found:
                            raise Error("managed_hook_changed_preserve_manual_edit")
                        found.remove(item)
                    elif item not in found:
                        found.append(item)
                if delete and not found:
                    del current[name]
            elif delete:
                # Keep shared schema version, remove only owned scalar leaves.
                if name == "version":
                    continue
                if current.get(name) != value:
                    raise Error("managed_setting_changed_preserve_manual_edit")
                del current[name]
            else:
                if name in current and current[name] != value:
                    raise Error("existing_setting_conflict")
                current[name] = value

    manifest_path = station.state_dir / "installation.json"
    with lock(station.state_dir / "install.lock"):
        manifest = read_json(manifest_path) if manifest_path.exists() else {"files": {}}
        if remove and not manifest["files"]:
            return {"status": "not_installed", "changed": []}
        changes = []
        updated = {"host": p["host"], "key": key, "files": {}}
        for rel in sorted(set(contributions) | set(text_parts) | set(manifest["files"])):
            target = root / rel
            if not target.resolve().is_relative_to(root):
                raise Error("configuration_path_escapes_project")
            before = target.read_bytes() if target.exists() else None
            text_before = before.decode("utf-8-sig") if before is not None else ""
            old = manifest["files"].get(rel)
            if rel.endswith(".mdc"):
                if old and text_before != old["full"]:
                    raise Error("managed_rule_changed_preserve_manual_edit")
                if before is not None and not old:
                    raise Error("existing_rule_not_owned")
                after = "" if remove else text_parts[rel]
                if not remove:
                    updated["files"][rel] = {"full": after}
            elif rel.endswith(".json"):
                data = json.loads(text_before) if text_before.strip() else {}
                if old:
                    merge(data, old["owned"], True)
                elif rel in contributions:
                    servers = data.get("mcpServers", {})
                    if key in servers:
                        raise Error("existing_mcp_entry_not_owned")
                if not remove and rel in contributions:
                    merge(data, contributions[rel])
                    updated["files"][rel] = {"owned": contributions[rel]}
                after = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
            else:
                toml = rel.endswith(".toml")
                start = ("# " if toml else "<!-- ") + "BEGIN " + key + ("" if toml else " -->")
                end = ("# " if toml else "<!-- ") + "END " + key + ("" if toml else " -->")
                base = text_before
                if start in base or end in base:
                    if not old or base.count(start) != 1 or base.count(end) != 1:
                        raise Error("unowned_or_ambiguous_instruction_block")
                    a, b = base.index(start), base.index(end) + len(end)
                    if base[a:b].replace("\r\n", "\n") != old["owned"].replace("\r\n", "\n"):
                        raise Error("managed_instructions_changed_preserve_manual_edit")
                    base = base[:a] + base[b:].removeprefix("\r\n\r\n").removeprefix("\n\n")
                elif old:
                    raise Error("managed_instructions_missing")
                if not remove and rel in text_parts:
                    owned = start + "\n" + text_parts[rel] + end
                    # Cursor frontmatter must begin at byte zero.
                    after = owned + "\n\n" + base
                    updated["files"][rel] = {"owned": owned}
                else:
                    after = base
                if rel.endswith(".toml"):
                    import tomllib

                    tomllib.loads(after)
            after_bytes = after.encode("utf-8")
            if before != after_bytes:
                changes.append((target, before, after_bytes))
        # Validate every intended edit before the first write; keep exact original bytes.
        backup = station.state_dir / "backups" / uuid.uuid4().hex
        backup.mkdir(parents=True)
        journal = []
        for target, before, after in changes:
            if (target.read_bytes() if target.exists() else None) != before:
                raise Error("configuration_changed_during_install")
            rel = target.relative_to(root).as_posix()
            if before is not None:
                saved = backup / rel
                saved.parent.mkdir(parents=True, exist_ok=True)
                saved.write_bytes(before)
            journal.append(
                {
                    "path": rel,
                    "existed": before is not None,
                    "before_sha256": hashlib.sha256(before).hexdigest()
                    if before is not None
                    else None,
                    "after_sha256": hashlib.sha256(after).hexdigest(),
                }
            )
        atomic(backup / "journal.json", {"changes": journal})
        for target, before, after in changes:
            if (target.read_bytes() if target.exists() else None) != before:
                raise Error("configuration_changed_during_install")
            target.parent.mkdir(parents=True, exist_ok=True)
            tmp = target.with_name(target.name + "." + uuid.uuid4().hex + ".tmp")
            tmp.write_bytes(after)
            os.replace(tmp, target)
        atomic(manifest_path, updated if not remove else {"files": {}})
        return {
            "status": "uninstalled" if remove else "configured",
            "host": p["host"],
            "changed": [x["path"] for x in journal],
            "backup": str(backup),
            "actual_host_verified": False,
            "requires_trusted_project": True,
        }


# @chain-region keepalive_wait | calls: Error, current.get, max, min, plan.get, station.client.call, str, time.sleep …
def keepalive_wait(station, max_wait):
    """For hosts that wake a session when a background command ends (Claude Code).

    Polls the plan, sleeps until it is due (activity pushes it later), records the
    fire and returns the message. Never fires without an active host plan.
    """
    if not 60 <= max_wait <= 7200:
        raise Error("invalid_keepalive_wait")
    deadline = time.time() + max_wait
    while True:
        current = station.client.call("station/keepalive")
        plan = current.get("keepalive")
        if not plan or plan.get("delivery") != "host" or plan.get("state") != "waiting_host":
            return {"status": "inactive", "keepalive": plan}
        due = current.get("next_due") or time.time()
        if time.time() >= due - 15:
            fired = station.client.call(
                "station/keepalive",
                {
                    "request_id": "keepalive-fire-" + plan["id"] + "-" + str(plan["fires"] + 1),
                    "action": "fire",
                    "id": plan["id"],
                },
            )
            return {"status": "fired", **fired}
        if time.time() >= deadline:
            return {"status": "waiting", "next_due": due}
        time.sleep(max(5, min(60, due - time.time(), deadline - time.time())))


# @chain-region main | calls: (station.root / '.codex/config.toml').read_text, Error, ID.fullmatch, Path, Path(args.body_file).read_text, Station, argparse.ArgumentParser, body.strip …
def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", required=True, type=Path)
    commands = parser.add_subparsers(dest="command", required=True)
    p = commands.add_parser("create", help="Create a dedicated local station and join it")
    p.add_argument("--name", required=True)
    p.add_argument("--project", required=True)
    p.add_argument("--root", required=True, type=Path)
    p.add_argument("--host", required=True, choices=HOSTS)
    p.add_argument("--native-session-id", required=True)
    p.add_argument("--port", type=int, default=17930)
    p.add_argument("--no-lease", action="store_true", help="Do not start the bounded lease helper")
    p.add_argument("--resume", action="store_true", help="Continue exactly the saved creation")
    commands.add_parser("doctor")
    commands.add_parser("os-doctor")
    commands.add_parser("hook")
    p = commands.add_parser("workspace", help="Prepare or inspect the assigned task's Git worktree")
    p.add_argument("operation", choices=("prepare", "status"))
    p.add_argument("--task", required=True)
    p.add_argument("--native-session-id", required=True)
    p.add_argument("--base", help="Full Git commit ID when first preparing a task")
    p.add_argument("--workspace-root", type=Path, help="Absolute parent directory for linked worktrees")
    p = commands.add_parser("space", help="Inspect the local project space or save a Git stage")
    p.add_argument("--native-session-id", required=True)
    operations = p.add_subparsers(dest="operation", required=True)
    operations.add_parser("status")
    snapshot = operations.add_parser("snapshot")
    snapshot.add_argument("--name", required=True)
    snapshot.add_argument("--revision", required=True, help="Full Git commit ID of the selected stage")
    for command in ("join", "finish"):
        p = commands.add_parser(command)
        p.add_argument("--native-session-id", required=True)
        if command == "join":
            p.add_argument(
                "--resume",
                action="store_true",
                help="Return bounded private handoff bodies; never ACK or save the cursor",
            )
            p.add_argument("--after", type=int, default=0)
            p.add_argument("--limit", type=int, default=20)
            p.add_argument("--stream-epoch", help="Validate the prior project-view message stream")
    p = commands.add_parser("watch")
    p.add_argument("--session-id", required=True)
    p = commands.add_parser(
        "notify-leader", help="Send a durable leader message and request bounded native wakeup"
    )
    p.add_argument("--request-id", required=True)
    p.add_argument("--body-file", required=True, help="UTF-8 message, at most 2000 characters")
    p.add_argument("--leader-actor-id")
    p = commands.add_parser("notification", help="Query the original leader-notification receipt")
    p.add_argument("--id", required=True)
    p = commands.add_parser("notifications", help="Page received or sent notifications without ACK")
    p.add_argument("--direction", choices=("received", "sent"), default="received")
    p.add_argument("--status", choices=("unhandled", "all"), default="unhandled")
    p.add_argument("--limit", type=int, default=50)
    p.add_argument("--after")
    p = commands.add_parser(
        "notification-ack", help="Explicitly record reading or handling with your live session"
    )
    p.add_argument("--session-id", required=True)
    p.add_argument("--id", required=True)
    p.add_argument("--state", choices=("read", "handled"), required=True)
    p.add_argument("--review-previous-binding", action="store_true")
    p.add_argument("--expected-binding-version", type=int)
    p.add_argument("--reason")
    p = commands.add_parser(
        "keepalive-wait",
        help="Host delivery: block until this station's keepalive is due, record it and print the message",
    )
    p.add_argument(
        "--max-wait", type=int, default=3700, help="Seconds before returning without a fire"
    )
    for command in ("install", "uninstall"):
        commands.add_parser(command)
    p = commands.add_parser("codex", help="Explicit project-scoped MCP configuration for Codex CLI")
    p.add_argument("arguments", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    try:
        if args.command == "create":
            output = create_station(
                args.profile,
                name=args.name,
                project=args.project,
                root=args.root,
                host=args.host,
                native=args.native_session_id,
                port=args.port,
                resume=args.resume,
                lease=not args.no_lease,
            )
            print(json.dumps(output, ensure_ascii=False))
            return 0
        station = Station(args.profile)
        if args.command == "codex":
            if station.p["host"] != "codex":
                raise Error("codex_profile_required")
            executable = shutil.which("codex")
            if not executable:
                raise Error("codex_executable_missing")
            key = "aieyra-control-" + hashlib.sha256(str(station.path).encode()).hexdigest()[:12]
            import tomllib

            config = tomllib.loads(
                (station.root / ".codex/config.toml").read_text(encoding="utf-8-sig")
            )
            server = config.get("mcp_servers", {}).get(key)
            if not server:
                raise Error("install_station_configuration_first")
            argv = [executable]
            for name, value in server.items():
                argv += ["-c", f"mcp_servers.{key}.{name}=" + json.dumps(value, ensure_ascii=False)]
            trailing = args.arguments
            if trailing and trailing[0] == "--":
                trailing = trailing[1:]
            argv += trailing
            result = subprocess.run(
                argv,
                cwd=station.root,
                stdin=sys.stdin,
                stdout=sys.stdout,
                stderr=sys.stderr,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            )
            return result.returncode
        if args.command == "hook":
            raw = sys.stdin.buffer.read(1024 * 1024 + 1)
            if len(raw) > 1024 * 1024:
                raise Error("hook_payload_too_large")
            _, output = station.hook(json.loads(raw))
        elif args.command == "doctor":
            output = station.doctor()
        elif args.command == "os-doctor":
            output = station.os_doctor()
        elif args.command == "workspace":
            output = station.workspace(
                args.operation, args.task, args.native_session_id, args.base, args.workspace_root,
            )
        elif args.command == "space":
            from task_worktree import WorkspaceError

            try:
                output = station.project_space(
                    args.operation, args.native_session_id, getattr(args, "name", None), getattr(args, "revision", None),
                )
            except WorkspaceError as error:
                raise Error(str(error)) from None
        elif args.command == "join":
            output = station.ensure(
                args.native_session_id,
                True,
                resume=args.resume,
                after=args.after,
                limit=args.limit,
                stream_epoch=args.stream_epoch,
            )
        elif args.command == "finish":
            output = station.finish(args.native_session_id)
        elif args.command == "watch":
            output = station.watch(args.session_id)
        elif args.command == "notify-leader":
            body = Path(args.body_file).read_text(encoding="utf-8-sig")
            if not body.strip() or len(body) > 2000:
                raise Error("invalid_leader_notification")
            payload = {"request_id": args.request_id, "body": body}
            if args.leader_actor_id:
                payload["leader_actor_id"] = args.leader_actor_id
            output = station.client.call("station/notify-leader", payload)
        elif args.command == "keepalive-wait":
            output = keepalive_wait(station, args.max_wait)
        elif args.command == "notification":
            if not ID.fullmatch(args.id):
                raise Error("invalid_notification_id")
            output = station.client.call("station/notifications/" + args.id)
        elif args.command == "notifications":
            if not 1 <= args.limit <= 100 or (
                args.after is not None and not ID.fullmatch(args.after)
            ):
                raise Error("invalid_notification_query")
            query = {"direction": args.direction, "status": args.status, "limit": args.limit}
            if args.after is not None:
                query["after"] = args.after
            output = station.client.call("station/notifications", query=query)
        elif args.command == "notification-ack":
            payload = {"session_id": args.session_id, "id": args.id, "state": args.state}
            if args.review_previous_binding:
                payload["review_previous_binding"] = True
            if args.expected_binding_version is not None:
                payload["expected_binding_version"] = args.expected_binding_version
            if args.reason is not None:
                payload["reason"] = args.reason
            output = station.client.call("station/notification-ack", payload)
        else:
            output = configure(station, remove=args.command == "uninstall")
        print(json.dumps(output, ensure_ascii=False))
        return 1 if args.command == "finish" and output.get("lease_released") is not True else 0
    except (Error, OSError, ValueError, KeyError) as error:
        code = (
            error.code if isinstance(error, Error) else "invalid_or_unavailable_local_configuration"
        )
        if args.command == "hook":
            print("{}")
            print(
                "Aieyra Control: " + code + "; use station doctor at the next work boundary.",
                file=sys.stderr,
            )
            return 0
        print(json.dumps({"status": "error", "code": code}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
