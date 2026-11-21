#!/usr/bin/env python3
# @file-map:start
# 文件: link/agent/together_link.py
# 位置: 二环·Agent完整链路 | 协作CLI、接续、实际启动器、工作包、源码传输和本机运行。
# 约束: 使用本人已有身份和connection，不因压缩重建身份；写操作保留request_id；未知结果查回执，凭据不进入日志与文档
# 下游: 无已解析的项目内静态导入
# 上游: 入口/动态加载；参阅链路与目录地图
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: python -X utf8 -B -m unittest discover -s AIDEBUG -p test_aidebug_launch.py, AIDEBUG/startup-review.py
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   NoRedirect | class
#   NoRedirect.redirect_request | function
#   Link | class
#   Link.__init__ | function
#   Link.call | function
#   Link.context | function
#   mcp | function
#   main | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Aieyra Together Link: independent Agent CLI and newline-delimited stdio MCP."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
import uuid
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler

VERSION = "0.1.0"
DEFAULT_SERVER = "https://os.aieyra.cn/together"


# @chain-region NoRedirect
class NoRedirect(HTTPRedirectHandler):
    # @chain-region NoRedirect.redirect_request
    def redirect_request(self, *args, **kwargs):
        return None


# @chain-region Link | calls: NoRedirect, Path, Path(key_file).expanduser, Path(key_file).expanduser().read_text, Path(key_file).expanduser().read_text(encoding='utf-8-sig').strip, Request, ValueError, any …
class Link:
    # @chain-region Link.__init__ | calls: NoRedirect, Path, Path(key_file).expanduser, Path(key_file).expanduser().read_text, Path(key_file).expanduser().read_text(encoding='utf-8-sig').strip, ValueError, any, build_opener …
    def __init__(self, server, key_file):
        parsed = urlsplit(server)
        if parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("invalid_server")
        if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1")):
            raise ValueError("https_required")
        if parsed.path.rstrip("/") != "/together":
            raise ValueError("together_endpoint_required")
        key = Path(key_file).expanduser().read_text(encoding="utf-8-sig").strip()
        if not 32 <= len(key) <= 100 or any(c.isspace() for c in key):
            raise ValueError("invalid_key_file")
        self.key, self.server = key, server.rstrip("/")
        self.opener = build_opener(NoRedirect())

    # @chain-region Link.call | calls: Request, ValueError, error.read, json.dumps, json.dumps(body, ensure_ascii=False).encode, json.loads, len, response.read …
    def call(self, action, body=None):
        request = Request(self.server+"/api/link/"+action,
                          data=None if body is None else json.dumps(body,ensure_ascii=False).encode(),
                          headers={"Authorization":"Bearer "+self.key,"Content-Type":"application/json"})
        try:
            with self.opener.open(request,timeout=30) as response:
                raw = response.read(2*1024*1024+1)
                if len(raw)>2*1024*1024:
                    raise ValueError("response_too_large")
                return json.loads(raw)
        except HTTPError as error:
            try:
                value = json.loads(error.read(8192))
                code = value.get("error","request_rejected")
            except (ValueError,UnicodeError):
                code = "request_rejected"
            raise ValueError(code) from None
        except (URLError,TimeoutError):
            raise ValueError("connection_failed_write_result_unknown_query_before_retry") from None

    # @chain-region Link.context | calls: self.call, uuid.uuid4
    def context(self):
        self.call("heartbeat",{"request_id":uuid.uuid4().hex})
        return self.call("state")


