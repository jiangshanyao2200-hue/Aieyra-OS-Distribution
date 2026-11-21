# @file-map:start
# 文件: link/office/service/office_extensions.py
# 位置: 二环·工位服务 | 本机控制、接入、凭据、工位与租约的HTTP服务。
# 约束: 服务绑定本机并核对所有者身份；凭据与工作正文不因短暂失联清空；关闭使用租约排空
# 下游: link/office/service/service_common.py
# 上游: link/office/service/main.py
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: python -X utf8 -B -m unittest discover -s link/office/tests/service
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   require | function
#   digest | function
#   encode | function
#   save | function
#   NoRedirect | class
#   NoRedirect.redirect_request | function
#   OfficeExtensions | class
#   OfficeExtensions.__init__ | function
#   OfficeExtensions.guide | function
#   OfficeExtensions.read | function
#   OfficeExtensions.binding | function
#   OfficeExtensions.module | function
#   OfficeExtensions.invoke | function
#   OfficeExtensions.invoke.feed | function
#   OfficeExtensions.status | function
#   OfficeExtensions.agent | function
#   OfficeExtensions.send | function
#   OfficeExtensions.public_delivery | function
#   OfficeExtensions.ack | function
#   OfficeExtensions.record_check | function
#   OfficeExtensions.delivery_rows | function
#   OfficeExtensions.deliveries | function
#   OfficeExtensions.configure_cloud | function
#   OfficeExtensions.poll_cloud | function
#   OfficeExtensions.run | function
#   OfficeExtensions.archive | function
#   OfficeExtensions.verify_archive | function
#   OfficeExtensions.organize | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Local, user-owned host adapters and verifiable office maintenance.

Module code is deliberately supplied by the local agent, never by a browser or
remote message. It runs outside Control, against an immutable source revision.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import tempfile
import threading
import time
import uuid
import zipfile
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, ProxyHandler, HTTPRedirectHandler

from service_common import ID, Problem


# @chain-region require | calls: Problem
def require(ok, code):
    if not ok:
        raise Problem(code, code, 409)


# @chain-region digest | calls: hashlib.sha256, hashlib.sha256(data).hexdigest
def digest(data):
    return hashlib.sha256(data).hexdigest()


# @chain-region encode | calls: json.dumps, json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False).encode
def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False).encode("utf-8")


