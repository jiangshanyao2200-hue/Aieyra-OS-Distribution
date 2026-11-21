# @file-map:start
# 文件: link/agent/local_runner.py
# 位置: 二环·Agent完整链路 | 协作CLI、接续、实际启动器、工作包、源码传输和本机运行。
# 约束: 使用本人已有身份和connection，不因压缩重建身份；写操作保留request_id；未知结果查回执，凭据不进入日志与文档
# 下游: link/agent/proposal.py, link/agent/source_protocol.py, link/agent/workspace.py
# 上游: AIDEBUG/live-experiment.py, AIDEBUG/practice-experiment.py, link/agent/appcontainer.py, link/agent/live_work.py, link/agent/local_preview.py, link/agent/proposal.py, tests/test_live_work.py, tests/test_local_preview.py, tests/test_local_runner.py
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: AIDEBUG/live-experiment.py, AIDEBUG/practice-experiment.py, tests/test_live_work.py, tests/test_local_preview.py, tests/test_local_runner.py
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   plan | function
#   environment | function
#   available | function
#   available.Memory | class
#   WindowsJob | class
#   WindowsJob.__init__ | function
#   WindowsJob.__init__.Basic | class
#   WindowsJob.__init__.IO | class
#   WindowsJob.__init__.Extended | class
#   WindowsJob.close | function
#   stop | function
#   process_alive | function
#   guard | function
#   original_manifest | function
#   LocalRunner | class
#   LocalRunner.__init__ | function
#   LocalRunner.path | function
#   LocalRunner.start | function
#   LocalRunner.list | function
#   LocalRunner.inspect | function
#   LocalRunner.logs | function
#   LocalRunner.cancel | function
#   LocalRunner.evidence | function
#   LocalRunner.report | function
#   worker | function
#   worker.save | function
#   dashboard | function
#   add_parser | function
#   run | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Asynchronous local project execution on a fixed source copy; not an OS sandbox."""
from __future__ import annotations

import argparse
import base64
import json
import os
from pathlib import Path
import platform
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
import uuid

if not __package__:
    sys.path.insert(0,str(Path(__file__).resolve().parent))
try:
    from . import source_protocol as source
    from .workspace import Workspaces, atomic, document, exclusive, plain
except ImportError:
    import source_protocol as source
    from workspace import Workspaces, atomic, document, exclusive, plain

TERMINAL = {'passed','failed','cancelled','interrupted'}
MAX_LOG = 1024*1024


# @chain-region plan | calls: source.execution_plan
def plan(value):
    return source.execution_plan(value)

# @chain-region environment | calls: Path, result.update, str, temporary.mkdir
def environment(tree=None):
    # A project process receives toolchain essentials, never Link credentials.
    names=('PATH','Path','SystemRoot','WINDIR','PATHEXT','SYSTEMDRIVE')
    result={k:os.environ[k] for k in names if k in os.environ}
    result.update(PYTHONUTF8='1',PYTHONDONTWRITEBYTECODE='1',PYTHONNOUSERSITE='1',
                  OMP_NUM_THREADS='1',GOMAXPROCS='1',NO_COLOR='1')
    if tree is not None:
        temporary=Path(tree).parent/'temporary'
        temporary.mkdir(exist_ok=True)
        result.update(TEMP=str(temporary),TMP=str(temporary),TMPDIR=str(temporary))
        result.update(GOCACHE=str(temporary/'go-cache'),GOPATH=str(temporary/'go-path'))
    return result


# @chain-region available | calls: Memory, Path, Path('/proc/meminfo').is_file, Path('/proc/meminfo').read_text, Path('/proc/meminfo').read_text().splitlines, ctypes.byref, ctypes.sizeof, ctypes.windll.kernel32.GlobalMemoryStatusEx …
def available():
    """Soft admission check; this is not a system-wide resource reservation."""
    try:
        if os.name=='nt':
            import ctypes
            # @chain-region available.Memory
            class Memory(ctypes.Structure):
                _fields_=[('length',ctypes.c_ulong),('load',ctypes.c_ulong)]+[(name,ctypes.c_ulonglong) for name in
                    ('total','free','page_total','page_free','virtual_total','virtual_free','extended')]
            memory=Memory();memory.length=ctypes.sizeof(memory)
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(memory)):
                return memory.free>=memory.total*0.2
        elif Path('/proc/meminfo').is_file():
            values={line.split(':')[0]:int(line.split()[1]) for line in Path('/proc/meminfo').read_text().splitlines() if len(line.split())>=2}
            return values['MemAvailable']>=values['MemTotal']*0.2
    except (OSError,ValueError,KeyError):
        pass
    return False


