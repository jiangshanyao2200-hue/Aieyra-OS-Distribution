# @file-map:start
# 文件: link/agent/source_protocol.py
# 位置: 二环·Agent完整链路 | 协作CLI、接续、实际启动器、工作包、源码传输和本机运行。
# 约束: 使用本人已有身份和connection，不因压缩重建身份；写操作保留request_id；未知结果查回执，凭据不进入日志与文档
# 下游: 无已解析的项目内静态导入
# 上游: AIDEBUG/co-creation-experiment.py, AIDEBUG/live-experiment.py, AIDEBUG/local-vm-experiment.py, AIDEBUG/practice-experiment.py, link/agent/artifact.py, link/agent/cocreation_source.py, link/agent/live_work.py, link/agent/local_preview.py, link/agent/local_runner.py, link/agent/local_vm.py, link/agent/prepare_vm.py, link/agent/proposal.py, link/agent/workspace.py, scripts/cocreation_bundle.py, server/engineering.py, server/http.py, server/live.py, server/manage.py, server/process_evidence.py, server/workflow.py, tests/test_artifact_transport.py, tests/test_blob_access.py, tests/test_cocreation_baseline.py, tests/test_cocreation_checkout.py, tests/test_live.py, tests/test_live_work.py, tests/test_local_preview.py, tests/test_local_vm.py, tests/test_source_workspaces.py, tests/test_upload_recovery.py, tests/test_vm_preparation.py, tests/test_workflow.py
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: AIDEBUG/co-creation-experiment.py, AIDEBUG/live-experiment.py, AIDEBUG/local-vm-experiment.py, AIDEBUG/practice-experiment.py, tests/test_artifact_transport.py, tests/test_blob_access.py, tests/test_cocreation_baseline.py, tests/test_cocreation_checkout.py, tests/test_live.py, tests/test_live_work.py, tests/test_local_preview.py, tests/test_local_vm.py, tests/test_source_workspaces.py, tests/test_upload_recovery.py, tests/test_vm_preparation.py, tests/test_workflow.py
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   canonical | function
#   digest | function
#   source_path | function
#   validate_blob | function
#   artifact_path | function
#   validate_manifest | function
#   revision_id | function
#   execution_plan | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Portable immutable-source contract shared by the server and Agent tools."""
from __future__ import annotations

import base64
import hashlib
import json
from pathlib import PurePosixPath
import re

HEX = re.compile(r'[a-f0-9]{64}\Z')
MAX_FILE = 16 * 1024 * 1024
MAX_TREE = 256 * 1024 * 1024
MAX_FILES = 5000
MAX_BUNDLE = 2 * MAX_TREE + 4 * 1024 * 1024
MAX_ARTIFACT = 512 * 1024 * 1024
MAX_ARTIFACTS = 1024 * 1024 * 1024
ARTIFACT_LEGACY_CHUNK = 256 * 1024
ARTIFACT_CHUNK = 2 * 1024 * 1024
ARTIFACT_JSON_LIMIT = 3 * 1024 * 1024
PUBLIC_KEYS = frozenset(('Config/release.pub.pem', 'Control/app/config/release-public.pem',
                         'Program/official/together/product/office/config/release-public.pem'))
# These redistributables are part of the reviewed OS source export and must survive checkout.
_RUNTIME = 'Program/official/together/product/runtime/'
PINNED_RUNTIME = {
    _RUNTIME + 'native/aieyra-link-lan.exe': 'f208a46f1928550af47fc9a7be551743988d2eb079b26c9bcf9de5c2cfea7f1a',
    _RUNTIME + 'native/aieyra-link.exe': 'f7a9643ec01acc82f0bdc56a4471b0108323280cf6886fcf85c95226df034921',
    _RUNTIME + 'python/libcrypto-3.dll': 'e03dd02fdcfb791981c9962827cfcf495f2a47a514c1526efb57f847a9df514a',
    _RUNTIME + 'python/libffi-8.dll': 'eff52743773eb550fcc6ce3efc37c85724502233b6b002a35496d828bd7b280a',
    _RUNTIME + 'python/libssl-3.dll': '1e4bc0638682bfcbb36f4465d6a2e9944d917a60f05ecc8ddf9e96847e05e13f',
    _RUNTIME + 'python/python.exe': '29d6486dc5fa86c9d19db9d390fdbb62c4830e2b305761723c0b42e6f3596954',
    _RUNTIME + 'python/python3.dll': 'f950ce3bf381d5ffae90cf63ec9c9761f1666d9a570e2f203a7f22da6f8e14f3',
    _RUNTIME + 'python/python313.dll': 'e7119fc5892eab890d44f6df05f44d50cf8c390c35d152e589e0c35781ca8d05',
    _RUNTIME + 'python/pythonw.exe': 'f74fe1bd59813ad8f8c913b45e7666094cea1e6ae0f3663f6e8ac743fb73e198',
    _RUNTIME + 'python/sqlite3.dll': '3f0cb5fb18f1c7eb77fb58eb8497fea1b8974f2c824ac1c7377b363fd9be3485',
    _RUNTIME + 'python/vcruntime140.dll': '052ad6a20d375957e82aa6a3c441ea548d89be0981516ca7eb306e063d5027f4',
    _RUNTIME + 'python/vcruntime140_1.dll': '6a99bc0128e0c7d6cbbf615fcc26909565e17d4ca3451b97f8987f9c6acbc6c8',
}


