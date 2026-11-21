# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: Core/AGENTS.md | ring 0
# Chains: module-local; query impact before editing
# Regions: save_memory; run
# Impact: python -B scripts/code-atlas.py show Core/workspace_station.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""OS boundary adapter. Delegates identity and transport to Control's official API."""
import importlib.util
import inspect
import json
import os
import re
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path


def save_memory(station, native, states):
    # Shared project memory is merged using CAS. Never replace other actors' text.
    path = station.state_dir / "os-memory-intent.json"
    names = ("blueprint", "timeline", "checkpoint", "recovery", "index")
    marker = "[os-runtime:" + native + "]"
    facts = {
        "blueprint": "Independent OS task; parent is navigation only, context and cancellation remain local.",
        "timeline": "Runtime close observed; last states " + json.dumps(states, sort_keys=True),
        "checkpoint": "Only local execution receipts establish completion; connection is not execution.",
        "recovery": "Closed runtime must not replay. Retain the dedicated profile and reconcile unresolved transport intents.",
        "index": "Native " + native + "; dedicated actor " + station.p["actor_id"],
    }
    for _ in range(3):
        if path.exists():
            intent = station_module.read_json(path)
        else:
            latest = station.client.call("memory", query={"project": "os"})
            memory = latest.get("memory") or {}
            sections = dict(memory.get("sections") or {})
            for name in names:
                original = sections.get(name, "")
                line = marker + " " + facts[name]
                # Update only a line previously authored by this exact runtime.
                old = original.splitlines(keepends=True)
                old = [value for value in old if not value.startswith(marker + " ")]
                kept = "".join(old)
                sections[name] = kept + ("" if not kept or kept.endswith("\n") else "\n") + line
            body = {"request_id": "os-memory-" + uuid.uuid4().hex,
                    "session_id": station.state()["session_id"], "project": "os",
                    "version": memory.get("version", 0), "sections": sections,
                    "summary": "OS runtime " + native + " close boundary; other project records preserved."}
            if any(len(value) > 12000 for value in sections.values()) or len(json.dumps(sections, ensure_ascii=False).encode()) > 26000:
                raise station_module.Error("memory_merge_capacity_exceeded")
            intent = {"body": body}
            station_module.atomic(path, intent)
        try:
            saved = station.client.call("memory", intent["body"])
        except station_module.Error as error:
            if error.code != "memory_version_conflict":
                raise
            path.unlink()
            continue
        version = saved["memory"]["version"]
        readback = station.client.call("memory", query={"project": "os", "version": version})
        if readback["memory"]["sections"] != intent["body"]["sections"]:
            raise station_module.Error("memory_readback_mismatch")
        station_module.atomic(station.state_dir / "os-memory-receipt.json", readback)
        path.unlink()
        return
    raise station_module.Error("memory_version_conflict")


def run(p):
    global station_module
    script = Path(p["directory"]) / "scripts" / "agent-station.py"
    spec = importlib.util.spec_from_file_location("os_control_station", script)
    station_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(station_module)
    native, profile, action = p["native"], Path(p["profile"]), p["action"]
    if action not in ("join", "working", "idle", "finish"):
        raise station_module.Error("invalid_station_action")
    if not profile.exists():
        if action != "join":
            return {"state": "not_joined", "project": "os", "native_session_id": native, "stale": True}
        # Older adapters cannot truthfully create an idle membership. Fail before enrollment.
        if "working" not in inspect.signature(station_module.create_station).parameters:
            raise station_module.Error("station_idle_creation_requires_adapter_update")
        # Use the same local service as the embedded Control host. Never silently
        # enroll into the default office when a different port was selected.
        # beta：默认连 beta 自己的办公室（17930），绝不落到旧家的真实办公室（17910）。
        raw_port = os.environ.get("AIEYRA_CONTROL_PORT", "17930")
        if not re.fullmatch(r"[0-9]+", raw_port) or not 1024 <= int(raw_port) <= 65535:
            raise station_module.Error("station_control_port_invalid")
        intent = profile.parent / (profile.stem + ".state") / "create.json"
        created = station_module.create_station(profile, name="OS task " + native,
            project="os", root=p["root"], host="os", native=native,
            port=int(raw_port), resume=intent.exists(), working=False)
        if created.get("status") != "connected":
            return {"state": created.get("status", "unconfirmed"), "project": "os",
                    "native_session_id": native, "stale": True}
    station = station_module.Station(profile)
    if station.p["project"] != "os" or station.p["host"] != "os" or station.root != Path(p["root"]).resolve():
        raise station_module.Error("station_profile_mismatch")
    identity = {"project": "os", "native_session_id": native,
                "actor_id": station.p["actor_id"], "seat_id": station.p["seat_id"]}
    if action == "finish":
        failure = ""
        try:
            save_memory(station, native, p.get("states", {}))
        except Exception as error:
            failure = getattr(error, "code", "memory_save_unconfirmed")
        result = station.finish(native)
        return {**identity, "state": result["status"], "stale": not result.get("lease_released", False),
                "transport_session_id": result.get("transport_session_id"), "error": failure,
                "observed_at": datetime.now(timezone.utc).isoformat()}
    result = station.ensure(native, working=action == "working", resume=True, limit=20)
    if result.get("status") == "connected":
        seat = station.seat()
        if (seat["id"] != station.p["seat_id"] or
            seat.get("station_binding", {}).get("native_session_id") != native or
            seat.get("session_id") != result.get("transport_session_id")):
            raise station_module.Error("station_identity_readback_mismatch")
        # Private reference only. Reading does not ACK, dispatch or confer authority.
        station_module.atomic(station.state_dir / "os-recovery.json", result.get("resume", {}))
    return {**identity, "state": result.get("status", "unconfirmed"),
            "transport_session_id": result.get("transport_session_id"),
            "stale": result.get("status") != "connected",
            "observed_at": datetime.now(timezone.utc).isoformat()}


if __name__ == "__main__":
    try:
        print(json.dumps({"membership": run(json.load(sys.stdin))}))
    except Exception as error:
        code = getattr(error, "code", "station_adapter_failed")
        if not isinstance(code, str) or not re.fullmatch(r"[a-z][a-z0-9_.-]{0,99}", code):
            code = "station_adapter_failed"
        print(json.dumps({"error": code}))
