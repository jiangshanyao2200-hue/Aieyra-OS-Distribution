#!/usr/bin/env python3
# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: Link/portable/AGENTS.md | ring 2
# Chains: module-local; query impact before editing
# Regions: default_data; cloud_mode; runtime_version; prepare_cloud; read_optional; private_data; select_binary; runtime_call; probe_runtime; live_transport; ensure_runtime; supervise; attachment; host_context; identity; join; inject_session; mcp_station_lifetime; serve_mcp; parser; main
# Impact: python -B scripts/code-atlas.py show Link/portable/link.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""Start or reuse LAN transport and join this device's own Agent station."""

from __future__ import annotations

import argparse
from contextlib import contextmanager
import copy
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
import os
from pathlib import Path
import platform
import re
import secrets
import shutil
import signal
import subprocess
import sys
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, ProxyHandler, build_opener
import uuid


VERSION = "0.1.1"
CLOUD_VERSION = "0.2.0"
HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("portable_agent", HERE / "agent.py")
AGENT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AGENT)
STATION, Error = AGENT.STATION, AGENT.Error
CLIENT = STATION.CLIENT
OPENER = build_opener(ProxyHandler({}), CLIENT.NoRedirect())


def default_data():
    if (HERE / "CLOUD-PACKAGE.json").is_file():
        return Path(os.environ.get("AIEYRA_LINK_CLOUD_DATA", str(Path.home() / ".local/share/aieyra-link-cloud")))
    return Path(os.environ.get("AIEYRA_LINK_LAN_DATA", str(Path.home() / ".local/share/aieyra-link-lan")))


def cloud_mode(data):
    return (data / "cloud-config.json").is_file()


def runtime_version(data):
    return CLOUD_VERSION if cloud_mode(data) else VERSION


def prepare_cloud(args):
    # Cloud and LAN never share a credential/office directory implicitly.
    if args.cloud_key_file and args.data == default_data() and not (HERE / "CLOUD-PACKAGE.json").is_file():
        args.data = Path(os.environ.get("AIEYRA_LINK_CLOUD_DATA", str(Path.home() / ".local/share/aieyra-link-cloud")))
    data = private_data(args.data)
    key_value = None
    if not args.cloud_key_file and (HERE / "CLOUD-PACKAGE.json").is_file() and not cloud_mode(data):
        # The shared key stays outside the distributable archive. An AI can
        # place the separately supplied private file next to the extracted
        # folder, then use the normal start entry without copying a command.
        candidate = Path(os.environ["AIEYRA_LINK_KEY_FILE"]) if os.environ.get("AIEYRA_LINK_KEY_FILE") else HERE.parent / "Aieyra-Link-Cloud-key.txt"
        if candidate.is_file() and args.command not in {"status", "stop", "_supervise"}:
            args.cloud_key_file = candidate
    if args.cloud_key_file:
        key_value = args.cloud_key_file.read_text(encoding="utf-8-sig").strip()
    elif (HERE / "CLOUD-PACKAGE.json").is_file() and not cloud_mode(data) and args.command not in {"status", "stop", "_supervise"}:
        if not sys.stdin.isatty():
            raise Error("cloud_link_key_required_use_cloud_key_file")
        import getpass
        key_value = getpass.getpass("请输入 Aieyra Link 链接密钥（仅首次）：")
    if key_value:
        spec = importlib.util.spec_from_file_location("cloud_transport_setup", HERE / "cloud_transport.py")
        cloud = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cloud)
        try:
            value = cloud.wire.parse_key(key_value)
        except cloud.wire.CloudError as error:
            raise Error(error.code, error.status) from None
        with STATION.lock(data / "cloud-setup.lock"):
            old = read_optional(data / "cloud-config.json")
            if old and old["url"] != value["url"]:
                raise Error("original_cloud_office_retained")
            if not old and (data / "agent.json").exists():
                raise Error("existing_lan_office_retained_use_cloud_data")
            if not old or not old.get("enrolled"):
                STATION.atomic(data / "cloud-config.json", value)
    return data


def read_optional(path):
    return STATION.read_json(path) if path.is_file() else {}


def private_data(value):
    data = value.expanduser().resolve()
    if data == HERE or data.is_relative_to(HERE):
        raise Error("private_data_must_be_outside_package")
    data.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(data, 0o700)
    return data


