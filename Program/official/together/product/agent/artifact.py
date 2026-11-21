# @file-map:start
# 文件: link/agent/artifact.py
# 位置: 二环·Agent完整链路 | 协作CLI、接续、实际启动器、工作包、源码传输和本机运行。
# 约束: 使用本人已有身份和connection，不因压缩重建身份；写操作保留request_id；未知结果查回执，凭据不进入日志与文档
# 下游: link/agent/proposal.py, link/agent/source_protocol.py, link/agent/workspace.py
# 上游: link/agent/proposal.py, tests/test_artifact_transport.py, tests/test_upload_recovery.py
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: tests/test_artifact_transport.py, tests/test_upload_recovery.py
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   digest | function
#   bounded_call | function
#   upload | function
#   download | function
#   add_parser | function
#   run | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Bounded release artifact transport. Downloads never execute or install files."""
import base64
import hashlib
import os
from pathlib import Path
import secrets
import time
from urllib.parse import urlencode

if __package__:
    from . import source_protocol as source
    from .workspace import plain
else:
    import source_protocol as source
    from workspace import plain


# @chain-region digest | calls: hashlib.sha256, iter, path.open, result.hexdigest, result.update, stream.read
def digest(path):
    result=hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):result.update(chunk)
    return result.hexdigest()


# @chain-region bounded_call | calls: ValueError, api.call, max, min, range, time.sleep
def bounded_call(api,server,route,body,key):
    for attempt in range(20):
        try:return api.call(server,route,body,key)
        except api.ApiError as error:
            if error.status!=429:raise
            time.sleep(min(60,max(1,error.retry_after)))
    raise ValueError('artifact_rate_limit_retry_exhausted')


# @chain-region upload | calls: Path, ValueError, base64.b64encode, base64.b64encode(chunk).decode, bounded_call, digest, len, min …
def upload(api,server,key,path,expected=None):
    path=Path(path);info=plain(path)
    if not 0<info.st_size<=source.MAX_ARTIFACT:raise ValueError('artifact_capacity')
    sha=digest(path)
    if expected and sha!=expected:raise ValueError('artifact_digest_mismatch')
    large = info.st_size>64*1024*1024
    chunk_size = source.ARTIFACT_CHUNK if large else source.ARTIFACT_LEGACY_CHUNK
    request_prefix = 'artifact-v2-' if large else 'artifact-'
    offset=0
    with path.open('rb') as stream:
        while offset<info.st_size:
            chunk=stream.read(min(chunk_size,info.st_size-offset))
            if not chunk:raise ValueError('artifact_changed_during_upload')
            body={'request_id':request_prefix+sha[:32]+'-'+str(offset),'sha256':sha,'size':info.st_size,'offset':offset,'data':base64.b64encode(chunk).decode()}
            value=bounded_call(api,server,'/engineering/artifacts/upload',body,key)
            if value.get('sha256')!=sha or type(value.get('offset')) is not int or not offset+len(chunk)<=value['offset']<=info.st_size:raise ValueError('artifact_upload_receipt_mismatch')
            offset=value['offset'];stream.seek(offset)
    if digest(path)!=sha:raise ValueError('artifact_changed_during_upload')
    return {'sha256':sha,'bytes':info.st_size,'uploaded':True,'executed':False}


# @chain-region download | calls: Path, Path(path).absolute, ValueError, base64.b64decode, bounded_call, digest, len, os.fsync …
def download(api,server,key,release,sha,path):
    if not source.HEX.fullmatch(release or '') or not source.HEX.fullmatch(sha or ''):raise ValueError('invalid_release_artifact')
    path=Path(path).absolute();path.parent.mkdir(parents=True,exist_ok=True)
    temporary=path.with_name(path.name+'.'+sha[:16]+'.partial')
    if path.exists() or path.is_symlink():
        # A crash can happen between the atomic no-clobber link and removing its
        # private partial name. Only recover this exact, verified link pair.
        if (not path.is_symlink() and not temporary.is_symlink() and temporary.exists() and
            path.stat().st_nlink==2 and os.path.samefile(path,temporary) and digest(path)==sha):
            temporary.unlink()
        plain(path)
        if digest(path)==sha:return {'path':str(path),'sha256':sha,'verified':True,'reused':True,'executed':False}
        raise ValueError('artifact_destination_exists')
    if temporary.exists() or temporary.is_symlink():plain(temporary)
    offset=temporary.stat().st_size if temporary.exists() else 0
    if offset>source.MAX_ARTIFACT:raise ValueError('artifact_capacity')
    identity=None
    with temporary.open('ab') as stream:
        while True:
            query = {'release_id':release,'sha256':sha,'offset':offset}
            if identity is not None and identity>64*1024*1024:
                query['chunk_size'] = source.ARTIFACT_CHUNK
            value=bounded_call(api,server,'/engineering/artifact?'+urlencode(query),None,key)
            if (value.get('sha256')!=sha or value.get('offset')!=offset or type(value.get('size')) is not int or
                not 1<=value['size']<=source.MAX_ARTIFACT or identity is not None and identity!=value['size']):raise ValueError('artifact_download_identity_mismatch')
            identity=value['size'];raw=base64.b64decode(value['data'],validate=True)
            if len(raw)>query.get('chunk_size',source.ARTIFACT_LEGACY_CHUNK) or source.digest(raw)!=value['chunk_sha256'] or offset+len(raw)>identity:raise ValueError('artifact_chunk_mismatch')
            stream.write(raw);stream.flush();os.fsync(stream.fileno());offset+=len(raw)
            if value.get('next_offset') is None:
                if offset!=identity:raise ValueError('artifact_download_incomplete')
                break
            if not raw or value['next_offset']!=offset:raise ValueError('artifact_download_cursor_mismatch')
    if digest(temporary)!=sha:
        temporary.rename(temporary.with_name(temporary.name+'.corrupt-'+secrets.token_hex(6)))
        raise ValueError('artifact_download_digest_mismatch')
    os.link(temporary,path);temporary.unlink() # Atomic no-clobber final name; downloaded file is never executed.
    return {'path':str(path),'sha256':sha,'bytes':offset,'verified':True,'executed':False}


# @chain-region add_parser | calls: commands.add_parser, p.add_argument
def add_parser(commands):
    p=commands.add_parser('artifact',help='Transfer exact VM build/release artifacts; never executes files')
    p.add_argument('operation',choices=['upload','download']);p.add_argument('--file',type=Path,required=True)
    p.add_argument('--sha256');p.add_argument('--release-id')


# @chain-region run | calls: download, upload
def run(args,secret):
    if __package__:from . import proposal as api
    else:import proposal as api
    if args.operation=='upload':return upload(api,secret['server'],secret['key'],args.file,args.sha256)
    return download(api,secret['server'],secret['key'],args.release_id,args.sha256,args.file)
