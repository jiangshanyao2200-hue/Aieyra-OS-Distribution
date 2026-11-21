# @file-map:start
# 文件: link/agent/vm_guest.py
# 位置: 二环·Agent完整链路 | 协作CLI、接续、实际启动器、工作包、源码传输和本机运行。
# 约束: 使用本人已有身份和connection，不因压缩重建身份；写操作保留request_id；未知结果查回执，凭据不进入日志与文档
# 下游: 无已解析的项目内静态导入
# 上游: link/agent/local_vm.py, link/agent/prepare_vm.py
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: python -X utf8 -B -m unittest discover -s AIDEBUG -p test_aidebug_launch.py, AIDEBUG/startup-review.py
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   sha | function
#   canonical | function
#   lower_privileges | function
#   safe_file | function
#   main | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Trusted guest-side runner, installed in the VM baseline, never loaded from source."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import resource
import select
import signal
import stat
import subprocess
import sys
import tarfile
import time

MAX_LOG = 4 * 1024 * 1024
# The trusted runner is installed as a standalone file in the VM.
MAX_ARTIFACT = 512 * 1024 * 1024
MAX_ARTIFACTS = 1024 * 1024 * 1024


# @chain-region sha | calls: hashlib.sha256, iter, path.open, result.hexdigest, result.update, stream.read
def sha(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''): result.update(chunk)
    return result.hexdigest()


# @chain-region canonical | calls: json.dumps
def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


# @chain-region lower_privileges | calls: os.setgid, os.setgroups, os.setuid, os.umask, resource.setrlimit
def lower_privileges():
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_ARTIFACT, MAX_ARTIFACT))
    resource.setrlimit(resource.RLIMIT_NOFILE, (512, 512))
    resource.setrlimit(resource.RLIMIT_NPROC, (256, 256))
    os.setgroups([])
    os.setgid(1000)
    os.setuid(1000)
    os.umask(0o077)


