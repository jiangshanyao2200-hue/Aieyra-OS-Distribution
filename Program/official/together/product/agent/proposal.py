#!/usr/bin/env python3
# @file-map:start
# 文件: link/agent/proposal.py
# 位置: 二环·Agent完整链路 | 协作CLI、接续、实际启动器、工作包、源码传输和本机运行。
# 约束: 使用本人已有身份和connection，不因压缩重建身份；写操作保留request_id；未知结果查回执，凭据不进入日志与文档
# 下游: link/agent/artifact.py, link/agent/collaboration.py, link/agent/live_work.py, link/agent/local_preview.py, link/agent/local_runner.py, link/agent/local_vm.py, link/agent/onboarding.py, link/agent/source_protocol.py, link/agent/workspace.py
# 上游: AIDEBUG/co-creation-experiment.py, AIDEBUG/live-experiment.py, AIDEBUG/practice-experiment.py, AIDEBUG/source-experiment.py, link/agent/artifact.py, link/agent/collaboration.py, link/agent/local_runner.py, link/agent/onboarding.py, link/agent/workspace.py, tests/test_artifact_transport.py, tests/test_live_work.py, tests/test_source_workspaces.py, tests/test_upload_recovery.py
# 链路: agent-continuity
# 验证: AIDEBUG/co-creation-experiment.py, AIDEBUG/live-experiment.py, AIDEBUG/onboarding-context.test.cjs, AIDEBUG/onboarding-timeout.test.cjs, AIDEBUG/practice-experiment.py, AIDEBUG/source-experiment.py, tests/test_artifact_transport.py, tests/test_live_work.py, tests/test_source_workspaces.py, tests/test_upload_recovery.py
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   ApiError | class
#   ApiError.__init__ | function
#   NoRedirect | class
#   NoRedirect.redirect_request | function
#   private_root | function
#   endpoint | function
#   response_json | function
#   retry_seconds | function
#   call_once | function
#   committed_receipt | function
#   call | function
#   read_json | function
#   save_secret | function
#   replace_secret | function
#   activate_durable | function
#   record | function
#   local_binding | function
#   local_binding.read | function
#   main | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Verified Together proposal Agent client. Standard library only."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import sys
import time
from http.client import HTTPException
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urlencode
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")
# The bundled isolated Windows Python does not add the script directory to sys.path.
sys.path.insert(0, str(Path(__file__).resolve().parent))
if __name__ == '__main__':
    sys.modules['proposal'] = sys.modules[__name__]


SERVER = "https://os.aieyra.cn/together"
ID = re.compile(r"[a-f0-9]{32}\Z")
# @chain-region ApiError | calls: super, super().__init__
class ApiError(ValueError):
    # @chain-region ApiError.__init__ | calls: super, super().__init__
    def __init__(self, code, status=0, retry_after=0, unknown=False):
        super().__init__(code)
        self.status=status; self.retry_after=retry_after; self.unknown=unknown

# @chain-region NoRedirect
class NoRedirect(HTTPRedirectHandler):
    # @chain-region NoRedirect.redirect_request
    def redirect_request(self, *args, **kwargs):
        return None


opener = build_opener(ProxyHandler({}), NoRedirect())


# @chain-region private_root | calls: Path, Path.home, os.environ.get
def private_root():
    base = os.environ.get("LOCALAPPDATA")
    return (Path(base) if base else Path.home() / ".local" / "share") / "Aieyra Together Link" / "data"


# @chain-region endpoint | calls: ValueError, parsed.path.rstrip, server.rstrip, urlsplit
def endpoint(server):
    parsed = urlsplit(server)
    if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path.rstrip("/") != "/together":
        raise ValueError("invalid_together_endpoint")
    if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1")):
        raise ValueError("https_required")
    return server.rstrip("/")


# @chain-region response_json | calls: ApiError, ValueError, isinstance, json.loads
def response_json(raw, writing=False):
    try:
        value = json.loads(raw)
        if not isinstance(value, dict):
            raise ValueError('object_required')
        return value
    except (ValueError, UnicodeError):
        raise ApiError('invalid_response_check_receipt_before_retry', 502, unknown=writing) from None


