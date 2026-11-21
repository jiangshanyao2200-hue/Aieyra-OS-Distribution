# @file-map:start
# 文件: link/office/scripts/task_delegation.py
# 位置: 二环·工位CLI | 工位 Agent 接入、原编号投递回执、续接及本地工单工作区。
# 约束: 从当前响应读取身份与可用端点；日志脱敏且有界，不以命令返回替代实际工位状态
# 下游: 无已解析的项目内静态导入
# 上游: link/office/scripts/agent-client.py, link/office/scripts/agent-station.py
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: python -X utf8 -B -m unittest discover -s link/office/tests/service -p test_agent_client.py
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   DelegationError | class
#   DelegationError.__init__ | function
#   require | function
#   canonical | function
#   digest | function
#   read | function
#   save | function
#   exclusive | function
#   native_adapter | function
#   TaskDelegator | class
#   TaskDelegator.__init__ | function
#   TaskDelegator.identity | function
#   TaskDelegator.request_path | function
#   TaskDelegator.authorized | function
#   TaskDelegator.target | function
#   TaskDelegator.status | function
#   TaskDelegator.reconcile_unsent | function
#   TaskDelegator.delegate | function
#   TaskDelegator.delegate.before_send | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Explicit work-order delivery to the existing bound native conversation.

