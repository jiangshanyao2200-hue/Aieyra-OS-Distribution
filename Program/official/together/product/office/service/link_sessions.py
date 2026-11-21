# @file-map:start
# 文件: link/office/service/link_sessions.py
# 位置: 二环·工位服务 | 本机控制、接入、凭据、工位与租约的HTTP服务。
# 约束: 服务绑定本机并核对所有者身份；凭据与工作正文不因短暂失联清空；关闭使用租约排空
# 下游: link/office/service/device_link.py
# 上游: link/office/service/device_link.py
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: python -X utf8 -B -m unittest discover -s link/office/tests/service
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   utf8_size | function
#   stamp | function
#   atomic | function
#   validate_extensions | function
#   LinkSessions | class
#   LinkSessions.__init__ | function
#   LinkSessions.refresh | function
#   LinkSessions.shares | function
#   LinkSessions.share | function
#   LinkSessions.grant | function
#   LinkSessions.permission | function
#   LinkSessions.index | function
#   LinkSessions.message_scope | function
#   LinkSessions.query | function
#   LinkSessions.request_status | function
#   LinkSessions.submit | function
#   LinkSessions.action | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""OS-session adapter for the existing Link CLI; never runs a model itself."""

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import tempfile
import uuid

from device_link import LinkError


ID = re.compile(r"[A-Za-z0-9_.:-]{1,160}")
MESSAGE_ID = re.compile(r"[a-f0-9]{64}")
SESSION_ID = re.compile(r"[a-f0-9]{32}:[A-Za-z0-9_.:-]{1,160}")
PERMISSIONS = {"read", "send", "cancel"}


# @chain-region utf8_size | calls: isinstance, len, value.encode
def utf8_size(value):
    try:
        return len(value.encode("utf-8")) if isinstance(value, str) else -1
    except UnicodeError:
        return -1


# @chain-region stamp | calls: datetime.now, datetime.now(timezone.utc).isoformat
def stamp():
    return datetime.now(timezone.utc).isoformat()


