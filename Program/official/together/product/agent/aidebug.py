# @file-map:start
# 文件: link/agent/aidebug.py
# 位置: 二环·Agent完整链路 | 协作CLI、接续、实际启动器、工作包、源码传输和本机运行。
# 约束: 使用本人已有身份和connection，不因压缩重建身份；写操作保留request_id；未知结果查回执，凭据不进入日志与文档
# 下游: link/agent/aidebug_launch.py
# 上游: 入口/动态加载；参阅链路与目录地图
# 链路: startup, observation
# 验证: AIDEBUG/control.test.cjs, AIDEBUG/observe.test.cjs, AIDEBUG/portable.test.cjs, AIDEBUG/startup-review.py, AIDEBUG/test_aidebug_launch.py
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   saved_receipt | function
#   offline_status | function
#   execute | function
#   execute.request | function
#   main | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Operate the actual running Link client and collect reproducible evidence."""
import argparse
import json
import os
from pathlib import Path
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

# The Windows embeddable Python omits the script directory in isolated mode.
if sys.flags.isolated:
    sys.path.insert(0, str(Path(__file__).resolve().parent))

from aidebug_launch import default_exe, latest_launch, launch, launch_status, preflight, read_json


# @chain-region saved_receipt | calls: folders.extend, journal.is_file, journal.open, journal.stat, json.loads, max, p.is_dir, receipt.get …
def saved_receipt(discovery_path, request_id):
    root = discovery_path.parent.parent / 'diagnostics'
    folders = [discovery_path.parent]
    if root.is_dir():
        folders.extend(sorted((p for p in root.iterdir() if p.is_dir()), reverse=True)[:40])
    for folder in folders:
        journal = folder / 'control-receipts.jsonl'
        if not journal.is_file():
            continue
        with journal.open('rb') as stream:
            stream.seek(max(0, journal.stat().st_size - 4 * 1024 * 1024))
            lines = stream.read().splitlines()
        for line in reversed(lines):
            try:
                receipt = json.loads(line)
            except ValueError:
                continue
            if receipt.get('request_id') == request_id:
                return receipt
    return None


