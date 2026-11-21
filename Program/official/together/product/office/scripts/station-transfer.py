#!/usr/bin/env python3
# @file-map:start
# 文件: link/office/scripts/station-transfer.py
# 位置: 二环·工位CLI | 工位 Agent 接入、原编号投递回执、续接及本地工单工作区。
# 约束: 从当前响应读取身份与可用端点；日志脱敏且有界，不以命令返回替代实际工位状态
# 下游: link/office/scripts/agent-station.py
# 上游: 入口/动态加载；参阅链路与目录地图
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: python -X utf8 -B -m unittest discover -s link/office/tests/service -p test_agent_client.py
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   read_private | function
#   export_station | function
#   import_station | function
#   main | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Explicit private export/import of an existing station; never creates or takes a seat."""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
from pathlib import Path
import sys

SPEC = importlib.util.spec_from_file_location(
    "transfer_station", Path(__file__).with_name("agent-station.py")
)
STATION = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(STATION)
Error = STATION.Error
FORMAT = "aieyra-station-transfer/1"


# @chain-region read_private | calls: Error, Path, Path(path).absolute, STATION.ENROLL.external_path, STATION.read_json, path.stat
def read_private(path):
    path = STATION.ENROLL.external_path(Path(path).absolute())
    if os.name != "nt" and path.stat().st_mode & 0o077:
        raise Error("private_file_requires_mode_600")
    if path.stat().st_size > 16384:
        raise Error("station_transfer_too_large")
    return STATION.read_json(path)


# @chain-region export_station | calls: Error, Path, Path(output).absolute, STATION.ENROLL.save_new, STATION.Station, station.seat, str
def export_station(profile, output):
    station = STATION.Station(profile)
    seat = station.seat()
    if not seat["selectable"]:
        raise Error("finish_the_active_station_before_export")
    # Export only selected identity fields. No paths, native IDs, chats, state or leases.
    value = {
        "format": FORMAT,
        "project": station.p["project"],
        "actor_id": station.p["actor_id"],
        "seat_id": station.p["seat_id"],
        "token": station.client.token,
    }
    STATION.ENROLL.save_new(output, value)
    return {
        "status": "exported",
        "file": str(Path(output).absolute()),
        "contains_secret": True,
        "handoff_performed": False,
    }


# @chain-region import_station | calls: (seat.get('station_binding') or {}).get, Error, Path, Path(profile).expanduser, Path(profile).expanduser().absolute, Path(root).expanduser, Path(root).expanduser().resolve, STATION.CLIENT.AgentClient …
def import_station(bundle, profile, root, host, port):
    value = read_private(bundle)
    if (
        set(value) != {"format", "project", "actor_id", "seat_id", "token"}
        or value["format"] != FORMAT
    ):
        raise Error("invalid_station_transfer")
    for key in ("project", "actor_id", "seat_id"):
        if not isinstance(value[key], str) or not STATION.ID.fullmatch(value[key]):
            raise Error("invalid_station_transfer")
    if host not in STATION.HOSTS or type(port) is not int or not 1 <= port <= 65535:
        raise Error("invalid_station_import_arguments")
    root = Path(root).expanduser().resolve()
    if not root.is_dir():
        raise Error("project_root_missing")
    profile = STATION.ENROLL.external_path(Path(profile).expanduser().absolute())
    state = STATION.ENROLL.external_path(profile.parent / (profile.stem + ".state"))
    config = state / "credential.json"
    if state in profile.parents or profile == config:
        raise Error("invalid_station_profile_path")
    credential = {"url": f"http://127.0.0.1:{port}", "token": value["token"]}
    client = STATION.CLIENT.AgentClient(credential)
    seats = client.call("seats")
    seat = next((row for row in seats.get("seats", []) if row["id"] == value["seat_id"]), None)
    if (
        seats.get("actor_id") != value["actor_id"]
        or not seat
        or seat["project"] != value["project"]
    ):
        raise Error("credential_project_or_seat_mismatch")
    result = {
        "schema": 1,
        "host": host,
        "project": value["project"],
        "root": str(root),
        "actor_id": value["actor_id"],
        "seat_id": value["seat_id"],
        "config_file": str(config),
    }
    with STATION.lock(state / "import.lock"):
        # A retry may finish an interrupted local import, but never change its destination.
        for path, expected in ((profile, result), (config, credential)):
            if path.exists() and read_private(path) != expected:
                raise Error("existing_station_import_mismatch")
        if not config.exists():
            STATION.ENROLL.save_new(config, credential)
        if not profile.exists():
            STATION.ENROLL.save_new(profile, result)
    return {
        "status": "imported",
        "profile": str(profile),
        "host": host,
        "binding_version": (seat.get("station_binding") or {}).get("version"),
        "joined": False,
        "handoff_performed": False,
        "next": "join_with_your_real_native_session_id",
    }


# @chain-region main | calls: argparse.ArgumentParser, export.add_argument, export_station, import_station, isinstance, json.dumps, load.add_argument, os.umask …
def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    export = sub.add_parser(
        "export", help="Write a secret bundle after the original station finishes"
    )
    export.add_argument("--profile", type=Path, required=True)
    export.add_argument("--output", type=Path, required=True)
    load = sub.add_parser(
        "import", help="Validate through a local gateway and save phone-local paths"
    )
    load.add_argument("--bundle", type=Path, required=True)
    load.add_argument("--profile", type=Path, required=True)
    load.add_argument("--root", type=Path, required=True)
    load.add_argument("--host", choices=STATION.HOSTS, default="codex")
    load.add_argument("--port", type=int, default=17921)
    args = parser.parse_args()
    if os.name != "nt":
        os.umask(0o077)
    try:
        if args.action == "export":
            result = export_station(args.profile, args.output)
        else:
            result = import_station(args.bundle, args.profile, args.root, args.host, args.port)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (Error, ValueError, OSError, KeyError, TypeError):
        error = sys.exception()
        code = error.code if isinstance(error, Error) else "invalid_or_unavailable_private_transfer"
        print(json.dumps({"status": "error", "code": code}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
