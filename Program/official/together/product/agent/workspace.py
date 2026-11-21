# @file-map:start
# 文件: link/agent/workspace.py
# 位置: 二环·Agent完整链路 | 协作CLI、接续、实际启动器、工作包、源码传输和本机运行。
# 约束: 使用本人已有身份和connection，不因压缩重建身份；写操作保留request_id；未知结果查回执，凭据不进入日志与文档
# 下游: link/agent/live_work.py, link/agent/proposal.py, link/agent/source_protocol.py
# 上游: AIDEBUG/co-creation-experiment.py, AIDEBUG/live-experiment.py, AIDEBUG/local-vm-experiment.py, AIDEBUG/practice-experiment.py, AIDEBUG/source-experiment.py, link/agent/artifact.py, link/agent/cocreation.py, link/agent/cocreation_source.py, link/agent/live_work.py, link/agent/local_preview.py, link/agent/local_runner.py, link/agent/local_vm.py, link/agent/prepare_vm.py, link/agent/proposal.py, tests/test_live_work.py, tests/test_local_preview.py, tests/test_local_vm.py, tests/test_source_workspaces.py, tests/test_vm_preparation.py
# 链路: agent-continuity
# 验证: AIDEBUG/co-creation-experiment.py, AIDEBUG/live-experiment.py, AIDEBUG/local-vm-experiment.py, AIDEBUG/onboarding-context.test.cjs, AIDEBUG/onboarding-timeout.test.cjs, AIDEBUG/practice-experiment.py, AIDEBUG/source-experiment.py, tests/test_live_work.py, tests/test_local_preview.py, tests/test_local_vm.py, tests/test_source_workspaces.py, tests/test_vm_preparation.py
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   plain | function
#   document | function
#   atomic | function
#   exclusive | function
#   Workspaces | class
#   Workspaces.__init__ | function
#   Workspaces._path | function
#   Workspaces._blob | function
#   Workspaces._load | function
#   Workspaces._download_blob | function
#   Workspaces.download | function
#   Workspaces._materialize | function
#   Workspaces.create | function
#   Workspaces.recover | function
#   Workspaces.scan | function
#   Workspaces.changes | function
#   Workspaces.status | function
#   Workspaces.list | function
#   Workspaces._snapshot | function
#   Workspaces.snapshot | function
#   Workspaces.preview | function
#   Workspaces.diff | function
#   Workspaces.publish | function
#   Workspaces._recover | function
#   Workspaces.rebase | function
#   add_parser | function
#   run | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Durable, account-scoped source workspaces. Candidate code never runs here."""
from __future__ import annotations

import base64
from contextlib import contextmanager
import difflib
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import stat
import time
from urllib.parse import urlencode

try:
    from . import source_protocol as source
except ImportError:
    import source_protocol as source

ID = re.compile(r'[a-f0-9]{32}\Z')


# @chain-region plain | calls: ValueError, getattr, path.lstat, stat.S_ISDIR, stat.S_ISLNK, stat.S_ISREG
def plain(path, directory=False):
    info = path.lstat()
    if (stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400 or
        not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)) or
        not directory and info.st_nlink > 1):
        raise ValueError('workspace_links_or_special_files_denied')
    return info


# @chain-region document | calls: ValueError, isinstance, json.loads, path.read_text, plain
def document(path):
    info = plain(path)
    if info.st_size > 4 * 1024 * 1024:
        raise ValueError('workspace_metadata_too_large')
    value = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(value, dict):
        raise ValueError('workspace_metadata_invalid')
    return value


