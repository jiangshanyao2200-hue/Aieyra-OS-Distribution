# @file-map:start
# 文件: link/office/service/product_commands.py
# 位置: 二环·工位服务 | 本机控制、接入、凭据、工位与租约的HTTP服务。
# 约束: 服务绑定本机并核对所有者身份；凭据与工作正文不因短暂失联清空；关闭使用租约排空
# 下游: link/office/service/os_sessions.py
# 上游: link/office/service/main.py
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: python -X utf8 -B -m unittest discover -s link/office/tests/service
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   ProductCommandError | class
#   ProductCommands | class
#   ProductCommands.__init__ | function
#   ProductCommands.sources | function
#   ProductCommands.call | function
#   ProductCommands.command | function
#   ProductCommands.dispatch | function
#   ProductCommands.status | function
#   ProductCommands.matrix_status | function
#   ProductCommands.human_sync | function
#   ProductCommands.product_job_sync | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Fixed product actions via the existing bridge, using its durable ledger."""

import json
from pathlib import Path
import re
import subprocess
import sys
from os_sessions import bridge_config


# @chain-region ProductCommandError
class ProductCommandError(Exception):
    pass


# @chain-region ProductCommands | calls: Path, Path(reference).is_absolute, ProductCommandError, ValueError, bridge_config, callable, field.replace, getattr …
class ProductCommands:
    # @chain-region ProductCommands.__init__ | calls: callable
    def __init__(self, sources):
        self.source_provider = sources if callable(sources) else lambda: sources

    # @chain-region ProductCommands.sources | calls: self.source_provider
    @property
    def sources(self):
        return {source["id"]: source for source in self.source_provider()}

    # @chain-region ProductCommands.call | calls: Path, Path(reference).is_absolute, ProductCommandError, ValueError, bridge_config, field.replace, getattr, isinstance …
    def call(self, source_id, request):
        if not isinstance(source_id, str) or source_id not in self.sources:
            raise ProductCommandError("product_source_not_registered")
        source = self.sources[source_id]
        # Paths come exclusively from validated local configuration.
        script = Path(source["adapter_dir"]) / "bridge.py"
        try:
            bridge_config(source)
            arguments = [
                sys.executable,
                "-X",
                "utf8",
                str(script),
                "--config",
                source["config_ref"],
            ]
            if request.get("operation") in ("human_sync", "product_job_sync"):
                field = (
                    "human_host_ref" if request["operation"] == "human_sync" else "product_host_ref"
                )
                reference = source.get(field)
                if not isinstance(reference, str) or not Path(reference).is_absolute():
                    raise ProductCommandError(field.replace("_ref", "_not_configured"))
                arguments += ["--" + field.replace("_", "-"), reference]
            process = subprocess.run(
                arguments,
                input=json.dumps(request, ensure_ascii=False).encode("utf-8"),
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                timeout=75,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            if len(process.stdout) > 32 * 1048576:
                raise ProductCommandError("product_output_limit_query_status")
            result = json.loads(process.stdout)
            if not isinstance(result, dict):
                raise ValueError("invalid_response")
            if process.returncode == 0 and result.get("ok") is True:
                return result["data"]
            code = result.get("error")
            raise ProductCommandError(
                code
                if isinstance(code, str) and re.fullmatch("[a-z0-9_]{1,100}", code)
                else "product_failed_query_status"
            )
        except subprocess.TimeoutExpired:
            # The subprocess is ours; a submitted runtime command is not replayed.
            raise ProductCommandError("product_outcome_unknown_query_status") from None
        except (OSError, ValueError, KeyError):
            raise ProductCommandError("product_unavailable_query_status") from None

    # @chain-region ProductCommands.command | calls: ProductCommandError, self.call, set
    def command(self, value):
        if set(value) != {"source_id", "command"}:
            raise ProductCommandError("invalid_product_command")
        return self.call(value["source_id"], {"operation": "command", "command": value["command"]})

    # @chain-region ProductCommands.dispatch | calls: ProductCommandError, self.call, set
    def dispatch(self, value):
        if set(value) != {"source_id", "task"}:
            raise ProductCommandError("invalid_product_dispatch")
        return self.call(value["source_id"], {"operation": "dispatch", "task": value["task"]})

    # @chain-region ProductCommands.status | calls: self.call
    def status(self, source_id, request_id):
        return self.call(source_id, {"operation": "command_status", "request_id": request_id})

    # @chain-region ProductCommands.matrix_status | calls: self.call
    def matrix_status(self, source_id):
        return self.call(source_id, {"operation": "matrix_status"})

    # @chain-region ProductCommands.human_sync | calls: self.call
    def human_sync(self, source_id):
        return self.call(source_id, {"operation": "human_sync"})

    # @chain-region ProductCommands.product_job_sync | calls: self.call
    def product_job_sync(self, source_id):
        return self.call(source_id, {"operation": "product_job_sync"})
