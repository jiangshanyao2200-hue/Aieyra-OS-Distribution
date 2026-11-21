# @file-map:start
# 文件: link/agent/aidebug_launch.py
# 位置: 二环·Agent完整链路 | 协作CLI、接续、实际启动器、工作包、源码传输和本机运行。
# 约束: 使用本人已有身份和connection，不因压缩重建身份；写操作保留request_id；未知结果查回执，凭据不进入日志与文档
# 下游: 无已解析的项目内静态导入
# 上游: link/agent/aidebug.py
# 链路: startup
# 验证: AIDEBUG/portable.test.cjs, AIDEBUG/startup-review.py, AIDEBUG/test_aidebug_launch.py
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   read_json | function
#   write_json | function
#   now | function
#   default_exe | function
#   preflight | function
#   preflight.Memory | class
#   launch_status | function
#   latest_launch | function
#   launch | function
#   supervise | function
#   supervise.save | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Launch the installed client and retain evidence even before its UI exists."""
import ctypes
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import uuid


# @chain-region read_json | calls: Path, Path(file).read_text, json.loads
def read_json(file):
    try:
        return json.loads(Path(file).read_text(encoding='utf-8-sig'))
    except (OSError, ValueError):
        return None


# @chain-region write_json | calls: Path, file.with_name, json.dumps, os.replace, temporary.write_text
def write_json(file, value):
    file = Path(file)
    temporary = file.with_name(file.name + '.next')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    os.replace(temporary, file)


# @chain-region now | calls: datetime.datetime.now, datetime.datetime.now(datetime.timezone.utc).isoformat
def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


# @chain-region default_exe | calls: Path, Path(__file__).resolve
def default_exe():
    program = Path(__file__).resolve().parent.parent
    if program.name == 'link':
        program = program.parent / 'dist/windows'
    return program / 'Aieyra Together Link.exe'


# @chain-region preflight | calls: (root / 'Local.migrating').is_dir, Memory, Path, Path(executable).resolve, checksum.hexdigest, checksum.update, ctypes.byref, ctypes.sizeof …
def preflight(executable):
    executable = Path(executable).resolve()
    root = executable.parent
    package = read_json(root / 'resources/app/package.json') or {}
    manifest = read_json(root / 'build-manifest.json') or {}
    required = [executable, root / 'resources/app' / package.get('main', 'bootstrap.cjs'),
                root / 'resources/app/startup-diagnostics.cjs', root / 'resources/app/portable.cjs',
                root / 'resources/app/main.cjs', root / 'resources/app/ui/index.html',
                root / 'resources/link/runtime/python/python.exe',
                root / 'resources/link/runtime/python/python313.zip',
                root / 'resources/link/runtime/native/aieyra-link.exe',
                root / 'resources/link/office/service/main.py']
    missing = [str(file.relative_to(root)) for file in required if not file.is_file()]
    expected = {item['path']: item['sha256'] for item in manifest.get('files', [])}
    mismatches = []
    for file in required[1:]:
        relative = file.relative_to(root).as_posix()
        if file.is_file() and relative in expected:
            checksum = hashlib.sha256()
            with file.open('rb') as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                    checksum.update(chunk)
            if checksum.hexdigest() != expected[relative]:
                mismatches.append(relative)
    storage = shutil.disk_usage(root) if root.is_dir() else None
    memory = None
    if os.name == 'nt':
        # @chain-region preflight.Memory
        class Memory(ctypes.Structure):
            _fields_ = [('length', ctypes.c_ulong), ('load', ctypes.c_ulong),
                        *[(key, ctypes.c_ulonglong) for key in ('total', 'available', 'page_total', 'page_available', 'virtual_total', 'virtual_available', 'extended')]]
        status = Memory()
        status.length = ctypes.sizeof(status)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
            memory = {'available_bytes': status.available, 'total_bytes': status.total,
                      'available_fraction': round(status.available / status.total, 4)}
    layout = read_json(root / 'Local/layout.json')
    return {'state': 'passed' if not missing and not mismatches else 'failed',
            'executable': str(executable), 'version': package.get('version'),
            'entry': package.get('main'), 'missing': missing, 'mismatches': mismatches,
            'layout': 'ready' if layout else 'interrupted-migration' if (root / 'Local.migrating').is_dir() else 'migration-required',
            'disk_free_bytes': storage.free if storage else None, 'memory': memory}


# @chain-region launch_status | calls: Path, Path(directory).resolve, read_json, str
def launch_status(directory):
    directory = Path(directory).resolve()
    result = read_json(directory / 'launch-status.json') or {'state': 'unknown', 'error': 'launch_status_not_found'}
    startup = read_json(directory / 'startup.json')
    if startup:
        result = {**result, 'startup': startup}
    return {**result, 'directory': str(directory)}


# @chain-region latest_launch | calls: Path, Path(executable).resolve, launch_status, pointer.get, read_json
def latest_launch(executable):
    pointer = read_json(Path(executable).resolve().parent / 'diagnostics/launch-latest.json')
    return launch_status(pointer['directory']) if pointer and pointer.get('directory') else None


