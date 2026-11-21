# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: Control/app/service/AGENTS.md | ring 2
# Chains: module-local; query impact before editing
# Regions: LinkError; NoRedirect; DeviceLink
# Impact: python -B scripts/code-atlas.py show Control/app/service/device_link.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""Explicit private-device connections; Link transports the existing Agent API."""

from copy import deepcopy
import json
import os
from pathlib import Path
import queue
import re
import socket
import subprocess
import threading
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener
import uuid


class LinkError(Exception):
    def __init__(self, code, status=409):
        self.code, self.status = code, status
        super().__init__(code)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class DeviceLink:
    def __init__(self, data_root, software_root):
        from link_sessions import LinkSessions, validate_extensions
        from link_lan import LinkLAN
        from link_auto import LinkAuto

        self.root = Path(data_root) / "link"
        self.software_root = Path(software_root)
        self.lock = threading.RLock()
        self.operations = threading.RLock()
        self.stop_event = threading.Event()
        self.children = {}
        self.threads = []
        self.observed = {}
        self.errors = {}
        self.origin = None
        self.stopped = False
        self.file = self.root / "connections.json"
        self.config = {"schema": 1, "connections": {}}
        self.sessions = LinkSessions(self)
        self.capabilities = {}
        self.lan = LinkLAN(self)
        self.auto = LinkAuto(self)
        if self.file.exists():
            try:
                value = json.loads(self.file.read_text(encoding="utf-8"))
                if value.get("schema") != 1 or not isinstance(value.get("connections"), dict):
                    raise ValueError()
                if len(value["connections"]) > 8:
                    raise ValueError()
                for key, row in value["connections"].items():
                    if not re.fullmatch(r"[a-f0-9]{32}", key) or not isinstance(row, dict):
                        raise ValueError()
                    if (
                        not isinstance(row.get("name"), str)
                        or not 1 <= len(row["name"].strip()) <= 120
                        or type(row.get("paired")) is not bool
                        or not isinstance(row.get("gateways"), dict)
                        or len(row["gateways"]) > 8
                        or any(
                            type(row.get(flag, False)) is not bool
                            for flag in ("attach", "share_view")
                        )
                    ):
                        raise ValueError()
                    if row["paired"] and (
                        not isinstance(row.get("device_id"), str)
                        or not re.fullmatch(r"[a-f0-9]{32}", row["device_id"])
                        or not isinstance(row.get("hub_url"), str)
                    ):
                        raise ValueError()
                    validate_extensions(row)
                    for service, port in row.get("gateways", {}).items():
                        if (
                            not re.fullmatch(r"[a-f0-9]{32}:control", service)
                            or type(port) is not int
                            or not 1024 <= port <= 65535
                        ):
                            raise ValueError()
                self.config = value
            except (OSError, ValueError, TypeError, AttributeError):
                raise LinkError("link_configuration_invalid_original_retained") from None

    def binary(self):
        from link_paths import link_path

        try:
            path = link_path(self.software_root)
        except ValueError:
            raise LinkError("link_binary_configuration_invalid", 503) from None
        if not path.is_absolute() or not path.is_file():
            raise LinkError("link_not_installed", 503)
        return str(path)

    def save(self):
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        temporary = self.file.with_suffix(".tmp")
        with temporary.open("w", encoding="utf-8") as handle:
            json.dump(self.config, handle, ensure_ascii=False, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, self.file)

    def connection(self, key):
        if not isinstance(key, str) or key not in self.config["connections"]:
            raise LinkError("link_connection_not_found", 404)
        return self.config["connections"][key]

    def command(self, key, action, *arguments):
        self.connection(key)
        return [self.binary(), action, "--data", str(self.root / key), *arguments]

    def run(self, command, extra_env=None):
        try:
            result = subprocess.run(
                command,
                stdin=subprocess.DEVNULL,
                capture_output=True,
                timeout=25,
                env={**os.environ, **(extra_env or {})},
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            if result.returncode:
                raise LinkError("link_command_failed_check_connection")
            value = json.loads(result.stdout)
            if not isinstance(value, dict):
                raise ValueError()
            return value
        except subprocess.TimeoutExpired:
            raise LinkError("link_result_unconfirmed_preserve_identity", 504) from None
        except (OSError, ValueError):
            raise LinkError("link_program_unavailable", 503) from None

    def require_private_prompt(self):
        self.require_capability(
            "private_prompt", (b"--prompt-file",), "link_update_required_for_private_prompt"
        )

    def require_capability(self, name, markers, error_code):
        binary = self.binary()
        try:
            stat = Path(binary).stat()
            signature = (binary, stat.st_size, stat.st_mtime_ns)
            if self.capabilities.get(name) != signature:
                result = subprocess.run(
                    [binary, "help"],
                    stdin=subprocess.DEVNULL,
                    capture_output=True,
                    timeout=5,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                )
                if result.returncode or any(marker not in result.stdout for marker in markers):
                    raise LinkError(error_code, 503)
                self.capabilities[name] = signature
        except (OSError, subprocess.TimeoutExpired):
            raise LinkError("link_program_unavailable", 503) from None

    def spawn(self, key, command):
        if self.stopped:
            raise LinkError("link_service_stopping")
        old = self.children.get(key)
        if old and old.poll() is None:
            raise LinkError("link_connection_already_running")
        try:
            child = subprocess.Popen(
                command,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                env={**os.environ, "AIEYRA_OS_OWNER_STDIN":"1"},
                stderr=subprocess.DEVNULL,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except OSError:
            raise LinkError("link_program_unavailable", 503) from None
        self.children[key] = child
        ready = queue.Queue(maxsize=1)

        def drain():
            try:
                ready.put(child.stdout.readline(8193))
                while child.stdout.read(8192):
                    pass
            except (OSError, ValueError):
                pass
            finally:
                child.stdout.close()

        reader = threading.Thread(target=drain, name="control-link-reader")
        self.threads.append(reader)
        reader.start()
        try:
            value = json.loads(ready.get(timeout=12))
            if not isinstance(value, dict) or child.poll() is not None or value.get("state") not in ("ready", "attached"):
                raise ValueError()
            return value
        except (queue.Empty, ValueError, TypeError):
            self.stop_child(key)
            raise LinkError("link_start_failed_check_original_process", 503) from None

    def stop_child(self, key):
        child = self.children.get(key)
        if child:
            if child.poll() is None:
                if child.stdin:
                    try: child.stdin.close()
                    except OSError: pass
                try: child.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    raise LinkError("link_shutdown_unconfirmed", 503) from None
            self.children.pop(key, None)

    def start(self, origin):
        self.origin = origin
        self.auto.start(origin)

        def restore():
            while not self.stop_event.is_set():
                with self.lock:
                    keys = list(self.config["connections"])
                for key in keys:
                    with self.operations:
                        if self.stopped:
                            return
                        try:
                            if self.lan.ready(key):
                                self.restore_enabled(key)
                                self.lan.succeeded(key)
                        except LinkError as error:
                            self.lan.failed(key, error)
                self.stop_event.wait(15)

        worker = threading.Thread(target=restore, name="control-device-link")
        self.threads.append(worker)
        worker.start()

    def restore_enabled(self, key):
        row = self.connection(key)
        child = self.children.get((key, "attach"))
        if row.get("attach") and (not child or child.poll() is not None):
            self.attach(key, row.get("share_view", False), persist=False)
        for sid, share in list(row.get("os_shares", {}).items()):
            self.sessions.share(key, {**share, "share": sid}, persist=False)
        for service, port in list(row.get("gateways", {}).items()):
            self.gateway(key, service, port, persist=False)

    def close(self):
        self.stopped = True
        self.stop_event.set()
        self.auto.close()
        with self.operations:
            # Notify all children first, then wait for their actual exit. A final
            # service drain must never release storage while a child is alive.
            for child in list(self.children.values()):
                if child.stdin:
                    try: child.stdin.close()
                    except OSError: pass
            for key, child in list(self.children.items()):
                child.wait()
                self.children.pop(key, None)
        for worker in list(self.threads): worker.join()

    def status(self):
        with self.lock:
            try:
                self.binary()
                installed = True
            except LinkError:
                installed = False
            rows = []
            for key, row in self.config["connections"].items():
                child = self.children.get((key, "attach"))
                gateways = []
                for service, port in row.get("gateways", {}).items():
                    proxy = self.children.get((key, service))
                    gateways.append(
                        {
                            "service_id": service,
                            "url": f"http://127.0.0.1:{port}",
                            "running": bool(proxy and proxy.poll() is None),
                        }
                    )
                rows.append(
                    {
                        "id": key,
                        "name": row["name"],
                        "paired": row.get("paired", False),
                        "hub_url": row.get("hub_url", ""),
                        "device_id": row.get("device_id", ""),
                        "attached": bool(child and child.poll() is None),
                        "share_view": row.get("share_view", False),
                        "services": self.observed.get(key, []),
                        "devices": self.sessions.catalogs.get(key, {}).get("devices", []),
                        "sessions": self.sessions.catalogs.get(key, {}).get("sessions", []),
                        "cursor": self.sessions.catalogs.get(key, {}).get("cursor", 0),
                        "observed_at": self.sessions.catalogs.get(key, {}).get("observed_at"),
                        "catalog_errors": self.sessions.catalogs.get(key, {}).get("errors", {}),
                        "catalog_stale": self.sessions.catalogs.get(key, {}).get("stale", True),
                        "os_shares": self.sessions.shares(key, row),
                        "agent_grants": row.get("agent_grants", {}),
                        "gateways": gateways,
                        "error": self.errors.get(key, ""),
                        "recovery": self.lan.recovery_status(key),
                    }
                )
            return deepcopy(
                {
                    "installed": installed,
                    "connections": rows,
                    "lan": self.lan.snapshot(),
                    "auto_lan": self.auto.status(),
                    "agent_authentication": "original_remote_office_token",
                    "official_account_required": False,
                }
            )

    def pair(self, value):
        name, code = value.get("name"), value.get("code")
        if (
            not isinstance(name, str)
            or not 1 <= len(name.strip()) <= 120
            or not isinstance(code, str)
            or not 1 <= len(code) <= 4096
        ):
            raise LinkError("link_invalid_pairing", 400)
        key = value.get("connection")
        if key:
            row = self.connection(key)
            if row.get("paired") or row["name"] != name.strip():
                raise LinkError("link_pairing_identity_retained")
        else:
            if len(self.config["connections"]) >= 8:
                raise LinkError("link_connection_limit")
            key = uuid.uuid4().hex
            row = {"name": name.strip(), "paired": False, "gateways": {}}
            with self.lock:
                self.config["connections"][key] = row
            self.save()
        identity_path = self.root / key / "device.json"
        if identity_path.is_file():
            # 配对结果丢失后，只读已有身份，不生成第二设备。
            identity = json.loads(identity_path.read_text(encoding="utf-8"))
            result = {"device_id": identity["device_id"], "hub_url": identity["url"]}
        else:
            result = self.run(
                self.command(key, "connect", "--name", row["name"]), {"AIEYRA_LINK_CODE": code}
            )
        row.update(paired=True, device_id=result["device_id"], hub_url=result["hub_url"])
        self.save()
        return {"connection": key, "paired": True}

    def refresh(self, key):
        return self.sessions.refresh(key)

    def attach(self, key, view, persist=True):
        row = self.connection(key)
        if type(view) is not bool or not self.origin:
            raise LinkError("link_invalid_attach", 400)
        args = ["--control-url", self.origin, "--name", row["name"]]
        if view:
            args.append("--share-view")
        self.stop_child((key, "attach"))
        result = self.spawn((key, "attach"), self.command(key, "control-attach", *args))
        row.update(attach=True, share_view=view)
        if persist:
            self.save()
        return result

    def gateway(self, key, service, port=None, persist=True):
        row = self.connection(key)
        if not isinstance(service, str) or not re.fullmatch(r"[a-f0-9]{32}:control", service):
            raise LinkError("link_invalid_service", 400)
        old = self.children.get((key, service))
        if old and old.poll() is None:
            return {"url": f"http://127.0.0.1:{row['gateways'][service]}"}
        if len(row.get("gateways", {})) >= 8 and service not in row["gateways"]:
            raise LinkError("link_gateway_limit")
        port = port or row.get("gateways", {}).get(service)
        if not port:
            with socket.socket() as sock:
                sock.bind(("127.0.0.1", 0))
                port = sock.getsockname()[1]
        result = self.spawn(
            (key, service),
            self.command(
                key, "control-connect", "--service", service, "--listen", f"127.0.0.1:{port}"
            ),
        )
        if result.get("url") != f"http://127.0.0.1:{port}":
            self.stop_child((key, service))
            raise LinkError("link_gateway_identity_mismatch")
        with self.lock:
            row.setdefault("gateways", {})[service] = port
        if persist:
            self.save()
        return result

    def action(self, action, value):
        if not isinstance(value, dict):
            raise LinkError("link_invalid_action", 400)
        with self.operations:
            if self.stopped:
                raise LinkError("link_service_stopping", 503)
            if action == "pair":
                return self.pair(value)
            if action == "discover":
                if value:
                    raise LinkError("link_invalid_action", 400)
                return self.lan.discover()
            key = value.get("connection")
            row = self.connection(key)
            if action == "recover":
                if set(value) != {"connection", "candidate"}:
                    raise LinkError("link_invalid_action", 400)
                return self.lan.recover(key, value.get("candidate"))
            if action == "refresh":
                return self.refresh(key)
            if action == "attach":
                return self.attach(key, value.get("share_view", False))
            if action == "connect":
                return self.gateway(key, value.get("service"))
            if action == "share-session":
                if not row.get("paired"):
                    raise LinkError("link_pairing_required")
                return self.sessions.share(key, value)
            if action == "unshare-session":
                sid = value.get("share")
                if not isinstance(sid, str) or sid not in row.get("os_shares", {}):
                    raise LinkError("link_share_not_found", 404)
                self.stop_child((key, "os", sid))
                with self.lock:
                    del row["os_shares"][sid]
                    self.save()
                return {"disconnected": True, "identity_retained": True}
            if action == "grant":
                return self.sessions.grant(key, value)
            if action == "revoke-grant":
                actor = value.get("actor_id")
                if not isinstance(actor, str) or actor not in row.get("agent_grants", {}):
                    raise LinkError("link_agent_grant_not_found", 404)
                with self.lock:
                    del row["agent_grants"][actor]
                    self.save()
                return {"actor_id": actor, "revoked": True, "running_tasks_cancelled": False}
            if action == "disconnect":
                service = value.get("service")
                if service:
                    if service not in row.get("gateways", {}):
                        raise LinkError("link_gateway_not_found", 404)
                    self.stop_child((key, service))
                    with self.lock:
                        del row["gateways"][service]
                else:
                    self.stop_child((key, "attach"))
                    row["attach"] = False
                self.save()
                return {"disconnected": True, "identity_retained": True}
            return self.sessions.action(action, value)

    def agent_action(self, peer, value):
        if not isinstance(value, dict):
            raise LinkError("link_invalid_action", 400)
        with self.operations:
            if self.stopped:
                raise LinkError("link_service_stopping", 503)
            if value.get("action") == "connections":
                if set(value) != {"action", "session_id"}:
                    raise LinkError("link_invalid_session_action", 400)
                return {
                    "connections": [
                        {
                            "id": key,
                            "name": row["name"],
                            "paired": row.get("paired", False),
                            "permissions": grant["permissions"],
                            "sessions": grant["sessions"],
                        }
                        for key, row in self.config["connections"].items()
                        if (grant := row.get("agent_grants", {}).get(peer["actor_id"]))
                        and grant["project"] == peer["project"]
                    ],
                    "pairing_grants_agent_access": False,
                }
            return self.sessions.action(value.get("action"), value, peer)

    def view(self, query):
        if set(query) - {"connection", "service", "resource", "before"} or any(
            len(v) != 1 for v in query.values()
        ):
            raise LinkError("link_invalid_view", 400)
        resource = query.get("resource", [""])[0]
        if resource not in ("snapshot", "registry", "chat-history", "health"):
            raise LinkError("link_view_not_allowed", 403)
        key, service = query.get("connection", [""])[0], query.get("service", [""])[0]
        with self.lock:
            row = self.connection(key)
            port = row.get("gateways", {}).get(service)
            child = self.children.get((key, service))
            if not port or not child or child.poll() is not None:
                raise LinkError("link_gateway_not_running", 503)
        suffix = ""
        if "before" in query:
            if resource != "chat-history" or not re.fullmatch(
                r"[1-9][0-9]{0,18}", query["before"][0]
            ):
                raise LinkError("link_invalid_cursor", 400)
            suffix = "?" + urlencode({"before": query["before"][0]})
        try:
            with build_opener(ProxyHandler({}), NoRedirect()).open(
                Request(f"http://127.0.0.1:{port}/api/{resource}{suffix}"), timeout=30
            ) as response:
                raw = response.read((8 << 20) + 1)
                if len(raw) > 8 << 20:
                    raise LinkError("link_response_too_large", 502)
                return json.loads(raw)
        except HTTPError as error:
            raise LinkError(
                "link_remote_view_not_shared" if error.code == 403 else "link_remote_unavailable",
                error.code,
            ) from None
        except (OSError, ValueError):
            raise LinkError("link_remote_unavailable", 503) from None
