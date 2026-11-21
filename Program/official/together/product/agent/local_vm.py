# @file-map:start
# 文件: link/agent/local_vm.py
# 位置: 二环·Agent完整链路 | 协作CLI、接续、实际启动器、工作包、源码传输和本机运行。
# 约束: 使用本人已有身份和connection，不因压缩重建身份；写操作保留request_id；未知结果查回执，凭据不进入日志与文档
# 下游: link/agent/prepare_vm.py, link/agent/source_protocol.py, link/agent/vm_guest.py, link/agent/workspace.py
# 上游: AIDEBUG/co-creation-experiment.py, AIDEBUG/local-vm-experiment.py, link/agent/prepare_vm.py, link/agent/proposal.py, tests/test_local_vm.py, tests/test_vm_preparation.py
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: AIDEBUG/co-creation-experiment.py, AIDEBUG/local-vm-experiment.py, tests/test_local_vm.py, tests/test_vm_preparation.py
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   digest_file | function
#   resource_budget | function
#   read_wire | function
#   qmp | function
#   guest | function
#   guest_write | function
#   guest_read | function
#   VMHost | class
#   VMHost.__init__ | function
#   VMHost.configuration | function
#   VMHost.doctor | function
#   VMHost.directory | function
#   VMHost.submit | function
#   VMHost._update | function
#   VMHost.status | function
#   VMHost.cancel | function
#   VMHost.logs | function
#   VMHost.evidence | function
#   VMHost.preview | function
#   VMHost.inspect | function
#   VMHost.export | function
#   VMHost.dashboard | function
#   VMHost.worker | function
#   VMHost._execute | function
#   bridge | function
#   dispatch | function
#   add_parser | function
#   run | function
#   main | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Local QEMU/KVM verification. No candidate execution, writable mounts or guest network on the host."""
from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import subprocess
import sys
import tarfile
import time
import uuid

# Embedded Windows Python omits the script directory. This module is also a
# trusted standalone desktop/WSL bridge, alongside the main proposal CLI.
if not __package__:
    sys.path.insert(0, str(Path(__file__).resolve().parent))

try:
    from . import source_protocol as source
    from .workspace import atomic, document, exclusive, plain
except ImportError:
    import source_protocol as source
    from workspace import atomic, document, exclusive, plain

TERMINAL = {'passed', 'failed', 'cancelled', 'interrupted'}
MAX_LOG = 4 * 1024 * 1024
ID = re.compile(r'[a-f0-9]{32}\Z')


# @chain-region digest_file | calls: f.fileno, f.read, hasattr, hashlib.sha256, iter, os.posix_fadvise, path.open, value.hexdigest …
def digest_file(path):
    value = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''): value.update(block)
        if hasattr(os,'posix_fadvise'):
            try: os.posix_fadvise(f.fileno(),0,0,os.POSIX_FADV_DONTNEED)
            except OSError: pass
    return value.hexdigest()