# @chain-region launch | calls: (directory / 'supervisor.log').open, (directory / name).exists, Path, Path(__file__).resolve, Path(directory).resolve, Path(executable).resolve, Path(scenario).resolve, ValueError …
def launch(executable, directory=None, scenario=None, timeout=60):
    executable = Path(executable).resolve()
    check = preflight(executable)
    if check['state'] != 'passed':
        return {'state': 'failed', 'error': 'launch_preflight_failed', 'preflight': check}
    directory = Path(directory).resolve() if directory else executable.parent / 'diagnostics/launch' / (datetime.datetime.now().strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:8])
    directory.mkdir(parents=True, exist_ok=True)
    if any((directory / name).exists() for name in ('launch-request.json', 'launch-status.json', 'startup.json')):
        raise ValueError('Use a new launch directory; existing startup evidence is never overwritten')
    if scenario:
        scenario = Path(scenario).resolve()
        if not scenario.is_relative_to(directory) or not scenario.is_file():
            raise ValueError('The isolated scenario must be inside the launch directory')
    request = {'protocol': 'aieyra-launch/1', 'executable': str(executable), 'directory': str(directory),
               'scenario': str(scenario) if scenario else None, 'requested_at': now(), 'preflight': check}
    write_json(directory / 'launch-request.json', request)
    # A detached supervisor keeps the real exit status after this CLI returns.
    flags = (subprocess.CREATE_NO_WINDOW | subprocess.DETACHED_PROCESS) if os.name == 'nt' else 0
    with (directory / 'supervisor.log').open('wb') as log:
        supervisor = subprocess.Popen([sys.executable, '-X', 'utf8', '-B', str(Path(__file__).resolve()), '--supervise', str(directory)],
                                      stdin=subprocess.DEVNULL, stdout=log, stderr=log, creationflags=flags,
                                      close_fds=True, start_new_session=os.name != 'nt')
    if not scenario:
        pointer = executable.parent / 'diagnostics/launch-latest.json'
        pointer.parent.mkdir(parents=True, exist_ok=True)
        write_json(pointer, {'directory': str(directory), 'requested_at': request['requested_at']})
    deadline = time.monotonic() + max(1, timeout)
    while time.monotonic() < deadline:
        result = launch_status(directory)
        if result.get('state') in ('ready', 'degraded', 'failed', 'exited', 'existing-instance'):
            return result
        time.sleep(0.15)
    return {**launch_status(directory), 'state': 'unknown', 'supervisor_pid': supervisor.pid,
            'error': 'startup_wait_expired', 'next': 'Query --op launch-status --launch-dir with this directory; do not relaunch.'}


# @chain-region supervise | calls: (directory / 'stderr.log').open, (directory / 'stdout.log').open, Path, Path(directory).resolve, args.append, child.poll, key.upper, key.upper().startswith …
def supervise(directory):
    directory = Path(directory).resolve()
    request = read_json(directory / 'launch-request.json')
    status = {'protocol': 'aieyra-launch/1', 'state': 'starting', 'supervisor_pid': os.getpid(),
              'executable': request['executable'], 'requested_at': request['requested_at']}
    # @chain-region supervise.save | calls: now, write_json
    def save():
        status['updated_at'] = now()
        write_json(directory / 'launch-status.json', status)
    save()
    args = [request['executable'], '--aidebug-startup-output=' + str(directory), '--aidebug-no-activate']
    if request.get('scenario'):
        args.append('--aidebug-startup-scenario=' + request['scenario'])
    env = {key: value for key, value in os.environ.items() if not key.upper().startswith(('ELECTRON_', 'PYTHON', 'AIEYRA_')) and key.upper() != 'NODE_OPTIONS'}
    try:
        with (directory / 'stdout.log').open('wb') as stdout, (directory / 'stderr.log').open('wb') as stderr:
            child = subprocess.Popen(args, cwd=str(Path(request['executable']).parent), env=env,
                                     stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr,
                                     creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0, close_fds=True)
            status['pid'] = child.pid
            save()
            previous = None
            while True:
                startup = read_json(directory / 'startup.json') or {}
                signature = (startup.get('events'), startup.get('state'), startup.get('phase'))
                if signature != previous:
                    previous = signature
                    status['phase'] = startup.get('phase', 'process-created')
                    if status['phase'] == 'existing-instance':
                        status['state'] = 'existing-instance'
                    elif startup.get('state') in ('ready', 'degraded', 'failed'):
                        status['state'] = startup['state']
                    if startup.get('ready_at'):
                        status['ready_at'] = startup['ready_at']
                    save()
                code = child.poll()
                if code is not None:
                    startup = read_json(directory / 'startup.json') or {}
                    status.update(exit_code=code, exited_at=now(), phase=startup.get('phase', status.get('phase')))
                    if status['phase'] == 'existing-instance':
                        status['state'] = 'existing-instance'
                    elif code != 0 or startup.get('state') == 'failed' or not status.get('ready_at'):
                        status['state'] = 'failed'
                        status['error'] = 'process_exited_before_ready' if not status.get('ready_at') else 'process_failed'
                    else:
                        status['state'] = 'exited'
                    save()
                    break
                time.sleep(0.2)
    except Exception as error:
        status.update(state='failed', error=type(error).__name__ + ': ' + str(error), exited_at=now())
        save()


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--supervise':
        supervise(sys.argv[2])
    else:
        raise SystemExit('Use Agent/aidebug.py --op launch')