# @chain-region WindowsJob | calls: Extended, ValueError, ctypes.WinDLL, ctypes.byref, ctypes.sizeof, int, kernel.AssignProcessToJobObject, kernel.CloseHandle …
class WindowsJob:
    """Keep only the processes created for this run in a kill-on-close job."""
    # @chain-region WindowsJob.__init__ | calls: Extended, ValueError, ctypes.WinDLL, ctypes.byref, ctypes.sizeof, int, kernel.AssignProcessToJobObject, kernel.CloseHandle …
    def __init__(self, process):
        self.handle=None
        if os.name!='nt':
            return
        import ctypes
        from ctypes import wintypes as w
        # @chain-region WindowsJob.__init__.Basic
        class Basic(ctypes.Structure):
            _fields_=[('process_time',ctypes.c_int64),('job_time',ctypes.c_int64),('flags',w.DWORD),
                ('minimum',ctypes.c_size_t),('maximum',ctypes.c_size_t),('active',w.DWORD),
                ('affinity',ctypes.c_size_t),('priority',w.DWORD),('scheduling',w.DWORD)]
        # @chain-region WindowsJob.__init__.IO
        class IO(ctypes.Structure):
            _fields_=[(n,ctypes.c_uint64) for n in ('read_ops','write_ops','other_ops','read_bytes','write_bytes','other_bytes')]
        # @chain-region WindowsJob.__init__.Extended
        class Extended(ctypes.Structure):
            _fields_=[('basic',Basic),('io',IO),('process_memory',ctypes.c_size_t),('job_memory',ctypes.c_size_t),
                      ('peak_process',ctypes.c_size_t),('peak_job',ctypes.c_size_t)]
        kernel=ctypes.WinDLL('kernel32',use_last_error=True)
        kernel.CreateJobObjectW.argtypes=[ctypes.c_void_p,w.LPCWSTR];kernel.CreateJobObjectW.restype=w.HANDLE
        kernel.SetInformationJobObject.argtypes=[w.HANDLE,ctypes.c_int,ctypes.c_void_p,w.DWORD]
        kernel.AssignProcessToJobObject.argtypes=[w.HANDLE,w.HANDLE]
        kernel.CloseHandle.argtypes=[w.HANDLE]
        handle=kernel.CreateJobObjectW(None,None)
        info=Extended();info.basic.flags=0x2000
        if not handle or not kernel.SetInformationJobObject(handle,9,ctypes.byref(info),ctypes.sizeof(info)):
            if handle:kernel.CloseHandle(handle)
            raise ValueError('local_process_job_unavailable')
        if not kernel.AssignProcessToJobObject(handle,int(process._handle)):
            kernel.CloseHandle(handle)
            if process.poll() is None:
                process.kill();process.wait(timeout=5)
            raise ValueError('local_process_job_assignment_failed')
        self.handle=handle;self.kernel=kernel

    # @chain-region WindowsJob.close | calls: self.kernel.CloseHandle
    def close(self):
        if self.handle:
            self.kernel.CloseHandle(self.handle);self.handle=None


# @chain-region stop | calls: getattr, job.close, os.killpg, process.kill, process.poll, process.stdin.close, process.wait
def stop(process, job=None):
    if job is not None:
        job.close()
    if getattr(process,'_link_guard',False):
        if process.stdin and not process.stdin.closed:process.stdin.close()
        try:process.wait(timeout=5)
        except subprocess.TimeoutExpired:process.kill();process.wait(timeout=5)
        return
    if os.name!='nt':
        try:os.killpg(process.pid,signal.SIGKILL)
        except ProcessLookupError:pass
    elif process.poll() is None:
        process.kill()
    try:process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill();process.wait(timeout=5)