# @chain-region save | calls: encode, os.fsync, os.replace, out.fileno, out.flush, out.write, path.parent.mkdir, path.with_name …
def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        with temporary.open("xb") as out:
            out.write(encode(value))
            out.flush()
            os.fsync(out.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


# @chain-region NoRedirect
class NoRedirect(HTTPRedirectHandler):
    # @chain-region NoRedirect.redirect_request
    def redirect_request(self, *args, **kwargs):
        return None


# @chain-region OfficeExtensions | calls: (cached / name).read_bytes, (cached / name).resolve, (cached / name).write_bytes, (self.root / 'adapters').resolve, (self.root / 'deliveries').glob, ID.fullmatch, NoRedirect, Path …
class OfficeExtensions:
    # @chain-region OfficeExtensions.__init__ | calls: Path, self.read, threading.RLock
    def __init__(self, app, directory):
        self.app = app
        self.root = Path(directory) / "office"
        self.lock = threading.RLock()
        self.loaded = {}
        self.errors = {}
        self.cloud = {"state": "not_configured", "online": False, "authenticated": False}
        self.cloud_config = self.read("cloud.json", {})
        self.origin = ""

    # @chain-region OfficeExtensions.guide | calls: Path, Path(__file__).resolve, configured.get, dict, isinstance, item.get, projects.items, self.app.config.get …
    def guide(self, origin=""):
        app_root = Path(__file__).resolve().parents[1]
        origin = origin or self.origin
        configured = {item["id"]: item for item in self.app.config.get("local_projects", [])}
        projects = dict(configured)
        try:
            for item in self.app.registry().get("projects", []):
                if isinstance(item, dict) and isinstance(item.get("id"), str):
                    projects[item["id"]] = {**configured.get(item["id"], {}), **item}
        except Exception:
            # The local instructions remain usable while a remote center is down.
            pass
        return {
            "protocol": "aieyra-office/1",
            "name": "Link接入与私有适配",
            "origin": origin,
            "api_base": origin + "/api/agent/v1" if origin else "",
            "guide_url": origin + "/api/office/guide" if origin else "",
            "port": urlsplit(origin).port if origin else None,
            "projects": [
                {"id": key, "name": item.get("name", key), "root": item.get("root", "")}
                for key, item in sorted(projects.items())
            ],
            "hosts": ["codex", "claude", "cursor", "os", "generic"],
            "station_script": str(app_root / "scripts" / "agent-station.py"),
            "client_script": str(app_root / "scripts" / "agent-client.py"),
            "receipt_cli": {
                "script": str(app_root / "scripts" / "agent-adapter.py"),
                "arguments": ["--profile", "<own profile>", "ack", "--resume", "--receipt-file", "-"],
                "stdin": "received receipt JSON after reading",
            },
            "receipt_lookup": "office/deliveries?id=<delivery id> or office/deliveries?request_id=<own outgoing request id>",
            "python_executable": sys.executable,
            "join": "已有本人私有profile，用join --native-session-id <真实native> --resume恢复。首次用create --help查看参数，只登记本人工位；未知宿主用generic。先读项目记忆和收件箱再确认。",
            "adapter_directory": str(self.root / "adapters" / "<own actor_id>"),
            "manifest": {
                "protocol": "aieyra-office-adapter/1",
                "name": "My host",
                "host": "generic",
                "entry": "bridge.py",
                "files": ["bridge.py"],
                "capabilities": ["deliver"],
            },
            "adapter_contract": "Python以UTF-8 stdin接收单个JSON：protocol、operation=deliver、id、source、target={actor_id,native_session_id,binding_version}、body、receipt={endpoint,id,challenge,native_session_id}。向指定已有native会话投递正文和receipt，不偷偷创建模型会话。宿主实际接受才输出{protocol:aieyra-office-adapter/1,accepted:true}。限时8秒、stdout上限64KiB。本机自装代码不是沙箱。",
            "client": "从本人profile读取config_file，用agent-client.py --config <file> call <route> --body-file <JSON file>。不复制他人凭据。写入均包含当前transport session_id。",
            "actions": {
                "station/avatar": ["request_id", "session_id", "name", "pixels"],
                "office/reload": [],
                "office/check": ["request_id", "target"],
                "office/send": ["request_id", "target", "body"],
                "office/ack": ["id", "challenge", "native_session_id"],
                "office/archive": ["request_id"],
                "office/verify-archive": ["id"],
                "office/organize": [
                    "archive_id",
                    "task_id",
                    "version",
                    "replacement_ids",
                    "reason",
                ],
            },
            "pixel_avatar": "只可绘制本人工位。name 为 1–24 字符，pixels 为 14 行，每行 12 格。点号为透明，0–9 为固定调色板（#18222c,#305969,#58c1a5,#acd77d,#f3d493,#d78770,#f1aebb,#e0eced,#788bc3,#a188c9）。",
            "verification": "先自收，再与用户允许通信的工位双向测试。收件native Agent用自己令牌及投递的challenge确认。office/deliveries核对原账，unknown不得重发。源码修订或native绑定变化使旧验证失效。另用隔离测试任务验任务创建/领取/提交、memory CAS/冲突、inbox ACK、finish与恢复；通信通过不等于全部能力通过。",
            "remote": "127.0.0.1仅本机。异机先走Link设备配对。云服务由owner配置HTTPS base，GET /health返回protocol=aieyra-office/1、online=true、office_id。可达不等于已认证，私有适配封装所选云协议。",
        }

    # @chain-region OfficeExtensions.read | calls: Problem, json.loads, path.exists, path.read_text, path.stat, require
    def read(self, name, default):
        path = self.root / name
        if not path.exists():
            return default
        try:
            require(path.stat().st_size <= 2 * 1024 * 1024, "office_record_too_large")
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            raise Problem("office_record_invalid", "原始记录已保留。", 409) from None

    # @chain-region OfficeExtensions.binding | calls: ID.fullmatch, binding.get, isinstance, require, self.app.agent_access.binding, self.app.agent_access.native_bindings, self.app.agent_access.native_bindings(include_versions=True).get
    def binding(self, actor):
        require(isinstance(actor, str) and ID.fullmatch(actor), "office_actor_invalid")
        binding = self.app.agent_access.binding(actor)
        require(binding and binding.get("native_session_id"), "office_native_binding_required")
        native = self.app.agent_access.native_bindings(include_versions=True).get(actor)
        require(
            native and native["native_session_id"] == binding["native_session_id"],
            "office_native_binding_changed",
        )
        return {**binding, "version": native["version"]}

    # @chain-region OfficeExtensions.module | calls: (cached / name).read_bytes, (cached / name).resolve, (cached / name).write_bytes, (self.root / 'adapters').resolve, ID.fullmatch, Path, all, cached.exists …
    def module(self, actor):
        """Re-read on use: changed code never inherits an old verified result."""
        require(isinstance(actor, str) and ID.fullmatch(actor), "office_actor_invalid")
        directory = self.root / "adapters" / actor
        try:
            base = directory.resolve()
            require(
                not directory.is_symlink()
                and base.name == actor
                and base.parent == (self.root / "adapters").resolve(),
                "adapter_directory_invalid",
            )
            manifest_path = base / "manifest.json"
            require(
                manifest_path.resolve().parent == base and manifest_path.stat().st_size <= 16384,
                "adapter_manifest_invalid",
            )
            raw = manifest_path.read_bytes()
            manifest = json.loads(raw)
            require(
                set(manifest) == {"protocol", "name", "host", "entry", "files", "capabilities"},
                "adapter_manifest_fields",
            )
            require(manifest["protocol"] == "aieyra-office-adapter/1", "adapter_protocol_invalid")
            require(
                all(
                    isinstance(manifest[k], str) and 0 < len(manifest[k]) <= 100
                    for k in ("name", "host", "entry")
                ),
                "adapter_label_invalid",
            )
            files = manifest["files"]
            require(
                isinstance(files, list)
                and 1 <= len(files) <= 12
                and all(isinstance(f, str) for f in files)
                and len(set(files)) == len(files)
                and manifest["entry"] in files,
                "adapter_files_invalid",
            )
            require(
                isinstance(manifest["capabilities"], list)
                and set(manifest["capabilities"]) <= {"inspect", "deliver", "cancel", "cloud"},
                "adapter_capabilities_invalid",
            )
            sources = {"manifest.json": raw}
            for name in files:
                require(
                    isinstance(name, str) and name.endswith(".py") and Path(name).name == name,
                    "adapter_source_invalid",
                )
                path = base / name
                require(
                    path.resolve().parent == base and path.stat().st_size <= 262144,
                    "adapter_source_invalid",
                )
                code = path.read_bytes()
                compile(code, name, "exec")
                sources[name] = code
            revision = digest(encode({k: digest(v) for k, v in sources.items()}))
            cached = self.root / "revisions" / actor / revision
            require(
                cached.resolve() == self.root.resolve() / "revisions" / actor / revision,
                "adapter_revision_path_invalid",
            )
            if not cached.exists():
                cached.mkdir(parents=True)
                for name, code in sources.items():
                    (cached / name).write_bytes(code)
            require(
                all(
                    (cached / name).resolve().parent == cached.resolve()
                    and (cached / name).read_bytes() == code
                    for name, code in sources.items()
                ),
                "adapter_revision_changed",
            )
            row = {
                "actor_id": actor,
                "revision": revision,
                "name": manifest["name"],
                "host": manifest["host"],
                "capabilities": manifest["capabilities"],
                "entry": str(cached / manifest["entry"]),
            }
            self.loaded[actor] = row
            self.errors.pop(actor, None)
            return row
        except (OSError, ValueError, SyntaxError, TypeError, KeyError, Problem):
            self.errors[actor] = "adapter_missing_or_invalid"
            return None

    # @chain-region OfficeExtensions.invoke | calls: Path, Problem, encode, isinstance, json.load, k.upper, len, os.environ.items …
    def invoke(self, module, operation, value):
        require(operation in module["capabilities"], "adapter_capability_missing")
        request = encode({"protocol": "aieyra-office-adapter/1", "operation": operation, **value})
        require(len(request) <= 32768, "adapter_request_too_large")
        env = {
            k: v
            for k, v in os.environ.items()
            if k.upper() in {"SYSTEMROOT", "WINDIR", "PATH", "TEMP", "TMP", "LOCALAPPDATA"}
        }
        env["PYTHONDONTWRITEBYTECODE"] = "1"
        with tempfile.TemporaryFile() as output:
            process = subprocess.Popen(
                [sys.executable, "-X", "utf8", "-B", module["entry"]],
                cwd=str(Path(module["entry"]).parent),
                env=env,
                stdin=subprocess.PIPE,
                stdout=output,
                stderr=subprocess.DEVNULL,
                creationflags=(subprocess.CREATE_NO_WINDOW | subprocess.BELOW_NORMAL_PRIORITY_CLASS)
                if os.name == "nt"
                else 0,
            )

            # @chain-region OfficeExtensions.invoke.feed | calls: process.stdin.close, process.stdin.write
            def feed():
                try:
                    process.stdin.write(request)
                    process.stdin.close()
                except OSError:
                    pass

            # Windows communicate writes stdin synchronously. A host that never
            # reads must not block the timeout before it even starts.
            writer = threading.Thread(target=feed, daemon=True)
            writer.start()
            try:
                deadline = time.monotonic() + 8
                while process.poll() is None:
                    if (
                        time.monotonic() >= deadline
                        or os.fstat(output.fileno()).st_size > 65536
                        or self.app.stop.is_set()
                    ):
                        process.kill()
                        process.wait()
                        raise Problem(
                            "adapter_outcome_unknown", "请核对原投递，不能自动重发。", 409
                        )
                    self.app.stop.wait(0.025)
                require(
                    process.returncode == 0 and os.fstat(output.fileno()).st_size <= 65536,
                    "adapter_failed",
                )
                output.seek(0)
                result = json.load(output)
                require(
                    isinstance(result, dict)
                    and result.get("protocol") == "aieyra-office-adapter/1",
                    "adapter_response_invalid",
                )
                # Output is untrusted; never expose diagnostics, paths or secrets.
                return {"accepted": result.get("accepted") is True}
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()
                writer.join(1)
                if not process.stdin.closed:
                    process.stdin.close()

    # @chain-region OfficeExtensions.status | calls: ID.fullmatch, adapters.append, all, auto.get, binding.get, bool, checked.values, checks.get …
    def status(self, origin="", peer=None):
        if origin:
            self.origin = origin
        registry = self.app.registry()
        seats = [
            s
            for s in registry.get("seats", [])
            if s.get("membership_state") == "active"
            and s.get("desired_state") not in ("removed", "retired", "archived")
            and (peer is None or s.get("project") == peer["project"])
        ]
        adapters = []
        with self.lock:
            for seat in seats:
                actor = seat.get("actor_id")
                if not actor or not ID.fullmatch(actor):
                    continue
                row = self.module(actor)
                checks = self.read("verified/" + actor + ".json", {})
                try:
                    binding = self.binding(actor)
                except Problem:
                    binding = {}
                current = bool(
                    row
                    and checks.get("revision") == row["revision"]
                    and binding
                    and checks.get("native_session_id") == binding.get("native_session_id")
                    and checks.get("binding_version") == binding.get("version")
                )
                checked = {
                    key: bool(current and checks.get(key))
                    for key in ("self", "peer_in", "peer_out")
                }
                verified = all(checked.values())
                adapters.append(
                    {
                        "actor_id": actor,
                        "name": seat.get("name", actor),
                        "host": row["host"] if row else binding.get("host", "generic"),
                        "state": "verified" if verified else "adapted" if row else "registered",
                        "revision": row["revision"] if row else None,
                        "capabilities": row["capabilities"] if row else [],
                        "error": self.errors.get(actor),
                        "checks": {
                            **checked,
                            "peer": checked["peer_in"] and checked["peer_out"],
                            "tasks_memory": "requires_agent_validation",
                        },
                    }
                )
        link = self.app.device_link.status()
        devices = link.get("connections", [])
        device_ids = (
            {str(x.get("device_id") or x.get("id")) for x in devices if isinstance(x, dict)}
            if isinstance(devices, list)
            else set(devices)
        )
        auto = link.get("auto_lan") or {}
        guide = self.origin + "/api/office/guide" if self.origin else "本地Link的 /api/office/guide"
        return {
            "protocol": "aieyra-office/1",
            "stations": len(seats),
            "devices": len(device_ids),
            "lan": {"state": auto.get("state", auto.get("status", "unknown"))},
            "cloud": dict(self.cloud),
            "adapters": adapters,
            "join": f"请读取“Link接入与私有适配”协议 {guide}，加入本人已有或新工位；保留真实native身份，安装本人适配后完成自收、双向跨工位及任务记忆验证。异机先走Link设备配对，不复用别人的凭据。",
        }

    # @chain-region OfficeExtensions.agent | calls: Problem, require, row.items, self.ack, self.app.agent_access.session, self.app.agent_access.validate_center, self.archive, self.binding …
    def agent(self, peer, action, value):
        actor = peer["actor_id"]
        session = self.app.agent_access.session(peer, value.get("session_id"))
        self.app.agent_access.validate_center(peer, session)
        binding = self.binding(actor)
        if action == "reload":
            with self.lock:
                row = self.module(actor)
                require(row is not None, "adapter_missing_or_invalid")
                return {k: v for k, v in row.items() if k != "entry"}
        if action == "ack":
            return self.ack(actor, binding, value)
        if action in ("send", "check"):
            return self.send(peer, binding, value, action == "check")
        if action == "archive":
            return self.archive(peer, value)
        if action == "verify-archive":
            return self.verify_archive(actor, value.get("id"))
        if action == "organize":
            return self.organize(peer, value)
        raise Problem("office_action_unknown", "未知工位操作。", 404)

    # @chain-region OfficeExtensions.send | calls: ID.fullmatch, any, digest, encode, isinstance, len, nonce.encode, path.exists …
    def send(self, peer, binding, value, check):
        actor, target, rid = (
            peer["actor_id"],
            value.get("target", peer["actor_id"]),
            value.get("request_id"),
        )
        require(isinstance(rid, str) and ID.fullmatch(rid), "office_request_id_required")
        target_binding = self.binding(target)
        seats = self.app.registry().get("seats", [])
        require(
            any(
                s.get("actor_id") == target
                and s.get("project") == peer["project"]
                and s.get("membership_state") == "active"
                for s in seats
            ),
            "office_target_outside_project",
        )
        body = value.get("body", "Link通信自检")
        require(isinstance(body, str) and 0 < len(body) <= 8000, "office_message_invalid")
        key = digest(encode([actor, rid]))
        path = self.root / "deliveries" / (key + ".json")
        intent = digest(encode([actor, target, body, check]))
        with self.lock:
            if path.exists():
                row = self.read("deliveries/" + key + ".json", {})
                require(row["intent"] == intent, "office_request_conflict")
                return self.public_delivery(row)
            module = self.module(target)
            require(module is not None, "office_target_adapter_required")
            nonce = secrets.token_urlsafe(24)
            source_module = self.module(actor)
            row = {
                "id": key,
                "request_id": rid,
                "intent": intent,
                "source": actor,
                "source_native": binding["native_session_id"],
                "source_version": binding["version"],
                "source_revision": source_module["revision"] if source_module else None,
                "target": target,
                "project": peer["project"],
                "native_session_id": target_binding["native_session_id"],
                "binding_version": target_binding.get("version"),
                "revision": module["revision"],
                "state": "submitting",
                "challenge_hash": digest(nonce.encode()),
                "check": check,
                "created": time.time(),
            }
            save(path, row)
        try:
            result = self.invoke(
                module,
                "deliver",
                {
                    "id": key,
                    "target": {
                        "actor_id": target,
                        "native_session_id": row["native_session_id"],
                        "binding_version": row["binding_version"],
                    },
                    "source": actor,
                    "body": body,
                    "receipt": {
                        "endpoint": "/api/agent/v1/office/ack",
                        "id": key,
                        "challenge": nonce,
                        "native_session_id": row["native_session_id"],
                    },
                },
            )
            state = "accepted" if result["accepted"] else "unknown"
            reason = None if result["accepted"] else "office_native_acceptance_unconfirmed"
        except Problem as error:
            state = "unknown"
            reason = error.code
        except Exception:
            state = "unknown"
            reason = "office_adapter_result_unavailable"
        with self.lock:
            row = self.read("deliveries/" + key + ".json", row)
            if row["state"] == "submitting":
                row["state"] = state
                if reason:
                    row["reason"] = reason
                save(path, row)
            return self.public_delivery(row)

    # @chain-region OfficeExtensions.public_delivery | calls: row.get, {'unknown': 'office_adapter_result_unavailable', 'submitting': 'office_no_final_result_recorded'}.get
    @staticmethod
    def public_delivery(row):
        return {
            k: row.get(k)
            for k in ("id", "request_id", "source", "target", "state", "created", "acknowledged", "revision")
        } | {
            "reason": row.get("reason") or {
                "unknown": "office_adapter_result_unavailable",
                "submitting": "office_no_final_result_recorded",
            }.get(row.get("state")),
            "replay_allowed": False,
        }

    # @chain-region OfficeExtensions.ack | calls: all, binding.get, challenge.encode, digest, isinstance, len, require, row.get …
    def ack(self, actor, binding, value):
        key = value.get("id")
        require(
            isinstance(key, str) and len(key) == 64 and all(c in "0123456789abcdef" for c in key),
            "office_delivery_invalid",
        )
        with self.lock:
            row = self.read("deliveries/" + key + ".json", None)
            require(
                row
                and row["target"] == actor
                and row["native_session_id"]
                == binding["native_session_id"]
                == value.get("native_session_id")
                and row["binding_version"] == binding.get("version"),
                "office_receipt_binding_changed",
            )
            challenge = value.get("challenge")
            require(
                isinstance(challenge, str)
                and secrets.compare_digest(digest(challenge.encode()), row["challenge_hash"]),
                "office_receipt_challenge_invalid",
            )
            if row["state"] != "acknowledged":
                require(time.time() - row["created"] <= 600, "office_receipt_expired")
                row["state"] = "acknowledged"
                row["acknowledged"] = time.time()
                row.pop("reason", None)
                save(self.root / "deliveries" / (key + ".json"), row)
            module = self.module(actor)
            if row["check"] and module and row["revision"] == module["revision"]:
                self.record_check(
                    actor, binding, module, "self" if actor == row["source"] else "peer_in", key
                )
                if actor != row["source"]:
                    try:
                        source_binding = self.binding(row["source"])
                    except Problem:
                        source_binding = {}
                    source_module = self.module(row["source"])
                    if (
                        source_module
                        and source_module["revision"] == row.get("source_revision")
                        and source_binding.get("native_session_id") == row.get("source_native")
                        and source_binding.get("version") == row.get("source_version")
                    ):
                        self.record_check(
                            row["source"], source_binding, source_module, "peer_out", key
                        )
            return self.public_delivery(row)

    # @chain-region OfficeExtensions.record_check | calls: any, prior.get, save, self.read, stamp.items
    def record_check(self, actor, binding, module, kind, key):
        stamp = {
            "revision": module["revision"],
            "native_session_id": binding["native_session_id"],
            "binding_version": binding["version"],
        }
        prior = self.read("verified/" + actor + ".json", {})
        if any(prior.get(k) != v for k, v in stamp.items()):
            prior = {}
        save(self.root / "verified" / (actor + ".json"), {**prior, **stamp, kind: key})

    # @chain-region OfficeExtensions.delivery_rows | calls: (self.root / 'deliveries').glob, row.get, self.read
    def delivery_rows(self, peer):
        for path in (self.root / "deliveries").glob("*.json"):
            row = self.read("deliveries/" + path.name, {})
            if peer["actor_id"] in (row.get("source"), row.get("target")):
                yield row

    # @chain-region OfficeExtensions.deliveries | calls: ID.fullmatch, Problem, digest, encode, len, re.fullmatch, row.get, self.delivery_rows …
    def deliveries(self, peer, query=None):
        if query:
            if set(query) == {"id"} and re.fullmatch(r"[0-9a-f]{64}", query["id"][0]):
                key = query["id"][0]
            elif set(query) == {"request_id"} and ID.fullmatch(query["request_id"][0]):
                key = digest(encode([peer["actor_id"], query["request_id"][0]]))
            else:
                raise Problem("office_delivery_filter_invalid", "投递查询须使用原编号。", 400)
            row = self.read("deliveries/" + key + ".json", {})
            if peer["actor_id"] not in (row.get("source"), row.get("target")):
                raise Problem("office_delivery_missing", "未找到该工位的投递。", 404)
            return {"delivery": self.public_delivery(row)}
        rows = sorted(self.delivery_rows(peer), key=lambda row: row["created"], reverse=True)
        return {
            "deliveries": [self.public_delivery(row) for row in rows[:200]],
            "limit": 200,
            "total": len(rows),
            "truncated": len(rows) > 200,
        }

    # @chain-region OfficeExtensions.configure_cloud | calls: base.rstrip, dict, isinstance, len, require, save, set, urlsplit
    def configure_cloud(self, value):
        require(set(value) == {"base_url"}, "office_cloud_fields")
        base = value["base_url"]
        require(isinstance(base, str) and len(base) <= 2048, "office_cloud_url_invalid")
        if base:
            parsed = urlsplit(base)
            require(
                parsed.hostname
                and not parsed.username
                and not parsed.password
                and not parsed.query
                and not parsed.fragment
                and (
                    parsed.scheme == "https"
                    or parsed.scheme == "http"
                    and parsed.hostname in ("127.0.0.1", "localhost")
                ),
                "office_cloud_https_required",
            )
        with self.lock:
            self.cloud_config = {"base_url": base.rstrip("/")}
            save(self.root / "cloud.json", self.cloud_config)
            self.cloud = {
                "state": "waiting" if base else "not_configured",
                "online": False,
                "authenticated": False,
            }
        return dict(self.cloud)

    # @chain-region OfficeExtensions.poll_cloud | calls: NoRedirect, ProxyHandler, Request, build_opener, build_opener(ProxyHandler({}), NoRedirect()).open, isinstance, json.loads, len …
    def poll_cloud(self):
        with self.lock:
            base = self.cloud_config.get("base_url", "")
        if not base:
            return
        state = {
            "state": "offline",
            "online": False,
            "authenticated": False,
            "checked_at": time.time(),
        }
        try:
            with build_opener(ProxyHandler({}), NoRedirect()).open(
                Request(base + "/health", headers={"Accept": "application/json"}), timeout=5
            ) as response:
                raw = response.read(16385)
                require(len(raw) <= 16384, "office_cloud_response_too_large")
                result = json.loads(raw)
            if (
                result.get("protocol") == "aieyra-office/1"
                and result.get("online") is True
                and isinstance(result.get("office_id"), str)
                and 0 < len(result["office_id"].strip()) <= 200
            ):
                state.update(state="online", online=True)
        except Exception:
            pass
        with self.lock:
            if base == self.cloud_config.get("base_url"):
                self.cloud = state

    # @chain-region OfficeExtensions.run | calls: self.app.stop.is_set, self.app.stop.wait, self.poll_cloud
    def run(self):
        while not self.app.stop.is_set():
            self.poll_cloud()
            if self.app.stop.wait(30):
                break

    # @chain-region OfficeExtensions.archive | calls: ID.fullmatch, Problem, access.center, archive.writestr, cursors.add, digest, directory.mkdir, docs.items …
    def archive(self, peer, value):
        """Capture a bounded, explicit API view. No database or source tree copy."""
        rid = value.get("request_id")
        require(isinstance(rid, str) and ID.fullmatch(rid), "office_request_id_required")
        actor = peer["actor_id"]
        key = digest(encode([actor, rid]))
        directory = self.root / "archives" / actor
        path = directory / (key + ".zip")
        with self.lock:
            if path.exists():
                return self.verify_archive(actor, key)
            access = self.app.agent_access
            tasks, cursors, cursor = {}, set(), None
            for page in range(500):
                query = {"project": [peer["project"]], "limit": ["20"]}
                if cursor:
                    query["before"] = [cursor]
                result = access.center(peer, "task-history", query=query)
                require(isinstance(result.get("items"), list), "office_tasks_response_invalid")
                for row in result["items"]:
                    require(
                        row["id"] not in tasks or tasks[row["id"]] == row,
                        "office_tasks_changed_during_archive",
                    )
                    tasks[row["id"]] = row
                if not result.get("has_more"):
                    break
                cursor = result.get("next_cursor")
                require(
                    isinstance(cursor, str) and cursor and cursor not in cursors,
                    "office_task_cursor_invalid",
                )
                cursors.add(cursor)
            else:
                raise Problem(
                    "office_archive_task_limit", "任务超过本次归档上限，原始记录保留。", 409
                )
            docs = {
                "registry.json": access.center(peer, "registry"),
                "tasks.json": {"tasks": list(tasks.values()), "pages": page + 1, "complete": True},
                "history.json": access.center(peer, "history", query={"limit": ["100"]}),
                "memory.json": self.app.project_memory.read(peer["project"]),
                "deliveries.json": self.deliveries(peer),
            }
            payloads = {name: encode(doc) for name, doc in docs.items()}
            manifest = {
                "schema": 1,
                "actor": actor,
                "project": peer["project"],
                "created": time.time(),
                "scope": "API snapshot; latest 100 history records, current tasks and memory; historical source retained",
                "files": {
                    name: {"sha256": digest(raw), "bytes": len(raw)}
                    for name, raw in payloads.items()
                },
            }
            directory.mkdir(parents=True, exist_ok=True)
            temporary = path.with_suffix(".tmp")
            try:
                with zipfile.ZipFile(temporary, "x", zipfile.ZIP_DEFLATED) as archive:
                    for name, raw in payloads.items():
                        archive.writestr(name, raw)
                    archive.writestr("manifest.json", encode(manifest))
                os.replace(temporary, path)
            finally:
                temporary.unlink(missing_ok=True)
            return self.verify_archive(actor, key)

    # @chain-region OfficeExtensions.verify_archive | calls: all, archive.infolist, archive.namelist, archive.read, digest, isinstance, json.loads, len …
    def verify_archive(self, actor, key):
        require(
            isinstance(key, str) and len(key) == 64 and all(c in "0123456789abcdef" for c in key),
            "office_archive_invalid",
        )
        path = self.root / "archives" / actor / (key + ".zip")
        require(
            path.is_file() and path.stat().st_size <= 32 * 1024 * 1024,
            "office_archive_missing_or_oversized",
        )
        with zipfile.ZipFile(path) as archive:
            require(
                set(archive.namelist())
                == {
                    "manifest.json",
                    "registry.json",
                    "tasks.json",
                    "history.json",
                    "memory.json",
                    "deliveries.json",
                }
                and len(archive.namelist()) == 6
                and sum(info.file_size for info in archive.infolist()) <= 64 * 1024 * 1024,
                "office_archive_invalid",
            )
            manifest = json.loads(archive.read("manifest.json"))
            require(manifest["actor"] == actor, "office_archive_owner_mismatch")
            require(
                all(
                    digest(archive.read(name)) == meta["sha256"]
                    and len(archive.read(name)) == meta["bytes"]
                    for name, meta in manifest["files"].items()
                ),
                "office_archive_corrupt",
            )
        return {
            "id": key,
            "sha256": digest(path.read_bytes()),
            "verified": True,
            "scope": manifest["scope"],
            "source_retained": True,
        }

    # @chain-region OfficeExtensions.organize | calls: ID.fullmatch, all, any, archive.read, digest, encode, isinstance, json.loads …
    def organize(self, peer, value):
        """Retire an explicit archived plan through the existing CAS ledger.

        Completed and executing work is never deleted. Unknown delivery keeps
        its original task and receipt. Replacements use existing task IDs.
        """
        actor, key = peer["actor_id"], value.get("archive_id")
        receipt = self.verify_archive(actor, key)
        task_id, version = value.get("task_id"), value.get("version")
        require(
            isinstance(task_id, str) and ID.fullmatch(task_id) and type(version) is int,
            "office_task_reference_invalid",
        )
        path = self.root / "archives" / actor / (key + ".zip")
        with zipfile.ZipFile(path) as archive:
            tasks = json.loads(archive.read("tasks.json"))
        rows = tasks.get("tasks", []) if isinstance(tasks, dict) else tasks
        require(
            any(
                t.get("id") == task_id
                and t.get("version") == version
                and t.get("status") in ("planned", "blocked")
                and not t.get("owner")
                for t in rows
            ),
            "office_archive_does_not_cover_inactive_plan",
        )
        require(
            all(d["state"] == "acknowledged" for d in self.delivery_rows(peer)),
            "office_delivery_unresolved",
        )
        replacements = value.get("replacement_ids", [])
        require(
            isinstance(replacements, list)
            and len(replacements) <= 20
            and all(isinstance(x, str) and ID.fullmatch(x) for x in replacements),
            "office_replacements_invalid",
        )
        reason = value.get("reason")
        require(isinstance(reason, str) and 1 <= len(reason) <= 1500, "office_reason_required")
        return self.app.agent_access.center(
            peer,
            "task-retire",
            body={
                "request_id": "office-organize-" + digest(encode([actor, key, task_id, version])),
                "id": task_id,
                "version": version,
                "disposition": "superseded" if replacements else "cancelled",
                "replacement_ids": replacements,
                "reason": reason,
                "evidence_ref": str(path),
                "evidence_sha256": receipt["sha256"],
            },
        )
