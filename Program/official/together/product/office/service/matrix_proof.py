# @file-map:start
# 文件: link/office/service/matrix_proof.py
# 位置: 二环·工位服务 | 本机控制、接入、凭据、工位与租约的HTTP服务。
# 约束: 服务绑定本机并核对所有者身份；凭据与工作正文不因短暂失联清空；关闭使用租约排空
# 下游: 无已解析的项目内静态导入
# 上游: link/office/service/cloud_link.py
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: python -X utf8 -B -m unittest discover -s link/office/tests/service
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   run | function
#   encode | function
#   headers | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Use the bundled Node crypto implementation; never expose keys to Agent tools."""

import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import time


# @chain-region run | calls: Path, Path(__file__).resolve, ValueError, bundled.exists, json.dumps, json.loads, os.environ.get, shutil.which …
def run(value):
    root = Path(__file__).resolve().parents[1]
    bundled = root / "runtime/electron/electron.exe"
    if not bundled.exists():
        bundled = root / "Aieyra Control.app/Contents/MacOS/Electron"
    executable = os.environ.get("AIEYRA_CONTROL_NODE") or (
        str(bundled) if bundled.exists() else shutil.which("node")
    )
    if not executable:
        raise ValueError("matrix_crypto_unavailable")
    result = subprocess.run(
        [executable, str(root / "scripts/matrix-proof.cjs")],
        input=json.dumps(value),
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=12,
        env={**os.environ, "ELECTRON_RUN_AS_NODE": "1"},
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    if result.returncode:
        raise ValueError("matrix_proof_failed")
    return json.loads(result.stdout)


# @chain-region encode | calls: json.dumps, json.dumps(body, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode
def encode(body):
    return json.dumps(body, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()


# @chain-region headers | calls: '\n'.join, encode, hashlib.sha256, hashlib.sha256(encode(body)).hexdigest, hashlib.sha256(session['access_token'].encode()).hexdigest, int, run, secrets.token_urlsafe …
def headers(path, body, session):
    timestamp, nonce = str(int(time.time() * 1000)), secrets.token_urlsafe(24)
    message = "\n".join(
        [
            "AIEYRA-MATRIX-1",
            "POST",
            path,
            hashlib.sha256(session["access_token"].encode()).hexdigest(),
            timestamp,
            nonce,
            hashlib.sha256(encode(body)).hexdigest(),
        ]
    )
    signed = run(
        {"action": "sign", "privateKey": session["matrix_private_key"], "message": message}
    )
    return {
        "X-Aieyra-Matrix": "1",
        "X-Matrix-Time": timestamp,
        "X-Matrix-Nonce": nonce,
        "X-Matrix-Signature": signed["signature"],
    }
