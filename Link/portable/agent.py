#!/usr/bin/env python3
# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: Link/portable/AGENTS.md | ring 2
# Chains: module-local; query impact before editing
# Regions: open_station; main
# Impact: python -B scripts/code-atlas.py show Link/portable/agent.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""Join the automatically enrolled device worker using the existing protocol."""

import importlib.util
from pathlib import Path


HERE = Path(__file__).resolve().parent
STATION_SCRIPT = HERE / "scripts/agent-station.py"
if not STATION_SCRIPT.is_file():
    # Installed OS source reuses the one Control protocol implementation.
    # Distributable packages carry the same scripts in their relative layout.
    STATION_SCRIPT = HERE.parents[1] / "Control/app/scripts/agent-station.py"
SPEC = importlib.util.spec_from_file_location("lan_station", STATION_SCRIPT)
STATION = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(STATION)
Error = STATION.Error


def open_station(data, root=None, host="generic"):
    credential = data / "agent.json"
    if not credential.is_file():
        raise Error("link_not_connected")
    config = STATION.read_json(credential)
    client = STATION.CLIENT.AgentClient(config)
    inventory = client.call("seats")
    candidates = [seat for seat in inventory["seats"] if seat.get("project") == config.get("project")]
    if len(candidates) != 1:
        raise Error("device_worker_seat_unconfirmed")
    seat = candidates[0]
    profile_file = data / "station.json"
    with STATION.lock(data / "bootstrap.lock"):
        if profile_file.is_file():
            profile = STATION.read_json(profile_file)
            if profile.get("actor_id") != inventory["actor_id"] or profile.get("seat_id") != seat["id"] or profile.get("project") != config["project"]:
                raise Error("original_station_retained")
        else:
            STATION.atomic(profile_file, {
                "schema": 1, "host": host, "project": config["project"],
                "root": str((root or Path.cwd()).resolve()),
                "config_file": str(credential.resolve()), "actor_id": inventory["actor_id"],
                "seat_id": seat["id"], "lease": True,
            })
    return STATION.Station(profile_file), seat


def main():
    # Retain the old command names while using the complete automatic entry.
    spec = importlib.util.spec_from_file_location("lan_bootstrap", HERE / "link.py")
    bootstrap = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bootstrap)
    return bootstrap.main()


if __name__ == "__main__":
    raise SystemExit(main())
