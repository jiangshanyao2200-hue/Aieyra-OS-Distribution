# @file-map:start
# 文件: link/office/service/discovery.py
# 位置: 二环·工位服务 | 本机控制、接入、凭据、工位与租约的HTTP服务。
# 约束: 服务绑定本机并核对所有者身份；凭据与工作正文不因短暂失联清空；关闭使用租约排空
# 下游: 无已解析的项目内静态导入
# 上游: link/office/service/main.py
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: python -X utf8 -B -m unittest discover -s link/office/tests/service
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   observed_at | function
#   discover | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Bounded local Agent discovery; metadata only, never secrets or private sessions."""

from __future__ import annotations

import datetime as dt
from pathlib import Path
import subprocess


# @chain-region observed_at | calls: dt.datetime.now, dt.datetime.now(dt.timezone.utc).isoformat
def observed_at():
    return dt.datetime.now(dt.timezone.utc).isoformat()


# @chain-region discover | calls: (result.stdout or '').strip, (result.stdout or '').strip().splitlines, OSError, Path, ValueError, config.get, endpoint.get, getattr …
def discover(config, runner=subprocess.run):
    stamp = observed_at()
    rows = []
    executable = config.get("codex_executable")
    if isinstance(executable, str) and executable and len(executable) <= 1024:
        path = Path(executable)
        row = {
            "id": "local-codex-cli",
            "name": "Codex CLI",
            "kind": "codex-cli",
            "source": "configured executable",
            "actions": ["inspect"],
            "observed_at": stamp,
        }
        try:
            if not path.is_file():
                raise OSError("executable_missing")
            result = runner(
                [str(path), "--version"],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=5,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            versions = (result.stdout or "").strip().splitlines()
            label = versions[0][:120] if result.returncode == 0 and versions else ""
            if not label:
                raise ValueError("version_unavailable")
            row.update(availability="available", version_label=label)
        except (OSError, ValueError, subprocess.SubprocessError):
            row.update(
                availability="unavailable",
                version_label="",
                reason="配置的 Codex 可执行文件不可核实",
            )
        rows.append(row)
    else:
        rows.append(
            {
                "id": "local-codex-cli",
                "name": "Codex CLI",
                "kind": "codex-cli",
                "source": "configured executable",
                "actions": ["inspect"],
                "availability": "unavailable",
                "version_label": "",
                "observed_at": stamp,
                "reason": "未配置可核实的可执行文件",
            }
        )

    endpoint = config.get("aieyra_os_adapter")
    os_row = {
        "id": "local-aieyra-os",
        "name": "Aieyra OS",
        "kind": "aieyra-os",
        "source": "public adapter declaration",
        "actions": ["inspect", "open", "pause", "resume", "interrupt", "close"],
        "version_label": "",
        "observed_at": stamp,
    }
    if (
        isinstance(endpoint, dict)
        and endpoint.get("health")
        and isinstance(endpoint.get("version"), str)
    ):
        # A declared URL is still unavailable until the owner adapter performs its
        # own authenticated health check. This endpoint never performs network IO.
        os_row.update(
            availability="unavailable",
            version_label=endpoint["version"][:80],
            reason="已声明端点，等待受控适配器健康回执",
        )
    else:
        os_row.update(availability="unavailable", reason="未提供公开、受控的 Aieyra OS 适配器端点")
    rows.append(os_row)
    for name, label in (("claude", "Claude Code"), ("cursor", "Cursor")):
        row = {
            "id": "local-" + name,
            "name": label,
            "kind": name,
            "source": "configured executable",
            "actions": ["inspect"],
            "observed_at": stamp,
            "availability": "unavailable",
            "version_label": "",
            "reason": "未配置可核实的可执行文件",
            "adapter": {
                "tools": "mcp_stdio",
                "lifecycle": "project_hooks",
                "installer": "scripts/agent-station.py",
                "execution_control": False,
                "automatic_wakeup": False,
                "configuration_verified": False,
            },
        }
        executable = config.get(name + "_executable")
        if isinstance(executable, str) and 0 < len(executable) <= 1024:
            path = Path(executable)
            try:
                if not path.is_absolute() or not path.is_file():
                    raise OSError("executable_missing")
                result = runner(
                    [str(path), "--version"],
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=5,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                )
                version = (result.stdout or "").strip().splitlines()
                if result.returncode != 0 or not version:
                    raise ValueError("version_unavailable")
                row.update(availability="available", version_label=version[0][:120], reason="")
            except (OSError, ValueError, subprocess.SubprocessError):
                row["reason"] = "配置的客户端可执行文件不可核实"
        rows.append(row)
    return {
        "schema_version": 1,
        "observed_at": stamp,
        "agents": rows,
        "private_data_read": False,
        "model_started": False,
    }
