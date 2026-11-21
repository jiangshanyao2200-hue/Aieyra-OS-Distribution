# @file-map:start
# 文件: link/office/service/native_presence.py
# 位置: 二环·工位服务 | 本机控制、接入、凭据、工位与租约的HTTP服务。
# 约束: 服务绑定本机并核对所有者身份；凭据与工作正文不因短暂失联清空；关闭使用租约排空
# 下游: 无已解析的项目内静态导入
# 上游: link/office/service/main.py, link/office/service/self_heal.py, link/office/service/station_keepalive.py
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: python -X utf8 -B -m unittest discover -s link/office/tests/service
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   _codex_root | function
#   _claude_root | function
#   locate | function
#   _tail | function
#   _codex_turn | function
#   _claude_turn | function
#   observe | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Station presence from the native agent session itself (Link 4.6, 2026-10-15).

Station clients connect, call and disconnect per command, so the transport lease
alone shows every working agent as offline. This module looks at the native
session file the agent is writing right now -- a Codex rollout or a Claude Code
transcript -- and reads only file times and turn-boundary markers. It never
returns message text, tool arguments or credentials.
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
from pathlib import Path

ID = re.compile(r"^[A-Za-z0-9_-]{8,80}$")
STALE_SECONDS = 600  # a turn with no writes for this long is "no sign of life"
IDLE_SECONDS = 1800  # a finished turn within this window counts as standby
TAIL_BYTES = 262144
CACHE_SECONDS = 5
PATH_RETRY_SECONDS = 60

_lock = threading.Lock()
_paths: dict[str, tuple[Path | None, float]] = {}
_results: dict[str, tuple[dict, float]] = {}

CODEX_MARK = re.compile(rb'"type":"event_msg","payload":\{"type":"(task_started|task_complete|turn_aborted|error|stream_error)"')


# @chain-region _codex_root | calls: Path, Path.home, os.environ.get
def _codex_root() -> Path:
    return Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex") / "sessions"


# @chain-region _claude_root | calls: Path, Path.home, os.environ.get
def _claude_root() -> Path:
    return Path(os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude") / "projects"


# @chain-region locate | calls: _claude_root, _codex_root, _paths.get, candidate.is_file, claude.is_dir, claude.iterdir, codex.glob, codex.is_dir …
def locate(native_id: str) -> tuple[Path | None, str | None]:
    """Find the session file for one native id (cached; recent day folders first)."""
    now = time.time()
    cached = _paths.get(native_id)
    if cached and 0 <= now - cached[1] < PATH_RETRY_SECONDS:
        path = cached[0]
        return path, (None if path is None else "codex" if path.name.startswith("rollout-") else "claude")
    found: Path | None = None
    claude = _claude_root()
    if claude.is_dir():
        for project in claude.iterdir():
            candidate = project / (native_id + ".jsonl")
            if candidate.is_file():
                found = candidate
                break
    if found is None:
        codex = _codex_root()
        if codex.is_dir():
            days = sorted((d for y in codex.glob("[0-9][0-9][0-9][0-9]") for m in y.iterdir() if m.is_dir()
                           for d in m.iterdir() if d.is_dir()), reverse=True)
            for day in days[:45]:
                hits = list(day.glob("rollout-*-" + native_id + ".jsonl"))
                if hits:
                    found = hits[0]
                    break
    _paths[native_id] = (found, now)
    return found, (None if found is None else "codex" if found.name.startswith("rollout-") else "claude")


# @chain-region _tail | calls: max, path.open, source.read, source.seek
def _tail(path: Path, size: int) -> bytes:
    with path.open("rb") as source:
        length = source.seek(0, 2)
        source.seek(max(0, length - size))
        return source.read()


# @chain-region _codex_turn | calls: _tail, _tail(path, size).splitlines, any, entry.get, isinstance, json.loads, payload.get, reversed
def _codex_turn(path: Path) -> tuple[bool | None, bool]:
    """(in_turn, error) from the last turn-boundary marker in the rollout tail."""
    for size in (TAIL_BYTES, TAIL_BYTES * 16):
        for raw in reversed(_tail(path, size).splitlines()):
            if not any(mark in raw for mark in (b'task_started', b'task_complete', b'turn_aborted', b'stream_error', b'"error"')):
                continue
            try:
                entry = json.loads(raw)
            except ValueError:
                continue
            if not isinstance(entry, dict):
                continue
            payload = entry.get('payload') or {}
            if entry.get('type') != 'event_msg' or not isinstance(payload, dict):
                continue
            last = payload.get('type')
            if last in {'error', 'stream_error'}:
                return True, True
            if last in {'task_started', 'task_complete', 'turn_aborted'}:
                return last == 'task_started', False
    return None, False


# @chain-region _claude_turn | calls: ' '.join, _tail, _tail(path, TAIL_BYTES).splitlines, entry.get, isinstance, json.loads, message.get, part.get …
def _claude_turn(path: Path) -> tuple[bool | None, bool]:
    """A Claude turn ends with an assistant message whose stop_reason is not tool_use."""
    lines = _tail(path, TAIL_BYTES).splitlines()[1:]
    for raw in reversed(lines):
        if b'"type"' not in raw:
            continue
        try:
            entry = json.loads(raw)
        except ValueError:
            continue
        if not isinstance(entry, dict):
            continue
        kind = entry.get("type")
        message = entry.get("message") if isinstance(entry.get("message"), dict) else {}
        if kind == "assistant":
            if entry.get("isApiErrorMessage"):
                return False, True
            return message.get("stop_reason") in {"tool_use", None}, False
        if kind == "user":
            content = message.get("content")
            text = content if isinstance(content, str) else ""
            if isinstance(content, list):
                text = " ".join(part.get("text", "") for part in content if isinstance(part, dict) and part.get("type") == "text")
            return not text.startswith("[Request interrupted"), False
    return None, False


# @chain-region observe | calls: ID.fullmatch, _results.get, dict, isinstance, locate, max, path.stat, round …
def observe(native_id: object, now: float | None = None) -> dict | None:
    """Return {host, state, at, silence_seconds} or None when the session file is unknown."""
    if not isinstance(native_id, str) or not ID.fullmatch(native_id):
        return None
    now = now or time.time()
    with _lock:
        cached = _results.get(native_id)
        if cached and now - cached[1] < CACHE_SECONDS:
            return dict(cached[0]) if cached[0] else None
        path, host = locate(native_id)
        if path is None:
            _results[native_id] = ({}, now)
            return None
        try:
            modified = path.stat().st_mtime
            in_turn, error = (_codex_turn if host == "codex" else _claude_turn)(path)
        except OSError:
            return None
        silence = max(0.0, now - modified)
        if error and silence <= STALE_SECONDS:
            state = "error"
        elif in_turn and silence <= STALE_SECONDS:
            state = "running"
        elif in_turn:
            state = "unknown"
        elif silence <= IDLE_SECONDS:
            state = "idle"
        else:
            state = "unknown"
        result = {
            "host": host,
            "source": "native_file",
            "state": state,
            "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(modified)),
            "silence_seconds": round(silence),
        }
        _results[native_id] = (result, now)
        return dict(result)
