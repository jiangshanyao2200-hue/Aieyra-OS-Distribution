# @file-map:start
# 文件: link/office/service/link_paths.py
# 位置: 二环·工位服务 | 本机控制、接入、凭据、工位与租约的HTTP服务。
# 约束: 服务绑定本机并核对所有者身份；凭据与工作正文不因短暂失联清空；关闭使用租约排空
# 下游: 无已解析的项目内静态导入
# 上游: link/office/service/device_link.py, link/office/service/link_auto.py, link/office/service/os_sessions.py
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: python -X utf8 -B -m unittest discover -s link/office/tests/service
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   native_target | function
#   product_link_root | function
#   os_source_root | function
#   link_path | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Only consume the native Link runtime shipped in this Together installation."""
import os
from pathlib import Path
import platform
import sys

# @chain-region native_target | calls: ValueError, hasattr, os.environ.get, platform.machine, platform.machine().lower, {'win32': 'windows', 'darwin': 'darwin'}.get, {'x86_64': 'amd64', 'amd64': 'amd64', 'aarch64': 'arm64', 'arm64': 'arm64'}.get
def native_target():
    system = "android" if hasattr(sys, "getandroidapilevel") or os.environ.get("TERMUX_VERSION") else {"win32":"windows", "darwin":"darwin"}.get(sys.platform, sys.platform)
    arch = {"x86_64":"amd64", "amd64":"amd64", "aarch64":"arm64", "arm64":"arm64"}.get(platform.machine().lower())
    if system not in {"windows","linux","android","darwin"} or not arch: raise ValueError("native_link_requires_a_supported_64_bit_platform")
    return system, arch

# @chain-region product_link_root | calls: Path, Path(control_root).resolve
def product_link_root(control_root):
    return Path(control_root).resolve().parent


# @chain-region os_source_root
def os_source_root(control_root):
    # OS integrations require explicit registered executables; never discover a sibling OS.
    return None


# @chain-region link_path | calls: product_link_root
def link_path(control_root):
    name = "aieyra-link.exe" if sys.platform == "win32" else "aieyra-link"
    return product_link_root(control_root) / "runtime/native" / name