# @chain-region canonical | calls: json.dumps
def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


# @chain-region digest | calls: hashlib.sha256, hashlib.sha256(raw).hexdigest
def digest(raw):
    return hashlib.sha256(raw).hexdigest()


# @chain-region source_path | calls: PurePosixPath, PurePosixPath(value).as_posix, PurePosixPath(value).suffix.lower, ValueError, any, isinstance, len, ord …
def source_path(value, *, allow_executable=False):
    if not isinstance(value, str) or not 1 <= len(value) <= 240:
        raise ValueError('invalid_source_path')
    parts = PurePosixPath(value).parts
    if (not parts or value != PurePosixPath(value).as_posix() or value.startswith('/') or
        any(ord(c) < 32 for c in value) or any(c in value for c in '\\:*?"<>|') or
        any(p in ('.', '..') or p.endswith((' ', '.')) or p.casefold() in
            ('.git', '.ssh', '.env', 'node_modules', '__pycache__', 'secrets', 'credentials') or
            p.casefold().startswith('.env.') or re.fullmatch(r'(?i)(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?', p)
            for p in parts) or value not in PUBLIC_KEYS and value not in PINNED_RUNTIME and PurePosixPath(value).suffix.lower() in
        (('.pfx', '.pem', '.key', '.sqlite', '.db') if allow_executable else ('.exe', '.dll', '.pfx', '.pem', '.key', '.sqlite', '.db'))):
        raise ValueError('invalid_source_path')
    return value


# @chain-region validate_blob | calls: ValueError, base64.b64decode, digest, len, match[1].replace, match[1].replace(b'\r', b'').replace, re.fullmatch, source_path
def validate_blob(path, raw):
    """Check special source entries against their exact approved format or digest."""
    source_path(path)
    if path in PINNED_RUNTIME and digest(raw) != PINNED_RUNTIME[path]:
        raise ValueError('runtime_digest_mismatch')
    if path in PUBLIC_KEYS:
        match = re.fullmatch(rb'-----BEGIN PUBLIC KEY-----\r?\n([A-Za-z0-9+/=\r\n]+)-----END PUBLIC KEY-----\r?\n?', raw)
        if len(raw) > 8192 or not match:
            raise ValueError('invalid_public_source_key')
        try:
            der = base64.b64decode(match[1].replace(b'\r', b'').replace(b'\n', b''), validate=True)
        except ValueError:
            raise ValueError('invalid_public_source_key') from None
        if len(der) < 32 or der[0] != 0x30:
            raise ValueError('invalid_public_source_key')
    return raw


# @chain-region artifact_path | calls: source_path
def artifact_path(value):
    return source_path(value, allow_executable=True)


# @chain-region validate_manifest | calls: '/'.join, HEX.fullmatch, ValueError, any, files.items, folded.add, isinstance, len …
def validate_manifest(files):
    if not isinstance(files, dict) or not 1 <= len(files) <= MAX_FILES:
        raise ValueError('manifest_size')
    folded = set()
    for path, sha in files.items():
        source_path(path)
        if not isinstance(sha, str) or not HEX.fullmatch(sha):
            raise ValueError('invalid_source_digest')
        if path in PINNED_RUNTIME and sha != PINNED_RUNTIME[path]:
            raise ValueError('runtime_digest_mismatch')
        if path.casefold() in folded:
            raise ValueError('source_path_collision')
        folded.add(path.casefold())
    if any('/'.join(path.split('/')[:i]) in folded for path in folded for i in range(1, len(path.split('/')))):
        raise ValueError('source_path_collision')
    return files


# @chain-region revision_id | calls: canonical, canonical({'base': base, 'files': validate_manifest(files), 'task': task}).encode, digest, validate_manifest
def revision_id(base, files, task=''):
    return digest(canonical({'base': base, 'files': validate_manifest(files), 'task': task}).encode())


# @chain-region execution_plan | calls: ValueError, any, artifact_path, canonical, canonical(value).encode, isinstance, len, set …
def execution_plan(value):
    """Portable local-process plan; argv is explicit and never implicitly a shell."""
    if not isinstance(value,dict) or len(canonical(value).encode())>65536:
        raise ValueError('invalid_local_plan')
    commands=value.get('commands')
    if not isinstance(commands,list) or not 1<=len(commands)<=8:
        raise ValueError('invalid_local_commands')
    for argv in commands:
        if not isinstance(argv,list) or not 1<=len(argv)<=64 or any(not isinstance(v,str) or len(v)>4096 or '\0' in v for v in argv) or not argv[0]:
            raise ValueError('invalid_local_command')
    timeout=value.get('timeout',120)
    artifacts=value.get('artifacts',[])
    if type(timeout) is not int or not 1<=timeout<=1200:
        raise ValueError('invalid_local_timeout')
    if not isinstance(artifacts,list) or len(artifacts)>16 or any(not isinstance(x,str) for x in artifacts) or len(set(artifacts))!=len(artifacts):
        raise ValueError('invalid_local_artifacts')
    for name in artifacts:
        artifact_path(name)
    return {'commands':commands,'timeout':timeout,'artifacts':artifacts}
