# @file-map:start
# 文件: link/office/scripts/link_runtime.py
# 位置: 二环·工位CLI | 工位 Agent 接入、原编号投递回执、续接及本地工单工作区。
# 约束: 从当前响应读取身份与可用端点；日志脱敏且有界，不以命令返回替代实际工位状态
# 下游: 无已解析的项目内静态导入
# 上游: 入口/动态加载；参阅链路与目录地图
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: python -X utf8 -B -m unittest discover -s link/office/tests/service -p test_agent_client.py
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   verify_link | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Verify an explicitly selected Link runtime before adding it to a release."""

import hashlib
import re
import subprocess
from pathlib import Path

# Keep the release-time verifier aligned with the runtime shipped by the
# current OS package.  The Link implementation and release manifest are 0.3.1;
# leaving this at 0.3.0 makes a valid runtime fail the packaging gate.
LINK_VERSION = "0.3.1"


# @chain-region verify_link | calls: Path, ValueError, binary.is_absolute, binary.is_file, binary.read_bytes, getattr, hashlib.sha256, hashlib.sha256(raw).hexdigest …
def verify_link(binary, expected_sha256):
    binary = Path(binary)
    if not binary.is_absolute() or not binary.is_file():
        raise ValueError("link_runtime_absolute_file_required")
    if not re.fullmatch(r"[0-9a-f]{64}", expected_sha256 or ""):
        raise ValueError("link_runtime_expected_sha256_required")
    raw = binary.read_bytes()
    actual = hashlib.sha256(raw).hexdigest()
    if actual != expected_sha256:
        raise ValueError("link_runtime_hash_mismatch")
    result = subprocess.run(
        [str(binary), "version"],
        capture_output=True,
        text=True,
        timeout=15,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    if result.returncode or result.stdout.strip() != "Aieyra Link " + LINK_VERSION:
        raise ValueError("link_runtime_version_mismatch")
    return {"version": LINK_VERSION, "sha256": actual, "size": len(raw)}
