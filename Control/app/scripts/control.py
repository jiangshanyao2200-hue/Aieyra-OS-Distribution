#!/usr/bin/env python3
# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: Control/app/scripts/AGENTS.md | ring 2
# Chains: module-local; query impact before editing
# Regions: link_path; command; verify_link; install_link; doctor; run_service; main
# Impact: python -B scripts/code-atlas.py show Control/app/scripts/control.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

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


from link_paths import native_target, os_source_root, link_path as discover_link


def link_path():
    return discover_link(ROOT)


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


def verify_link(target):
    version = command([target, "version"], timeout=15)
    if version != "Aieyra Link " + LINK_VERSION:
        raise ValueError("link_version_mismatch")
    return {"version": LINK_VERSION, "sha256": hashlib.sha256(target.read_bytes()).hexdigest()}


def install_link(output=None):
    """Build this OS checkout's single Link implementation; preserve existing runtimes."""
    system, arch = native_target()
    target = Path(output).expanduser().absolute() if output else link_path()
    if target.exists() or target.is_symlink():
        raise ValueError("link_output_exists_preserve_it_or_choose_a_new_output")
    source = os_source_root(ROOT)
    if source is None:
        raise ValueError("build_link_from_the_complete_aieyra_os_checkout")
    go = shutil.which("go")
    if not go:
        raise ValueError("install_go_1_26_8_or_newer_first")
    env = dict(os.environ, CGO_ENABLED="0", GOOS=system, GOARCH=arch, GOFLAGS="", GOWORK="off")
    if system == "android":
        # Official Go auto-downloads are not a replacement for Termux's patched toolchain.
        env["GOTOOLCHAIN"] = "local"
    with tempfile.TemporaryDirectory(prefix="aieyra-link-build-") as directory:
        candidate = Path(directory) / target.name
        command(
            [go, "build", "-mod=readonly", "-trimpath", "-o", candidate, "./cmd/aieyra-link"],
            cwd=source / "Link/app/link-core",
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
        "source": "Link/app/link-core/cmd/aieyra-link",
        "source_policy": "current_aieyra_os_checkout",
        **verified,
    }


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


def run_service(port, storage=None, *, owner_stdin=False):
    if not 1 <= port <= 65535:
        raise ValueError("invalid_port")
    if storage is not None:
        os.environ["AIEYRA_CONTROL_DATA"] = str(
            external_path(Path(storage).expanduser().absolute())
        )
    if os.name != "nt":
        os.umask(0o077)

    from link_owner import run

    return run(port, owner_stdin=owner_stdin)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    sub.add_parser("doctor", help="Check Python, private storage and the optional Link runtime")
    run = sub.add_parser("run", help="Run the loopback office in the foreground; Ctrl-C to stop")
    run.add_argument("--port", type=int, default=DEFAULT_PORT)
    run.add_argument("--data-root", type=Path)
    run.add_argument("--owner-stdin", action="store_true", help="Stop when the owning desktop closes stdin")
    install = sub.add_parser("install-link", help="Build this OS checkout's Link with Go 1.26.8+")
    install.add_argument("--output", type=Path)
    link = sub.add_parser("link", help="Run the installed native Link CLI in the foreground")
    link.add_argument("arguments", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    try:
        if sys.version_info < (3, 11):
            raise ValueError("python_3_11_or_newer_required")
        if args.action == "run":
            return run_service(args.port, args.data_root, owner_stdin=args.owner_stdin)
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