# @chain-region atomic | calls: (source.canonical(value) + '\n').encode, getattr, os.chmod, os.fsync, os.replace, out.fileno, out.flush, out.write …
def atomic(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.exists() or path.is_symlink(): plain(path)
    temporary = path.with_name(path.name + '.' + secrets.token_hex(8) + '.tmp')
    try:
        with temporary.open('xb') as out:
            os.chmod(temporary, 0o600)
            out.write((source.canonical(value) + '\n').encode())
            out.flush()
            os.fsync(out.fileno())
        deadline = time.monotonic() + 2
        while True:
            try:
                os.replace(temporary, path)
                break
            except PermissionError as error:
                # A Windows reader may briefly deny delete-sharing. Retain the
                # old complete record while waiting; genuine failures still fail.
                if getattr(error, 'winerror', None) not in (5, 32, 33) or time.monotonic() >= deadline:
                    raise
                time.sleep(.02)
    finally:
        temporary.unlink(missing_ok=True)


# @chain-region exclusive | calls: ValueError, fcntl.flock, lock.fileno, lock.flush, lock.seek, lock.write, msvcrt.locking, os.fstat …
@contextmanager
def exclusive(path):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.exists() or path.is_symlink(): plain(path)
    with path.open('a+b') as lock:
        lock.seek(0)
        if os.name == 'nt':
            import msvcrt
            # Windows byte locks also deny reads by a second handle. Inspect
            # the size without touching the locked byte before attempting it.
            if os.fstat(lock.fileno()).st_size == 0:
                lock.write(b'0'); lock.flush()
            lock.seek(0)
            try: msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError: raise ValueError('workspace_busy') from None
        else:
            import fcntl
            try: fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError: raise ValueError('workspace_busy') from None
        try:
            yield
        finally:
            if os.name == 'nt':
                lock.seek(0); msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


# @chain-region Workspaces | calls: ''.join, ('/engineering/snapshots/create\n' + source.canonical(body)).encode, (identifier + revision + source.canonical(merged)).encode, (pending.get('upload_id', local_id) + change['sha256'] + str(offset)).encode, (self.root / 'records').glob, ID.fullmatch, Path, Path(home or api.private_root() / 'engineering-workspaces').expanduser …
class Workspaces:
    # @chain-region Workspaces.__init__ | calls: ID.fullmatch, Path, Path(home or api.private_root() / 'engineering-workspaces').expanduser, Path(home or api.private_root() / 'engineering-workspaces').expanduser().resolve, ValueError, api.call, api.endpoint, api.private_root …
    def __init__(self, secret, home=None, transport=None):
        try:
            from . import proposal as api
        except ImportError:
            import proposal as api
        if not ID.fullmatch(secret.get('user_id', '')) or not ID.fullmatch(secret.get('id', '')):
            raise ValueError('verified_agent_identity_required')
        self.secret = secret
        self.scope = {'server': api.endpoint(secret.get('server', api.SERVER)), 'user_id': secret['user_id']}
        self.home = Path(home or api.private_root() / 'engineering-workspaces').expanduser().resolve()
        self.root = self.home / source.digest(source.canonical(self.scope).encode())
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        plain(self.root, True)
        self.call = transport or (lambda route, body=None: api.call(self.scope['server'], route, body, secret['key']))
        for name in ('records', 'trees', 'blobs', 'sources', 'snapshots', 'staging', 'history', 'pending', 'locks', 'previews'):
            p = self.root / name
            p.mkdir(exist_ok=True, mode=0o700)
            plain(p, True)

    # @chain-region Workspaces._path | calls: ValueError, isinstance, pattern.fullmatch
    def _path(self, kind, identifier, suffix=''):
        pattern = ID if kind in ('records', 'trees', 'locks') else source.HEX
        if not isinstance(identifier, str) or not pattern.fullmatch(identifier):
            raise ValueError('invalid_workspace_identifier')
        return self.root / kind / (identifier + suffix)

    # @chain-region Workspaces._blob | calls: ValueError, len, os.chmod, os.fsync, os.replace, out.fileno, out.flush, out.write …
    def _blob(self, sha, raw=None):
        path = self._path('blobs', sha)
        if raw is not None:
            if len(raw) > source.MAX_FILE or source.digest(raw) != sha:
                raise ValueError('source_digest_mismatch')
            if path.exists():
                plain(path)
                if path.stat().st_size <= source.MAX_FILE and source.digest(path.read_bytes()) == sha:
                    return path
            temporary = path.with_name(sha + '.' + secrets.token_hex(8) + '.tmp')
            try:
                with temporary.open('xb') as out:
                    os.chmod(temporary, 0o600)
                    out.write(raw); out.flush(); os.fsync(out.fileno())
                os.replace(temporary, path)
            finally:
                temporary.unlink(missing_ok=True)
        info = plain(path)
        if info.st_size > source.MAX_FILE or source.digest(path.read_bytes()) != sha:
            raise ValueError('cached_source_digest_mismatch')
        return path

    # @chain-region Workspaces._load | calls: ValueError, document, plain, record.get, self._path, self._recover, source.validate_manifest
    def _load(self, identifier):
        record = document(self._path('records', identifier, '.json'))
        if record.get('scope') != self.scope or record.get('id') != identifier:
            raise ValueError('workspace_account_mismatch')
        source.validate_manifest(record['files'])
        if record.get('transition'):
            self._recover(record)
        plain(self._path('trees', identifier), True)
        return record

    # @chain-region Workspaces._download_blob | calls: ValueError, any, atomic, base64.b64decode, digest.hexdigest, digest.update, document, getattr …
    def _download_blob(self, revision, name, sha, size):
        if type(size) is not int or not 0 <= size <= source.MAX_FILE:
            raise ValueError('source_archive_size_mismatch')
        try:
            return self._blob(sha).read_bytes()
        except FileNotFoundError:
            pass
        except ValueError as error:
            if str(error) != 'cached_source_digest_mismatch':
                raise
        if size == 0:
            self._blob(sha, b'')
            return b''
        partial = self._path('blobs', sha, '.partial')
        record = self._path('blobs', sha, '.partial.json')
        identity = {'revision': revision, 'path': name, 'sha256': sha, 'bytes': size}
        offset, digest = 0, hashlib.sha256()
        try:
            saved = document(record)
            plain(partial)
            if saved['identity'] != identity or type(saved['received']) is not int or not 0 <= saved['received'] <= size:
                raise ValueError('source_segment_record_invalid')
            if partial.stat().st_size < saved['received']: raise ValueError('source_segment_record_invalid')
            with partial.open('r+b') as stream:
                stream.truncate(saved['received'])
                digest.update(stream.read())
            if digest.hexdigest() != saved['prefix_sha256']: raise ValueError('source_segment_record_invalid')
            offset = saved['received']
        except (OSError, ValueError, TypeError, KeyError):
            partial.unlink(missing_ok=True); record.unlink(missing_ok=True)
            digest = hashlib.sha256()
        progress = getattr(self, 'source_file_progress', lambda *_: None)
        progress(name, offset, size)
        while offset < size:
            limit = min(1024 * 1024, size - offset)
            page = self.call('/engineering/file?' + urlencode({'revision': revision, 'path': name, 'offset': offset, 'limit': limit, 'transfer': 1}))
            if any(page.get(k) != value for k, value in {'revision': revision, 'path': name, 'sha256': sha, 'bytes': size, 'offset': offset}.items()):
                raise ValueError('source_segment_identity_mismatch')
            try: raw = base64.b64decode(page['base64'], validate=True)
            except (ValueError, KeyError, TypeError): raise ValueError('source_segment_encoding') from None
            if (not 0 < len(raw) <= limit or page.get('chunk_bytes') != len(raw) or
                    source.digest(raw) != page.get('chunk_sha256') or
                    page.get('next_offset') != (offset + len(raw) if offset + len(raw) < size else None)):
                raise ValueError('source_segment_digest_mismatch')
            with partial.open('ab') as stream:
                stream.write(raw); stream.flush(); os.fsync(stream.fileno())
            digest.update(raw); offset += len(raw)
            atomic(record, {'identity': identity, 'received': offset, 'prefix_sha256': digest.hexdigest()})
            progress(name, offset, size)
        if digest.hexdigest() != sha:
            partial.unlink(missing_ok=True); record.unlink(missing_ok=True)
            raise ValueError('source_digest_mismatch')
        raw = partial.read_bytes()
        self._blob(sha, raw)
        partial.unlink(missing_ok=True); record.unlink(missing_ok=True)
        return raw

    # @chain-region Workspaces.download | calls: ValueError, atomic, base64.b64decode, cached.exists, document, getattr, isinstance, item.get …
    def download(self, revision, fresh=False, reuse=None):
        if not isinstance(revision, str) or not source.HEX.fullmatch(revision):
            raise ValueError('invalid_source_revision')
        cached = self._path('sources',revision,'.json')
        if cached.exists() and not fresh:
            value=document(cached)
            if (value.get('revision')!=revision or source.revision_id(value.get('base'),value.get('files'),value.get('task_id'))!=revision):
                raise ValueError('cached_source_manifest_changed')
            # The manifest is immutable. Materialization still verifies every blob byte.
            return value | {'from_cache':True}
        offset, files, total_bytes, identity = 0, {}, 0, None
        archive_query = {'revision': revision, 'segments': 1}
        if reuse and not fresh and self._path('sources',reuse,'.json').exists():
            archive_query['reuse'] = reuse
        progress = getattr(self, 'source_progress', lambda *_: None)
        partial = self._path('sources', revision, '.partial.json')
        if partial.exists() and not fresh:
            try:
                saved = document(partial)
                source.validate_manifest(saved['files'])
                if (saved['identity']['revision'] != revision or saved['offset'] != len(saved['files']) or
                    not 0 < saved['offset'] <= saved['identity']['total'] <= source.MAX_FILES):
                    raise ValueError('source_resume_invalid')
                size = sum(self._blob(sha).stat().st_size for sha in saved['files'].values())
                if size != saved['bytes'] or size > source.MAX_TREE: raise ValueError('source_resume_invalid')
                offset, files, total_bytes, identity = saved['offset'], saved['files'], size, saved['identity']
                progress(offset, identity['total'])
            except (ValueError, KeyError, TypeError, OSError):
                partial.unlink(missing_ok=True)
        while identity is None or offset < identity['total']:
            for attempt in range(3):
                try:
                    page = self.call('/engineering/archive?' + urlencode({**archive_query, 'offset': offset}))
                    break
                except Exception as error:
                    delay=getattr(error,'retry_after',0)
                    if getattr(error,'status',0)!=429 or attempt==2 or not 0<delay<=60:raise
                    time.sleep(delay)
            current = {k: page.get(k) for k in ('revision', 'base', 'task_id', 'manifest_sha256', 'total')}
            if identity is None: identity = current
            if (current != identity or current['revision'] != revision or
                type(current['total']) is not int or not 1 <= current['total'] <= source.MAX_FILES or
                page.get('offset') != offset or not isinstance(page.get('files'), list) or not 1 <= len(page['files']) <= 100):
                raise ValueError('source_archive_identity_mismatch')
            progress(offset, current['total'])
            for item in page['files']:
                name = source.source_path(item.get('path'))
                sha = item.get('sha256')
                if name in files or not isinstance(sha, str) or not source.HEX.fullmatch(sha):
                    raise ValueError('source_archive_duplicate_or_invalid')
                if item.get('segmented') is True or (item.get('reused') is True and 'reuse' in archive_query):
                    raw = self._download_blob(revision, name, sha, item.get('bytes'))
                else:
                    try: raw = base64.b64decode(item['base64'], validate=True)
                    except (ValueError, KeyError, TypeError): raise ValueError('source_archive_encoding') from None
                if type(item.get('bytes')) is not int or len(raw) != item['bytes']:
                    raise ValueError('source_archive_size_mismatch')
                total_bytes += len(raw)
                if total_bytes > source.MAX_TREE: raise ValueError('manifest_size')
                source.validate_blob(name, raw)
                self._blob(sha, raw)
                files[name] = sha
            next_offset = page.get('next_offset')
            completed = offset + len(page['files'])
            if next_offset is None and completed != current['total']:
                raise ValueError('source_archive_cursor_mismatch')
            if type(next_offset) is not int or next_offset != offset + len(page['files']) or next_offset >= current['total']:
                if next_offset is not None: raise ValueError('source_archive_cursor_mismatch')
            offset = completed
            atomic(partial, {'identity': identity, 'offset': offset, 'files': files, 'bytes': total_bytes})
            progress(offset, current['total'])
        source.validate_manifest(files)
        if (len(files) != identity['total'] or source.digest(source.canonical(files).encode()) != identity['manifest_sha256'] or
            source.revision_id(identity['base'], files, identity['task_id']) != revision):
            partial.unlink(missing_ok=True)
            raise ValueError('source_archive_revision_mismatch')
        value = {'revision': revision, 'base': identity['base'], 'task_id': identity['task_id'], 'files': files,
                 'bytes': total_bytes, 'downloaded': time.time()}
        atomic(self._path('sources', revision, '.json'), value)
        partial.unlink(missing_ok=True)
        return value

    # @chain-region Workspaces._materialize | calls: files.items, out.write, p.open, p.parent.mkdir, self._blob, self._blob(sha).read_bytes, sorted, source.validate_blob …
    def _materialize(self, files, target):
        source.validate_manifest(files)
        target.mkdir(mode=0o700)
        for name, sha in sorted(files.items()):
            p = target / name
            p.parent.mkdir(parents=True, exist_ok=True)
            with p.open('xb') as out:
                out.write(source.validate_blob(name, self._blob(sha).read_bytes()))
        return target

    # @chain-region Workspaces.create | calls: ID.fullmatch, ValueError, atomic, secrets.token_hex, self._materialize, self._path, self.call, self.download …
    def create(self, task_id=None, revision=None):
        task = None
        if task_id:
            if not ID.fullmatch(task_id): raise ValueError('invalid_task_id')
            task = self.call('/engineering/task?' + urlencode({'id': task_id}))['task']
        revision = revision or (task['base'] if task else self.call('/engineering/overview')['repository']['cloud'])
        if not revision: raise ValueError('source_pending')
        snapshot = self.download(revision)
        identifier = secrets.token_hex(16)
        record = {'id': identifier, 'scope': self.scope, 'agent_id': self.secret['id'], 'task_id': task_id,
                  'base': revision, 'files': snapshot['files'], 'created': time.time(), 'updated': time.time(), 'publications': {}}
        self._materialize(record['files'], self._path('trees', identifier))
        atomic(self._path('records', identifier, '.json'), record)
        return self.status(identifier)

    # @chain-region Workspaces.recover | calls: ID.fullmatch, ValueError, atomic, secrets.token_hex, self._materialize, self._path, self.call, self.download …
    def recover(self, task_id, revision):
        """Create a fresh editable tree from a handed-over cloud candidate."""
        if not ID.fullmatch(task_id or ''): raise ValueError('invalid_task_id')
        task = self.call('/engineering/task?' + urlencode({'id':task_id}))['task']
        if task['owner'] != self.secret['user_id'] or task['agent_id'] != self.secret['id']:
            raise ValueError('task_owner_required')
        recovered = self.download(revision)
        if recovered['task_id'] != task_id: raise ValueError('handoff_source_task_mismatch')
        original = self.download(task['base'])
        identifier = secrets.token_hex(16)
        record = {'id':identifier,'scope':self.scope,'agent_id':self.secret['id'],'task_id':task_id,
                  'base':task['base'],'files':original['files'],'recovered_from':revision,
                  'created':time.time(),'updated':time.time(),'publications':{}}
        self._materialize(recovered['files'],self._path('trees',identifier))
        atomic(self._path('records',identifier,'.json'),record)
        return self.status(identifier) | {'recovered_from':revision,'prior_workspaces_untouched':True}

    # @chain-region Workspaces.scan | calls: Path, ValueError, directory.relative_to, directory.relative_to(tree).as_posix, len, os.walk, p.read_bytes, p.relative_to …
    def scan(self, tree, persist=False):
        plain(tree, True)
        files, count, total = {}, 0, 0
        for parent, directories, names in os.walk(tree, followlinks=False):
            count += len(directories) + len(names)
            if count > 20000: raise ValueError('workspace_entry_limit')
            for name in directories:
                directory = Path(parent) / name
                plain(directory, True)
                source.source_path(directory.relative_to(tree).as_posix())
            for name in names:
                p = Path(parent) / name
                relative = source.source_path(p.relative_to(tree).as_posix())
                before = plain(p)
                if before.st_size > source.MAX_FILE: raise ValueError('source_file_too_large')
                total += before.st_size
                if total > source.MAX_TREE or len(files) >= source.MAX_FILES: raise ValueError('manifest_size')
                raw = p.read_bytes()
                after = plain(p)
                if (before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_ino, after.st_size, after.st_mtime_ns) or len(raw) != before.st_size:
                    raise ValueError('source_changed_while_reading')
                sha = source.digest(raw)
                source.validate_blob(relative, raw)
                if persist: self._blob(sha, raw)
                files[relative] = sha
        source.validate_manifest(files)
        return files

    # @chain-region Workspaces.changes | calls: after.get, after.keys, before.get, before.keys, sorted
    @staticmethod
    def changes(before, after):
        return [{'path': name, 'before': before.get(name), 'sha256': after.get(name),
                 'kind': 'added' if name not in before else 'deleted' if name not in after else 'modified'}
                for name in sorted(before.keys() | after.keys()) if before.get(name) != after.get(name)]

    # @chain-region Workspaces.status | calls: exclusive, len, record.get, self._load, self._path, self.changes, self.scan, str
    def status(self, identifier):
        with exclusive(self._path('locks', identifier, '.lock')):
            record = self._load(identifier)
            tree = self._path('trees', identifier)
            current = self.scan(tree)
            return {'id': identifier, 'path': str(tree), 'task_id': record['task_id'], 'base': record['base'],
                    'files': len(current), 'changes': self.changes(record['files'], current),
                    'offline_cache': True, 'cloud_status_verified': False, 'executes_candidate_code': False,
                    'last_snapshot': record.get('last_snapshot'), 'agent_id': record['agent_id'],
                    'upstream':record.get('upstream'), 'last_sync':record.get('last_sync'),
                    'cloud_draft':record.get('cloud_draft'), 'fusion_queue':record.get('fusion_queue')}

    # @chain-region Workspaces.list | calls: (self.root / 'records').glob, document, document(p).get, sorted
    def list(self):
        return [{'id': p.stem, 'base': document(p).get('base'), 'task_id': document(p).get('task_id')}
                for p in sorted((self.root / 'records').glob('*.json'))]

    # @chain-region Workspaces._snapshot | calls: atomic, record.update, self._path, self.scan, source.canonical, source.canonical(value).encode, source.digest, time.time
    def _snapshot(self, record):
        files = self.scan(self._path('trees', record['id']), persist=True)
        value = {'workspace_id': record['id'], 'base': record['base'], 'files': files, 'task_id': record['task_id']}
        snapshot_id = source.digest(source.canonical(value).encode())
        atomic(self._path('snapshots', snapshot_id, '.json'), {**value, 'id': snapshot_id})
        record.update(last_snapshot=snapshot_id, updated=time.time())
        atomic(self._path('records', record['id'], '.json'), record)
        return {**value, 'id': snapshot_id}

    # @chain-region Workspaces.snapshot | calls: exclusive, len, self._load, self._path, self._snapshot
    def snapshot(self, identifier):
        with exclusive(self._path('locks', identifier, '.lock')):
            value = self._snapshot(self._load(identifier))
            return {k: value[k] for k in ('id', 'workspace_id', 'base', 'task_id')} | {'files': len(value['files']), 'synced_to_cloud': False}

    # @chain-region Workspaces.preview | calls: ValueError, document, len, self._load, self._materialize, self._path, self.scan, source.canonical …
    def preview(self, snapshot_id):
        value = document(self._path('snapshots', snapshot_id, '.json'))
        identifier = value.pop('id', None)
        if identifier != snapshot_id or source.digest(source.canonical(value).encode()) != snapshot_id:
            raise ValueError('local_snapshot_digest_mismatch')
        self._load(value['workspace_id'])
        target = self._path('previews', snapshot_id)
        if target.exists():
            if self.scan(target) != value['files']: raise ValueError('preview_modified')
        else:
            self._materialize(value['files'], target)
        return {'snapshot': snapshot_id, 'path': str(target), 'base': value['base'],
                'manifest_sha256': source.digest(source.canonical(value['files']).encode()), 'files': len(value['files']),
                'execution': 'source_only_not_executed', 'task_id': value['task_id']}

    # @chain-region Workspaces.diff | calls: ''.join, current.get, difflib.unified_diff, exclusive, len, new.splitlines, old.splitlines, record['files'].get …
    def diff(self, identifier, path):
        source.source_path(path)
        with exclusive(self._path('locks', identifier, '.lock')):
            record = self._load(identifier)
            current = self.scan(self._path('trees', identifier), persist=True)
            if record['files'].get(path) == current.get(path): return {'path': path, 'diff': '', 'changed': False}
            try:
                old = self._blob(record['files'][path]).read_text(encoding='utf-8') if path in record['files'] else ''
                new = self._blob(current[path]).read_text(encoding='utf-8') if path in current else ''
            except UnicodeError:
                return {'path': path, 'before': record['files'].get(path), 'after': current.get(path), 'binary': True}
            text = ''.join(difflib.unified_diff(old.splitlines(True), new.splitlines(True), fromfile='base/' + path, tofile='work/' + path))
            return {'path': path, 'diff': text[:65536], 'truncated': len(text) > 65536, 'changed': True}

    # @chain-region Workspaces.publish | calls: ('/engineering/snapshots/create\n' + source.canonical(body)).encode, (pending.get('upload_id', local_id) + change['sha256'] + str(offset)).encode, ValueError, any, atomic, base64.b64encode, base64.b64encode(chunk).decode, document …
    def publish(self, identifier, message):
        if not isinstance(message, str) or not 4 <= len(message) <= 500: raise ValueError('invalid_commit_message')
        with exclusive(self._path('locks', identifier, '.lock')):
            record = self._load(identifier)
            if not record['task_id']: raise ValueError('task_required_for_publish')
            task = self.call('/engineering/task?' + urlencode({'id': record['task_id']}))['task']
            if task['owner'] != self.secret['user_id'] or task['agent_id'] != self.secret['id']:
                raise ValueError('resume_own_task_before_publish')
            snapshot = self._snapshot(record)
            local_id = snapshot['id']
            if local_id in record['publications']:
                return {'local_snapshot': local_id, **record['publications'][local_id], 'recovered': True}
            pending_file = self._path('pending', local_id, '.json')
            if pending_file.exists():
                pending = document(pending_file)
                if pending.get('workspace_id') != identifier: raise ValueError('pending_workspace_mismatch')
                body=pending['body']
                previous_agent=pending.get('agent_id',record.get('agent_id',self.secret['id']))
                receipt=self.call('/agent/receipt?'+urlencode({'request_id':body['request_id'],'agent_id':previous_agent}))
                if receipt.get('found'):
                    expected=source.digest(('/engineering/snapshots/create\n'+source.canonical(body)).encode())
                    if receipt.get('body_hash')!=expected or not isinstance(receipt.get('result'),dict):
                        raise ValueError('candidate_receipt_mismatch')
                    result=receipt['result']
                    expected_revision=source.revision_id(body['base'],snapshot['files'],body['task_id'])
                    if result.get('revision')!=expected_revision or result.get('head_unchanged') is not True:
                        raise ValueError('candidate_receipt_mismatch')
                    record['publications'][local_id]=result
                    atomic(self._path('records',identifier,'.json'),record)
                    pending_file.unlink(missing_ok=True)
                    return {'local_snapshot':local_id,**result,'recovered':True}
                if body['version']!=task['version'] or previous_agent!=self.secret['id']:
                    # The original request has no receipt and its task/Agent
                    # version can no longer commit. Preserve it before binding
                    # this same fixed source to the current authorized task.
                    if task['base']!=record['base']:raise ValueError('workspace_base_changed_rebase_required')
                    if task['state']=='integrated':raise ValueError('task_closed')
                    for item in body['changes']:
                        if not any(item['path']==prefix or item['path'].startswith(prefix+'/') for prefix in task['scope']):
                            raise ValueError('task_scope_denied')
                    pending.setdefault('previous_requests',[]).append({'agent_id':previous_agent,'body':body})
                    body={**body,'request_id':'workspace-commit-'+local_id+'-v'+str(task['version']),
                          'version':task['version']}
                    pending.update(body=body,agent_id=self.secret['id'],upload_id=body['request_id'])
                    atomic(pending_file,pending)
            else:
                if task['base'] != record['base']: raise ValueError('workspace_base_changed_rebase_required')
                changes = self.changes(record['files'], snapshot['files'])
                if not 1 <= len(changes) <= 64: raise ValueError('commit_requires_one_to_64_changed_files')
                for item in changes:
                    if not any(item['path'] == prefix or item['path'].startswith(prefix + '/') for prefix in task['scope']):
                        raise ValueError('task_scope_denied')
                body = {'request_id': 'workspace-commit-' + local_id, 'task_id': task['id'], 'version': task['version'],
                        'base': record['base'], 'message': message, 'changes': [{k: item[k] for k in ('path', 'sha256')} for item in changes]}
                pending = {'workspace_id': identifier, 'body': body,'agent_id':self.secret['id']}
                atomic(pending_file, pending)
            body = pending['body']
            for change in body['changes']:
                if change['sha256'] is None: continue
                raw = self._blob(change['sha256']).read_bytes()
                for offset in range(0, max(1, len(raw)), 12288):
                    chunk = raw[offset:offset + 12288]
                    upload = {'task_id': body['task_id'], 'version': body['version'],
                              'request_id': 'workspace-upload-' + source.digest((pending.get('upload_id',local_id) + change['sha256'] + str(offset)).encode()),
                              'sha256': change['sha256'], 'size': len(raw), 'offset': offset, 'data': base64.b64encode(chunk).decode()}
                    self.call('/engineering/upload', upload)
            result = self.call('/engineering/snapshots/create', body)
            expected = source.revision_id(body['base'], snapshot['files'], body['task_id'])
            if result.get('revision') != expected or result.get('head_unchanged') is not True:
                raise ValueError('candidate_receipt_mismatch')
            record['publications'][local_id] = result
            atomic(self._path('records', identifier, '.json'), record)
            pending_file.unlink(missing_ok=True)
            return {'local_snapshot': local_id, **result}

    # @chain-region Workspaces._recover | calls: ID.fullmatch, ValueError, atomic, backup.exists, plain, record.pop, record.update, self._path …
    def _recover(self, record):
        transition = record['transition']
        for key in ('stage', 'backup'):
            if not ID.fullmatch(transition.get(key, '')): raise ValueError('workspace_transition_invalid')
        new_base = transition['new_base']
        if not source.HEX.fullmatch(new_base): raise ValueError('workspace_transition_invalid')
        files = source.validate_manifest(transition['files'])
        stage, backup = self.root / 'staging' / transition['stage'], self.root / 'history' / transition['backup']
        tree = self._path('trees', record['id'])
        if stage.exists():
            if self.scan(stage) != files: raise ValueError('workspace_staging_digest_mismatch')
            if tree.exists():
                if backup.exists(): raise ValueError('workspace_transition_conflict')
                plain(tree, True); tree.rename(backup)
            stage.rename(tree)
        elif not tree.exists():
            raise ValueError('workspace_transition_incomplete_preserve_history')
        if self.scan(tree) != files: raise ValueError('workspace_transition_changed_preserve_history')
        record.update(base=new_base, files=transition['base_files'], updated=time.time())
        record.pop('transition')
        atomic(self._path('records', record['id'], '.json'), record)

    # @chain-region Workspaces.rebase | calls: (identifier + revision + source.canonical(merged)).encode, ValueError, atomic, conflicts.append, exclusive, isinstance, local.get, local.keys …
    def rebase(self, identifier, revision=None, resolutions=None, *, sync_version=None):
        with exclusive(self._path('locks', identifier, '.lock')):
            record = self._load(identifier)
            if sync_version is not None and (sync_version, revision) != (record.get('upstream_version'), record.get('upstream')):
                return {'id':identifier, 'applied':False, 'base':record['base'], 'upstream':record['upstream'],
                        'repository_version':record['upstream_version'], 'update_available':record['base']!=record['upstream']}
            revision = revision or self.call('/engineering/overview')['repository']['cloud']
            upstream = self.download(revision, reuse=record['base'])
            local = self.scan(self._path('trees', identifier), persist=True)
            merged, conflicts = {}, []
            resolutions = resolutions or {}
            if not isinstance(resolutions, dict): raise ValueError('invalid_conflict_resolutions')
            used = set()
            for path in sorted(record['files'].keys() | local.keys() | upstream['files'].keys()):
                old, ours, theirs = record['files'].get(path), local.get(path), upstream['files'].get(path)
                if ours == old: selected = theirs
                elif theirs == old or ours == theirs: selected = ours
                elif path in resolutions and resolutions[path] in ('local', 'upstream'):
                    selected = ours if resolutions[path] == 'local' else theirs
                    used.add(path)
                else:
                    conflicts.append({'path': path, 'base': old, 'local': ours, 'upstream': theirs})
                    continue
                if selected is not None: merged[path] = selected
            if set(resolutions) != used: raise ValueError('resolution_must_match_actual_conflict')
            if conflicts: return {'id': identifier, 'applied': False, 'base': record['base'], 'upstream': revision, 'conflicts': conflicts}
            source.validate_manifest(merged)
            if record['task_id']:
                task = self.call('/engineering/task?' + urlencode({'id': record['task_id']}))['task']
                if task['owner'] != self.secret['user_id'] or task['agent_id'] != self.secret['id'] and task['state']!='integrated':
                    raise ValueError('resume_own_task_before_rebase')
                if task['base'] != revision and task['state']!='integrated':
                    self.call('/engineering/tasks/update', {'request_id': 'workspace-rebase-' + source.digest((identifier + revision + source.canonical(merged)).encode()),
                              'task_id': task['id'], 'version': task['version'], 'base': revision})
            self._snapshot(record)
            stage_id, backup_id = secrets.token_hex(16), secrets.token_hex(16)
            self._materialize(merged, self.root / 'staging' / stage_id)
            if self.scan(self._path('trees',identifier)) != local:
                raise ValueError('workspace_changed_during_sync_preserved')
            record['transition'] = {'stage': stage_id, 'backup': backup_id, 'new_base': revision,
                                    'files': merged, 'base_files': upstream['files']}
            atomic(self._path('records', identifier, '.json'), record)
            self._recover(record)
            return {'id': identifier, 'applied': True, 'base': revision, 'conflicts': [],
                    'changes': self.changes(upstream['files'], merged), 'previous_tree_preserved': True}


# @chain-region add_parser | calls: commands.add_parser, parser.add_argument
def add_parser(commands):
    parser = commands.add_parser('work', help='Persistent local source workspace; execution uses explicit local or VM runners')
    parser.add_argument('operation', choices=['list', 'fetch', 'checkout', 'recover', 'status', 'diff', 'snapshot', 'preview', 'commit', 'rebase',
                                            'sync','backup','restore-draft','attach','read','watch','cycle'])
    parser.add_argument('--id')
    parser.add_argument('--task')
    parser.add_argument('--revision')
    parser.add_argument('--snapshot')
    parser.add_argument('--path')
    parser.add_argument('--message')
    parser.add_argument('--resolutions', type=Path)
    parser.add_argument('--draft');parser.add_argument('--agenda',default='')
    parser.add_argument('--apply',action='store_true');parser.add_argument('--plan',type=Path)
    parser.add_argument('--complete-task',action='store_true')
    parser.add_argument('--interval',type=float,default=10);parser.add_argument('--cycles',type=int,default=1)


# @chain-region run | calls: LiveClient, ValueError, Workspaces, client.annotate, client.attach, client.backup, client.cycle, client.restore …
def run(args, secret):
    work = Workspaces(secret)
    operation = args.operation
    if operation == 'list': return {'workspaces': work.list(), 'offline_cache': True}
    if operation == 'fetch': return work.download(args.revision,fresh=True)
    if operation == 'checkout': return work.create(args.task, args.revision)
    if operation == 'recover': return work.recover(args.task,args.revision)
    if operation == 'preview': return work.preview(args.snapshot)
    if operation in ('sync','backup','restore-draft','attach','read','watch','cycle'):
        try:from .live_work import LiveClient,recovery,pause
        except ImportError:from live_work import LiveClient,recovery,pause
        client=LiveClient(work)
        if operation=='restore-draft':return client.restore(args.draft)
        if not args.id:raise ValueError('workspace_id_required')
        if operation=='sync':return client.sync(args.id,args.apply)
        if operation=='backup':return client.backup(args.id,args.message or 'Saved personal work',args.agenda)
        if operation=='attach':return client.attach(args.id,args.task)
        if operation=='read':return client.annotate(args.id,args.path)
        if operation=='cycle':
            if not args.plan:raise ValueError('local_plan_required')
            return client.cycle(args.id,document(args.plan),args.message or 'Submit the current small engineering result',args.complete_task)
        if not 2<=args.interval<=60 or not 0<=args.cycles<=10000:raise ValueError('invalid_watch_options')
        cycles=0;result=None
        while args.cycles==0 or cycles<args.cycles:
            backoff=args.interval
            try:
                result=client.watch_tick(args.id,document(args.plan) if args.plan else None,
                                         args.message or 'Continuous personal checkpoint',args.agenda,args.apply)
            except Exception as error:
                result=recovery(error)
                if result is None:raise
                backoff=max(backoff,result['retry_after'])
            cycles+=1
            if args.cycles==0:print(source.canonical(result),flush=True)
            if args.cycles and cycles>=args.cycles:break
            pause(backoff)
        return {'cycles':cycles,'result':result,'download_only':not args.apply}
    if not args.id: raise ValueError('workspace_id_required')
    if operation == 'status': return work.status(args.id)
    if operation == 'diff': return work.diff(args.id, args.path)
    if operation == 'snapshot': return work.snapshot(args.id)
    if operation == 'commit': return work.publish(args.id, args.message)
    if operation == 'rebase': return work.rebase(args.id, args.revision, document(args.resolutions) if args.resolutions else None)
    raise ValueError('unknown_workspace_operation')
