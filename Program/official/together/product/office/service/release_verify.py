# @file-map:start
# 文件: link/office/service/release_verify.py
# 位置: 二环·工位服务 | 本机控制、接入、凭据、工位与租约的HTTP服务。
# 约束: 服务绑定本机并核对所有者身份；凭据与工作正文不因短暂失联清空；关闭使用租约排空
# 下游: 无已解析的项目内静态导入
# 上游: link/office/service/cloud_link.py
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: python -X utf8 -B -m unittest discover -s link/office/tests/service
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   verify | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Verify pinned Ed25519 release metadata with the packaged Node runtime."""

import json
import os
import shutil
import subprocess
from pathlib import Path


# @chain-region verify | calls: Path, Path(__file__).resolve, ValueError, bundled.exists, json.dumps, json.loads, os.environ.get, shutil.which …
def verify(envelope, root=None):
    root = Path(root or Path(__file__).resolve().parents[1])
    bundled = root / "runtime/electron/electron.exe"
    if not bundled.exists():
        bundled = root / "Aieyra Control.app/Contents/MacOS/Electron"
    executable = os.environ.get("AIEYRA_CONTROL_NODE") or (
        str(bundled) if bundled.exists() else shutil.which("node")
    )
    if not executable:
        raise ValueError("signature_verifier_unavailable")
    env = {**os.environ, "ELECTRON_RUN_AS_NODE": "1"}
    result = subprocess.run(
        [executable, str(root / "scripts/verify-release.cjs")],
        input=json.dumps(envelope),
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=12,
        env=env,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    if result.returncode:
        raise ValueError("release_signature_invalid")
    return json.loads(result.stdout)
