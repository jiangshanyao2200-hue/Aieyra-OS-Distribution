#!/usr/bin/env python3
# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: Link/portable/AGENTS.md | ring 2
# Chains: module-local; query impact before editing
# Regions: enroll; run
# Impact: python -B scripts/code-atlas.py show Link/portable/cloud_transport.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""Loopback Agent API to verified HTTPS cloud Link; no model execution."""

from __future__ import annotations

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
import os
from pathlib import Path
import secrets
import signal
import sys
import threading
from urllib.parse import urlsplit

HERE = Path(__file__).resolve().parent
PROTOCOL = HERE / "cloud/protocol.py"
if not PROTOCOL.is_file():
    PROTOCOL = HERE.parent / "cloud/protocol.py"
spec = importlib.util.spec_from_file_location("cloud_protocol", PROTOCOL)
wire = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wire)


def enroll(data, name):
    config = wire.read(data / "cloud-config.json")
    identity_file = data / "cloud-identity.json"
    if identity_file.exists():
        identity = wire.read(identity_file)
        if identity["url"] != config["url"]:
            raise wire.CloudError("original_cloud_office_retained", 409)
    else:
        identity = {"schema": 1, "url": config["url"], "device_id": secrets.token_hex(16),
                    "name": name, "token": secrets.token_urlsafe(32)}
        wire.atomic(identity_file, identity)
    client = wire.CloudHTTP(identity["url"])
    # Only enrollment is replayed with a durable, identical intent. Agent writes
    # are forwarded once and their original request IDs remain queryable.
    authorization = identity["token"] if identity.get("office_id") else config["key"]
    result = client.request("/v1/enroll", authorization,
                            {"device_id": identity["device_id"], "name": identity["name"], "token": identity["token"]})
    if identity.get("office_id") and result.get("office_id") != identity["office_id"]:
        raise wire.CloudError("original_cloud_office_retained", 409)
    identity.update(office_id=result["office_id"], actor_id=result["actor_id"], project=result["project"])
    wire.atomic(identity_file, identity)
    # The shared join key is no longer needed by an enrolled device.
    wire.atomic(data / "cloud-config.json", {"url": config["url"], "enrolled": True})
    return client, identity


def run(data, listen, name):
    client, identity = enroll(data, name)
    stopped = threading.Event()
    local_token = secrets.token_urlsafe(32)
    peer_token = identity["token"]

    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(35)

        def log_message(self, *_):
            pass

        def send(self, status, value):
            raw = json.dumps(value, ensure_ascii=False, allow_nan=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            try:
                self.wfile.write(raw)
            except (ConnectionError, TimeoutError):
                pass

        def do_GET(self):
            self.handle_request()

        def do_POST(self):
            self.handle_request()

        def handle_request(self):
            try:
                if any(len(self.headers.get_all(k, [])) > 1 for k in ("Host", "Authorization", "Origin", "Sec-Fetch-Site", "Content-Length", "Transfer-Encoding", "Content-Type")):
                    raise wire.CloudError("duplicate_local_cloud_header")
                if self.headers.get("Host") != "127.0.0.1:" + str(server.server_port) or self.headers.get("Origin") or self.headers.get("Sec-Fetch-Site") or self.headers.get("Transfer-Encoding") or self.headers.get("Authorization") != "Bearer " + local_token:
                    raise wire.CloudError("local_cloud_unauthorized", 403)
                if not self.path.startswith("/api/agent/v1/") or any(x in self.path for x in ("..", "%", "\\", "#")):
                    raise wire.CloudError("local_cloud_route_denied", 404)
                body = None
                if self.command == "POST":
                    length = int(self.headers.get("Content-Length", "-1"))
                    if not 0 < length <= 1024 * 1024:
                        raise wire.CloudError("local_cloud_body_out_of_bounds", 413)
                    if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                        raise wire.CloudError("local_cloud_json_required", 415)
                    body = json.loads(self.rfile.read(length))
                    if not isinstance(body, dict):
                        raise ValueError()
                result = client.request("/v1/agent/" + self.path[len("/api/agent/v1/"):], peer_token, body)
                self.send(200, result)
            except wire.CloudError as error:
                self.send(error.status, {"code": error.code, "replay_allowed": False})
            except (ValueError, TypeError, KeyError):
                self.send(400, {"code": "invalid_local_cloud_request", "replay_allowed": False})

    host, port = listen.rsplit(":", 1)
    if host != "127.0.0.1":
        raise wire.CloudError("cloud_agent_loopback_only")
    server = ThreadingHTTPServer((host, int(port)), Handler)
    server.daemon_threads = False
    server.block_on_close = True
    server.timeout = 0.2
    origin = "http://127.0.0.1:" + str(server.server_port)
    wire.atomic(data / "agent.json", {"url": origin, "token": local_token, "project": identity["project"]})
    wire.atomic(data / "status.json", {"state": "connected", "transport": "cloud", "version": wire.VERSION,
                "office_id": identity["office_id"], "endpoint": identity["url"], "device_id": identity["device_id"], "actor_id": identity["actor_id"]})
    # Exact parent pipe lifetime, including parent crash. No detached native
    # daemon survives its supervisor; credentials stay outside this package.
    def owner_eof():
        try:
            while sys.stdin.buffer.read(1):
                pass
        finally:
            stopped.set()
    threading.Thread(target=owner_eof, daemon=True).start()
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: stopped.set())
    try:
        while not stopped.is_set():
            server.handle_request()
    finally:
        server.server_close()
        wire.atomic(data / "status.json", {"state": "stopped", "transport": "cloud", "office_id": identity["office_id"]})
    return 0


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--data", type=Path, required=True)
    p.add_argument("--listen", default="127.0.0.1:0")
    p.add_argument("--name", default="Link 云设备")
    args = p.parse_args()
    os.umask(0o077)
    try:
        raise SystemExit(run(args.data.resolve(), args.listen, args.name))
    except (wire.CloudError, OSError, ValueError, KeyError) as error:
        print(json.dumps({"code": getattr(error, "code", "cloud_transport_start_failed"), "replay_allowed": False}), file=sys.stderr)
        raise SystemExit(1)
