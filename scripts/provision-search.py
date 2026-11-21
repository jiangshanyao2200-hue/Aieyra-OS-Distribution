# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: scripts/AGENTS.md | ring 3
# Chains: module-local; query impact before editing
# Regions: digest; verify; install
# Impact: python -B scripts/code-atlas.py show scripts/provision-search.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""Install the pinned, private Windows search runtime; never change global Python.

python -B scripts/provision-search.py --cache-dir <download-cache>
All distributions must match search-runtime.lock.json. Existing runtimes are
verified or rejected, never silently overwritten. No pip runs in the product.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import uuid
import zipfile

ROOT = Path(__file__).resolve().parents[1]
LOCK = json.loads(Path(__file__).with_name("search-runtime.lock.json").read_text(encoding="utf-8"))


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify(target):
    target = target.resolve()
    receipt = json.loads((target / "runtime-manifest.json").read_text(encoding="utf-8"))
    if receipt["lock"] != LOCK:
        raise RuntimeError("Search runtime differs from the pinned lock; retain it and review migration")
    actual = {p.relative_to(target).as_posix() for p in target.rglob("*") if p.is_file()}
    if actual != set(receipt["files"]) | {"runtime-manifest.json"}:
        raise RuntimeError("Search runtime contains missing or untracked files")
    for name, expected in receipt["files"].items():
        file = target / name
        if not file.resolve().is_relative_to(target) or file.is_symlink() or digest(file) != expected:
            raise RuntimeError("Search runtime changed: " + name)
    return receipt


def install(cache, target):
    if os.name != "nt" or sys.maxsize < 2**32:
        raise RuntimeError("This lock installs Windows x64 only")
    if target.exists():
        receipt = verify(target)
        print(json.dumps({"status": "verified", "files": len(receipt["files"])}))
        return
    cache.mkdir(parents=True, exist_ok=True)
    archives = []
    for entry in LOCK["files"]:
        path = cache / entry["name"]
        if not path.exists():
            subprocess.run(["curl.exe", "-fsSL", "--connect-timeout", "10", "--max-time", "180",
                            "-o", str(path), entry["url"]], check=True, timeout=185)
        if digest(path) != entry["sha256"]:
            raise RuntimeError("Download hash mismatch; kept for inspection: " + str(path))
        archives.append(path)
    stage = target.with_name(target.name + ".install-" + uuid.uuid4().hex)
    stage.mkdir(parents=True)
    for archive in archives:
        with zipfile.ZipFile(archive) as package:
            for info in package.infolist():
                path = stage / info.filename
                if not path.resolve().is_relative_to(stage.resolve()) or info.file_size > 128 << 20:
                    raise RuntimeError("Unsafe package member: " + info.filename)
            package.extractall(stage)
    # Isolated embedding uses only the standard-library ZIP and this directory.
    # There is no site initialization, external Python path, or user package hook.
    (stage / "python313._pth").write_text("python313.zip\n.\n", encoding="utf-8")
    probe = subprocess.run([str(stage / "python.exe"), "-I", "-B", "-c",
                            "from ddgs.ddgs import DDGS; import lxml.etree, primp; print('DDGS_READY')"],
                           capture_output=True, text=True, timeout=30,
                           creationflags=subprocess.CREATE_NO_WINDOW)
    if probe.returncode or probe.stdout.strip() != "DDGS_READY":
        raise RuntimeError("Search runtime import failed: " + probe.stderr[:1000])
    receipt = {"schema": 1, "lock": LOCK,
               "files": {p.relative_to(stage).as_posix(): digest(p) for p in sorted(stage.rglob("*")) if p.is_file()}}
    (stage / "runtime-manifest.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    stage.rename(target)
    print(json.dumps({"status": "installed", "files": len(receipt["files"]), "target": str(target)}, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-dir", type=Path)
    parser.add_argument("--verify-only", action="store_true")
    parser.add_argument("--target", type=Path, default=ROOT / "runtime/search")
    args = parser.parse_args()
    if args.verify_only:
        receipt = verify(args.target)
        print(json.dumps({"status": "verified", "files": len(receipt["files"]), "target": str(args.target)}))
    else:
        if args.cache_dir is None:
            parser.error("--cache-dir is required for installation")
        install(args.cache_dir.resolve(), args.target.resolve())
