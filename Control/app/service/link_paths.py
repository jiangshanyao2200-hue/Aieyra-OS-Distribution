# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: Control/app/service/AGENTS.md | ring 2
# Chains: module-local; query impact before editing
# Regions: native_target; os_source_root; link_path
# Impact: python -B scripts/code-atlas.py show Control/app/service/link_paths.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""Only consume the Link module in this OS checkout."""
import os
from pathlib import Path
import platform
import sys

def native_target():
    system = "android" if hasattr(sys, "getandroidapilevel") or os.environ.get("TERMUX_VERSION") else {"win32":"windows", "darwin":"darwin"}.get(sys.platform, sys.platform)
    arch = {"x86_64":"amd64", "amd64":"amd64", "aarch64":"arm64", "arm64":"arm64"}.get(platform.machine().lower())
    if system not in {"windows","linux","android","darwin"} or not arch: raise ValueError("native_link_requires_a_supported_64_bit_platform")
    return system, arch

def os_source_root(control_root):
    root = Path(control_root).resolve().parents[1]
    if (root/"Core/go.mod").is_file() and (root/"Link/app/link-core/go.mod").is_file(): return root
    return None

def link_path(control_root):
    root = os_source_root(control_root)
    if root is None: raise ValueError("link_requires_aieyra_os")
    name = "aieyra-link.exe" if sys.platform=="win32" else "aieyra-link"
    return root/"Link/app/runtime/link"/name
