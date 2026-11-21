#!/usr/bin/env python3
# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: Link/cloud/AGENTS.md | ring 2
# Chains: module-local; query impact before editing
# Regions: main
# Impact: python -B scripts/code-atlas.py show Link/cloud/desktop_owner.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""Desktop-owned cloud adapter. EOF releases only this device's own lease."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import sys
import threading


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--portable", type=Path, required=True)
    args = parser.parse_args()
    cfg = json.loads(args.config.read_text(encoding="utf-8-sig"))
    spec = importlib.util.spec_from_file_location("desktop_link", args.portable / "link.py")
    link = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(link)
    options = link.parser().parse_args(["--data", cfg["client_data"], "--cloud-key-file", cfg["key_file"],
                                        "--name", cfg.get("device_name", "Aieyra OS 电脑"), "connect"])
    data = link.prepare_cloud(options)
    if link.read_optional(data / "cloud-config.json").get("url") != cfg["url"].rstrip("/"):
        raise link.Error("original_cloud_office_retained")
    stop = threading.Event()

    def owner_eof():
        while sys.stdin.buffer.read(1):
            pass
        stop.set()

    threading.Thread(target=owner_eof, daemon=True).start()
    with link.STATION.lock(data / "desktop-owner.lock", seconds=0.2):
        link.ensure_runtime(options, data)
        with link.mcp_station_lifetime(data), link.attachment(data):
            station, result = link.join(options, data, full=False, working=False)
            native = result["identity"]["native_session_id"]
            if result["identity"]["kind"] != "link_local_session":
                raise link.Error("desktop_requires_its_own_adapter_session")
            print(json.dumps({"type": "link.desktop.cloud.ready", "actor_id": station.p["actor_id"],
                              "seat_id": station.p["seat_id"], "kind": "link_local_session"}), flush=True)
            while not stop.wait(25):
                # Communication renewal is idle, never an external-model activity.
                try:
                    link.ensure_runtime(options, data)
                    station, _ = link.join(options, data, full=False, working=False)
                except (link.Error, OSError, ValueError, KeyError):
                    if stop.wait(5):
                        break
        # Keep a runtime that another MCP attachment is actively borrowing.
        try:
            link.runtime_call(data, "stop")
        except (link.Error, OSError, ValueError):
            pass
    return 0


if __name__ == "__main__":
    os.umask(0o077)
    try:
        raise SystemExit(main())
    except Exception:
        print(json.dumps({"type": "link.desktop.cloud.error", "code": "desktop_cloud_connection_unconfirmed"}), flush=True)
        raise SystemExit(1)