# @chain-region atomic | calls: handle.fileno, handle.flush, json.dump, os.chmod, os.fsync, os.replace, path.parent.mkdir, path.with_name …
def atomic(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        with temporary.open("x", encoding="utf-8") as handle:
            os.chmod(temporary, 0o600)
            json.dump(value, handle, ensure_ascii=False, allow_nan=False)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


# @chain-region validate_extensions | calls: ID.fullmatch, Path, Path(share['discovery']).is_absolute, SESSION_ID.fullmatch, ValueError, any, grant.get, grants.items …
def validate_extensions(row):
    shares = row.get("os_shares", {})
    grants = row.get("agent_grants", {})
    if not isinstance(shares, dict) or len(shares) > 8:
        raise ValueError()
    for key, share in shares.items():
        if (
            not re.fullmatch(r"[a-f0-9]{32}", key)
            or not isinstance(share, dict)
            or not isinstance(share.get("discovery"), str)
            or not Path(share["discovery"]).is_absolute()
            or not 1 <= utf8_size(share.get("title")) <= 160
        ):
            raise ValueError()
    if not isinstance(grants, dict) or len(grants) > 128:
        raise ValueError()
    for actor, grant in grants.items():
        if (
            not isinstance(actor, str)
            or not ID.fullmatch(actor)
            or not isinstance(grant, dict)
            or not isinstance(grant.get("project"), str)
            or not ID.fullmatch(grant["project"])
            or not isinstance(grant.get("sessions"), list)
            or not 1 <= len(grant["sessions"]) <= 64
            or any(not isinstance(s, str) or not SESSION_ID.fullmatch(s) for s in grant["sessions"])
            or not isinstance(grant.get("permissions"), list)
            or not grant["permissions"]
            or any(not isinstance(p, str) or p not in PERMISSIONS for p in grant["permissions"])
            or "read" not in grant["permissions"]
        ):
            raise ValueError()


# @chain-region LinkSessions | calls: (actor + '\n' + action + '\n' + rid).encode, (actor + '\n' + operation + '\n' + rid).encode, (row['device_id'] + '\n' + upstream).encode, (self.manager.connection(key)['device_id'] + '\ncontrol-' + request_key).encode, ID.fullmatch, LinkError, MESSAGE_ID.fullmatch, Path …
class LinkSessions:
    # @chain-region LinkSessions.__init__
    def __init__(self, manager):
        self.manager = manager
        self.catalogs = {}

    # @chain-region LinkSessions.refresh | calls: LinkError, SESSION_ID.fullmatch, ThreadPoolExecutor, any, catalog.clear, catalog.update, deepcopy, failures.values …
    def refresh(self, key, include_offices=True):
        actions = ["status", "control-status"] if include_offices else ["status"]
        results, failures = {}, {}
        with ThreadPoolExecutor(max_workers=len(actions)) as pool:
            futures = {action: pool.submit(self.manager.run, self.manager.command(key, action)) for action in actions}
            for action, future in futures.items():
                try:
                    result = future.result()
                    fields = ("sessions", "devices") if action == "status" else ("services",)
                    if any(not isinstance(result.get(field), list) or any(not isinstance(item, dict) for item in result[field]) for field in fields):
                        raise LinkError("link_catalog_invalid", 502)
                    if action == "status" and any(
                        not isinstance(session.get("id"), str) or not SESSION_ID.fullmatch(session["id"])
                        or not isinstance(session.get("device_id"), str) or session["device_id"] != session["id"].split(":", 1)[0]
                        for session in result["sessions"]
                    ):
                        raise LinkError("link_catalog_invalid", 502)
                    results[action] = result
                except LinkError as error:
                    failures[action] = error.code
        with self.manager.lock:
            catalog = self.catalogs.setdefault(key, {})
            if "status" in results:
                catalog.clear()
                catalog.update(results["status"], observed_at=stamp(), stale=False)
            else:
                catalog["stale"] = True
            if "control-status" in results:
                self.manager.observed[key] = results["control-status"].get("services", [])
            elif include_offices:
                self.manager.observed[key] = [
                    {**service, "state": "unknown"}
                    for service in self.manager.observed.get(key, [])
                ]
            catalog["errors"] = failures
            if failures:
                self.manager.errors[key] = next(iter(failures.values()))
            else:
                self.manager.errors.pop(key, None)
            snapshot = deepcopy({**catalog, "services": self.manager.observed.get(key, [])})
        if not results:
            raise LinkError(next(iter(failures.values())), 503)
        return snapshot

    # @chain-region LinkSessions.shares | calls: bool, child.poll, row.get, row.get('os_shares', {}).items, self.manager.children.get
    def shares(self, key, row):
        return [
            {"id": sid, **share, "running": bool((child := self.manager.children.get((key, "os", sid))) and child.poll() is None)}
            for sid, share in row.get("os_shares", {}).items()
        ]

    # @chain-region LinkSessions.share | calls: LinkError, Path, Path(discovery).is_absolute, Path(discovery).is_file, Path(discovery).resolve, SESSION_ID.fullmatch, child.poll, isinstance …
    def share(self, key, value, persist=True):
        row = self.manager.connection(key)
        discovery, title = value.get("discovery"), value.get("title")
        if (
            not isinstance(discovery, str)
            or not 1 <= len(discovery) <= 4096
            or not Path(discovery).is_absolute()
            or not Path(discovery).is_file()
            or not isinstance(title, str)
            or not 1 <= utf8_size(title.strip()) <= 160
        ):
            raise LinkError("link_select_running_os_discovery", 400)
        discovery = str(Path(discovery).resolve())
        sid = value.get("share") or next((sid for sid, s in row.get("os_shares", {}).items() if s["discovery"] == discovery), None)
        if sid and sid not in row.get("os_shares", {}):
            raise LinkError("link_share_not_found", 404)
        if not sid:
            if len(row.get("os_shares", {})) >= 8:
                raise LinkError("link_session_share_limit")
            sid = uuid.uuid4().hex
        child = self.manager.children.get((key, "os", sid))
        if child and child.poll() is None:
            return {"share": sid, "session_id": row["os_shares"][sid].get("session_id"), "already_attached": True}
        result = self.manager.spawn((key, "os", sid), self.manager.command(key, "attach", "--discovery", discovery, "--title", title.strip()))
        if not isinstance(result.get("session_id"), str) or not SESSION_ID.fullmatch(result["session_id"]):
            self.manager.stop_child((key, "os", sid))
            raise LinkError("link_session_identity_mismatch")
        with self.manager.lock:
            row.setdefault("os_shares", {})[sid] = {"discovery": discovery, "title": title.strip(), "session_id": result["session_id"]}
            if persist:
                self.manager.save()
        return {"share": sid, **result}

    # @chain-region LinkSessions.grant | calls: LinkError, len, row.get, row.setdefault, self.manager.connection, self.manager.save, validate_extensions, value.get
    def grant(self, key, value):
        row = self.manager.connection(key)
        actor, project = value.get("actor_id"), value.get("project")
        grant = {"project": project, "sessions": value.get("sessions"), "permissions": value.get("permissions")}
        try:
            validate_extensions({"agent_grants": {actor: grant}})
        except (ValueError, TypeError):
            raise LinkError("link_invalid_agent_grant", 400) from None
        if len(row.get("agent_grants", {})) >= 128 and actor not in row["agent_grants"]:
            raise LinkError("link_agent_grant_limit")
        with self.manager.lock:
            row.setdefault("agent_grants", {})[actor] = grant
            self.manager.save()
        return {"actor_id": actor, "granted": True, **grant}

    # @chain-region LinkSessions.permission | calls: LinkError, self.manager.connection, self.manager.connection(key).get, self.manager.connection(key).get('agent_grants', {}).get
    def permission(self, key, peer, action, target=None):
        if peer is None:
            return None
        grant = self.manager.connection(key).get("agent_grants", {}).get(peer["actor_id"])
        permission = "send" if action == "send" else "cancel" if action == "cancel" else "read"
        if (
            action not in {"catalog", "send", "message", "events", "cancel", "answer-status", "request-status"}
            or not grant
            or grant["project"] != peer["project"]
            or permission not in grant["permissions"]
            or target is not None and target not in grant["sessions"]
        ):
            raise LinkError("link_agent_permission_denied", 403)
        return grant

    # @chain-region LinkSessions.index
    def index(self, key, mid):
        return self.manager.root / key / "messages" / (mid + ".json")

    # @chain-region LinkSessions.message_scope | calls: LinkError, MESSAGE_ID.fullmatch, isinstance, json.loads, record.get, self.index, self.index(key, mid).read_text, self.permission
    def message_scope(self, key, mid, peer, action="message"):
        if not isinstance(mid, str) or not MESSAGE_ID.fullmatch(mid):
            raise LinkError("link_invalid_message_id", 400)
        if peer is not None:
            try:
                record = json.loads(self.index(key, mid).read_text(encoding="utf-8"))
            except (OSError, ValueError):
                raise LinkError("link_agent_message_denied", 403) from None
            if not isinstance(record, dict) or record.get("actor_id") != peer["actor_id"] or not isinstance(record.get("target_session"), str):
                raise LinkError("link_agent_message_denied", 403)
            self.permission(key, peer, action, record["target_session"])

    # @chain-region LinkSessions.query | calls: LinkError, isinstance, result.get, self.manager.command, self.manager.run
    def query(self, key, action, mid):
        result = self.manager.run(self.manager.command(key, action, "--id", mid))
        if not isinstance(result, dict) or result.get("id") != mid:
            raise LinkError("link_result_identity_mismatch", 502)
        return result

    # @chain-region LinkSessions.request_status | calls: (actor + '\n' + operation + '\n' + rid).encode, (self.manager.connection(key)['device_id'] + '\ncontrol-' + request_key).encode, ID.fullmatch, LinkError, SESSION_ID.fullmatch, isinstance, json.loads, path.read_text …
    def request_status(self, key, value, peer):
        """Recover a lost HTTP receipt using the journal; never dispatch a task."""
        rid, operation = value.get("request_id"), value.get("operation")
        if not isinstance(rid, str) or not ID.fullmatch(rid) or operation not in {"send", "answer"}:
            raise LinkError("link_invalid_request_query", 400)
        if peer is not None and operation != "send":
            raise LinkError("link_agent_permission_denied", 403)
        actor = peer["actor_id"] if peer else "local-owner"
        request_key = sha256((actor + "\n" + operation + "\n" + rid).encode()).hexdigest()
        mid = sha256((self.manager.connection(key)["device_id"] + "\ncontrol-" + request_key).encode()).hexdigest()
        query_action = "answer-status" if operation == "answer" else "message"
        path = self.manager.root / key / "requests" / (request_key + ".json")
        try:
            record = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return {"request_id": rid, "state": "not-recorded", "replay_allowed": False}
        except (OSError, ValueError):
            raise LinkError("link_request_record_invalid_original_retained") from None
        if (
            not isinstance(record, dict)
            or record.get("request_id") != rid or record.get("id") != mid
            or record.get("actor_id") != actor or record.get("action") != operation
            or record.get("query_action") != query_action or record.get("replay_allowed") is not False
            or operation == "send" and (
                not isinstance(record.get("target_session"), str)
                or not SESSION_ID.fullmatch(record["target_session"])
            )
        ):
            raise LinkError("link_request_record_invalid_original_retained")
        if peer is not None:
            self.permission(key, peer, "request-status", record["target_session"])
            self.message_scope(key, mid, peer)
        handle = {"request_id": rid, "id": mid, "query_action": query_action, "replay_allowed": False}
        try:
            return {**handle, "result": self.query(key, query_action, mid), "recovered": True}
        except LinkError as error:
            return {**handle, "state": "unconfirmed", "error": error.code}

    # @chain-region LinkSessions.submit | calls: (actor + '\n' + action + '\n' + rid).encode, (row['device_id'] + '\n' + upstream).encode, ID.fullmatch, LinkError, MESSAGE_ID.fullmatch, Path, Path(prompt_path).unlink, SESSION_ID.fullmatch …
    def submit(self, key, action, value, peer):
        row = self.manager.connection(key)
        rid = value.get("request_id")
        if not isinstance(rid, str) or not ID.fullmatch(rid):
            raise LinkError("link_request_id_required", 400)
        target = value.get("target_session")
        if action == "send":
            if not isinstance(target, str) or not SESSION_ID.fullmatch(target):
                raise LinkError("link_invalid_session", 400)
            self.permission(key, peer, action, target)
        else:
            self.message_scope(key, value.get("id"), peer, action)
        text = value.get("text", "")
        text_bytes = utf8_size(text)
        if not 0 <= text_bytes <= 16000 or "\0" in text or action == "send" and not text.strip():
            raise LinkError("link_invalid_text", 400)
        if action == "answer":
            if (
                not isinstance(value.get("human_id"), str)
                or not ID.fullmatch(value["human_id"])
                or type(value.get("human_version")) is not int
                or value["human_version"] < 1
                or not isinstance(value.get("human_token"), str)
                or not MESSAGE_ID.fullmatch(value["human_token"])
                or bool(text.strip()) == bool(value.get("option"))
                or value.get("option") and (not isinstance(value["option"], str) or not ID.fullmatch(value["option"]))
            ):
                raise LinkError("link_invalid_human_answer", 400)
        actor = peer["actor_id"] if peer else "local-owner"
        request_key = sha256((actor + "\n" + action + "\n" + rid).encode()).hexdigest()
        upstream = "control-" + request_key
        mid = sha256((row["device_id"] + "\n" + upstream).encode()).hexdigest()
        payload = {k: v for k, v in value.items() if k not in {"session_id", "connection", "request_id", "action"}}
        fingerprint = sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False, allow_nan=False).encode()).hexdigest()
        path = self.manager.root / key / "requests" / (request_key + ".json")
        query_action = "answer-status" if action == "answer" else "message"
        handle = {"request_id": rid, "id": mid, "query_action": query_action, "replay_allowed": False}
        try:
            prior = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            prior = None
            record_exists = False
        except (OSError, ValueError):
            raise LinkError("link_request_record_invalid_original_retained") from None
        else:
            record_exists = True
        if record_exists:
            if not isinstance(prior, dict):
                raise LinkError("link_request_record_invalid_original_retained")
            if prior.get("fingerprint") != fingerprint:
                raise LinkError("link_request_content_conflict")
            try:
                return {**handle, "result": self.query(key, query_action, mid), "recovered": True}
            except LinkError as error:
                return {**handle, "state": "unconfirmed", "error": error.code}
        # Validate the local program before recording a request that might execute.
        self.manager.binary()
        if text:
            self.manager.require_private_prompt()
        record = {**handle, "fingerprint": fingerprint, "actor_id": actor, "target_session": target, "action": action, "state": "dispatching", "created_at": stamp()}
        atomic(path, record)
        atomic(self.index(key, mid), record)
        args = ["--request-id", upstream]
        if action == "send":
            args += ["--session", target]
        else:
            args += ["--id", value["id"], "--human-id", value["human_id"], "--human-version", str(value["human_version"]), "--human-token", value["human_token"]]
            if value.get("option"):
                args += ["--option", value["option"]]
        prompt_path = None
        try:
            if text:
                fd, prompt_path = tempfile.mkstemp(prefix="prompt-", suffix=".txt", dir=path.parent)
                with os.fdopen(fd, "w", encoding="utf-8", newline="") as prompt:
                    os.chmod(prompt_path, 0o600)
                    prompt.write(text)
                args += ["--prompt-file", prompt_path]
            result = self.manager.run(self.manager.command(key, action, *args))
            if not isinstance(result, dict) or result.get("id") != mid:
                raise LinkError("link_result_identity_mismatch", 502)
            record.update(state="received", updated_at=stamp())
            atomic(path, record)
            return {**handle, "result": result}
        except LinkError as error:
            record.update(state="unconfirmed", error=error.code, updated_at=stamp())
            atomic(path, record)
            return {**handle, "state": "unconfirmed", "error": error.code}
        except OSError:
            # A local persistence failure may follow a received remote result.
            # Return the original handle and never turn it into a second send.
            return {**handle, "state": "unconfirmed", "error": "link_local_request_failed_preserve_identity"}
        finally:
            if prompt_path:
                Path(prompt_path).unlink(missing_ok=True)

    # @chain-region LinkSessions.action | calls: LinkError, any, catalog.get, d.get, event.get, events.get, isinstance, list …
    def action(self, action, value, peer=None):
        if not isinstance(value, dict):
            raise LinkError("link_invalid_action", 400)
        allowed = {
            "catalog": set(), "send": {"request_id", "target_session", "text"},
            "message": {"id"}, "events": {"after"}, "cancel": {"id"},
            "answer": {"id", "request_id", "human_id", "human_version", "human_token", "text", "option"},
            "answer-status": {"id"},
            "request-status": {"request_id", "operation"},
        }
        if action not in allowed or set(value) - allowed[action] - {"connection", "session_id", "action"}:
            raise LinkError("link_invalid_session_action", 400)
        key = value.get("connection")
        row = self.manager.connection(key)
        if not row.get("paired"):
            raise LinkError("link_pairing_required")
        grant = self.permission(key, peer, action)
        if action == "request-status":
            return self.request_status(key, value, peer)
        if action == "catalog":
            catalog = self.refresh(key, include_offices=peer is None)
            if grant:
                sessions = [s for s in catalog.get("sessions", []) if s["id"] in grant["sessions"]]
                devices = [{k: d.get(k) for k in ("device_id", "name", "revoked")} for d in catalog.get("devices", []) if any(s["device_id"] == d["device_id"] for s in sessions)]
                return {"sessions": sessions, "devices": devices, "cursor": catalog.get("cursor", 0), "errors": catalog.get("errors", {}), "observed_at": catalog.get("observed_at"), "stale": catalog.get("stale", True), "permissions": list(grant["permissions"])}
            return catalog
        if action in {"send", "answer"}:
            return self.submit(key, action, value, peer)
        if action in {"message", "cancel", "answer-status"}:
            self.message_scope(key, value.get("id"), peer, action)
            result = self.query(key, action, value["id"])
            return {"result": result, "replay_allowed": False, "cancel_is_completion": False} if action == "cancel" else result
        after = value.get("after", 0)
        if type(after) is not int or not 0 <= after <= 2**64 - 1:
            raise LinkError("link_invalid_cursor", 400)
        events = self.manager.run(self.manager.command(key, "events", "--after", str(after)))
        if not isinstance(events.get("events"), list) or any(not isinstance(event, dict) for event in events["events"]):
            raise LinkError("link_events_invalid", 502)
        if grant:
            visible = []
            for event in events.get("events", []):
                if event.get("kind") == "session" and event.get("id") in grant["sessions"]:
                    visible.append(event)
                elif event.get("kind") in {"message", "cancel", "answer"}:
                    try:
                        self.message_scope(key, event.get("id"), peer)
                        visible.append(event)
                    except LinkError:
                        pass
            events = {**events, "events": visible}
        return events