# @chain-region process_alive | calls: Path, bool, ctypes.POINTER, ctypes.WinDLL, ctypes.byref, kernel.CloseHandle, kernel.GetExitCodeProcess, kernel.OpenProcess …
def process_alive(pid):
    if type(pid) is not int or pid<=0:return False
    if os.name=='nt':
        import ctypes
        from ctypes import wintypes as w
        kernel=ctypes.WinDLL('kernel32',use_last_error=True)
        kernel.OpenProcess.argtypes=[w.DWORD,w.BOOL,w.DWORD];kernel.OpenProcess.restype=w.HANDLE
        kernel.GetExitCodeProcess.argtypes=[w.HANDLE,ctypes.POINTER(w.DWORD)];kernel.CloseHandle.argtypes=[w.HANDLE]
        handle=kernel.OpenProcess(0x1000,False,pid)
        if not handle:return False
        try:
            code=w.DWORD();return bool(kernel.GetExitCodeProcess(handle,ctypes.byref(code))) and code.value==259
        finally:kernel.CloseHandle(handle)
    try:
        state=Path('/proc')/str(pid)/'stat'
        if state.is_file() and state.read_text().rsplit(')',1)[1].strip().split()[0]=='Z':return False
        os.kill(pid,0);return True
    except (OSError,ValueError):return False


# @chain-region guard | calls: child.poll, hasattr, min, os.read, os.sched_getaffinity, os.sched_setaffinity, select.select, stop …
def guard(argv):
    # EOF on this private pipe also arrives when the worker dies unexpectedly.
    # The guardian owns and reaps exactly the process group it created.
    import select
    if hasattr(os,'sched_setaffinity'):
        os.sched_setaffinity(0,{min(os.sched_getaffinity(0))})
    child=subprocess.Popen(argv,stdin=subprocess.DEVNULL,start_new_session=True)
    try:
        while child.poll() is None:
            ready,_,_=select.select([sys.stdin.buffer],[],[],.05)
            if ready and not os.read(sys.stdin.fileno(),1):return 125
        return child.returncode if child.returncode>=0 else 128-child.returncode
    finally:stop(child)


# @chain-region original_manifest | calls: file.read_bytes, plain, source.digest
def original_manifest(tree, files):
    current={}
    for name in files:
        file=tree/name
        try:
            plain(file)
            for parent in file.parents:
                if parent==tree:break
                plain(parent,True)
            current[name]=source.digest(file.read_bytes())
        except (OSError,ValueError):
            current[name]=None
    return current