# @chain-region retry_seconds | calls: int, isinstance, max, min, str, str(value).isdigit
def retry_seconds(*values):
    return min(3600, max([0] + [int(value) for value in values
                              if isinstance(value, (int, str)) and str(value).isdigit()]))


# @chain-region call_once | calls: ApiError, Request, ValueError, endpoint, error.headers.get, error.read, isinstance, json.dumps …
def call_once(server, route, body=None, key="", *, timeout=25):
    from source_protocol import ARTIFACT_JSON_LIMIT, MAX_FILE
    parsed_route=urlsplit(route)
    if parsed_route.netloc or parsed_route.scheme or parsed_route.fragment or len(route)>4096 or not (re.fullmatch(r"/(?:engineering/(?:overview|tasks|task|brief|events|inbox(?:/ack)?|checkpoints|repository|manifest|archive|file|reviews|workflow|verifications|compositions|releases|release|artifact|handoffs(?:/(?:offer|accept|cancel))?|artifacts/upload|verify|compose|tasks/(?:create|update|resume|checkpoint|signal)|upload|snapshots/create|review)|agent/(?:activate|status|guide|inbox|confirm|check|local-report|ack|renew|receipt)|elections(?:/(?:nominate|withdraw|execute|authorization|candidate|management|manage|nominate-replacement))?|goals(?:/nominate)?|agendas(?:/[a-f0-9]{32}(?:/(?:publish|resume|complete))?)?)", parsed_route.path) or re.fullmatch(r"/engineering/live/(?:context|tasks/complete|plan(?:/save)?|conflicts|pheromones(?:/(?:save|close))?|rooms(?:/(?:create|message|close|ack))?|room|drafts(?:/(?:upload|save))?|draft|queue(?:/(?:submit|prepare|advance|cancel|claim))?|sync)",parsed_route.path)):
        raise ValueError("route_denied")
    headers = {"Accept": "application/json"}
    if key:
        headers["Authorization"] = "Bearer " + key
    raw = None if body is None else json.dumps(body, ensure_ascii=False, allow_nan=False).encode()
    if raw is not None:
        maximum = 196608 if parsed_route.path=='/engineering/verify' else ARTIFACT_JSON_LIMIT if parsed_route.path=='/engineering/artifacts/upload' else 32768
        if len(raw)>maximum: raise ValueError('request_too_large')
        headers["Content-Type"] = "application/json"
    try:
        with opener.open(Request(endpoint(server) + "/api" + route, data=raw, headers=headers), timeout=timeout) as response:
            # Archive pages may contain one complete font/editor asset. Text file
            # responses can expand sixfold when JSON escapes control characters.
            maximum = (6 * MAX_FILE + 65536 if parsed_route.path=='/engineering/file' else
                       (MAX_FILE * 4 // 3 + 65536) if parsed_route.path=='/engineering/archive' else
                       ARTIFACT_JSON_LIMIT if parsed_route.path=='/engineering/artifact' else 2_000_000)
            content = response.read(maximum+1)
            if len(content) > maximum:
                raise ApiError("response_too_large_check_receipt_before_retry", 502, unknown=body is not None)
            return response_json(content, body is not None)
    except HTTPError as error:
        try:
            value = json.loads(error.read(8192))
            code = value.get("error", "request_rejected") if isinstance(value, dict) else "request_rejected"
        except (ValueError, UnicodeError, HTTPException, ConnectionError, TimeoutError):
            value = {}
            code = "request_rejected"
        retry_after=retry_seconds(error.headers.get('Retry-After','0'), value.get('retry_after',0) if isinstance(value,dict) else 0)
        raise ApiError(code,error.code,retry_after,unknown=body is not None and error.code>=500) from None
    except (URLError, TimeoutError, HTTPException, ConnectionError):
        raise ApiError("connection_unknown_check_receipt_before_retry",unknown=body is not None) from None


# @chain-region committed_receipt | calls: (route + '\n' + canonical).encode, call_once, hashlib.sha256, hashlib.sha256((route + '\n' + canonical).encode()).hexdigest, isinstance, json.dumps, max, min …
def committed_receipt(server, route, body, key, delay):
    lookup = '/agent/receipt?' + urlencode({'request_id': body['request_id']})
    canonical = json.dumps(body, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False)
    expected = hashlib.sha256((route + "\n" + canonical).encode()).hexdigest()
    deadline = time.monotonic() + 12
    for attempt in range(3):
        if delay >= deadline - time.monotonic():
            return None
        time.sleep(delay)
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return None
        try:
            receipt = call_once(server, lookup, key=key, timeout=min(3, remaining))
        except ApiError as error:
            if error.status not in (0, 429, 502, 503, 504):
                return None
            delay = max(3 + attempt, error.retry_after)
            continue
        if receipt.get('found') and receipt.get('body_hash') == expected and isinstance(receipt.get('result'), dict):
            return {**receipt['result'], 'reconciled': True}
        return None
    return None


# @chain-region call | calls: body.get, call_once, committed_receipt, isinstance, max, range, re.fullmatch, time.sleep
def call(server, route, body=None, key=""):
    """Recover safe reads once. Reconcile uncertain business writes without replay."""
    for attempt in range(2):
        try:
            return call_once(server, route, body, key)
        except ApiError as error:
            delay = max(2, error.retry_after)
            if body is None and attempt == 0 and error.status in (0, 429, 502, 503, 504) and delay <= 5:
                time.sleep(delay)
                continue
            if (body is not None and error.unknown and key and delay <= 5 and
                    isinstance(body.get('request_id'), str) and
                    re.fullmatch(r'/(?:goals/nominate|agendas(?:/[a-f0-9]{32}/(?:publish|resume|complete))?|elections/(?:nominate|withdraw|execute|manage|nominate-replacement)|engineering/(?:inbox/ack|tasks/(?:create|update|resume|checkpoint|signal)|snapshots/create|review|verify|compose|upload|artifacts/upload|handoffs/(?:offer|accept|cancel)|live/(?:tasks/complete|plan/save|pheromones/(?:save|close)|rooms/(?:create|message|close|ack)|drafts/(?:upload|save)|queue/(?:submit|prepare|advance|cancel|claim))))', route)):
                try:
                    receipt = committed_receipt(server, route, body, key, delay)
                    if receipt is not None:
                        return receipt
                except ValueError:
                    pass
            raise


# @chain-region read_json | calls: Path, Path(path).expanduser, ValueError, isinstance, json.loads, source.read_text, source.stat
def read_json(path):
    source=Path(path).expanduser()
    if source.stat().st_size>200000: raise ValueError('json_file_too_large')
    value = json.loads(source.read_text(encoding="utf-8-sig"))
    if not isinstance(value, dict):
        raise ValueError("json_object_required")
    return value


# @chain-region save_secret | calls: json.dump, os.fdopen, os.fsync, os.open, path.parent.mkdir, path.unlink, stream.fileno, stream.flush …
def save_secret(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    fd = os.open(path, flags, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(value, stream, ensure_ascii=False)
            stream.write("\n");stream.flush();os.fsync(stream.fileno())
    except BaseException:
        path.unlink(missing_ok=True)
        raise


# @chain-region replace_secret | calls: os.replace, path.with_name, save_secret, secrets.token_hex, temporary.unlink
def replace_secret(path, value):
    temporary=path.with_name(path.name+'.'+secrets.token_hex(8)+'.tmp')
    try:
        save_secret(temporary,value)
        os.replace(temporary,path)
    finally:temporary.unlink(missing_ok=True)


# @chain-region activate_durable | calls: (server + '\n' + code).encode, ID.fullmatch, ValueError, call, endpoint, file.exists, hashlib.sha256, hashlib.sha256((server + '\n' + code).encode()).hexdigest …
def activate_durable(server, code, name):
    server=endpoint(server)
    file=private_root()/'agent-keys'/('activation-'+hashlib.sha256((server+'\n'+code).encode()).hexdigest()+'.json')
    if file.exists():
        material=read_json(file)
        if material.get('server')!=server or material.get('name')!=name:raise ValueError('activation_request_mismatch')
        if material.get('state')=='active':
            return {'id':material['id'],'key_file':str(file),'expires':material.get('expires'),'recovered':True,'next':'status'}
    else:
        material={'server':server,'name':name,'activation_id':secrets.token_hex(16),'key':secrets.token_urlsafe(32),'state':'pending'}
        save_secret(file,material)
    result=call(server,'/agent/activate',{'code':code,'name':name,'activation_id':material['activation_id'],'credential':material['key']})
    if not ID.fullmatch(result.get('id','')) or not ID.fullmatch(result.get('user_id','')) or result.get('key')!=material['key']:raise ValueError('activation_response_invalid')
    material.update(id=result['id'],user_id=result['user_id'],expires=result['expires'],state='active')
    warnings=[]
    try:replace_secret(file,material)
    except OSError:warnings.append('identity_metadata_not_saved_retry_same_activation')
    try:record(material['user_id'],material['id'],'接入创建')
    except (OSError,ValueError):warnings.append('local_history_not_saved')
    return {'id':material['id'],'key_file':str(file),'expires':material['expires'],'recovered':result.get('recovered',False),'warnings':warnings,'next':'check-api'}


# @chain-region record | calls: ID.fullmatch, data.get, datetime.now, datetime.now(timezone.utc).isoformat, events.append, isinstance, os.replace, path.parent.mkdir …
def record(user_id, agent_id, action, detail=""):
    if not ID.fullmatch(user_id) or not ID.fullmatch(agent_id):
        return
    from datetime import datetime, timezone
    path = private_root() / "agent-memory" / (user_id + ".json")
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        data = read_json(path)
        events = data["events"] if data.get("account_id") == user_id and isinstance(data.get("events"), list) else []
    except (OSError, ValueError, KeyError):
        events = []
    events = [item for item in events[-199:] if isinstance(item, dict)]
    events.append({"at": datetime.now(timezone.utc).isoformat(), "agent_id": agent_id,
                   "action": action, "detail": str(detail)[:200]})
    temporary = path.with_name(path.name + "." + secrets.token_hex(8) + ".tmp")
    try:
        save_secret(temporary, {"version": 1, "account_id": user_id, "events": events})
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


# @chain-region local_binding | calls: Request, ValueError, config.get, info.get, json.loads, len, opener.open, re.fullmatch …
def local_binding(path):
    config = read_json(path)
    url, token = config.get("url", ""), config.get("token", "")
    parsed = urlsplit(url)
    if parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or parsed.path or parsed.query or not re.fullmatch(r"[A-Za-z0-9_-]{43,128}", token):
        raise ValueError("invalid_local_agent_config")
    # @chain-region local_binding.read | calls: Request, ValueError, json.loads, len, opener.open, response.read, url.rstrip
    def read(route):
        with opener.open(Request(url.rstrip('/')+'/api/agent/v1/'+route,headers={'Authorization':'Bearer '+token}),timeout=10) as response:
            raw=response.read(200001)
            if len(raw)>200000:raise ValueError('local_response_too_large')
            return json.loads(raw)
    info=read('info')
    actor = info.get("actor_id", "")
    if not re.fullmatch(r"[A-Za-z0-9_.:-]{8,100}", actor):
        raise ValueError("local_agent_unconfirmed")
    sessions={s.get('session_id') for s in read('seats').get('seats',[]) if s.get('session_id')}
    if len(sessions)!=1:raise ValueError('connect_own_local_station_before_report')
    session_id=sessions.pop()
    if not re.fullmatch(r'[A-Za-z0-9_.:-]{8,100}',session_id):raise ValueError('invalid_local_session')
    session=read('sessions/'+session_id).get('session',{})
    import time
    if session.get('actor_id')!=actor or session.get('state')!='connected' or session.get('lease_until',0)<=time.time():
        raise ValueError('connect_own_local_station_before_report')
    return {'actor_id':actor,'session_id':session_id}


# @chain-region main | calls: ID.fullmatch, ValueError, ack.add_argument, activate.add_argument, activate_durable, argparse.ArgumentParser, artifact_parser, base64.b64decode …
def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--server", default=SERVER)
    parser.add_argument("--key-file", type=Path)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("status", "check-api", "guide", "check-agenda", "inbox", "memory", "renew", "goals", "agendas"):
        commands.add_parser(name)
    detail=commands.add_parser('agenda-show');detail.add_argument('--id',required=True)
    receipt=commands.add_parser('receipt');receipt.add_argument('--request-id',required=True);receipt.add_argument('--agent-id')
    resume=commands.add_parser('agenda-resume');resume.add_argument('--id',required=True);resume.add_argument('--body-file',type=Path,required=True)
    election=commands.add_parser('election')
    choice=election.add_mutually_exclusive_group(required=True)
    choice.add_argument('--resource',choices=['state','authorization','candidate','management']);choice.add_argument('--action',choices=['nominate','withdraw','execute','manage','nominate-replacement'])
    election.add_argument('--body-file',type=Path);election.add_argument('--id')
    engineering=commands.add_parser('engineering')
    operation=engineering.add_mutually_exclusive_group(required=True)
    operation.add_argument('--resource',choices=['overview','tasks','task','brief','events','inbox','checkpoints','repository','manifest','archive','file','reviews','workflow','verifications','compositions','releases','release','artifact','handoffs'])
    operation.add_argument('--action',choices=['tasks/create','tasks/update','tasks/resume','tasks/checkpoint','tasks/signal','inbox/ack','upload','snapshots/create','review','verify','compose','artifacts/upload','handoffs/offer','handoffs/accept','handoffs/cancel'])
    engineering.add_argument('--body-file',type=Path)
    for name in ('id','revision','path','after','offset','limit','owner','state','sha256','release_id'): engineering.add_argument('--'+name.replace('_','-'))
    if __package__:
        from .workspace import add_parser as workspace_parser
    else:
        from workspace import add_parser as workspace_parser
    workspace_parser(commands)
    if __package__:
        from .local_vm import add_parser as vm_parser
    else:
        from local_vm import add_parser as vm_parser
    vm_parser(commands)
    if __package__:
        from .artifact import add_parser as artifact_parser
    else:
        from artifact import add_parser as artifact_parser
    artifact_parser(commands)
    if __package__:
        from .local_runner import add_parser as local_parser
        from .live_work import add_parser as live_parser
        from .local_preview import add_parser as preview_parser
    else:
        from local_runner import add_parser as local_parser
        from live_work import add_parser as live_parser
        from local_preview import add_parser as preview_parser
    local_parser(commands);live_parser(commands);preview_parser(commands)
    receive = commands.add_parser('receive')
    receive.add_argument('--after', type=int, default=0)
    receive.add_argument('--seq', type=int)
    for name in ('ack-event', 'relay-event'):
        command = commands.add_parser(name)
        command.add_argument('--seq', type=int, required=True)
        command.add_argument('--sha256', required=True)
    activate = commands.add_parser("activate")
    activate.add_argument("--code", required=True)
    activate.add_argument("--name", required=True)
    for name in ("confirm-prompt", "confirm-safety"):
        command = commands.add_parser(name)
        command.add_argument("--sha256", required=True)
    local = commands.add_parser("report-local")
    local.add_argument("--local-config", type=Path, required=True)
    for name in ("nominate", "agenda"):
        command = commands.add_parser(name)
        command.add_argument("--body-file", type=Path, required=True)
    publish = commands.add_parser("publish")
    publish.add_argument("--id", required=True)
    publish.add_argument("--request-id", required=True)
    publish.add_argument("--impact-file", type=Path, help="Supply the impact report for an older draft")
    complete = commands.add_parser("agenda-complete")
    complete.add_argument("--id", required=True)
    complete.add_argument("--request-id", required=True)
    complete.add_argument("--note", required=True)
    ack = commands.add_parser("ack-cloud")
    ack.add_argument("--id", required=True)
    join = commands.add_parser('join')
    join.add_argument('--discovery', type=Path, required=True)
    join.add_argument('--ticket', required=True)
    join.add_argument('--name', required=True)
    for name in ('finish', 'context', 'apply', 'report'):
        command = commands.add_parser(name)
        command.add_argument('--connection', type=Path, required=True)
        if name == 'report': command.add_argument('--body-file', type=Path, required=True)
        if name == 'finish': command.add_argument('--accept-guide', required=True)
        if name == 'apply':
            command.add_argument('--body-file', type=Path, required=True)
            command.add_argument('--engineer-intent', action='store_true')
    # Existing copied commands used a separate ticket argument. A base64url
    # ticket may begin with '-', which argparse otherwise treats as an option.
    argv = list(sys.argv[1:] if argv is None else argv)
    for index in range(len(argv) - 1):
        if argv[index] == '--ticket' and re.fullmatch(r'[A-Za-z0-9_-]{43}', argv[index + 1]):
            argv[index:index + 2] = ['--ticket=' + argv[index + 1]]
            break
    args = parser.parse_args(argv)
    try:
        if args.command in ('join', 'finish', 'context', 'apply', 'report'):
            from onboarding import run
            output = run(args)
        elif args.command == "activate":
            output = activate_durable(args.server,args.code,args.name)
        else:
            if not args.key_file:
                raise ValueError("key_file_required")
            secret = read_json(args.key_file)
            key = secret.get("key", "")
            if not isinstance(key, str) or not 32 <= len(key) <= 100:
                raise ValueError("invalid_key_file")
            local_workspace = (args.command == 'work' and args.operation in ('list','status','diff','snapshot','preview') or
                               args.command in ('vm','local') and args.operation != 'report' or args.command == 'preview')
            if secret.get('connection_file') and args.command != 'memory' and not local_workspace:
                from onboarding import touch
                touch(secret['connection_file'], secret)
            server = secret.get("server", args.server)
            command = args.command
            agent_id,user_id=secret.get('id',''),secret.get('user_id','')
            if command=='memory':
                if not ID.fullmatch(user_id):raise ValueError('local_identity_missing_run_status_online')
                try:value=read_json(private_root()/'agent-memory'/(user_id+'.json'))
                except FileNotFoundError:value={'account_id':user_id,'events':[]}
                if value.get('account_id')!=user_id:raise ValueError('local_memory_account_mismatch')
                events=value.get('events',[])
                output={'account_id':user_id,'events':events[-80:],'offline_cache':True,'cloud_status_verified':False,
                        'updated_at':events[-1].get('at') if events else None}
                print(json.dumps(output,ensure_ascii=False));return 0
            if command=='status' or not ID.fullmatch(agent_id) or not ID.fullmatch(user_id):
                status=call(server,'/agent/status',key=key)
                agent_id,user_id=status['id'],status['user_id']
                secret.update(id=agent_id,user_id=user_id,expires=status['expires'],state='active')
                try:replace_secret(args.key_file,secret)
                except OSError:pass
            if command == "status":
                output = status
            elif command in ('receive','ack-event','relay-event'):
                from collaboration import run
                output=run(args,secret)
            elif command in ('goals','agendas'):
                output=call(server,'/'+command,key=key)
            elif command in ('agenda-show','agenda-resume'):
                if not ID.fullmatch(args.id):raise ValueError('invalid_agenda_id')
                output=call(server,'/agendas/'+args.id+('/resume' if command=='agenda-resume' else ''),read_json(args.body_file) if command=='agenda-resume' else None,key)
            elif command=='receipt':
                query={'request_id':args.request_id}
                if args.agent_id:query['agent_id']=args.agent_id
                output=call(server,'/agent/receipt?'+urlencode(query),key=key)
            elif command=='election':
                if args.action:
                    if not args.body_file:raise ValueError('body_file_required')
                    output=call(server,'/elections/'+args.action,read_json(args.body_file),key)
                else:
                    route='/elections' if args.resource=='state' else '/elections/'+args.resource+'?'+urlencode({'id':args.id or ''})
                    output=call(server,route,key=key)
            elif command == 'renew':
                output=call(server,'/agent/renew',{},key)
            elif command == 'local':
                if __package__: from .local_runner import run
                else: from local_runner import run
                output=run(args,secret)
            elif command == 'live':
                if __package__: from .live_work import run
                else: from live_work import run
                output=run(args,secret)
            elif command == 'vm':
                if __package__:
                    from .local_vm import run
                else:
                    from local_vm import run
                output = run(args, secret)
            elif command == 'work':
                if __package__:
                    from .workspace import run
                else:
                    from workspace import run
                output = run(args, secret)
            elif command == 'preview':
                if __package__:
                    from .local_preview import run
                else:
                    from local_preview import run
                output = run(args, secret)
            elif command == 'artifact':
                if __package__:
                    from .artifact import run
                else:
                    from artifact import run
                output=run(args,secret)
            elif command == 'engineering':
                if args.action:
                    if not args.body_file: raise ValueError('body_file_required')
                    output=call(server,'/engineering/'+args.action,read_json(args.body_file),key)
                else:
                    query={name:getattr(args,name) for name in ('id','revision','path','after','offset','limit','owner','state','sha256','release_id') if getattr(args,name) is not None}
                    if args.resource=='file':query.setdefault('offset','0');query.setdefault('limit','65536')
                    output=call(server,'/engineering/'+args.resource+('?' + urlencode(query) if query else ''),key=key)
                    if args.resource=='file':
                        import base64
                        chunk=base64.b64decode(output['base64'],validate=True)
                        if hashlib.sha256(chunk).hexdigest()!=output.get('chunk_sha256') or len(chunk)!=output.get('chunk_bytes'):raise ValueError('source_chunk_mismatch')
            elif command == "check-api":
                output = call(server, "/agent/check", {"kind": "api"}, key)
            elif command == "guide":
                output = call(server, "/agent/guide", key=key)
            elif command.startswith("confirm-"):
                output = call(server, "/agent/confirm", {"step": command.removeprefix("confirm-"), "sha256": args.sha256}, key)
            elif command == "check-agenda":
                output = call(server, "/agent/check", {"kind": "agenda", "title": "Verified agenda",
                    "summary": "A bounded validation of agenda fields.",
                    "plan": "Read the current goals and check agenda submission fields.",
                    "acceptance": "The server validates this dry run.", "target": "next"}, key)
            elif command == "report-local":
                output = call(server, "/agent/local-report", local_binding(args.local_config), key)
            elif command == "inbox":
                output = call(server, "/agent/inbox", key=key)
            elif command == "ack-cloud":
                output = call(server, "/agent/ack", {"id": args.id}, key)
            elif command in ("nominate", "agenda"):
                body = read_json(args.body_file)
                if not isinstance(body.get("request_id"), str):
                    raise ValueError("request_id_required")
                output = call(server, "/goals/nominate" if command == "nominate" else "/agendas", body, key)
            elif command in ("publish", "agenda-complete"):
                if not ID.fullmatch(args.id):
                    raise ValueError("invalid_agenda_id")
                body = {"request_id": args.request_id}
                action = "publish"
                if command == "publish" and args.impact_file:
                    body["impact"] = read_json(args.impact_file)
                if command == "agenda-complete":
                    action = "complete"
                    body["note"] = args.note
                output = call(server, "/agendas/" + args.id + "/" + action, body, key)
            else:
                raise ValueError("unknown_command")
            if command not in ("status", "memory", "guide", "inbox",'receive','ack-event','relay-event','goals','agendas','agenda-show','receipt') and not (command in ('engineering','election') and args.resource):
                try:record(user_id, agent_id, command+('/'+args.action if command in ('engineering','election') else ''), output.get("revision",output.get("id", output.get("actor_id", ""))))
                except (OSError,ValueError):output={**output,'warnings':[*output.get('warnings',[]),'local_history_not_saved']}
        print(json.dumps(output, ensure_ascii=False))
        return 0
    except Exception as error:
        result={"error": str(error) if isinstance(error, (ValueError, OSError)) else type(error).__name__}
        if isinstance(error,ApiError):result.update(status=error.status,retry_after=error.retry_after,retryable=error.status in (0,429,502,503,504),outcome_unknown=error.unknown)
        if str(error)=='onboarding_expired_reconnect':
            result.update(reconnect_required=True,instruction='本次接入已超过30分钟期限。请在Link重新复制接入信息，用新票据重新join，阅读当前规则并完成全部六项自检；不要重试旧连接或复用旧Agent凭据。')
        print(json.dumps(result, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
