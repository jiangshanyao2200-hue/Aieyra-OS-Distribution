#!/usr/bin/env python3
# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: scripts/AGENTS.md | ring 3
# Chains: module-local; query impact before editing
# Regions: main
# Impact: python -B scripts/code-atlas.py show scripts/plugins.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""Forward compatibility commands to this OS checkout's Control and Link tools."""

import argparse
import os
from pathlib import Path
import subprocess
import sys

from link_product import discover_app, regular

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__, epilog="Arguments after the command pass unchanged to the plugin. Use COMMAND --help.")
    parser.add_argument("command", choices=("doctor", "build-link", "control", "link", "station", "transfer"))
    parser.add_argument("arguments", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if sys.version_info < (3, 11):
        parser.error("Python 3.11 or newer is required")
    entries = {
        "doctor": ("control.py", ["doctor"]),
        "build-link": ("control.py", ["install-link"]),
        "control": ("control.py", []),
        "link": ("control.py", ["link"]),
        "station": ("agent-station.py", []),
        "transfer": ("station-transfer.py", []),
    }
    filename, prefix = entries[args.command]
    try:
        script = regular(discover_app(ROOT) / "scripts" / filename)
    except (OSError, ValueError) as error:
        parser.error(str(error))
    arguments = args.arguments[1:] if args.arguments[:1] == ["--"] else args.arguments
    command = [sys.executable, "-X", "utf8", str(script), *prefix, *arguments]
    if os.name == "nt":
        # Windows execv does not quote paths containing spaces.
        return subprocess.call(command)
    os.execv(sys.executable, command)


if __name__ == "__main__":
    raise SystemExit(main())