# @chain-region LocalRunner | calls: (folder / 'output.log').read_bytes, (folder / 'worker.log').open, (self.root / 'records').glob, (self.root / name).mkdir, Path, Path(__file__).resolve, Path(home).resolve, ValueError …
class LocalRunner:
    # @chain-region LocalRunner.__init__ | calls: (self.root / name).mkdir, Path, Path(home).resolve, api.private_root, plain, self.root.mkdir, source.canonical, source.canonical(work.scope).encode …
    def __init__(self, work, home=None):
        self.work=work
        if home is None:
            try:from . import proposal as api
            except ImportError:import proposal as api
            home=api.private_root()/'engineering-runs'
        self.root=Path(home).resolve()/source.digest(source.canonical(work.scope).encode())
        self.root.mkdir(parents=True,exist_ok=True,mode=0o700)
        plain(self.root,True)
        for name in ('records','jobs','runs','cancel'):
            (self.root/name).mkdir(exist_ok=True,mode=0o700);plain(self.root/name,True)

    # @chain-region LocalRunner.path | calls: ValueError, isinstance, re.fullmatch
    def path(self, kind, ident, suffix=''):
        if not isinstance(ident,str) or not re.fullmatch('[a-f0-9]{32}',ident):
            raise ValueError('invalid_local_run_id')
        return self.root/kind/(ident+suffix)

    # @chain-region LocalRunner.start | calls: (folder / 'worker.log').open, Path, Path(__file__).resolve, ValueError, atomic, document, environment, exclusive …
    def start(self, snapshot, value, request_id=None):
        value=plan(value)
        fixed=document(self.work._path('snapshots',snapshot,'.json'))
        self.work._load(fixed.get('workspace_id'))
        if fixed.get('id')!=snapshot or source.digest(source.canonical({k:v for k,v in fixed.items() if k!='id'}).encode())!=snapshot:
            raise ValueError('local_snapshot_owner_mismatch')
        files=source.validate_manifest(fixed['files'])
        request_id=request_id or uuid.uuid4().hex
        if not re.fullmatch('[A-Za-z0-9_.:-]{8,100}',request_id):
            raise ValueError('invalid_request_id')
        binding=source.digest(source.canonical({'snapshot':snapshot,'plan':value}).encode())
        with exclusive(self.root/'admission.lock'):
            records=self.list()
            for row in records:
                if row.get('request_id')==request_id:
                    if row.get('binding')!=binding:
                        raise ValueError('local_request_content_changed')
                    return {'run':row,'recovered':True}
            if sum(r['state'] not in TERMINAL for r in records)>=4:
                raise ValueError('local_run_queue_full')
            if len(records)>=200:
                raise ValueError('local_run_history_full')
            ident=uuid.uuid4().hex
            folder=self.path('runs',ident);folder.mkdir(mode=0o700)
            tree=self.work._materialize(files,folder/'source')
            record={'id':ident,'scope':self.work.scope,'request_id':request_id,'binding':binding,
                    'kind':'local-process','state':'queued','snapshot':snapshot,'base':fixed['base'],
                    'task_id':fixed.get('task_id'),'manifest_sha256':source.digest(source.canonical(files).encode()),
                    'created':time.time(),'updated':time.time(),'code':None,'actual_vm':False}
            job={'record':record,'files':files,'plan':value,'tree':str(tree),'root':str(self.root)}
            atomic(self.path('jobs',ident,'.json'),job)
            atomic(self.path('records',ident,'.json'),record)
            log=(folder/'worker.log').open('ab')
            try:
                child=subprocess.Popen([sys.executable,'-B',str(Path(__file__).resolve()),'--worker',str(self.path('jobs',ident,'.json'))],
                                       stdin=subprocess.DEVNULL,stdout=log,stderr=log,env=environment(),
                                       creationflags=0x08000000 if os.name=='nt' else 0,start_new_session=os.name!='nt')
                record['worker_pid']=child.pid
                atomic(self.path('jobs',ident,'.pid.json'),{'pid':child.pid})
                threading.Thread(target=child.wait,daemon=True).start()
                # The worker owns subsequent updates; do not overwrite its running state.
            except OSError:
                record.update(state='interrupted',error='local_worker_start_failed',updated=time.time())
                atomic(self.path('records',ident,'.json'),record)
                raise
            finally:
                log.close()
            return {'run':record,'accepted':True,'passed':False}

    # @chain-region LocalRunner.list | calls: (self.root / 'records').glob, document, rows.append, self.inspect, sorted, value.get
    def list(self):
        rows=[]
        for file in sorted((self.root/'records').glob('*.json')):
            value=document(file)
            if value.get('scope')==self.work.scope:
                rows.append(self.inspect(value['id']))
        return sorted(rows,key=lambda r:r['created'],reverse=True)

    # @chain-region LocalRunner.inspect | calls: ValueError, atomic, document, document(startup).get, process_alive, record.get, record.update, self.path …
    def inspect(self, ident):
        record=document(self.path('records',ident,'.json'))
        if record.get('scope')!=self.work.scope or record.get('id')!=ident:
            raise ValueError('local_run_owner_mismatch')
        if record['state'] not in TERMINAL and time.time()-record['created']>2:
            pid=record.get('worker_pid')
            startup=self.path('jobs',ident,'.pid.json')
            if not pid and startup.exists():pid=document(startup).get('pid')
            if pid and not process_alive(pid):
                record.update(state='interrupted',error='local_worker_interrupted',updated=time.time())
                atomic(self.path('records',ident,'.json'),record)
        return record

    # @chain-region LocalRunner.logs | calls: ValueError, chunk.decode, file.exists, file.open, file.stat, len, plain, self.inspect …
    def logs(self, ident, offset=0):
        self.inspect(ident)
        if type(offset) is not int or not 0<=offset<=MAX_LOG:
            raise ValueError('invalid_log_offset')
        file=self.path('runs',ident)/'output.log'
        if not file.exists():return {'text':'','offset':offset,'next_offset':None}
        plain(file)
        with file.open('rb') as stream:
            stream.seek(offset);chunk=stream.read(65536)
        return {'text':chunk.decode('utf-8','replace'),'offset':offset,
                'next_offset':offset+len(chunk) if offset+len(chunk)<file.stat().st_size else None}

    # @chain-region LocalRunner.cancel | calls: atomic, self.inspect, self.path, time.time
    def cancel(self, ident):
        record=self.inspect(ident)
        if record['state'] in TERMINAL:
            return {'id':ident,'state':record['state'],'cancelled':False}
        atomic(self.path('cancel',ident,'.json'),{'cancelled':True,'at':time.time()})
        return {'id':ident,'cancel_requested':True,'passed':False}

    # @chain-region LocalRunner.evidence | calls: (folder / 'output.log').read_bytes, ValueError, document, original_manifest, path.read_bytes, plain, self.inspect, self.path …
    def evidence(self, ident, revision):
        record=self.inspect(ident)
        if record['state'] not in TERMINAL or 'execution' not in record:
            raise ValueError('local_run_not_complete')
        fixed=self.work.download(revision)
        job=document(self.path('jobs',ident,'.json'))
        if fixed['files']!=job['files']:
            raise ValueError('local_evidence_source_mismatch')
        folder=self.path('runs',ident)
        raw=(folder/'output.log').read_bytes()
        if source.digest(raw)!=record['execution']['log_sha256']:
            raise ValueError('local_run_log_changed')
        if original_manifest(folder/'source',job['files'])!=job['files'] and record['execution']['source_unchanged']:
            raise ValueError('local_run_source_changed_after_execution')
        for artifact in record['execution']['artifacts']:
            path=folder/'source'/artifact['path'];plain(path)
            if source.digest(path.read_bytes())!=artifact['sha256']:
                raise ValueError('local_run_artifact_changed')
        return {'schema':3,'revision':revision,'kind':'local-process','script':source.canonical(job['plan']),
                'execution':record['execution'],'environment':record['environment'],
                'observation':{'local_process':True,'os_sandbox':False,'remote_attestation':False}}

    # @chain-region LocalRunner.report | calls: self.evidence, self.work.call, source.canonical, source.canonical(proof).encode, source.digest
    def report(self, ident, revision, summary):
        proof=self.evidence(ident,revision)
        request={'request_id':'local-report-'+source.digest(source.canonical(proof).encode())[:40],
                 'revision':revision,'evidence':proof,'outcome':'pass' if proof['execution']['passed'] else 'fail','summary':summary}
        return self.work.call('/engineering/verify',request)