def select_binary(data, override=None):
    if override:
        binary = override.expanduser().resolve()
        if not binary.is_file():
            raise Error("native_binary_missing")
        return binary
    arch = {"aarch64": "arm64", "arm64": "arm64", "x86_64": "amd64", "amd64": "amd64"}.get(platform.machine().lower())
    android = bool(os.environ.get("TERMUX_VERSION") or os.environ.get("ANDROID_ROOT") or Path("/system/bin/linker64").exists())
    system = "android" if android else "linux"
    if not arch or (not android and platform.system() != "Linux"):
        raise Error("platform_not_supported")
    source = HERE / "bin" / (system + "-" + arch) / "aieyra-link-lan"
    if not source.is_file():
        raise Error("native_binary_missing")
    # Android shared storage is noexec. Stage only the verified native bytes in
    # HOME; Python sources can still be read from the original package location.
    raw = source.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    manifest = HERE / "MANIFEST.sha256"
    if manifest.is_file():
        entry = digest + "  " + source.relative_to(HERE).as_posix()
        if entry not in manifest.read_text(encoding="utf-8").splitlines():
            raise Error("native_manifest_mismatch")
    target = data / "native" / digest / "aieyra-link-lan"
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if not target.is_file():
        tmp = target.with_name("native-" + uuid.uuid4().hex + ".tmp")
        try:
            with tmp.open("xb") as output:
                output.write(raw)
            os.chmod(tmp, 0o700)
            os.replace(tmp, target)
        finally:
            tmp.unlink(missing_ok=True)
    if hashlib.sha256(target.read_bytes()).hexdigest() != digest:
        raise Error("retained_native_binary_mismatch")
    os.chmod(target, 0o700)
    return target


def runtime_call(data, action="status", body=None, timeout=2):
    info = STATION.read_json(data / "runtime.json")
    parsed = urlsplit(info["url"])
    if parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or not parsed.port or parsed.path or parsed.query or parsed.fragment or parsed.username or parsed.password:
        raise Error("invalid_local_runtime")
    if not re.fullmatch(r"[a-f0-9]{64}", info["token"]):
        raise Error("invalid_local_runtime")
    request = Request(info["url"] + "/" + action,
                      data=json.dumps(body or {}).encode() if action != "status" else None,
                      headers={"Authorization": "Bearer " + info["token"], "Content-Type": "application/json"})
    status = 200
    try:
        with OPENER.open(request, timeout=timeout) as response:
            result = CLIENT.AgentClient.read_response(response)
    except HTTPError as response:
        with response:
            result = CLIENT.AgentClient.read_response(response)
            status = response.code
    if result.get("instance") != info["instance"]:
        raise Error("local_runtime_identity_mismatch")
    if status != 200:
        code = result.get("code", "local_runtime_request_failed")
        if not isinstance(code, str) or not re.fullmatch(r"[a-z0-9_]{1,100}", code):
            code = "local_runtime_request_failed"
        raise Error(code, status)
    return result


def probe_runtime(data):
    try:
        return runtime_call(data)
    except (Error, OSError, ValueError, KeyError, URLError):
        return None


def live_transport(data, timeout=2):
    state = read_optional(data / "status.json")
    if state.get("state") != "connected" or not (data / "agent.json").is_file():
        return None
    try:
        config = STATION.read_json(data / "agent.json")
        client = CLIENT.AgentClient(config)
        client.timeout = timeout
        inventory = client.call("seats")
        if inventory.get("actor_id") and inventory.get("seats"):
            return state
    except Error:
        pass
    return None


def ensure_runtime(args, data):
    deadline = time.monotonic() + args.timeout
    with STATION.lock(data / "launch.lock", seconds=min(args.timeout, 60)):
        runtime = probe_runtime(data)
        if runtime is None:
            existing = live_transport(data)
            if existing:
                # A verified manually started native channel may be borrowed;
                # never claim its lifetime or stop it using a stored PID.
                return existing
            binary = None if cloud_mode(data) else select_binary(data, args.binary)
            log_path = data / "runtime.log"
            with log_path.open("ab") as log:
                os.chmod(log_path, 0o600)
                command = [
                    sys.executable, "-X", "utf8", str(HERE / "link.py"),
                    "--data", str(data),
                    "--listen", args.listen, "--name", args.name,
                    "--idle-seconds", str(args.idle_seconds), "_supervise",
                ]
                if binary:
                    command[4:4] = ["--binary", str(binary)]
                child = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), start_new_session=os.name != "nt")
            while time.monotonic() < deadline:
                runtime = probe_runtime(data)
                if runtime is not None:
                    break
                if child.poll() is not None:
                    # A concurrent starter may have won the kernel lock.
                    runtime = probe_runtime(data)
                    if runtime is None:
                        raise Error("local_runtime_start_failed_see_runtime_log")
                    break
                time.sleep(0.1)
        if runtime is None:
            raise Error("local_runtime_start_timeout")
        if runtime["version"] != runtime_version(data):
            raise Error("local_runtime_version_retained_stop_before_upgrade")
        runtime_call(data, "touch")
    while time.monotonic() < deadline:
        state = live_transport(data, min(3, max(0.1, deadline - time.monotonic())))
        if state:
            return state
        runtime = probe_runtime(data)
        if runtime is None or runtime.get("native_exit") is not None:
            raise Error("local_transport_stopped_see_runtime_log")
        time.sleep(0.2)
    raise Error("office_not_found_yet_retry_same_entry")