# @chain-region offline_status | calls: (root / 'diagnostics').is_dir, (root / 'diagnostics').iterdir, default_exe, failure.is_file, failure.read_text, json.loads, latest_launch, launch_status …
def offline_status(discovery_path, launch_directory=None, executable=None):
    root = discovery_path.parent.parent
    result = {'mode': 'saved-diagnostics', 'runtime': str(discovery_path.parent),
              'diagnostics': str(root / 'diagnostics')}
    pointer = read_json(discovery_path.parent / 'startup.json')
    if pointer and pointer.get('file'):
        result['startup'] = read_json(pointer['file']) or {'state': 'unreadable', 'path': pointer['file']}
    launcher = launch_status(launch_directory) if launch_directory else latest_launch(executable or default_exe())
    if launcher:
        result['launch'] = launcher
    failure = root / 'data/logs/desktop-error.json'
    if failure.is_file():
        try:
            result['startup_failure'] = json.loads(failure.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            result['startup_failure'] = {'path': str(failure), 'error': 'Could not read saved startup failure'}
    if (root / 'diagnostics').is_dir():
        recent = sorted((p for p in (root / 'diagnostics').iterdir() if p.is_dir()), reverse=True)[:5]
        result['recent_sessions'] = [str(p) for p in recent]
    return result


# @chain-region execute | calls: RuntimeError, ValueError, args.discovery.read_text, args.file.read_text, command.setdefault, getattr, isinstance, json.dumps …
def execute(args):
    if args.op == 'preflight':
        return preflight(args.exe)
    if args.op == 'launch':
        return launch(args.exe, args.launch_dir, args.scenario, args.timeout)
    if args.op == 'launch-status':
        return launch_status(args.launch_dir) if args.launch_dir else latest_launch(args.exe) or {'state': 'unknown', 'error': 'launch_not_found'}
    if args.op == 'offline':
        return offline_status(args.discovery, args.launch_dir, args.exe)
    if args.receipt:
        saved = saved_receipt(args.discovery, args.receipt)
        if saved and saved.get('state') in ('completed', 'failed', 'unknown'):
            return saved['result'] if saved['state'] == 'completed' else saved
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    discovery = None
    # @chain-region execute.request | calls: RuntimeError, json.dumps, json.dumps(body, ensure_ascii=False).encode, json.load, max, min, opener.open, urllib.request.Request
    def request(route, body=None):
        headers = {'Authorization': 'Bearer ' + discovery['token']}
        raw = None
        if body is not None:
            raw = json.dumps(body, ensure_ascii=False).encode('utf-8')
            headers['Content-Type'] = 'application/json'
        req = urllib.request.Request(discovery['origin'] + route, data=raw, headers=headers)
        try:
            with opener.open(req, timeout=min(15, max(1, args.timeout))) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            try:
                detail = json.load(error)
            except (ValueError, OSError):
                detail = {'error': error.reason}
            raise RuntimeError(json.dumps(detail, ensure_ascii=False)) from None
    deadline = time.monotonic() + min(10, max(1, args.timeout))
    while True:
        try:
            discovery = json.loads(args.discovery.read_text(encoding='utf-8'))
            origin = urllib.parse.urlparse(discovery['origin'])
            if origin.scheme != 'http' or origin.hostname != '127.0.0.1' or not origin.port:
                raise ValueError('Invalid local AIDEBUG discovery')
            status = request('/status')
            break
        except (OSError, ValueError, KeyError):
            if time.monotonic() >= deadline:
                if args.receipt and saved:
                    return {**saved, 'state': 'unknown'}
                raise RuntimeError('AIDEBUG is not available. Use --op offline for saved evidence or --op launch to start the installed client. Discovery: ' + str(args.discovery)) from None
            time.sleep(0.2)
    if args.receipt:
        receipt = request('/receipts/' + urllib.parse.quote(args.receipt, safe=''))
    else:
        command = json.loads(args.file.read_text(encoding='utf-8-sig')) if args.file else json.loads(args.command) if args.command else {'op': args.op} if args.op else None
        if command is None:
            return status
        if isinstance(command, list):
            command = {'op': 'batch', 'steps': command}
        command.setdefault('request_id', args.request_id or 'aidebug-' + uuid.uuid4().hex)
        for key in ('view', 'selector', 'name', 'surface'):
            value = getattr(args, key)
            if value:
                command[key] = value
        try:
            receipt = request('/commands', command)
        except (OSError, TimeoutError):
            return {'state': 'unknown', 'request_id': command['request_id'], 'error': 'Query this request with --receipt; do not repeat the action.'}
    deadline = time.monotonic() + args.timeout
    while receipt['state'] in ('accepted', 'running'):
        if time.monotonic() >= deadline:
            return {'state': 'unknown', 'request_id': receipt['request_id'], 'error': 'Still running; query --receipt with this ID.'}
        time.sleep(0.1)
        try:
            receipt = request('/receipts/' + receipt['request_id'])
        except (OSError, TimeoutError):
            saved = saved_receipt(args.discovery, receipt['request_id'])
            if saved:
                receipt = saved
            # Keep reading the original receipt within the deadline; never replay the action.
    return receipt['result'] if receipt['state'] == 'completed' else receipt


# @chain-region main | calls: Path, argparse.ArgumentParser, args.exe.resolve, args.output.parent.mkdir, args.output.write_text, default_exe, execute, isinstance …
def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--discovery', type=Path, help='Explicit running client discovery; defaults to this installation')
    parser.add_argument('--timeout', type=float, default=60)
    parser.add_argument('--exe', type=Path, default=default_exe(), help='Installed client executable for launch/preflight')
    parser.add_argument('--launch-dir', type=Path, help='Persistent launch evidence directory')
    parser.add_argument('--scenario', type=Path, help='Isolated migration scenario inside --launch-dir')
    source = parser.add_mutually_exclusive_group()
    source.add_argument('--command', help='JSON command; omit for status')
    source.add_argument('--file', type=Path, help='Read a command or ordered list from JSON')
    source.add_argument('--op', help='Single operation, e.g. actions, bundle, logs, capture')
    source.add_argument('--receipt', help='Inspect a previous request without repeating it')
    parser.add_argument('--request-id', help='Optional stable operation ID')
    parser.add_argument('--view', help='shell, office, or contents:<ID> from status')
    parser.add_argument('--selector', help='CSS selector for the operation')
    parser.add_argument('--name', help='Evidence folder or file name')
    parser.add_argument('--surface', choices=('desktop', 'composite'), help='Windows desktop pixels or compositor capture')
    parser.add_argument('--output', type=Path, help='Save evidence index, including failures')
    args = parser.parse_args()
    if args.discovery is None:
        portable = args.exe.resolve().parent / 'Local/runtime/aidebug.json'
        args.discovery = portable if portable.parent.is_dir() else Path(os.environ.get('LOCALAPPDATA', '.')) / 'Aieyra Together Link/runtime/aidebug.json'
    try:
        result = execute(args)
    except (OSError, ValueError, RuntimeError, KeyError) as error:
        result = {'state': 'failed', 'error': str(error), 'offline': offline_status(args.discovery, args.launch_dir, args.exe)}
    text = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text + '\n', encoding='utf-8')
    print(text)
    if isinstance(result, dict) and result.get('state') in ('failed', 'unknown', 'partial', 'degraded', 'existing-instance'):
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