# @chain-region worker | calls: Path, Path(__file__).read_bytes, Path(__file__).resolve, Path(executable).read_bytes, Path(job_path).resolve, ValueError, WindowsJob, any …
def worker(job_path):
    job_path=Path(job_path).resolve();job=document(job_path)
    ident=job_path.stem;root=job_path.parent.parent
    if not re.fullmatch('[a-f0-9]{32}',ident) or job_path.parent.name!='jobs' or str(root)!=job.get('root'):
        raise ValueError('invalid_local_worker_job')
    record=job['record'];files=source.validate_manifest(job['files']);value=plan(job['plan'])
    tree=root/'runs'/ident/'source'
    if str(tree)!=job.get('tree') or record.get('id')!=ident or root.name!=source.digest(source.canonical(record['scope']).encode()):
        raise ValueError('local_worker_scope_mismatch')
    record_path=root/'records'/(ident+'.json');cancel=root/'cancel'/(ident+'.json')
    # @chain-region worker.save | calls: atomic, record.update, time.time
    def save(**updates):
        record.update(updates,updated=time.time());atomic(record_path,record)
    save(worker_pid=os.getpid())
    deadline=time.monotonic()+1200
    acquired=False
    while not acquired:
        if cancel.exists():save(state='cancelled');return
        try:
            lock=exclusive(root/'execution.lock');lock.__enter__();acquired=True
        except ValueError:
            if time.monotonic()>deadline:save(state='interrupted',error='local_queue_timeout');return
            time.sleep(.25)
    try:
        while not available():
            save(state='waiting_resources')
            if cancel.exists():save(state='cancelled');return
            if time.monotonic()>deadline:save(state='interrupted',error='local_resources_timeout');return
            time.sleep(.5)
        plain(tree,True)
        if original_manifest(tree,files)!=files:
            save(state='failed',error='local_input_changed');return
        script=source.canonical(value);started=time.time();start=time.monotonic()
        log_path=tree.parent/'output.log'
        code=0;timed_out=False;cancelled=False;truncated=False;error=None;artifacts=[];tools=[]
        save(state='running',started=started)
        with log_path.open('wb') as log:
            for argv in value['commands']:
                executable=sys.executable if argv[0]=='$PYTHON' else shutil.which({'$NODE':'node','$GO':'go'}.get(argv[0],argv[0]))
                if not executable:
                    code=127;error='local_toolchain_unavailable';break
                tools.append({'name':argv[0],'sha256':source.digest(Path(executable).read_bytes())})
                child=None;job_handle=None
                try:
                    command=[executable,*argv[1:]]
                    if os.name!='nt':command=[sys.executable,'-B',str(Path(__file__).resolve()),'--guard',source.canonical(command)]
                    child=subprocess.Popen(command,cwd=tree,env=environment(tree),
                                           stdin=subprocess.DEVNULL if os.name=='nt' else subprocess.PIPE,stdout=log,stderr=subprocess.STDOUT,
                                           start_new_session=os.name!='nt',creationflags=0x08000200 if os.name=='nt' else 0)
                    child._link_guard=os.name!='nt'
                    job_handle=WindowsJob(child)
                    if os.name!='nt' and hasattr(os,'sched_setaffinity'):
                        try:os.sched_setaffinity(child.pid,{min(os.sched_getaffinity(0))})
                        except (OSError,ProcessLookupError):pass
                    while child.poll() is None:
                        timed_out=time.monotonic()-start>value['timeout']
                        cancelled=cancel.exists()
                        truncated=log_path.stat().st_size>MAX_LOG
                        if timed_out or cancelled or truncated:
                            break
                        time.sleep(.05)
                    if child.poll() is not None:
                        code=child.returncode
                    else:
                        code=-1
                finally:
                    if child is not None:stop(child,job_handle)
                timed_out=timed_out or time.monotonic()-start>value['timeout']
                if code!=0 or timed_out or cancelled or truncated:
                    break
        if log_path.stat().st_size>MAX_LOG:
            truncated=True
            with log_path.open('r+b') as log:log.truncate(MAX_LOG)
        changed=[name for name,sha in original_manifest(tree,files).items() if sha!=files[name]]
        if code==0 and not timed_out and not cancelled and not truncated and not changed:
            try:
                total=0
                for name in value['artifacts']:
                    file=tree/name
                    for parent in file.parents:
                        if parent==tree:break
                        plain(parent,True)
                    info=plain(file)
                    if not 0<info.st_size<=source.MAX_ARTIFACT:raise ValueError('local_artifact_size')
                    total+=info.st_size
                    if total>source.MAX_ARTIFACTS:raise ValueError('local_artifact_capacity')
                    artifacts.append({'path':name,'sha256':source.digest(file.read_bytes()),'bytes':info.st_size})
            except (ValueError,OSError):
                error='local_artifact_invalid';artifacts=[]
        raw=log_path.read_bytes()
        passed=code==0 and not any((timed_out,cancelled,truncated,changed,error))
        execution={'operation':ident,'snapshot':record['snapshot'],'manifest_sha256':record['manifest_sha256'],
                   'script_sha256':source.digest(script.encode()),'log_sha256':source.digest(raw),'log_bytes':len(raw),
                   'started':started,'finished':time.time(),'code':code,'passed':passed,'source_unchanged':not changed,
                   'source_changed':changed,'timed_out':timed_out,'cancelled':cancelled,'log_truncated':truncated,
                   'artifacts':artifacts,'artifact_error':error}
        env={'kind':'local-process','os_sandbox':False,'platform':platform.system(),'architecture':platform.machine(),
             'python':platform.python_version(),'runner_sha256':source.digest(Path(__file__).read_bytes()),'tools':tools}
        env['baseline_id']=source.digest(source.canonical(env).encode())
        save(state='passed' if passed else 'cancelled' if cancelled else 'failed',code=code,error=error,
             execution=execution,environment=env)
    except BaseException as exception:
        save(state='interrupted',error=type(exception).__name__+': '+str(exception)[:300])
    finally:
        lock.__exit__(None,None,None)


