#!/usr/bin/env python3
# @file-map:start
# 文件: link/office/scripts/control.py
# 位置: 二环·工位CLI | 工位 Agent 接入、原编号投递回执、续接及本地工单工作区。
# 约束: 从当前响应读取身份与可用端点；日志脱敏且有界，不以命令返回替代实际工位状态
# 下游: 无已解析的项目内静态导入
# 上游: 入口/动态加载；参阅链路与目录地图
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: python -X utf8 -B -m unittest discover -s link/office/tests/service -p test_agent_client.py
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   link_path | function
#   command | function
#   verify_link | function
#   install_link | function
#   doctor | function
#   run_service | function
#   main | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Headless Control and the native Link runtime, without a desktop dependency."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
LINK_VERSION = "0.3.1"
sys.path.insert(0, str(ROOT / "service"))
from paths import data_root, external_path
from office_runtime import DEFAULT_PORT


from link_paths import native_target, product_link_root, link_path as discover_link


# @chain-region link_path | calls: discover_link
def link_path():
    return discover_link(ROOT)


# @chain-region command | calls: Path, ValueError, getattr, result.stdout.strip, str, subprocess.run
def command(argv, *, cwd=None, env=None, timeout=600):
    result = subprocess.run(
        [str(item) for item in argv],
        cwd=cwd,
        env=env,
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        timeout=timeout,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    if result.returncode:
        # Do not echo environment, credentials, Git helpers, or arbitrary subprocess output.
        raise ValueError(Path(str(argv[0])).stem + "_failed_check_installed_toolchain_and_network")
    return result.stdout.strip()


# @chain-region verify_link | calls: ValueError, command, hashlib.sha256, hashlib.sha256(target.read_bytes()).hexdigest, target.read_bytes
def verify_link(target):
    version = command([target, "version"], timeout=15)
    if version != "Aieyra Link " + LINK_VERSION:
        raise ValueError("link_version_mismatch")
    return {"version": LINK_VERSION, "sha256": hashlib.sha256(target.read_bytes()).hexdigest()}


# @chain-region install_link | calls: (source / 'native/go.mod').is_file, Path, Path(output).expanduser, Path(output).expanduser().absolute, ValueError, candidate.read_bytes, command, dict …
def install_link(output=None):
    """Build this Together project's single Link implementation; preserve existing runtimes."""
    system, arch = native_target()
    target = Path(output).expanduser().absolute() if output else link_path()
    if target.exists() or target.is_symlink():
        raise ValueError("link_output_exists_preserve_it_or_choose_a_new_output")
    source = product_link_root(ROOT)
    if not (source / "native/go.mod").is_file():
        raise ValueError("build_link_from_the_together_source_project")
    go = shutil.which("go")
    if not go:
        raise ValueError("install_go_1_26_8_or_newer_first")
    env = dict(os.environ, CGO_ENABLED="0", GOOS=system, GOARCH=arch, GOFLAGS="-p=1", GOMAXPROCS="1", GOWORK="off")
    if system == "android":
        # Official Go auto-downloads are not a replacement for Termux's patched toolchain.
        env["GOTOOLCHAIN"] = "local"
    with tempfile.TemporaryDirectory(prefix="aieyra-link-build-") as directory:
        candidate = Path(directory) / target.name
        command(
            [go, "build", "-mod=readonly", "-trimpath", "-o", candidate, "./cmd/aieyra-link"],
            cwd=source / "native",
            env=env,
        )
        verified = verify_link(candidate)
        target.parent.mkdir(parents=True, exist_ok=True)
        # A same-directory candidate plus exclusive link protects an existing installation.
        fd, name = tempfile.mkstemp(prefix=".link-", dir=target.parent)
        staging = Path(name)
        try:
            with os.fdopen(fd, "wb") as stream:
                stream.write(candidate.read_bytes())
                stream.flush()
                os.fsync(stream.fileno())
            staging.chmod(0o755)
            os.link(staging, target)
        finally:
            staging.unlink(missing_ok=True)
    return {
        "status": "installed",
        "binary": str(target),
        "platform": system,
        "arch": arch,
        "source": "link/native/cmd/aieyra-link",
        "source_policy": "current_together_project",
        **verified,
    }


# @chain-region doctor | calls: binary.is_file, data_root, link_path, native_target, platform.python_version, str, verify_link
def doctor():
    import sqlite3

    result = {
        "status": "ready",
        "python": platform.python_version(),
        "sqlite": sqlite3.sqlite_version,
        "platform": native_target()[0],
        "architecture": native_target()[1],
        "data_root": str(data_root()),
        "desktop_required": False,
        "link": {"status": "not_installed", "required_for_lan": True},
    }
    binary = link_path()
    if binary.is_file():
        try:
            result["link"] = {"status": "ready", "binary": str(binary), **verify_link(binary)}
        except (OSError, ValueError, subprocess.SubprocessError):
            result["link"] = {"status": "unusable", "binary": str(binary)}
            result["status"] = "attention_required"
    return result


# @chain-region run_service | calls: Path, Path(storage).expanduser, Path(storage).expanduser().absolute, ValueError, external_path, os.umask, run, str
def run_service(port, storage=None):
    if not 1 <= port <= 65535:
        raise ValueError("invalid_port")
    if storage is not None:
        os.environ["AIEYRA_CONTROL_DATA"] = str(
            external_path(Path(storage).expanduser().absolute())
        )
    if os.name != "nt":
        os.umask(0o077)

    from link_owner import run

    return run(port)


# @chain-region main | calls: ValueError, argparse.ArgumentParser, doctor, install.add_argument, install_link, isinstance, json.dumps, link.add_argument …
def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    sub.add_parser("doctor", help="Check Python, private storage and the optional Link runtime")
    run = sub.add_parser("run", help="Run the loopback office in the foreground; Ctrl-C to stop")
    run.add_argument("--port", type=int, default=DEFAULT_PORT)
    run.add_argument("--data-root", type=Path)
    install = sub.add_parser("install-link", help="Build this Together project's Link with Go 1.26.8+")
    install.add_argument("--output", type=Path)
    link = sub.add_parser("link", help="Run the installed native Link CLI in the foreground")
    link.add_argument("arguments", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    try:
        if sys.version_info < (3, 11):
            raise ValueError("python_3_11_or_newer_required")
        if args.action == "run":
            return run_service(args.port, args.data_root)
        if args.action == "link":
            binary = link_path()
            verify_link(binary)
            arguments = args.arguments
            if arguments[:1] == ["--"]:
                arguments = arguments[1:]
            command_line = [str(binary), *(arguments or ["help"])]
            if os.name == "nt":
                return subprocess.call(command_line)
            os.execv(str(binary), command_line)
        result = install_link(args.output) if args.action == "install-link" else doctor()
        print(json.dumps(result, ensure_ascii=False))
        return 0 if result["status"] != "attention_required" else 1
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        code = str(error) if isinstance(error, ValueError) else "local_runtime_or_build_unavailable"
        print(json.dumps({"status": "error", "code": code}), file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
