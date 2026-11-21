#!/usr/bin/env python3
# @file-map:start
# 文件: link/office/scripts/enroll-agent.py
# 位置: 二环·工位CLI | 工位 Agent 接入、原编号投递回执、续接及本地工单工作区。
# 约束: 从当前响应读取身份与可用端点；日志脱敏且有界，不以命令返回替代实际工位状态
# 下游: 无已解析的项目内静态导入
# 上游: link/office/scripts/agent-station.py
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: python -X utf8 -B -m unittest discover -s link/office/tests/service -p test_agent_client.py
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   NoRedirect | class
#   NoRedirect.redirect_request | function
#   save_new | function
#   enroll | function
#   main | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Enroll an Agent on this computer. Writes its credential to a new private file."""

import argparse
import json
import os
import secrets
import sys
from pathlib import Path
from urllib.request import HTTPRedirectHandler, Request, build_opener, ProxyHandler

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "service"))
from paths import external_path


# @chain-region NoRedirect
class NoRedirect(HTTPRedirectHandler):
    # @chain-region NoRedirect.redirect_request
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


# @chain-region save_new | calls: Path, Path(path).absolute, external_path, json.dump, os.fdopen, os.fsync, os.link, os.open …
def save_new(path, value):
    """Publish complete private JSON without ever replacing an existing file."""
    path = external_path(Path(path).absolute())
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + "." + secrets.token_hex(16) + ".tmp")
    fd = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.link(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


# @chain-region enroll | calls: NoRedirect, Path, Path(output).absolute, ProxyHandler, Request, ValueError, build_opener, config.get …
def enroll(name, project, output, *, port=17930, request_id=None, resume=False):
    """Persist a private intent before enrollment; retry only its original payload."""
    output = external_path(Path(output).absolute())
    origin = "http://127.0.0.1:" + str(port)
    opener = build_opener(ProxyHandler({}), NoRedirect())
    if resume:
        config = json.loads(output.read_text(encoding="utf-8-sig"))
        if (
            config.get("url") != origin
            or config.get("enrollment") != {"name": name, "project": project}
            or (request_id and request_id != config["request_id"])
        ):
            raise ValueError("Resume must match the saved enrollment exactly")
    elif output.exists():
        raise ValueError(
            "Refusing to overwrite an existing credential; use --resume for the exact original request"
        )
    else:
        config = {
            "protocol": "aieyra-agent/1",
            "url": origin,
            "token": secrets.token_urlsafe(32),
            "request_id": request_id or "enroll-" + secrets.token_hex(16),
            "enrollment": {"name": name, "project": project},
        }
        save_new(output, config)
    with opener.open(origin + "/api/session", timeout=10) as response:
        csrf = json.load(response)["csrf"]
    body = {
        "request_id": config["request_id"],
        "name": name,
        "project": project,
        "token": config["token"],
    }
    request = Request(
        origin + "/api/agent-access/enroll",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Origin": origin, "X-Control-CSRF": csrf},
    )
    with opener.open(request, timeout=30) as response:
        result = json.load(response)
    return {
        "credential": result["credential"],
        "config": str(output),
        "state": result["state"],
        "project_memory": result.get("project_memory"),
    }


# @chain-region main | calls: argparse.ArgumentParser, enroll, json.dumps, p.add_argument, p.parse_args, print
def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--name", required=True)
    p.add_argument("--project", required=True)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--port", type=int, default=17930)
    p.add_argument("--request-id", default=None)
    p.add_argument(
        "--resume",
        action="store_true",
        help="Retry exactly the saved enrollment after a lost response",
    )
    a = p.parse_args()
    print(
        json.dumps(
            enroll(
                a.name,
                a.project,
                a.output,
                port=a.port,
                request_id=a.request_id,
                resume=a.resume,
            ),
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