# @chain-region dashboard | calls: (root / 'records').glob, Path, ValueError, api.private_root, available, directory.is_absolute, document, file.exists …
def dashboard(owner, ident=None, data_directory=None, offset=0):
    if not isinstance(owner,str) or not source.HEX.fullmatch(owner):
        raise ValueError('invalid_local_owner')
    try:from . import proposal as api
    except ImportError:import proposal as api
    # The desktop supplies its own private profile root. Test profiles and
    # alternate account directories may differ from this child's environment.
    directory=Path(data_directory) if data_directory is not None else api.private_root()
    if not directory.is_absolute():raise ValueError('invalid_local_data_directory')
    root=directory/'engineering-runs'/owner
    if not root.exists():return {'local_runs':[],'local_environment':{'ready':True,'kind':'local-process','os_sandbox':False}}
    plain(root,True)
    if ident is not None:
        if not re.fullmatch('[a-f0-9]{32}',ident):raise ValueError('invalid_local_run_id')
        row=document(root/'records'/(ident+'.json'))
        if source.digest(source.canonical(row['scope']).encode())!=owner:raise ValueError('local_run_owner_mismatch')
        file=root/'runs'/ident/'output.log'
        text=''
        if type(offset) is not int or not 0<=offset<=MAX_LOG:raise ValueError('invalid_log_offset')
        size=0;length=0
        if file.exists():
            plain(file);size=file.stat().st_size
            with file.open('rb') as stream:stream.seek(offset);raw=stream.read(32768)
            length=len(raw);text=raw.decode('utf-8','replace')
        return {'run':row,'logs':{'text':text,'offset':offset,'next_offset':offset+length if offset+length<size else None},'preview':None}
    rows=[]
    for file in (root/'records').glob('*.json'):
        row=document(file)
        if source.digest(source.canonical(row['scope']).encode())==owner:rows.append(row)
    return {'local_runs':sorted(rows,key=lambda r:r['created'],reverse=True)[:40],
            'local_environment':{'ready':True,'kind':'local-process','os_sandbox':False,'memory_available':available()}}