The center owns tasks. This local adapter owns native-send intents and receipts;
it never starts a new host, rebinds a seat, or retries an uncertain native write.
"""

from contextlib import contextmanager
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import time
import uuid


ID = re.compile(r"^[A-Za-z0-9_.:-]{1,100}$")
TERMINAL = {"accepted", "delivered", "cancelled", "superseded"}
SENT = {"submitting", "notified", "unknown"}


# @chain-region DelegationError | calls: super, super().__init__
class DelegationError(Exception):
    # @chain-region DelegationError.__init__ | calls: super, super().__init__
    def __init__(self, code):
        self.code = code
        super().__init__(code)


# @chain-region require | calls: DelegationError
def require(condition, code):
    if not condition:
        raise DelegationError(code)


# @chain-region canonical | calls: json.dumps
def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


# @chain-region digest | calls: canonical, canonical(value).encode, hashlib.sha256, hashlib.sha256(canonical(value).encode('utf-8')).hexdigest
def digest(value):
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


# @chain-region read | calls: json.loads, path.read_text
def read(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


# @chain-region save | calls: canonical, os.fsync, os.replace, output.fileno, output.flush, output.write, path.with_name, temporary.open …
def save(path, value):
    temporary = path.with_name(path.name + ".tmp-" + uuid.uuid4().hex)
    try:
        with temporary.open("x", encoding="utf-8", newline="\n") as output:
            output.write(canonical(value))
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


# @chain-region exclusive | calls: DelegationError, directory.mkdir, fcntl.flock, handle.fileno, handle.flush, handle.seek, handle.tell, handle.write …
@contextmanager
def exclusive(directory):
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / ".delegate.lock"
    # Keep a stable lock file: kernel ownership ends on process death. Unlinking
    # it would allow different processes to lock different files at one path.
    with path.open("a+b") as handle:
        if handle.tell() == 0:
            handle.write(b"0")
            handle.flush()
        handle.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            raise DelegationError("task_delegation_in_progress_query_original") from None
        try:
            yield
        finally:
            handle.seek(0)
            if os.name == "nt":
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


# @chain-region native_adapter | calls: Path, Path(__file__).resolve, importlib.util.module_from_spec, importlib.util.spec_from_file_location, module.NativeWakeup, spec.loader.exec_module
def native_adapter(config):
    source = Path(__file__).resolve().parents[1] / "service/native_wakeup.py"
    spec = importlib.util.spec_from_file_location("aieyra_task_native", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.NativeWakeup({"enabled": True, "host": "codex", "executable": config["executable"]})


# @chain-region TaskDelegator | calls: DelegationError, ID.fullmatch, Path, Path(__file__).resolve, Path(directory).is_absolute, Path(executable).is_absolute, Path(executable).is_file, Path(template_path).read_text …
class TaskDelegator:
    # @chain-region TaskDelegator.__init__ | calls: Path, Path(directory).is_absolute, isinstance, require, self.config.get
    def __init__(self, client, config, adapter_factory=native_adapter):
        self.client, self.config, self.adapter_factory = client, config or {}, adapter_factory
        directory = self.config.get("state_dir")
        require(isinstance(directory, str) and Path(directory).is_absolute(), "task_delegation_state_dir_required")
        self.directory = Path(directory)

    # @chain-region TaskDelegator.identity | calls: ID.fullmatch, isinstance, require, self.client.call, self.client.call('seats').get
    def identity(self):
        identity = self.client.call("seats").get("actor_id")
        require(isinstance(identity, str) and ID.fullmatch(identity), "task_delegation_identity_unavailable")
        return identity

    # @chain-region TaskDelegator.request_path | calls: ID.fullmatch, digest, isinstance, require
    def request_path(self, actor, request_id):
        require(isinstance(request_id, str) and ID.fullmatch(request_id), "invalid_task_delegation_request_id")
        return self.directory / ("request-" + digest([self.client.url, actor, request_id]) + ".json")

    # @chain-region TaskDelegator.authorized | calls: any, registry.get, require, row.get, self.client.call
    def authorized(self, actor, project):
        registry = self.client.call("center/registry")
        require(any(
            row.get("actor_id") == actor and row.get("active")
            and row.get("role") in ("leader", "deputy")
            and (project in row.get("projects", []) or "*" in row.get("projects", []))
            for row in registry.get("governance", [])
        ), "task_delegation_leader_required")
        return registry

    # @chain-region TaskDelegator.target | calls: ID.fullmatch, binding.get, isinstance, len, registry.get, require, row.get, row.get('station_binding', {}).get …
    def target(self, task):
        registry = self.client.local_registry()
        seats = [row for row in registry.get("seats", [])
                 if row.get("actor_id") == task["assignee"] and row.get("project") == task["project"]
                 and row.get("membership_state") == "active"
                 and row.get("desired_state") not in ("removed", "retired", "archived")
                 and row.get("station_binding", {}).get("seat_id") == row.get("id")]
        require(len(seats) == 1, "task_delegation_native_binding_missing_or_ambiguous")
        binding = seats[0]["station_binding"]
        require(isinstance(binding.get("native_session_id"), str) and ID.fullmatch(binding["native_session_id"])
                and type(binding.get("version")) is int and binding["version"] > 0,
                "task_delegation_native_binding_invalid")
        return {"actor_id": task["assignee"], "seat_id": seats[0]["id"],
                "native_session_id": binding["native_session_id"], "binding_version": binding["version"]}

    # @chain-region TaskDelegator.status | calls: dict, getattr, path.is_file, read, require, self.authorized, self.client.call, self.identity …
    def status(self, request_id):
        actor = self.identity()
        path = self.request_path(actor, request_id)
        require(path.is_file(), "task_delegation_request_missing")
        reference = read(path)
        row = read(self.directory / reference["receipt"])
        self.authorized(actor, row["project"])
        result = dict(row, replayed=True, replay_allowed=False)
        # This is a separate current task observation, not proof the message was read.
        result["task_current"] = self.client.call("center/task", query={"id": row["task_id"]})
        try:
            result["center_dispatch"] = self.client.call("center/task-dispatch", query={"id": row["task_id"], "dispatch_id": row["id"]})
        except Exception as error:
            result["center_dispatch_error"] = getattr(error, "code", "task_dispatch_query_unavailable")
        return result

    # @chain-region TaskDelegator.reconcile_unsent | calls: exclusive, read, require, row.get, row.pop, row.update, save, self.authorized …
    def reconcile_unsent(self, request_id):
        """Settle an aborted center begin, only with durable proof native send never began."""
        actor = self.identity()
        with exclusive(self.directory):
            reference = read(self.request_path(actor, request_id))
            path = self.directory / reference['receipt']
            row = read(path)
            self.authorized(actor, row['project'])
            require(row.get('native_send_aborted') is True and row.get('native_send_started') is False,
                    'task_dispatch_native_outcome_unknown_query_only')
            original = self.client.call('center/task-dispatch', query={'id': row['task_id'], 'dispatch_id': row['id']})
            require(original['state'] in ('submitting', 'not_sent'), 'task_dispatch_query_original')
            if original['state'] == 'submitting':
                self.client.call('center/task-dispatch', {'request_id': row['id'] + '.unsent-recovery',
                    'id': row['task_id'], 'version': row['task_version'], 'dispatch_id': row['id'], 'state': 'not_sent'})
            row.update(state='not_sent', center_dispatch_recorded=True, updated=time.time())
            row.pop('center_dispatch_error', None)
            save(path, row)
        return self.status(request_id)

    # @chain-region TaskDelegator.delegate | calls: DelegationError, ID.fullmatch, Path, Path(__file__).resolve, Path(executable).is_absolute, Path(executable).is_file, Path(template_path).read_text, adapter.notify …
    def delegate(self, arguments):
        require(isinstance(arguments, dict) and not set(arguments) - {"request_id", "task_id", "version", "instruction"}
                and {"request_id", "task_id", "version"} <= set(arguments), "invalid_task_delegation_fields")
        require(isinstance(arguments["task_id"], str) and ID.fullmatch(arguments["task_id"])
                and type(arguments["version"]) is int and arguments["version"] > 0,
                "invalid_task_delegation_task")
        instruction = arguments.get("instruction", "")
        require(isinstance(instruction, str) and len(instruction) <= 2000, "invalid_task_delegation_instruction")
        require(self.config.get("enabled") is True, "task_delegation_not_configured")
        executable = self.config.get("executable")
        require(isinstance(executable, str) and Path(executable).is_absolute() and Path(executable).is_file(),
                "task_delegation_native_executable_required")
        actor = self.identity()
        request_path = self.request_path(actor, arguments["request_id"])
        request_hash = digest(arguments)
        with exclusive(self.directory):
            if request_path.exists():
                reference = read(request_path)
                require(reference["digest"] == request_hash, "task_delegation_request_id_conflict")
                row = read(self.directory / reference["receipt"])
                self.authorized(actor, row["project"])
                if row["state"] in SENT or row.get('center_dispatch_attempted'):
                    return dict(row, replayed=True, replay_allowed=False)
            task = self.client.call("center/task", query={"id": arguments["task_id"]})
            self.authorized(actor, task["project"])
            require(task["version"] == arguments["version"], "task_delegation_version_changed")
            require(task.get("status") not in TERMINAL, "task_delegation_task_closed")
            require(isinstance(task.get("assignee"), str) and task["assignee"], "task_delegation_assignee_required")
            if task["assignee"] == actor:
                return {"state": "self_assigned", "task_id": task["id"], "native_send_performed": False}
            require(not (task.get("owner") and task["owner"] != task["assignee"]
                         and task.get("lease_until", 0) > time.time()), "task_delegation_task_owned_elsewhere")
            target = self.target(task)
            template_path = self.config.get("prompt_file")
            if not template_path:
                template_path = Path(__file__).resolve().parents[3] / "Agent/official/Eyra/prompts/contracts/工单委派.txt"
            try:
                template = Path(template_path).read_text(encoding="utf-8-sig")
            except (OSError, UnicodeError):
                raise DelegationError("task_delegation_prompt_unreadable") from None
            require(template.strip() and len(template.encode("utf-8")) <= 16384, "task_delegation_prompt_invalid")
            frozen_task = {key: task.get(key) for key in
                           ("id", "project", "title", "scope", "version", "assignee", "request", "acceptance")}
            intent = {"task": frozen_task, "target": target, "instruction": instruction, "template": template}
            intent_hash = digest(intent)
            delegation_id = "delegate-" + digest([self.client.url, task["project"], task["id"], task["version"], target])[:48]
            receipt_path = self.directory / (delegation_id + ".json")
            if receipt_path.exists():
                row = read(receipt_path)
                require(row["intent_sha256"] == intent_hash, "task_delegation_intent_conflict")
                save(request_path, {"digest": request_hash, "receipt": receipt_path.name})
                if row["state"] in SENT or row.get('center_dispatch_attempted'):
                    return dict(row, replayed=True, replay_allowed=False)
            else:
                row = {"schema": 1, "id": delegation_id, "request_id": arguments["request_id"],
                       "sender": actor, "project": task["project"], "task_id": task["id"],
                       "task_version": task["version"], "target": target, "intent_sha256": intent_hash,
                       "state": "prepared", "created": time.time()}
            save(receipt_path, row)
            save(request_path, {"digest": request_hash, "receipt": receipt_path.name})
            sending = False
            dispatch_recorded = False
            try:
                if not row.get("message_id"):
                    notice = self.client.call("center/message", {
                        "request_id": delegation_id + ".intent", "project": task["project"], "kind": "handoff",
                        "body": "正在把工单交给负责的会话。\n" + canonical({"delegation": delegation_id, "task": frozen_task,
                                                                  "target": target, "intent_sha256": intent_hash})})
                    row["message_id"] = notice["id"]
                    save(receipt_path, row)
                envelope = {"request_id": row["request_id"], "delegation_id": delegation_id,
                            "message_id": row["message_id"], "task": frozen_task, "instruction": instruction,
                            "target": target, "dispatch_version": task['version']}
                prompt = "[aieyra-workorder-delegation:" + delegation_id + "]\n" + template.rstrip() + "\n\n" + canonical(envelope)
                row["input_sha256"] = hashlib.sha256(prompt.encode("utf-8")).hexdigest()

                # @chain-region TaskDelegator.delegate.before_send | calls: current.get, require, row.update, save, self.authorized, self.client.call, self.target
                def before_send():
                    nonlocal sending, dispatch_recorded
                    self.authorized(actor, task["project"])
                    current = self.client.call("center/task", query={"id": task["id"]})
                    require(current["version"] == task["version"] and current.get("assignee") == task["assignee"]
                            and current.get("status") not in TERMINAL, "task_delegation_task_changed")
                    require(self.target(current) == target, "task_delegation_binding_changed")
                    row.update(state='submitting', center_dispatch_attempted=True, native_send_started=False)
                    save(receipt_path, row)
                    self.client.call('center/task-dispatch', {
                        'request_id': delegation_id + '.begin', 'id': task['id'],
                        'version': task['version'], 'dispatch_id': delegation_id, 'state': 'submitting',
                        'native_session_id': target['native_session_id'], 'binding_version': target['binding_version'],
                    })
                    dispatch_recorded = True
                    row["native_send_started"] = True
                    save(receipt_path, row)
                    sending = True

                adapter = self.adapter_factory(self.config)
                native = adapter.notify({"leader": target["actor_id"], **target}, prompt, delegation_id, before_send)
                require(isinstance(native, dict) and native.get("thread_id") == target["native_session_id"]
                        and isinstance(native.get("turn_id"), str) and native["turn_id"], "task_delegation_invalid_native_receipt")
                row.update(state="notified", native_receipt=native, error=None)
            except Exception as error:
                code = error.code if hasattr(error, "code") else str(error) if type(error).__name__ == "WakeError" else "task_delegation_adapter_unavailable"
                row.update(state="unknown" if sending or row.get('center_dispatch_attempted') and not dispatch_recorded else "not_sent", error=code,
                           native_send_aborted=not sending)
            row["updated"] = time.time()
            if dispatch_recorded:
                try:
                    self.client.call('center/task-dispatch', {
                        'request_id': delegation_id + '.result', 'id': task['id'], 'version': task['version'],
                        'dispatch_id': delegation_id, 'state': row['state'],
                    })
                    row['center_dispatch_recorded'] = True
                except Exception:
                    row['center_dispatch_recorded'] = False
                    row['center_dispatch_error'] = 'query_original_dispatch_before_handoff'
            save(receipt_path, row)
            return dict(row, replayed=False, replay_allowed=False)
