#!/usr/bin/env python3
# @file-map:start
# 文件: link/office/scripts/agent-adapter.py
# 位置: 二环·工位CLI | 工位 Agent 接入、原编号投递回执、续接及本地工单工作区。
# 约束: 从当前响应读取身份与可用端点；日志脱敏且有界，不以命令返回替代实际工位状态
# 下游: link/office/scripts/agent-station.py
# 上游: 入口/动态加载；参阅链路与目录地图
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: python -X utf8 -B -m unittest discover -s link/office/tests/service -p test_agent_client.py
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   station_at | function
#   probe | function
#   read_receipt | function
#   run | function
#   main | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Install, inspect and self-check one's own persistent Codex office adapter."""

import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import sys
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "service"))
from native_wakeup import CodexConnection
from office_codex import connection_options, inspect_thread


# @chain-region station_at | calls: Path, Path(__file__).with_name, importlib.util.module_from_spec, importlib.util.spec_from_file_location, module.Station, spec.loader.exec_module
def station_at(profile):
    spec = importlib.util.spec_from_file_location(
        "adapter_station", Path(__file__).with_name("agent-station.py")
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.Station(profile)


# @chain-region probe | calls: CodexConnection, client.close, connection_options, inspect_thread
def probe(config):
    executable, args, env = connection_options(config)
    client = CodexConnection(executable, timeout=2, proxy_args=args, env=env)
    try:
        state, _ = inspect_thread(client, config["binding"]["native_session_id"])
        return {"native_reachable": True, "state": state, "probe_is_read_only": True}
    finally:
        client.close()


# @chain-region read_receipt | calls: Path, ValueError, any, isinstance, json.loads, len, path.open, raw.decode …
def read_receipt(path):
    if path == Path("-"):
        raw = sys.stdin.buffer.read(65537)
    else:
        with path.open("rb") as stream:
            raw = stream.read(65537)
    if len(raw) > 65536:
        raise ValueError("office_receipt_too_large")
    receipt = json.loads(raw.decode("utf-8-sig"))
    fields = ("id", "challenge", "native_session_id")
    if not isinstance(receipt, dict) or any(
        not isinstance(receipt.get(key), str) or not receipt[key] for key in fields
    ):
        raise ValueError("office_receipt_invalid")
    if not re.fullmatch(r"[0-9a-f]{64}", receipt["id"]):
        raise ValueError("office_receipt_invalid")
    return {key: receipt[key] for key in fields}


# @chain-region run | calls: ('CONFIG = ' + repr(config) + '\n').encode, (ROOT / 'service/native_wakeup.py').read_bytes, (ROOT / 'service/office_codex.py').read_bytes, Path, ValueError, args.body_file.read_text, config.update, directory.exists …
def run(args):
    station = station_at(args.profile)
    if args.action == "deliveries":
        query = {
            name: value
            for name, value in (("id", args.delivery_id), ("request_id", args.request_id))
            if value is not None
        }
        result = station.client.call("office/deliveries", query=query)
        if query and "delivery" not in result:
            raise ValueError("office_delivery_lookup_not_supported")
        return result
    seat = station.seat()
    native = seat.get("station_binding") or {}
    binding = {
        "actor_id": station.p["actor_id"],
        "native_session_id": native.get("native_session_id"),
        "binding_version": native.get("version"),
    }
    state = station.state()
    receipt = None
    if args.action == "ack" and getattr(args, "resume", False):
        receipt = read_receipt(args.receipt_file)
        if receipt["native_session_id"] != binding["native_session_id"]:
            raise ValueError("office_receipt_identity_mismatch")
        if (
            state.get("status") != "connected"
            or not state.get("session_id")
            or state.get("native_session_id") != receipt["native_session_id"]
            or state.get("session_id") != seat.get("session_id")
        ):
            resumed = station.ensure(
                receipt["native_session_id"],
                coordination_read=False,
                require_existing_binding=True,
            )
            if resumed.get("status") != "connected":
                return resumed
            state = station.state()
    if not binding["native_session_id"] or (
        args.action != "doctor" and (
            state.get("status") != "connected"
            or state.get("native_session_id") != binding["native_session_id"]
        )
    ):
        raise ValueError("join_own_current_native_first")
    if args.action in ("install", "doctor"):
        guide = station.client.call("office/guide")
        directory = Path(guide["adapter_directory"].replace("<own actor_id>", station.p["actor_id"]))
        if not directory.is_absolute() or directory.name != station.p["actor_id"]:
            raise ValueError("adapter_directory_invalid")
    if args.action == "install":
        config = {
            "binding": binding,
            "transport": "wsl" if args.wsl_distro else "native",
            "executable": args.codex,
            "codex_home": args.codex_home,
        }
        if args.wsl_distro:
            config.update(
                distro=args.wsl_distro,
                user=args.wsl_user,
                wsl_executable=args.wsl_executable or shutil.which("wsl.exe"),
            )
            if not config["wsl_executable"]:
                raise ValueError("wsl_executable_required")
        result = probe(
            config
        )  # Read-only; do not overwrite a usable adapter with an untested route.
        if directory.exists() and not args.replace:
            raise ValueError("adapter_exists_inspect_or_explicitly_replace")
        directory.mkdir(parents=True, exist_ok=True)
        # The manifest is published last; Control snapshots and hashes all four sources.
        sources = {
            "office_codex.py": (ROOT / "service/office_codex.py").read_bytes(),
            "native_wakeup.py": (ROOT / "service/native_wakeup.py").read_bytes(),
            "binding.py": ("CONFIG = " + repr(config) + "\n").encode("utf8"),
        }
        for name, data in sources.items():
            tmp = directory / (name + ".tmp")
            tmp.write_bytes(data)
            os.replace(tmp, directory / name)
        manifest = {
            "protocol": "aieyra-office-adapter/1",
            "name": "Codex " + config["transport"],
            "host": "codex",
            "entry": "office_codex.py",
            "files": list(sources),
            "capabilities": ["deliver"],
        }
        tmp = directory / "manifest.json.tmp"
        tmp.write_text(json.dumps(manifest), encoding="utf8")
        os.replace(tmp, directory / "manifest.json")
        # The live bounded watcher reads this route on its next probe. Installation
        # does not stop a watcher, disconnect a transport or start a native turn.
        profile = json.loads(station.path.read_text(encoding="utf-8-sig"))
        if profile.get("actor_id") != binding["actor_id"]:
            raise ValueError("profile_identity_changed")
        profile["native_status_connection"] = config
        temporary = station.path.with_name(station.path.name + "." + uuid.uuid4().hex + ".tmp")
        try:
            with temporary.open("x", encoding="utf8") as stream:
                os.chmod(temporary, 0o600)
                json.dump(profile, stream, ensure_ascii=False, indent=2)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, station.path)
        finally:
            temporary.unlink(missing_ok=True)
        return {
            **result,
            "native_status_saved": True,
            "native_status_activation": "next_native_probe",
            "adapter": station.client.call("office/reload", {"session_id": state["session_id"]}),
        }
    if args.action == "doctor":
        spec = importlib.util.spec_from_file_location(
            "own_adapter_binding", directory / "binding.py"
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        if module.CONFIG["binding"] != binding:
            raise ValueError("adapter_binding_changed_reinstall_and_recheck")
        native_result = probe(module.CONFIG)
        office = station.client.call("office")
        own = next(
            (
                row
                for row in office.get("adapters", [])
                if row.get("actor_id") == binding["actor_id"]
            ),
            {},
        )
        return {
            **native_result,
            "office_state": "online",
            "transport_state": seat.get("transport_state", "connected" if seat.get("session_id") else "unobserved"),
            "native_session_id": binding["native_session_id"],
            "binding_version": binding["binding_version"],
            "receipt_verified": own.get("state") == "verified",
            "office": office,
        }
    if args.action == "check":
        return station.client.call(
            "office/check",
            {
                "session_id": state["session_id"],
                "request_id": args.request_id,
                "target": args.target or binding["actor_id"],
                "body": "Link通信自检：请确认实际读到本消息后，用本人工位回复回执。",
            },
        )
    if args.action == "send":
        body = args.body_file.read_text(encoding="utf-8-sig")
        if not 0 < len(body) <= 8000:
            raise ValueError("office_message_invalid")
        return station.client.call(
            "office/send",
            {
                "session_id": state["session_id"],
                "request_id": args.request_id,
                "target": args.target,
                "body": body,
            },
        )
    if args.action == "ack":
        receipt = receipt or read_receipt(args.receipt_file)
        if receipt.get("native_session_id") != binding["native_session_id"]:
            raise ValueError("office_receipt_identity_mismatch")
        return station.client.call(
            "office/ack",
            {
                "session_id": state["session_id"],
                **receipt,
            },
        )
    raise ValueError("office_action_unknown")


# @chain-region main | calls: ack.add_argument, argparse.ArgumentParser, check.add_argument, commands.add_parser, deliveries.add_mutually_exclusive_group, getattr, install.add_argument, int …
def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", type=Path, required=True)
    commands = parser.add_subparsers(dest="action", required=True)
    install = commands.add_parser("install")
    install.add_argument("--codex", required=True)
    install.add_argument("--codex-home", required=True)
    install.add_argument("--wsl-distro")
    install.add_argument("--wsl-user")
    install.add_argument("--wsl-executable")
    install.add_argument("--replace", action="store_true")
    commands.add_parser("doctor")
    deliveries = commands.add_parser("deliveries")
    original = deliveries.add_mutually_exclusive_group()
    original.add_argument("--id", dest="delivery_id")
    original.add_argument("--request-id", help="Original outgoing request ID")
    check = commands.add_parser("check")
    check.add_argument(
        "--request-id",
        required=True,
        help="Retain this ID; unknown delivery must not be retried with a new ID",
    )
    check.add_argument("--target")
    send = commands.add_parser("send")
    send.add_argument("--request-id", required=True)
    send.add_argument("--target", required=True)
    send.add_argument("--body-file", required=True, type=Path)
    ack = commands.add_parser(
        "ack", help="Explicit acknowledgement only after receiving and reading the native message"
    )
    ack.add_argument("--receipt-file", required=True, type=Path, help="Received JSON file or - for stdin")
    ack.add_argument("--resume", action="store_true", help="Reconnect the receipt's existing native binding before acknowledging")
    args = parser.parse_args()
    try:
        result = run(args)
        print(json.dumps(result, ensure_ascii=False))
        return int(args.action == "ack" and result.get("state") != "acknowledged")
    except Exception as error:
        # No credentials, RPC payloads or native diagnostics on stdout.
        code = getattr(error, "code", None) or str(error)
        if not isinstance(code, str) or not re.fullmatch(r"[a-z][a-z0-9_]{1,100}", code):
            code = type(error).__name__
        print(json.dumps({"status": "failed", "code": code}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