# @chain-region safe_file | calls: PurePosixPath, PurePosixPath(name).as_posix, ValueError, name.startswith, os.close, os.fstat, os.open, parent.lstat …
def safe_file(root, name):
    parts = PurePosixPath(name).parts
    if not parts or name != PurePosixPath(name).as_posix() or name.startswith('/') or '..' in parts or '\\' in name:
        raise ValueError('unsafe_artifact_path')
    for parent in (root/name).parents:
        if parent == root: break
        if not stat.S_ISDIR(parent.lstat().st_mode): raise ValueError('artifact_parent_link')
    descriptor = os.open(root/name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    info = os.fstat(descriptor)
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        os.close(descriptor);raise ValueError('artifact_link_or_special_file')
    return descriptor, info


# @chain-region main | calls: (output / 'result.json').write_text, Path, Path(sys.argv[1]).read_text, PurePosixPath, ValueError, any, artifacts.append, bundle.extractfile …
def main():
    request = json.loads(Path(sys.argv[1]).read_text())
    identifier = request['operation']
    if len(identifier) != 32 or any(c not in '0123456789abcdef' for c in identifier): raise ValueError('invalid_operation')
    files = request['files']
    if not isinstance(files, dict) or not 1 <= len(files) <= 5000: raise ValueError('invalid_manifest')
    if hashlib.sha256(canonical(files).encode()).hexdigest() != request['manifest_sha256']: raise ValueError('manifest_digest_mismatch')
    directory = Path('/work/sources') / identifier
    output = Path('/work/results') / identifier
    output.mkdir(mode=0o755)
    directory.mkdir(mode=0o755)
    archive = Path('/work/control/source.tar.gz')
    if sha(archive) != request['archive_sha256']: raise ValueError('archive_digest_mismatch')
    with tarfile.open(archive, 'r:gz') as bundle:
        seen, total = set(), 0
        for member in bundle:
            name = member.name
            parts = PurePosixPath(name).parts
            if (not member.isfile() or name not in files or name in seen or name.startswith('/') or
                '\\' in name or '..' in parts or member.size > 1024 * 1024): raise ValueError('unsafe_source_archive')
            total += member.size
            if total > 32 * 1024 * 1024: raise ValueError('source_capacity')
            raw = bundle.extractfile(member).read(1024 * 1024 + 1)
            if hashlib.sha256(raw).hexdigest() != files[name]: raise ValueError('source_digest_mismatch')
            p = directory / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(raw);os.chown(p, 1000, 1000)
            seen.add(name)
    if seen != set(files): raise ValueError('source_files_missing')
    for root, folders, names in os.walk(directory):
        os.chown(root, 1000, 1000)
    temporary = Path('/work/tmp') / identifier
    temporary.mkdir(mode=0o700);os.chown(temporary,1000,1000)
    started = time.time()
    timeout = request['timeout']
    if type(timeout) is not int or not 1 <= timeout <= 1200: raise ValueError('invalid_timeout')
    script = request['script']
    if not isinstance(script, str) or not 1 <= len(script.encode()) <= 65536 or '\0' in script: raise ValueError('invalid_script')
    log = output / 'output.log'
    environment = {'PATH':'/usr/local/go/bin:/usr/local/bin:/usr/bin:/bin', 'HOME':'/home/ubuntu',
                   'LANG':'C.UTF-8','TMPDIR':str(temporary),'GOMAXPROCS':'1','GOFLAGS':'-p=1',
                   'GOMEMLIMIT':str(max(256,int(request.get('environment',{}).get('memory_mb',1024)*0.60)))+'MiB',
                   'GOTOOLCHAIN':'local','GOPROXY':'off','GOSUMDB':'off',
                   'GOPATH':'/opt/aieyra-link/gopath','GOCACHE':'/work/cache/go-build',
                   'GOMODCACHE':'/opt/aieyra-link/go-mod','GIT_TERMINAL_PROMPT':'0',
                   'CGO_ENABLED':'0','GOVCS':'*:off',
                   'AIEYRA_LINK_OPERATION':identifier,'AIEYRA_LINK_SOURCE_SNAPSHOT':request['snapshot']}
    timed_out, truncated = False, False
    with log.open('wb') as stream:
        child = subprocess.Popen(['/bin/bash','--noprofile','--norc','-e','-u','-o','pipefail','-c',script],
                                 cwd=directory,env=environment,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,
                                 start_new_session=True,preexec_fn=lower_privileges)
        deadline = time.monotonic()+timeout
        try:
            while True:
                if time.monotonic() >= deadline: timed_out = True;break
                ready,_,_ = select.select([child.stdout],[],[],0.2)
                if ready:
                    chunk = os.read(child.stdout.fileno(),65536)
                    if not chunk: break
                    remaining = MAX_LOG-stream.tell()
                    stream.write(chunk[:remaining])
                    stream.flush()
                    if len(chunk) >= remaining: truncated = True;break
                elif child.poll() is not None: break
            if not timed_out and not truncated:
                try: child.wait(timeout=1)
                except subprocess.TimeoutExpired: pass
        finally:
            # A successful shell must not leave background writers changing the evidence.
            try: os.killpg(child.pid,signal.SIGKILL)
            except ProcessLookupError: pass
            code = child.wait(timeout=5)
            child.stdout.close()
    changed = []
    for name,digest in files.items():
        try:
            fd,info = safe_file(directory,name)
            with os.fdopen(fd,'rb') as stream: actual = hashlib.sha256(stream.read(1024*1024+1)).hexdigest()
            if actual != digest: changed.append(name)
        except OSError: changed.append(name)
        except ValueError: changed.append(name)
    artifacts, artifact_error, total = [], None, 0
    try:
        names = request.get('artifacts',[])
        if not isinstance(names,list) or len(names)>16 or len(set(names)) != len(names): raise ValueError('invalid_artifact_list')
        for name in names:
            fd,info = safe_file(directory,name)
            with os.fdopen(fd,'rb') as incoming:
                if not 0 < info.st_size <= MAX_ARTIFACT or total+info.st_size > MAX_ARTIFACTS: raise ValueError('artifact_capacity')
                target = output/'artifacts'/name;target.parent.mkdir(parents=True,exist_ok=True)
                digest = hashlib.sha256();count = 0
                with target.open('xb') as out:
                    for chunk in iter(lambda:incoming.read(65536),b''):
                        count += len(chunk)
                        if count > info.st_size: raise ValueError('artifact_changed_during_read')
                        digest.update(chunk);out.write(chunk)
                if count != info.st_size: raise ValueError('artifact_changed_during_read')
            artifacts.append({'path':name,'sha256':digest.hexdigest(),'bytes':count});total += count
    except (OSError,ValueError) as error: artifact_error = str(error)[:160]
    result = {'operation':identifier,'snapshot':request['snapshot'],'manifest_sha256':request['manifest_sha256'],
              'script_sha256':hashlib.sha256(script.encode()).hexdigest(),'archive_sha256':request['archive_sha256'],
              'started':started,'finished':time.time(),'code':code,'timed_out':timed_out,
              'source_changed':changed[:64],'source_unchanged':not changed,'log_sha256':sha(log),'log_bytes':log.stat().st_size,
              'log_truncated':truncated,'uid':1000,'kernel':os.uname().release,
              'artifacts':artifacts,'artifact_error':artifact_error,
              'passed':code == 0 and not timed_out and not changed and not truncated and artifact_error is None}
    (output/'result.json').write_text(canonical(result)+'\n')
    print(canonical({'result':'/work/results/'+identifier+'/result.json','passed':result['passed']}),flush=True)
    return 0


if __name__ == '__main__':
    try: raise SystemExit(main())
    except Exception as error:
        print(json.dumps({'error':type(error).__name__,'detail':str(error)[:200]}),file=sys.stderr,flush=True)
        raise SystemExit(1)