# @chain-region resource_budget | calls: Path, Path('/proc/meminfo').read_text, Path('/proc/meminfo').read_text().splitlines, ValueError, int, json.loads, min, powershell.exists …
def resource_budget(memory_mb):
    """Sample both WSL and Windows, retaining room for concurrent user work."""
    facts = {'requested_mb':memory_mb}
    available = {row.split(':')[0]:int(row.split()[1]) for row in Path('/proc/meminfo').read_text().splitlines() if row.startswith(('MemAvailable:','MemTotal:'))}
    allowed = (available['MemAvailable']-available['MemTotal']*0.2)/1024-128
    powershell = Path('/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe')
    if powershell.exists():
        command = "$o=Get-CimInstance Win32_OperatingSystem; $c=Get-CimInstance Win32_Processor; @{totalKiB=$o.TotalVisibleMemorySize;freeKiB=$o.FreePhysicalMemory;cpu=($c|Measure-Object LoadPercentage -Average).Average}|ConvertTo-Json -Compress"
        result = subprocess.run([str(powershell),'-NoProfile','-NonInteractive','-Command',command],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=20)
        if result.returncode: raise ValueError('vm_host_resource_sample_failed')
        windows = json.loads(result.stdout.decode('utf-8-sig'));facts['windows'] = windows
        if windows.get('cpu') is None or windows['cpu'] >= 75: raise ValueError('vm_host_cpu_headroom_required')
        allowed = min(allowed,(windows['freeKiB']-windows['totalKiB']*0.2)/1024-128)
    actual = min(memory_mb,int(allowed//64)*64)
    if actual < 512: raise ValueError('vm_insufficient_host_memory_headroom')
    return actual, facts


# @chain-region read_wire | calls: ValueError, isinstance, json.loads, len, raw.endswith, stream.readline
def read_wire(stream, limit=2 * 1024 * 1024):
    raw = stream.readline(limit + 1)
    if not raw.endswith(b'\n') or len(raw) > limit: raise ValueError('vm_protocol_response_limit')
    result = json.loads(raw)
    if not isinstance(result, dict): raise ValueError('vm_protocol_object_required')
    return result


# @chain-region qmp | calls: (json.dumps(request) + '\n').encode, ValueError, conn.connect, conn.makefile, conn.sendall, conn.settimeout, json.dumps, read_wire …
def qmp(path, command, arguments=None):
    with socket.socket(socket.AF_UNIX) as conn:
        conn.settimeout(4);conn.connect(str(path))
        stream = conn.makefile('rb')
        greeting = read_wire(stream)
        if 'QMP' not in greeting: raise ValueError('vm_monitor_protocol')
        for action, args in [('qmp_capabilities',None),(command,arguments)]:
            request = {'execute':action}
            if args: request['arguments'] = args
            conn.sendall((json.dumps(request)+'\n').encode())
            while True:
                response = read_wire(stream)
                if 'return' in response: break
                if 'error' in response: raise ValueError('vm_monitor_rejected')
        return response['return']


# @chain-region guest | calls: (json.dumps(payload) + '\n').encode, (json.dumps({'execute': 'guest-sync-delimited', 'arguments': {'id': sync}}) + '\n').encode, ValueError, conn.connect, conn.makefile, conn.sendall, conn.settimeout, json.dumps …
def guest(path, command, arguments=None):
    with socket.socket(socket.AF_UNIX) as conn:
        conn.settimeout(4);conn.connect(str(path))
        stream = conn.makefile('rb')
        sync = secrets.randbits(48)
        conn.sendall(b'\xff'+(json.dumps({'execute':'guest-sync-delimited','arguments':{'id':sync}})+'\n').encode())
        for _ in range(2 * 1024 * 1024):
            if stream.read(1) == b'\xff': break
        else: raise ValueError('vm_guest_sync_limit')
        if read_wire(stream).get('return') != sync: raise ValueError('vm_guest_sync_mismatch')
        payload = {'execute':command}
        if arguments is not None: payload['arguments'] = arguments
        conn.sendall((json.dumps(payload)+'\n').encode())
        response = read_wire(stream)
        if 'error' in response: raise ValueError('vm_guest_command_rejected')
        if 'return' not in response: raise ValueError('vm_guest_response_invalid')
        return response['return']


# @chain-region guest_write | calls: ValueError, base64.b64encode, base64.b64encode(chunk).decode, guest, len, range, result.get
def guest_write(path, name, data):
    handle = guest(path,'guest-file-open',{'path':name,'mode':'wb'})
    try:
        for offset in range(0,len(data),49152):
            chunk = data[offset:offset+49152]
            result = guest(path,'guest-file-write',{'handle':handle,'buf-b64':base64.b64encode(chunk).decode()})
            if result.get('count') != len(chunk): raise ValueError('vm_guest_short_write')
    finally:
        guest(path,'guest-file-close',{'handle':handle})


# @chain-region guest_read | calls: ValueError, base64.b64decode, bytearray, bytes, guest, len, min, response.get …
def guest_read(path, name, limit, offset=0):
    handle = guest(path,'guest-file-open',{'path':name,'mode':'rb'})
    result = bytearray()
    try:
        if offset: guest(path,'guest-file-seek',{'handle':handle,'offset':offset,'whence':0})
        while len(result) < limit:
            response = guest(path,'guest-file-read',{'handle':handle,'count':min(49152,limit-len(result))})
            raw = base64.b64decode(response.get('buf-b64',''),validate=True)
            if len(raw) != response.get('count') or len(raw) > min(49152,limit-len(result)):
                raise ValueError('vm_guest_file_range_mismatch')
            result.extend(raw)
            if response.get('eof') or not raw: break
    finally:
        guest(path,'guest-file-close',{'handle':handle})
    return bytes(result)


# @chain-region VMHost | calls: (folder / 'cancel.json').exists, (folder / 'qemu.log').open, (folder / 'source.tar.gz').read_bytes, (folder / 'worker.json').is_file, (folder / 'worker.log').open, (payload['owner'] + '\n' + request_id).encode, (payload['snapshot'] + script + config['baseline_id']).encode, (self.directory(identifier) / 'output.log').is_file …
class VMHost:
    # @chain-region VMHost.__init__ | calls: Path, Path(config or Path.home() / '.local/share/Aieyra Together Link/data/vm/environment.json').expanduser, Path(config or Path.home() / '.local/share/Aieyra Together Link/data/vm/environment.json').expanduser().resolve, Path.home, self.runs.mkdir
    def __init__(self, config=None):
        self.config_path = Path(config or Path.home()/'.local/share/Aieyra Together Link/data/vm/environment.json').expanduser().resolve()
        self.root = self.config_path.parent
        self.runs = self.root/'runs';self.runs.mkdir(parents=True,exist_ok=True,mode=0o700)

    # @chain-region VMHost.configuration | calls: Path, Path(__file__).with_name, Path(config['image']).resolve, ValueError, config.get, digest_file, document, plain …
    def configuration(self):
        config = document(self.config_path)
        if config.get('provider') != 'qemu-kvm' or config.get('verified_boot') is not True:
            raise ValueError('verified_local_vm_baseline_required')
        if (type(config.get('memory_mb')) is not int or not 512 <= config['memory_mb'] <= 2048 or
            config.get('cpus') != 1 or not source.HEX.fullmatch(config.get('image_sha256',''))):
            raise ValueError('vm_resource_configuration_invalid')
        image = Path(config['image']).resolve()
        plain(image)
        if digest_file(image) != config['image_sha256']: raise ValueError('vm_baseline_image_changed')
        if digest_file(Path(__file__).with_name('vm_guest.py')) != config.get('guest_runner_sha256'):
            raise ValueError('vm_guest_runner_upgrade_requires_baseline_refresh')
        return config | {'image':str(image)}

    # @chain-region VMHost.doctor | calls: bool, config.get, facts.update, os.access, self.config_path.is_file, self.configuration, shutil.which, str
    def doctor(self):
        facts = {'provider':'qemu-kvm','configured':self.config_path.is_file(),'qemu_available':bool(shutil.which('qemu-system-x86_64')),
                 'kvm_accessible':os.access('/dev/kvm',os.R_OK|os.W_OK),'cloud_execution':False,
                 'guest_network':False,'host_mounts':False,'ready':False}
        if facts['configured']:
            try:
                config = self.configuration()
                facts.update(ready=facts['qemu_available'] and facts['kvm_accessible'],baseline_id=config['baseline_id'],
                             memory_mb=config['memory_mb'],cpus=config['cpus'],tools=config.get('tools',{}))
            except (OSError,ValueError,KeyError) as error:
                facts['error'] = str(error)
        return facts

    # @chain-region VMHost.directory | calls: ID.fullmatch, ValueError, isinstance
    def directory(self, identifier):
        if not isinstance(identifier,str) or not ID.fullmatch(identifier): raise ValueError('invalid_vm_operation')
        return self.runs/identifier

    # @chain-region VMHost.submit | calls: (folder / 'worker.log').open, (payload['owner'] + '\n' + request_id).encode, (payload['snapshot'] + script + config['baseline_id']).encode, Path, Path(__file__).resolve, Path(payload['path']).resolve, ValueError, any …
    def submit(self, payload):
        config = self.configuration()
        files = source.validate_manifest(payload['files'])
        if source.digest(source.canonical(files).encode()) != payload.get('manifest_sha256'):
            raise ValueError('vm_source_manifest_mismatch')
        if not source.HEX.fullmatch(payload.get('owner','')) or not source.HEX.fullmatch(payload.get('snapshot','')):
            raise ValueError('vm_source_identity_required')
        script = payload.get('script')
        if not isinstance(script,str) or not 1 <= len(script.encode()) <= 65536 or '\0' in script: raise ValueError('invalid_vm_script')
        timeout = payload.get('timeout',900)
        if type(timeout) is not int or not 1 <= timeout <= 1200: raise ValueError('invalid_vm_timeout')
        request_id = payload.get('request_id') or source.digest((payload['snapshot']+script+config['baseline_id']).encode())
        if not isinstance(request_id,str) or not 1 <= len(request_id) <= 100: raise ValueError('invalid_vm_request_id')
        artifacts = payload.get('artifacts',[])
        if not isinstance(artifacts,list) or len(artifacts)>16 or any(not isinstance(p,str) for p in artifacts) or len(set(artifacts)) != len(artifacts): raise ValueError('invalid_vm_artifacts')
        for name in artifacts: source.artifact_path(name)
        identity = {k:payload[k] for k in ('owner','snapshot','manifest_sha256')}
        environment = {'baseline_id':config['baseline_id'],'image_sha256':config['image_sha256'],
                       'runner_sha256':config['guest_runner_sha256'],'tools':config.get('tools',{}),
                       'network':'none','host_mounts':False,'cpus':config['cpus'],'memory_mb':config['memory_mb']}
        identity.update(request_id=request_id,script=script,timeout=timeout,baseline_id=config['baseline_id'],artifacts=artifacts,environment=environment)
        identifier = source.digest((payload['owner']+'\n'+request_id).encode())[:32]
        folder = self.directory(identifier)
        body_hash = source.digest(source.canonical(identity).encode())
        with exclusive(self.root/'submit.lock'):
            if folder.exists():
                prior = document(folder/'state.json')
                if prior.get('body_hash') != body_hash: raise ValueError('vm_request_content_conflict')
                return self.status(identifier,payload['owner']) | {'recovered':True}
            if sum(1 for p in self.runs.glob('*/state.json') if document(p).get('state') not in TERMINAL) >= 8:
                raise ValueError('vm_queue_full')
            staging = self.runs/('.preparing-'+identifier+'-'+secrets.token_hex(8))
            staging.mkdir(mode=0o700)
            try:
                tree = Path(payload['path']).resolve();plain(tree,True)
                archive = staging/'source.tar.gz'
                with tarfile.open(archive,'w:gz',format=tarfile.PAX_FORMAT) as out:
                    total = 0
                    for name, digest in sorted(files.items()):
                        path = tree/name
                        for parent in path.relative_to(tree).parents:
                            plain(tree/parent,True)
                        info = plain(path)
                        if info.st_size > source.MAX_FILE: raise ValueError('source_file_too_large')
                        raw = path.read_bytes();total += len(raw)
                        if source.digest(raw) != digest or total > source.MAX_TREE: raise ValueError('vm_source_changed')
                        member = tarfile.TarInfo(name);member.size=len(raw);member.mode=0o644
                        out.addfile(member,io.BytesIO(raw))
                request = {**payload,**identity,'operation':identifier,'archive_sha256':digest_file(archive)}
                atomic(staging/'request.json',request)
                state = {'id':identifier,'owner':payload['owner'],'state':'queued','body_hash':body_hash,
                         'snapshot':payload['snapshot'],'manifest_sha256':payload['manifest_sha256'],
                         'baseline_id':config['baseline_id'],'created':time.time(),'updated':time.time(),
                         'next_poll_seconds':3,'actual_vm':False,'code':None}
                atomic(staging/'state.json',state)
                staging.rename(folder)
            finally:
                if staging.exists(): shutil.rmtree(staging)
            with (folder/'worker.log').open('ab') as log:
                try:
                    worker = subprocess.Popen([sys.executable,'-B',str(Path(__file__).resolve()),'--config',str(self.config_path),'--worker',identifier],
                                              stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
                except OSError:
                    return self._update(folder,state='interrupted',error='vm_worker_could_not_start')
            atomic(folder/'worker.json',{'pid':worker.pid,'operation':identifier})
            return state | {'worker_pid':worker.pid}

    # @chain-region VMHost._update | calls: atomic, document, state.update, time.time
    def _update(self, folder, **changes):
        state = document(folder/'state.json');state.update(changes,updated=time.time());atomic(folder/'state.json',state)
        return state

    # @chain-region VMHost.status | calls: (folder / 'worker.json').is_file, Path, ValueError, command.exists, command.read_bytes, document, document(folder / 'worker.json').get, identifier.encode …
    def status(self, identifier, owner):
        folder = self.directory(identifier)
        value = document(folder/'state.json')
        if value.get('owner') != owner: raise ValueError('own_vm_operation_required')
        pid = value.get('worker_pid')
        if not pid and (folder/'worker.json').is_file(): pid = document(folder/'worker.json').get('pid')
        if value['state'] not in TERMINAL and pid:
            command = Path('/proc')/str(pid)/'cmdline'
            active = command.exists() and identifier.encode() in command.read_bytes()
            if not active:
                monitor = folder/'monitor.sock'
                try:
                    if qmp(monitor,'query-uuid').get('UUID') == str(uuid.UUID(hex=identifier)):
                        qmp(monitor,'quit')
                except (OSError,ValueError,TimeoutError): pass
                value = self._update(folder,state='interrupted',error='vm_worker_stopped_evidence_preserved')
        return value

    # @chain-region VMHost.cancel | calls: atomic, self.directory, self.status, time.time
    def cancel(self, identifier, owner):
        value = self.status(identifier,owner)
        if value['state'] in TERMINAL: return value
        atomic(self.directory(identifier)/'cancel.json',{'requested':time.time()})
        return value | {'cancel_requested':True}

    # @chain-region VMHost.logs | calls: ValueError, len, path.exists, path.open, path.stat, plain, raw.decode, self.directory …
    def logs(self, identifier, owner, offset=0):
        value = self.status(identifier,owner)
        if type(offset) is not int or offset < 0: raise ValueError('invalid_log_offset')
        path = self.directory(identifier)/'output.log'
        raw = b''
        if path.exists():
            plain(path)
            with path.open('rb') as stream:
                stream.seek(offset);raw=stream.read(32768)
        return {'id':identifier,'state':value['state'],'offset':offset,'next_offset':offset+len(raw) if path.exists() and offset+len(raw)<path.stat().st_size else None,
                'text':raw.decode('utf-8',errors='replace'),'bytes':len(raw),'source_snapshot':value['snapshot']}

    # @chain-region VMHost.evidence | calls: ValueError, digest_file, document, self.directory, self.status, source.HEX.fullmatch, state.get
    def evidence(self, identifier, owner, revision):
        state = self.status(identifier,owner)
        if not source.HEX.fullmatch(revision or ''): raise ValueError('invalid_source_revision')
        if state['state'] not in ('passed','failed') or not state.get('actual_vm') or not state.get('result_sha256'):
            raise ValueError('actual_completed_vm_result_required')
        folder = self.directory(identifier)
        if digest_file(folder/'result.json') != state['result_sha256'] or digest_file(folder/'output.log') != state['log_sha256']:
            raise ValueError('local_vm_evidence_changed')
        request, result = document(folder/'request.json'),document(folder/'result.json')
        return {'schema':2,'revision':revision,'script':request['script'],'execution':result,
                'environment':request['environment'],'observation':state['vm_observation']}

    # @chain-region VMHost.preview | calls: ValueError, digest_file, path.stat, plain, self.directory, self.status, state.get, str
    def preview(self, identifier, owner):
        state=self.status(identifier,owner)
        path=self.directory(identifier)/'console.png'
        if not state.get('console_sha256'): raise ValueError('vm_console_preview_unavailable')
        plain(path)
        if path.stat().st_size>2*1024*1024 or digest_file(path)!=state['console_sha256']:
            raise ValueError('local_vm_preview_changed')
        return {'file':str(path),'sha256':state['console_sha256'],'kind':'actual_vm_console',
                'description':'实际虚拟机控制台中的执行日志；不是图形 OS 桌面。'}

    # @chain-region VMHost.inspect | calls: (self.directory(identifier) / 'output.log').is_file, (self.directory(identifier) / 'output.log').stat, Path, Path(preview['file']).read_bytes, base64.b64encode, base64.b64encode(Path(preview['file']).read_bytes()).decode, preview.items, self.directory …
    def inspect(self, identifier, owner, offset=0):
        state=self.status(identifier,owner)
        size=(self.directory(identifier)/'output.log').stat().st_size if (self.directory(identifier)/'output.log').is_file() else 0
        value={'run':state,'logs':self.logs(identifier,owner,offset)}
        if state.get('console_sha256'):
            preview=self.preview(identifier,owner)
            value['preview']={k:v for k,v in preview.items() if k!='file'}
            value['preview']['data']='data:image/png;base64,'+base64.b64encode(Path(preview['file']).read_bytes()).decode()
        return value

    # @chain-region VMHost.export | calls: Path, Path(destination).expanduser, Path(destination).expanduser().absolute, ValueError, digest_file, document, incoming.read, iter …
    def export(self, identifier, owner, name, destination):
        state = self.status(identifier,owner)
        if state['state'] != 'passed' or state.get('actual_vm') is not True: raise ValueError('passing_vm_artifact_required')
        name = source.artifact_path(name)
        folder = self.directory(identifier)
        result = document(folder/'result.json')
        if (digest_file(folder/'result.json') != state.get('result_sha256') or
            digest_file(folder/'output.log') != state.get('log_sha256')): raise ValueError('local_vm_evidence_changed')
        item = next((row for row in result.get('artifacts',[]) if row['path']==name),None)
        if not item: raise ValueError('vm_artifact_not_recorded')
        original = folder/'artifacts'/name
        for parent in original.relative_to(folder).parents: plain(folder/parent,True)
        info = plain(original)
        if info.st_size != item['bytes'] or digest_file(original) != item['sha256']: raise ValueError('vm_artifact_digest_mismatch')
        target = Path(destination).expanduser().absolute()
        target.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        if target.exists() or target.is_symlink():
            plain(target)
            if digest_file(target) != item['sha256']: raise ValueError('artifact_destination_exists')
            return {**item,'file':str(target),'verified':True,'reused':True,'executed':False}
        temporary = target.with_name(target.name+'.'+secrets.token_hex(8)+'.partial')
        try:
            with original.open('rb') as incoming,temporary.open('xb') as output:
                for chunk in iter(lambda:incoming.read(1024*1024),b''): output.write(chunk)
                output.flush();os.fsync(output.fileno())
            if digest_file(temporary) != item['sha256']: raise ValueError('vm_artifact_digest_mismatch')
            os.link(temporary,target)
        finally: temporary.unlink(missing_ok=True)
        return {**item,'file':str(target),'verified':True,'executed':False}

    # @chain-region VMHost.dashboard | calls: ValueError, document, len, p.stat, rows.append, self.doctor, self.runs.glob, self.status …
    def dashboard(self, owner):
        if not source.HEX.fullmatch(owner or ''): raise ValueError('invalid_vm_account')
        rows=[]
        for file in sorted(self.runs.glob('*/state.json'),key=lambda p:p.stat().st_mtime,reverse=True):
            state=document(file)
            if state.get('owner') != owner: continue
            state=self.status(state['id'],owner)
            rows.append({k:state.get(k) for k in ('id','state','snapshot','created','updated','finished','actual_vm','code','error','source_unchanged','memory_mb','console_sha256')})
            if len(rows)>=30:break
        return {'environment':self.doctor(),'runs':rows,'scope':'current_account','read_only':True}

    # @chain-region VMHost.worker | calls: (folder / 'cancel.json').exists, ValueError, exclusive, os.getpid, self._execute, self._update, self.directory, str …
    def worker(self, identifier):
        folder = self.directory(identifier)
        process = None
        try:
            self._update(folder,worker_pid=os.getpid())
            deadline = time.monotonic()+1200
            while True:
                if (folder/'cancel.json').exists(): self._update(folder,state='cancelled');return
                try:
                    with exclusive(self.root/'execution.lock'):
                        self._execute(folder)
                    return
                except ValueError as error:
                    reason = str(error)
                    if reason not in ('workspace_busy','vm_insufficient_host_memory_headroom','vm_host_cpu_headroom_required'): raise
                    if time.monotonic() >= deadline: raise ValueError('vm_queue_timeout')
                    if reason != 'workspace_busy':
                        self._update(folder,state='waiting_resources',wait_reason=reason,next_poll_seconds=10)
                    time.sleep(5 if reason != 'workspace_busy' else 1)
        except BaseException as error:
            self._update(folder,state='failed',error=str(error)[:200],error_type=type(error).__name__)

    # @chain-region VMHost._execute | calls: (folder / 'cancel.json').exists, (folder / 'qemu.log').open, (folder / 'source.tar.gz').read_bytes, Path, ValueError, atomic, digest.hexdigest, digest.update …
    def _execute(self, folder):
        request = document(folder/'request.json')
        config = self.configuration()
        if (request['environment']['baseline_id']!=config['baseline_id'] or
            request['environment']['image_sha256']!=config['image_sha256'] or
            request['environment']['runner_sha256']!=config['guest_runner_sha256']):
            raise ValueError('vm_queued_baseline_changed_resubmit_required')
        actual_memory, resources = resource_budget(config['memory_mb'])
        self._update(folder,state='booting',resource_sample=resources,memory_mb=actual_memory,wait_reason=None,next_poll_seconds=3)
        request['environment']['memory_mb'] = actual_memory
        atomic(folder/'request.json',request)
        disk = folder/'work.qcow2'
        subprocess.run(['qemu-img','create','-q','-f','qcow2','-F','qcow2','-b',config['image'],str(disk)],check=True,timeout=30)
        monitor, agent = folder/'monitor.sock',folder/'guest.sock'
        command = ['qemu-system-x86_64','-name','Aieyra-Link-'+request['operation'],'-uuid',str(uuid.UUID(hex=request['operation'])),
                   '-machine','q35,accel=kvm','-cpu','host','-smp','1','-m',str(actual_memory),
                   '-drive','file='+str(disk)+',format=qcow2,if=virtio','-net','none','-display','none','-monitor','none',
                   '-qmp','unix:'+str(monitor)+',server=on,wait=off','-chardev','socket,path='+str(agent)+',server=on,wait=off,id=qga0',
                   '-device','virtio-serial-pci','-device','virtserialport,chardev=qga0,name=org.qemu.guest_agent.0',
                   '-serial','file:'+str(folder/'console.log'),'-no-reboot']
        with (folder/'qemu.log').open('ab') as log:
            process = subprocess.Popen(command,stdin=subprocess.DEVNULL,stdout=log,stderr=log)
        try:
            boot_deadline = time.monotonic()+120
            while True:
                if (folder/'cancel.json').exists(): self._update(folder,state='cancelled');return
                if process.poll() is not None: raise ValueError('local_vm_exited_during_boot')
                try: guest(agent,'guest-ping');break
                except (OSError,ValueError,TimeoutError):
                    if time.monotonic() >= boot_deadline: raise ValueError('local_vm_guest_boot_timeout')
                    time.sleep(1)
            observed = {'uuid':qmp(monitor,'query-uuid')['UUID'],'kvm':qmp(monitor,'query-kvm')}
            if observed['uuid'] != str(uuid.UUID(hex=request['operation'])) or observed['kvm'].get('enabled') is not True:
                raise ValueError('local_vm_identity_or_acceleration_mismatch')
            self._update(folder,state='transferring',actual_vm=True,vm_observation=observed)
            guest_write(agent,'/work/control/source.tar.gz',(folder/'source.tar.gz').read_bytes())
            guest_write(agent,'/work/control/request.json',source.canonical(request).encode())
            executed = guest(agent,'guest-exec',{'path':'/usr/bin/python3','arg':['-I','/opt/aieyra-link/vm_guest.py','/work/control/request.json'],'capture-output':True})
            pid = executed.get('pid')
            if type(pid) is not int or pid < 1: raise ValueError('vm_guest_process_identity_missing')
            self._update(folder,state='running',guest_pid=pid)
            execution_deadline = time.monotonic()+request['timeout']+60
            log_path = '/work/results/'+request['operation']+'/output.log'
            local_log = folder/'output.log';local_log.touch(mode=0o600)
            while True:
                if (folder/'cancel.json').exists(): self._update(folder,state='cancelled');return
                if time.monotonic() > execution_deadline: raise ValueError('vm_guest_execution_timeout')
                state = guest(agent,'guest-exec-status',{'pid':pid})
                try:
                    chunk = guest_read(agent,log_path,65536,local_log.stat().st_size)
                    if local_log.stat().st_size+len(chunk)>MAX_LOG: raise ValueError('vm_output_limit')
                    with local_log.open('ab') as output: output.write(chunk)
                except ValueError as error:
                    if str(error) != 'vm_guest_command_rejected': raise
                if state.get('exited'):
                    if state.get('exitcode') != 0:
                        atomic(folder/'guest-exit.json',state)
                        raise ValueError('vm_guest_runner_failed')
                    break
                time.sleep(1)
            while True:
                chunk = guest_read(agent,log_path,65536,local_log.stat().st_size)
                if not chunk: break
                if local_log.stat().st_size+len(chunk)>MAX_LOG: raise ValueError('vm_output_limit')
                with local_log.open('ab') as output: output.write(chunk)
            raw = guest_read(agent,'/work/results/'+request['operation']+'/result.json',262144)
            report = json.loads(raw)
            if (not isinstance(report,dict) or report.get('operation') != request['operation'] or
                report.get('snapshot') != request['snapshot'] or report.get('manifest_sha256') != request['manifest_sha256'] or
                report.get('script_sha256') != source.digest(request['script'].encode()) or
                report.get('log_sha256') != digest_file(local_log) or report.get('log_bytes') != local_log.stat().st_size):
                raise ValueError('vm_evidence_identity_mismatch')
            atomic(folder/'result.json',report)
            artifacts = report.get('artifacts',[])
            if (not isinstance(artifacts,list) or len(artifacts)>16 or
                [item.get('path') for item in artifacts] != request.get('artifacts',[]) and report.get('passed') is True):
                raise ValueError('vm_artifact_manifest_mismatch')
            total = 0
            for item in artifacts:
                name = source.artifact_path(item.get('path'))
                if (type(item.get('bytes')) is not int or not 0 < item['bytes'] <= source.MAX_ARTIFACT or
                    not source.HEX.fullmatch(item.get('sha256',''))): raise ValueError('vm_artifact_manifest_invalid')
                total += item['bytes']
                if total>source.MAX_ARTIFACTS: raise ValueError('vm_artifact_capacity')
                target = folder/'artifacts'/name;target.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
                digest = hashlib.sha256();count = 0
                with target.open('xb') as output:
                    while count<item['bytes']:
                        chunk = guest_read(agent,'/work/results/'+request['operation']+'/artifacts/'+name,min(65536,item['bytes']-count),count)
                        if not chunk: raise ValueError('vm_artifact_short_read')
                        digest.update(chunk);output.write(chunk);count += len(chunk)
                if digest.hexdigest() != item['sha256']: raise ValueError('vm_artifact_digest_mismatch')
            passed = (report.get('passed') is True and type(report.get('code')) is int and report['code'] == 0 and
                      report.get('timed_out') is False and report.get('source_unchanged') is True and
                      report.get('source_changed') == [] and report.get('log_truncated') is False)
            passed = passed and report.get('artifact_error') is None
            # Render the actual, bounded execution log on the guest console. The
            # trusted controller only displays printable text; source cannot
            # supply terminal escape sequences or a host screenshot path.
            try:
                renderer="from pathlib import Path; import sys; t=Path(sys.argv[1]).read_text(errors='replace')[-4000:]; t=''.join(c if c.isprintable() or c=='\\n' else ' ' for c in t); Path('/dev/tty1').write_text('\\x1b[2J\\x1b[HAieyra Link - actual VM execution log\\n'+t)"
                rendered=guest(agent,'guest-exec',{'path':'/usr/bin/python3','arg':['-I','-c',renderer,log_path],'capture-output':True})
                for _ in range(20):
                    if guest(agent,'guest-exec-status',{'pid':rendered['pid']}).get('exited'): break
                    time.sleep(.1)
                qmp(monitor,'screendump',{'filename':str(folder/'console.png'),'format':'png'})
                self._update(folder,console_sha256=digest_file(folder/'console.png'))
            except (OSError,ValueError,KeyError,TimeoutError):
                self._update(folder,console_error='vm_console_preview_unavailable')
            self._update(folder,state='passed' if passed else 'failed',code=report.get('code'),
                         result_sha256=digest_file(folder/'result.json'),log_sha256=digest_file(local_log),
                         finished=time.time(),evidence='result.json',source_unchanged=report.get('source_unchanged'))
        finally:
            if process.poll() is None:
                try: qmp(monitor,'quit')
                except (OSError,ValueError,TimeoutError): process.terminate()
                try: process.wait(timeout=10)
                except subprocess.TimeoutExpired: process.kill();process.wait(timeout=5)
            atomic(folder/'vm-exit.json',{'code':process.returncode,'owned_process':True,'network':'none','host_mounts':False})
            if hasattr(os,'posix_fadvise'):
                for path in (disk,Path(config['image'])):
                    try:
                        with path.open('rb') as stream: os.posix_fadvise(stream.fileno(),0,0,os.POSIX_FADV_DONTNEED)
                    except OSError: pass


# @chain-region bridge | calls: Path, Path(__file__).resolve, VMHost, ValueError, dispatch, json.loads, len, match[1].lower …
def bridge(action, payload):
    if os.name != 'nt':
        return dispatch(VMHost(),action,payload)
    # WSL is the local VM host. No user script is interpolated into a host shell.
    controller = str(Path(__file__).resolve())
    match = re.match(r'^([A-Za-z]):[\\/](.*)$',controller)
    if not match: raise ValueError('wsl_controller_requires_local_drive_path')
    linux_controller = '/mnt/'+match[1].lower()+'/'+match[2].replace('\\','/')
    for field in ('path','destination'):
        if payload.get(field):
            match = re.match(r'^([A-Za-z]):[\\/](.*)$',payload[field])
            if not match: raise ValueError('wsl_source_requires_local_drive_path')
            payload = {**payload,field:'/mnt/'+match[1].lower()+'/'+match[2].replace('\\','/')}
    command = ['wsl.exe','-d','Ubuntu-24.04','--','python3','-B',linux_controller,'--rpc']
    result = subprocess.run(command,input=source.canonical({'action':action,'payload':payload}).encode(),
                            stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=1800 if action == 'prepare' else 90)
    if len(result.stdout)>2*1024*1024: raise ValueError('vm_bridge_response_limit')
    if result.returncode: raise ValueError('local_vm_host_unavailable')
    response = json.loads(result.stdout)
    if response.get('error'): raise ValueError(response['error'])
    return response


# @chain-region dispatch | calls: ValueError, host.cancel, host.dashboard, host.doctor, host.evidence, host.export, host.inspect, host.logs …
def dispatch(host, action, payload):
    if action == 'doctor': return host.doctor()
    if action == 'prepare':
        try:
            from .prepare_vm import prepare
        except ImportError:
            from prepare_vm import prepare
        return prepare(payload,host.config_path)
    if action == 'submit': return host.submit(payload)
    if action == 'status': return host.status(payload['id'],payload['owner'])
    if action == 'cancel': return host.cancel(payload['id'],payload['owner'])
    if action == 'logs': return host.logs(payload['id'],payload['owner'],payload.get('offset',0))
    if action == 'evidence': return host.evidence(payload['id'],payload['owner'],payload['revision'])
    if action == 'preview': return host.preview(payload['id'],payload['owner'])
    if action == 'inspect': return host.inspect(payload['id'],payload['owner'],payload.get('offset',0))
    if action == 'export': return host.export(payload['id'],payload['owner'],payload['artifact'],payload['destination'])
    if action == 'dashboard': return host.dashboard(payload['owner'])
    raise ValueError('vm_operation_denied')


# @chain-region add_parser | calls: commands.add_parser, parser.add_argument
def add_parser(commands):
    parser = commands.add_parser('vm',help='Run a fixed source snapshot inside a real local VM')
    parser.add_argument('operation',choices=['doctor','prepare','run','status','logs','cancel','evidence','report','export','preview'])
    parser.add_argument('--id');parser.add_argument('--snapshot');parser.add_argument('--script-file',type=Path)
    parser.add_argument('--timeout',type=int,default=900);parser.add_argument('--request-id')
    parser.add_argument('--offset',type=int,default=0)
    parser.add_argument('--revision');parser.add_argument('--summary');parser.add_argument('--artifacts-file',type=Path)
    parser.add_argument('--artifact');parser.add_argument('--file',type=Path)


# @chain-region run | calls: ('vm-report:' + args.revision + args.id).encode, ValueError, Workspaces, args.artifacts_file.read_text, args.file.absolute, args.script_file.read_text, args.script_file.stat, bridge …
def run(args, secret):
    try:
        from .workspace import Workspaces
    except ImportError:
        from workspace import Workspaces
    work = Workspaces(secret)
    owner = source.digest(source.canonical(work.scope).encode())
    if args.operation == 'doctor': return bridge('doctor',{})
    if args.operation in ('run','prepare'):
        preview = work.preview(args.snapshot)
        snapshot = document(work._path('snapshots',args.snapshot,'.json'))
        if args.operation == 'prepare': return bridge('prepare',{**preview,'files':snapshot['files']})
        if not args.script_file: raise ValueError('vm_script_file_required')
        plain(args.script_file)
        if args.script_file.stat().st_size>65536: raise ValueError('vm_script_too_large')
        artifacts = json.loads(args.artifacts_file.read_text(encoding='utf-8-sig')) if args.artifacts_file else []
        return bridge('submit',{**preview,'files':snapshot['files'],'script':args.script_file.read_text(encoding='utf-8-sig'),
                                'owner':owner,'timeout':args.timeout,'request_id':args.request_id,'artifacts':artifacts})
    if not args.id: raise ValueError('vm_operation_id_required')
    if args.operation == 'export':
        if not args.file: raise ValueError('artifact_destination_required')
        return bridge('export',{'id':args.id,'owner':owner,'artifact':args.artifact,'destination':str(args.file.absolute())})
    if args.operation in ('evidence','report'):
        evidence = bridge('evidence',{'id':args.id,'owner':owner,'revision':args.revision})
        if args.operation == 'evidence': return evidence
        downloaded = work.download(args.revision)
        if source.digest(source.canonical(downloaded['files']).encode()) != evidence['execution']['manifest_sha256']:
            raise ValueError('vm_result_does_not_match_cloud_revision')
        body = {'request_id':args.request_id or source.digest(('vm-report:'+args.revision+args.id).encode()),
                'revision':args.revision,'evidence':evidence,'summary':args.summary or '固定源码在本机隔离VM中执行，结果与日志摘要见证据。',
                'outcome':'pass' if evidence['execution']['passed'] else 'fail'}
        return work.call('/engineering/verify',body)
    return bridge(args.operation,{'id':args.id,'owner':owner,'offset':args.offset})


# @chain-region main | calls: VMHost, ValueError, argparse.ArgumentParser, bridge, dispatch, host.doctor, host.worker, json.loads …
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config',type=Path);parser.add_argument('--worker');parser.add_argument('--rpc',action='store_true');parser.add_argument('--bridge-rpc',action='store_true')
    args = parser.parse_args()
    try:
        if args.bridge_rpc:
            request=json.loads(sys.stdin.buffer.read(2*1024*1024+1))
            if request.get('action') not in ('dashboard','inspect'): raise ValueError('desktop_vm_operation_denied')
            result=bridge(request['action'],request.get('payload',{}));print(source.canonical(result));return 0
        host = VMHost(args.config)
        if args.worker: host.worker(args.worker);return 0
        if args.rpc:
            request = json.loads(sys.stdin.buffer.read(2*1024*1024+1))
            result = dispatch(host,request['action'],request.get('payload',{}))
        else: result = host.doctor()
        print(source.canonical(result));return 0
    except (OSError,ValueError,KeyError,subprocess.SubprocessError) as error:
        print(source.canonical({'error':str(error)[:200]}));return 1


if __name__ == '__main__':raise SystemExit(main())