TOOLS = [
    {"name":"together_context","description":"Read the current Together office and messages. Reading does not send read receipts. Reports communication state, not code execution.","inputSchema":{"type":"object","properties":{},"additionalProperties":False}},
    {"name":"together_heartbeat","description":"Refresh your own communication presence at a real work boundary.","inputSchema":{"type":"object","properties":{},"additionalProperties":False}},
    {"name":"together_message","description":"Send an explicitly user-authorized office message. Use a stable request_id; do not silently repeat an uncertain write with a new ID.","inputSchema":{"type":"object","properties":{"body":{"type":"string","maxLength":4000},"request_id":{"type":"string","minLength":8,"maxLength":100}},"required":["body","request_id"],"additionalProperties":False}},
    {"name":"together_ack","description":"After actually reading messages, explicitly acknowledge their IDs as your own Agent.","inputSchema":{"type":"object","properties":{"ids":{"type":"array","items":{"type":"string"},"maxItems":100},"request_id":{"type":"string","minLength":8,"maxLength":100}},"required":["ids","request_id"],"additionalProperties":False}},
]


# @chain-region mcp | calls: ValueError, isinstance, json.dumps, json.loads, len, link.call, link.context, params.get …
def mcp(link):
    for line in sys.stdin:
        request = None
        try:
            if len(line)>65536:
                raise ValueError("request_too_large")
            request=json.loads(line)
            if not isinstance(request,dict):
                raise ValueError("invalid_request")
            method=request.get("method")
            if "id" not in request:
                continue
            if method=="initialize":
                result={"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"aieyra-together-link","version":VERSION}}
            elif method=="ping":
                result={}
            elif method=="tools/list":
                result={"tools":TOOLS}
            elif method=="tools/call":
                params=request.get("params",{});name=params.get("name");args=params.get("arguments",{})
                if name=="together_context":
                    value=link.context()
                elif name=="together_heartbeat":
                    value=link.call("heartbeat",{"request_id":uuid.uuid4().hex})
                elif name in ("together_message","together_ack"):
                    value=link.call("message" if name=="together_message" else "ack",args)
                else:
                    raise ValueError("unknown_tool")
                result={"content":[{"type":"text","text":json.dumps(value,ensure_ascii=False)}]}
            else:
                raise ValueError("method_not_found")
            response={"jsonrpc":"2.0","id":request["id"],"result":result}
        except Exception as error:
            code=str(error) if isinstance(error,ValueError) else "request_failed"
            response={"jsonrpc":"2.0","id":request.get("id") if isinstance(request,dict) else None,"error":{"code":-32603,"message":code}}
        print(json.dumps(response,ensure_ascii=False),flush=True)


# @chain-region main | calls: Link, argparse.ArgumentParser, args.body_file.read_text, hasattr, isinstance, json.dumps, link.call, link.context …
def main():
    # JSON/MCP is UTF-8 regardless of the Windows console code page.
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        if hasattr(stream, 'reconfigure'):
            stream.reconfigure(encoding='utf-8')
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--server",default=DEFAULT_SERVER)
    parser.add_argument("--key-file",type=Path,required=True)
    parser.add_argument("command",choices=["context","heartbeat","message","ack","mcp"])
    parser.add_argument("--body-file",type=Path)
    parser.add_argument("--request-id")
    parser.add_argument("--ids",nargs="*")
    args=parser.parse_args()
    try:
        link=Link(args.server,args.key_file)
        if args.command=="mcp":
            mcp(link);return 0
        if args.command=="context":
            result=link.context()
        elif args.command=="heartbeat":
            result=link.call("heartbeat",{"request_id":uuid.uuid4().hex})
        else:
            if not args.request_id:
                parser.error("message/ack require --request-id for safe write reconciliation")
            body={"request_id":args.request_id}
            if args.command=="message":
                if not args.body_file:
                    parser.error("message requires --body-file")
                body["body"]=args.body_file.read_text(encoding="utf-8-sig")
            else:
                body["ids"]=args.ids or []
            result=link.call(args.command,body)
        print(json.dumps(result,ensure_ascii=False))
        return 0
    except Exception as error:
        code=str(error) if isinstance(error,ValueError) else type(error).__name__
        print(json.dumps({"error":code}),file=sys.stderr)
        return 1


if __name__=="__main__":
    raise SystemExit(main())