def supervise(args, data):
    with STATION.lock(data / "supervisor.lock", seconds=0.2):
        stop = threading.Event()
        instance, token = uuid.uuid4().hex, secrets.token_hex(32)
        holders, state_lock = {}, threading.Lock()
        last_activity = time.monotonic()
        binary = None if cloud_mode(data) else select_binary(data, args.binary)
        native = None

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def respond(self, status, value):
                raw = json.dumps({"instance": instance, **value}).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def do_GET(self):
                self.handle_request()

            def do_POST(self):
                self.handle_request()

            def handle_request(self):
                nonlocal last_activity
                if self.headers.get("Authorization") != "Bearer " + token or self.headers.get("Origin") or self.headers.get("Sec-Fetch-Site") or self.headers.get("Host") != "127.0.0.1:" + str(server.server_port):
                    self.respond(403, {"code": "local_runtime_unauthorized"})
                    return
                try:
                    length = int(self.headers.get("Content-Length", 0))
                    if not 0 <= length <= 4096 or self.headers.get("Transfer-Encoding"):
                        raise ValueError()
                    body = json.loads(self.rfile.read(length)) if length else {}
                    if not isinstance(body, dict):
                        raise ValueError()
                    action = self.path.removeprefix("/")
                    if (self.command == "GET") != (action == "status"):
                        raise ValueError()
                    with state_lock:
                        now = time.monotonic()
                        for key in list(holders):
                            if holders[key] < now:
                                holders.pop(key)
                        if action == "acquire":
                            if not re.fullmatch(r"[a-f0-9]{32}", body.get("holder", "")):
                                raise ValueError()
                            holders[body["holder"]] = now + 60
                        elif action == "release":
                            holders.pop(body.get("holder"), None)
                        elif action == "stop":
                            if holders:
                                self.respond(409, {"code": "runtime_in_use", "holders": len(holders)})
                                return
                            stop.set()
                        elif action not in {"status", "touch"}:
                            raise ValueError()
                        if action != "status":
                            last_activity = now
                        self.respond(200, {"version": runtime_version(data), "holders": len(holders), "native_exit": native.poll() if native else None})
                except (ValueError, TypeError):
                    self.respond(400, {"code": "invalid_runtime_request"})

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        server.daemon_threads = True
        server.timeout = 0.2
        for sig in (signal.SIGTERM, signal.SIGINT):
            signal.signal(sig, lambda *_: stop.set())
        env = {**os.environ, "AIEYRA_OS_OWNER_STDIN": "1"}
        command = ([sys.executable, "-X", "utf8", str(HERE / "cloud_transport.py"), "--data", str(data),
                    "--listen", "127.0.0.1:0" if args.listen == "127.0.0.1:17921" else args.listen, "--name", args.name]
                   if cloud_mode(data) else [str(binary), "run", "--data", str(data), "--listen", args.listen, "--name", args.name])
        native = subprocess.Popen(command,
                                  stdin=subprocess.PIPE, stdout=sys.stdout, stderr=sys.stderr, env=env,
                                  creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        STATION.atomic(data / "runtime.json", {"schema": 1, "version": runtime_version(data), "instance": instance,
                       "url": "http://127.0.0.1:" + str(server.server_port), "token": token})
        try:
            while not stop.is_set() and native.poll() is None:
                server.handle_request()
                with state_lock:
                    live_holders = any(expiry > time.monotonic() for expiry in holders.values())
                    if not live_holders and time.monotonic() - last_activity > args.idle_seconds:
                        break
        finally:
            # Finish the device's own transport while the LAN gateway still exists.
            try:
                profile = read_optional(data / "station.json")
                if profile:
                    station = STATION.Station(data / "station.json")
                    connection = station.state()
                    if connection.get("status") == "connected":
                        station.finish(connection["native_session_id"])
            except (Error, OSError, ValueError, KeyError):
                pass  # The server lease remains bounded when the office is offline.
            native.stdin.close()
            try:
                native.wait(timeout=10)
            except subprocess.TimeoutExpired:
                native.terminate()  # This is only the exact child created above.
                native.wait(timeout=5)
            server.server_close()
        return 0


@contextmanager
def attachment(data):
    if probe_runtime(data) is None:
        if live_transport(data):
            yield
            return
        raise Error("local_transport_stopped")
    holder, stopped = uuid.uuid4().hex, threading.Event()
    with STATION.lock(data / "lifecycle.lock"):
        runtime_call(data, "acquire", {"holder": holder})

    def keep_attachment():
        while not stopped.wait(20):
            try:
                runtime_call(data, "acquire", {"holder": holder})
            except (Error, OSError, ValueError, KeyError, URLError):
                return

    thread = threading.Thread(target=keep_attachment, daemon=True, name="link-attachment")
    thread.start()
    try:
        yield
    finally:
        stopped.set()
        thread.join(timeout=3)
        try:
            runtime_call(data, "release", {"holder": holder})
        except (Error, OSError, ValueError, KeyError, URLError):
            pass


def host_context(args):
    # Host IDs are used only when actually supplied by this process's host.
    detected = [("codex", "CODEX_THREAD_ID"), ("claude", "CLAUDE_CODE_SESSION_ID"), ("cursor", "CURSOR_CONVERSATION_ID")]
    context = next(({"host": host, "native_session_id": os.environ[key], "source": key}
                    for host, key in detected if os.environ.get(key)), None)
    if args.native_session_id:
        context = {"host": "generic", "native_session_id": args.native_session_id, "source": "explicit_host_context"}
    return context


def identity(args, data, seat):
    context = host_context(args)
    file = data / "adapter-session.json"
    with STATION.lock(data / "identity.lock"):
        saved = read_optional(file)
        if saved and (saved.get("schema") != 1 or saved.get("kind") not in {"host_session", "link_local_session"}):
            raise Error("retained_adapter_identity_invalid")
        if saved.get("kind") == "link_local_session" and not args.native_session_id:
            # This is a real session of the local Link adapter, not an invented
            # ID for an unknown Codex/Claude conversation. Upstream identity is
            # diagnostic only and is never silently rebound into this station.
            result = saved
        elif context:
            result = {"schema": 1, "kind": "host_session", **context}
        elif saved.get("kind") == "host_session":
            raise Error("host_session_context_unavailable")
        elif (seat.get("station_binding") or {}).get("native_session_id"):
            raise Error("existing_host_binding_requires_its_real_context")
        else:
            result = {"schema": 1, "kind": "link_local_session", "host": "generic",
                      "native_session_id": "link-agent-" + uuid.uuid4().hex,
                      "source": "local_link_adapter_session", "created_at": time.time()}
        if not isinstance(result.get("native_session_id"), str) or not re.fullmatch(r"[A-Za-z0-9_.:-]{1,100}", result["native_session_id"]):
            raise Error("real_native_session_id_required")
        if not saved:
            STATION.atomic(file, result)
    return {**result, "upstream_host": context if result["kind"] == "link_local_session" else None}


def join(args, data, *, full=True, working=False):
    ensure_runtime(args, data)
    retained = read_optional(data / "adapter-session.json")
    host = retained.get("host") or (host_context(args) or {}).get("host", "generic")
    station, seat = AGENT.open_station(data, args.root, host=host)
    ident = identity(args, data, seat)
    binding = seat.get("station_binding") or {}
    if binding.get("native_session_id") and binding["native_session_id"] != ident["native_session_id"]:
        return station, {"status": "handoff_required", "code": "handoff_required_original_native_retained",
                         "actor_id": station.p["actor_id"], "seat_id": seat["id"],
                         "expected_version": binding["version"], "automatic_handoff": False}
    with STATION.lock(data / "lifecycle.lock"):
        result = station.ensure(ident["native_session_id"], working=working, resume=full,
                                after=args.after, stream_epoch=args.stream_epoch, coordination_read=full)
    if result.get("status") != "connected":
        raise Error(result.get("status", "station_join_unconfirmed"))
    result.update(identity=ident, actor_id=station.p["actor_id"], link_version=runtime_version(data),
                  automatic_transport=True, user_setup_steps=0)
    return station, result


def inject_session(client, name, arguments, sid):
    value = copy.deepcopy(arguments)
    specification = next((shape for tool, _, shape in CLIENT.TOOLS if tool == name), None)
    if specification and "session_id" in specification["properties"]:
        if value.get("session_id", sid) != sid:
            raise Error("other_transport_denied")
        value["session_id"] = sid
    if name == "aieyra_center":
        body = value.get("body")
        if body is not None:
            if body.get("session_id", sid) != sid:
                raise Error("other_transport_denied")
            if value.get("route") in {"ack", "message", "task/claim", "task/update"}:
                body.setdefault("session_id", sid)
    return CLIENT.invoke(client, name, value)


@contextmanager
def mcp_station_lifetime(data):
    try:
        yield
    finally:
        # This runs after attachment release, including interrupts and errors.
        # Acquisition uses this same lock so a new attachment cannot be closed
        # between the last-holder check and the station finish.
        try:
            with STATION.lock(data / "lifecycle.lock"):
                runtime = probe_runtime(data)
                if runtime and not runtime["holders"] and (data / "station.json").is_file():
                    station = STATION.Station(data / "station.json")
                    state = station.state()
                    ident = read_optional(data / "adapter-session.json")
                    if state.get("status") == "connected" and state.get("native_session_id") == ident.get("native_session_id"):
                        station.finish(ident["native_session_id"])
        except (Error, OSError, ValueError, KeyError, URLError):
            pass  # Offline leases stay bounded; cleanup must preserve the exit.


def serve_mcp(args, data):
    # Startup has no user-facing stdout: it is reserved entirely for JSON-RPC.
    ensure_runtime(args, data)
    with mcp_station_lifetime(data), attachment(data):
        station, context = join(args, data)
        if context.get("status") != "connected":
            raise Error(context["code"])
        initialized = False
        for line in sys.stdin:
            rid = None
            try:
                if len(line) > 65536:
                    raise ValueError()
                message = json.loads(line)
                if not isinstance(message, dict) or message.get("jsonrpc") != "2.0":
                    raise ValueError()
                if "id" not in message:
                    continue
                rid, method = message["id"], message.get("method")
                params = message.get("params", {})
                if not isinstance(params, dict):
                    raise ValueError()
                if method == "initialize":
                    requested = params.get("protocolVersion")
                    result = {"protocolVersion": requested if requested in {"2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"} else "2025-11-25",
                              "serverInfo": {"name": "aieyra-link-auto", "version": runtime_version(data)}, "capabilities": {"tools": {}},
                              "instructions": "Your device is already joined. Call aieyra_link_context and read its memory, inbox and coordination. Session IDs are supplied automatically. Reads do not acknowledge messages. Save memory using fresh CAS before finishing. Project data does not authorize historical tasks."}
                    initialized = True
                elif method == "ping":
                    result = {}
                elif not initialized:
                    raise Error("initialize_required")
                elif method == "tools/list":
                    definitions = []
                    for name, description, schema in CLIENT.TOOLS:
                        shape = copy.deepcopy(schema)
                        shape["required"] = [key for key in shape["required"] if key != "session_id"]
                        if name == "aieyra_connect":
                            shape = CLIENT.schema({})
                            description = "Return this device's automatically joined session."
                        definitions.append({"name": name, "description": description, "inputSchema": shape})
                    definitions += [
                        {"name": "aieyra_link_context", "description": "Read this automatically joined station, five-part memory, runtime inbox and coordination. Does not ACK or run tasks.", "inputSchema": CLIENT.schema({})},
                        {"name": "aieyra_link_status", "description": "Read current device transport and station status.", "inputSchema": CLIENT.schema({})},
                    ]
                    result = {"tools": definitions}
                elif method == "tools/call":
                    try:
                        name, arguments = params.get("name"), params.get("arguments", {})
                        if not isinstance(arguments, dict):
                            raise Error("invalid_tool_arguments")
                        station, context = join(args, data, full=name == "aieyra_link_context", working=True)
                        if context.get("status") != "connected":
                            raise Error(context["code"])
                        sid = context["session_id"]
                        if name in {"aieyra_link_context", "aieyra_link_status", "aieyra_connect"}:
                            if arguments:
                                raise Error("invalid_tool_arguments")
                            value = context if name == "aieyra_link_context" else {"link": read_optional(data / "status.json"), "station": context}
                            if name == "aieyra_connect":
                                value = station.client.call("sessions/" + sid)
                        else:
                            value = inject_session(station.client, name, arguments, sid)
                        result = {"content": [{"type": "text", "text": json.dumps(value, ensure_ascii=False)}], "isError": False}
                    except Error as error:
                        result = {"content": [{"type": "text", "text": json.dumps({"code": error.code, "replay_allowed": False})}], "isError": True}
                else:
                    raise Error("method_not_found")
                response = {"jsonrpc": "2.0", "id": rid, "result": result}
            except (ValueError, TypeError, AttributeError):
                response = {"jsonrpc": "2.0", "id": rid, "error": {"code": -32600, "message": "Invalid request"}}
            except Error as error:
                response = {"jsonrpc": "2.0", "id": rid, "error": {"code": -32601, "message": error.code}}
            print(json.dumps(response, ensure_ascii=False), flush=True)
    return 0


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--data", type=Path, default=default_data())
    common.add_argument("--binary", type=Path)
    common.add_argument("--cloud-key-file", type=Path)
    common.add_argument("--listen", default="127.0.0.1:17921")
    common.add_argument("--name", default=os.environ.get("AIEYRA_LINK_DEVICE_NAME", platform.node() or "Termux Link"))
    common.add_argument("--timeout", type=float, default=45)
    common.add_argument("--idle-seconds", type=int, default=600)
    common.add_argument("--native-session-id")
    common.add_argument("--root", type=Path)
    common.add_argument("--after", type=int, default=0)
    common.add_argument("--stream-epoch")
    p = argparse.ArgumentParser(description=__doc__, parents=[common])
    commands = p.add_subparsers(dest="command", required=True)
    for name in ("connect", "join", "work", "status", "finish", "stop", "mcp", "_supervise"):
        # Suppressed defaults let options be supplied before or after the command.
        child = commands.add_parser(name)
        for action in common._actions:
            options = {"dest": action.dest, "default": argparse.SUPPRESS}
            if action.type:
                options["type"] = action.type
            child.add_argument(*action.option_strings, **options)
    return p


def main():
    args = parser().parse_args()
    if not 1 <= args.timeout <= 120 or not 30 <= args.idle_seconds <= 86400:
        raise SystemExit("Timeout or idle duration is out of bounds")
    os.umask(0o077)
    try:
        data = prepare_cloud(args)
        if args.command == "_supervise":
            return supervise(args, data)
        if args.command == "status":
            runtime = probe_runtime(data)
            profile = read_optional(data / "station.json")
            value = {"runtime": runtime, "link": read_optional(data / "status.json"),
                     "connection": read_optional(data / "station.state/connection.json"),
                     "actor_id": profile.get("actor_id"), "seat_id": profile.get("seat_id")}
        elif args.command == "stop":
            runtime = probe_runtime(data)
            if runtime:
                runtime_call(data, "stop")
                deadline = time.monotonic() + 20
                while probe_runtime(data) and time.monotonic() < deadline:
                    time.sleep(0.1)
                if probe_runtime(data):
                    raise Error("runtime_stop_unconfirmed")
            elif live_transport(data):
                raise Error("unmanaged_transport_retained")
            value = {"status": "stopped", "runtime": probe_runtime(data), "link": read_optional(data / "status.json")}
        elif args.command == "finish":
            ensure_runtime(args, data)
            with attachment(data):
                station, seat = AGENT.open_station(data, args.root)
                ident = identity(args, data, seat)
                if (seat.get("station_binding") or {}).get("native_session_id", ident["native_session_id"]) != ident["native_session_id"]:
                    raise Error("other_transport_denied")
                value = station.finish(ident["native_session_id"])
        elif args.command == "mcp":
            return serve_mcp(args, data)
        else:
            ensure_runtime(args, data)
            with attachment(data):
                _, value = join(args, data, full=True, working=args.command == "work")
        print(json.dumps(value, ensure_ascii=False, indent=2))
        return 2 if value.get("status") == "handoff_required" else 0
    except (Error, OSError, ValueError, KeyError, URLError) as error:
        code = error.code if isinstance(error, Error) else "local_link_state_unavailable"
        print(json.dumps({"code": code, "automatic_replay": False}, ensure_ascii=False), file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