# @chain-region add_parser | calls: cli.add_argument, commands.add_parser
def add_parser(commands):
    cli=commands.add_parser('local',help='Fixed-source local project runs; not an OS sandbox')
    cli.add_argument('operation',choices=['doctor','run','status','logs','cancel','evidence','report'])
    cli.add_argument('--snapshot');cli.add_argument('--plan',type=Path);cli.add_argument('--id')
    cli.add_argument('--revision');cli.add_argument('--request-id');cli.add_argument('--summary')
    cli.add_argument('--offset',type=int,default=0)


# @chain-region run | calls: LocalRunner, ValueError, Workspaces, available, bool, document, platform.python_version, runner.cancel …
def run(args,secret):
    runner=LocalRunner(Workspaces(secret))
    if args.operation=='doctor':return {'kind':'local-process','ready':True,'os_sandbox':False,'memory_available':available(),
                                       'python':platform.python_version(),'node':bool(shutil.which('node')),'go':bool(shutil.which('go'))}
    if args.operation=='run':
        if not args.plan:raise ValueError('local_plan_required')
        return runner.start(args.snapshot,document(args.plan),args.request_id)
    if args.operation=='status':return {'run':runner.inspect(args.id)} if args.id else {'runs':runner.list()}
    if args.operation=='logs':return runner.logs(args.id,args.offset)
    if args.operation=='cancel':return runner.cancel(args.id)
    if args.operation=='evidence':return runner.evidence(args.id,args.revision)
    if args.operation=='report':return runner.report(args.id,args.revision,args.summary)
    raise ValueError('unknown_local_operation')


if __name__=='__main__':
    if len(sys.argv)==3 and sys.argv[1]=='--guard' and os.name!='nt':
        raise SystemExit(guard(json.loads(sys.argv[2])))
    elif len(sys.argv)==3 and sys.argv[1]=='--worker':
        worker(sys.argv[2])
    elif len(sys.argv)==2 and sys.argv[1]=='--bridge-rpc':
        try:
            message=json.loads(sys.stdin.read(8193));payload=message.get('payload',{})
            if message.get('action') not in ('dashboard','inspect'):raise ValueError('local_bridge_action_denied')
            print(source.canonical(dashboard(payload.get('owner'),payload.get('id'),payload.get('data_directory'),payload.get('offset',0))))
        except Exception as exception:
            print(source.canonical({'error':str(exception)[:300]}))
    else:
        raise SystemExit('Use proposal.py local')
