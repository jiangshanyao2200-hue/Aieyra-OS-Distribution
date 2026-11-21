# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: Control/app/service/AGENTS.md | ring 2
# Chains: module-local; query impact before editing
# Regions: run; encode; headers
# Impact: python -B scripts/code-atlas.py show Control/app/service/matrix_proof.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""Use the bundled Node crypto implementation; never expose keys to Agent tools."""

import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import time


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


def encode(body):
    return json.dumps(body, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()


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
