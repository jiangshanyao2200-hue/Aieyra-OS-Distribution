# @file-map:start
# 文件: link/office/service/monitor.py
# 位置: 二环·工位服务 | 本机控制、接入、凭据、工位与租约的HTTP服务。
# 约束: 服务绑定本机并核对所有者身份；凭据与工作正文不因短暂失联清空；关闭使用租约排空
# 下游: 无已解析的项目内静态导入
# 上游: link/office/service/main.py
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: python -X utf8 -B -m unittest discover -s link/office/tests/service
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   collect_monitors | function
#   collect_monitors.one | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""已配置服务器的只读系统采样；不执行来自聊天/网页的命令。"""

import concurrent.futures
import datetime as dt
import json
import math
import os
import subprocess

SAMPLE = """import json,os,platform
mem={line.split(':',1)[0]:int(line.split()[1])*1024 for line in open('/proc/meminfo') if len(line.split())>1 and line.split()[1].isdigit()}
disk=os.statvfs('/')
print(json.dumps({'hostname':platform.node(),'load_1m':os.getloadavg()[0],'cpu_count':os.cpu_count(),'memory_total_bytes':mem.get('MemTotal'),'memory_available_bytes':mem.get('MemAvailable'),'disk_total_bytes':disk.f_blocks*disk.f_frsize,'disk_available_bytes':disk.f_bavail*disk.f_frsize,'uptime_seconds':float(open('/proc/uptime').read().split()[0])}))
"""


# @chain-region collect_monitors | calls: SAMPLE.replace, ValueError, any, clean.values, concurrent.futures.ThreadPoolExecutor, config.get, data.get, dict …
def collect_monitors(config, runner=subprocess.run):
    # @chain-region collect_monitors.one | calls: SAMPLE.replace, ValueError, any, clean.values, data.get, dt.datetime.now, dt.datetime.now(dt.timezone.utc).isoformat, isinstance …
    def one(item):
        stamp = dt.datetime.now(dt.timezone.utc).isoformat()
        # 远端脚本是固定只读程序；别名来自本机部署配置，不来自HTTP消息。
        command = "python3 -c '" + SAMPLE.replace("'", "'\"'\"'") + "'"
        try:
            result = runner(
                [
                    config["executable"],
                    "-F",
                    config["ssh_config"],
                    "-o",
                    "BatchMode=yes",
                    "-o",
                    "ConnectTimeout=6",
                    "-o",
                    "ConnectionAttempts=1",
                    item["alias"],
                    command,
                ],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=12,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            )
            if result.returncode != 0 or len(result.stdout) > 8192:
                raise ValueError("sample_unavailable")
            data = json.loads(result.stdout)
            if not isinstance(data, dict):
                raise ValueError("invalid_sample")
            clean = {}
            for key in (
                "load_1m",
                "cpu_count",
                "memory_total_bytes",
                "memory_available_bytes",
                "disk_total_bytes",
                "disk_available_bytes",
                "uptime_seconds",
            ):
                value = data.get(key)
                if value is not None and (
                    not isinstance(value, (int, float))
                    or isinstance(value, bool)
                    or not math.isfinite(value)
                    or value < 0
                ):
                    raise ValueError("invalid_metric")
                clean[key] = value
            if any(value is None for value in clean.values()) or clean["cpu_count"] < 1:
                raise ValueError("incomplete_sample")
            for prefix in ("memory", "disk"):
                if clean[prefix + "_available_bytes"] > clean[prefix + "_total_bytes"]:
                    raise ValueError("inconsistent_sample")
            return item["location"], {
                "state": "sampled",
                "observed_at": stamp,
                "source": "ssh_readonly",
                **clean,
            }
        except (OSError, ValueError, OverflowError, subprocess.SubprocessError, KeyError):
            return item["location"], {
                "state": "unavailable",
                "observed_at": stamp,
                "source": "ssh_readonly",
                "error": "本次只读采样不可用",
            }

    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        return dict(executor.map(one, config.get("servers", [])))
