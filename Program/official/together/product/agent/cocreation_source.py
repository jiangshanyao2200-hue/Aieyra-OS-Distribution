# @file-map:start
# 文件: link/agent/cocreation_source.py
# 位置: 二环·Agent完整链路 | 协作CLI、接续、实际启动器、工作包、源码传输和本机运行。
# 约束: 使用本人已有身份和connection，不因压缩重建身份；写操作保留request_id；未知结果查回执，凭据不进入日志与文档
# 下游: link/agent/source_protocol.py, link/agent/workspace.py
# 上游: link/agent/cocreation.py, tests/test_cocreation_checkout.py
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: tests/test_cocreation_checkout.py
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   Checkout | class
#   Checkout.__init__ | function
#   Checkout.sync | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Human checkout using the same immutable cache and three-way sync as Agent workspaces."""
from pathlib import Path
import secrets
import time
try:
    from .workspace import Workspaces, plain, atomic, document, ID
    from . import source_protocol as source
except ImportError:
    from workspace import Workspaces, plain, atomic, document, ID
    import source_protocol as source


# @chain-region Checkout | calls: (self.root / name).mkdir, ID.fullmatch, Path, Path(home).resolve, ValueError, atomic, document, plain …
class Checkout:
    # Reuse byte verification, crash recovery and conflict preservation without
    # fabricating an Agent identity or exposing any publishing operation.
    _path = Workspaces._path
    _blob = Workspaces._blob
    _download_blob = Workspaces._download_blob
    _load = Workspaces._load
    download = Workspaces.download
    _materialize = Workspaces._materialize
    scan = Workspaces.scan
    _snapshot = Workspaces._snapshot
    _recover = Workspaces._recover
    rebase = Workspaces.rebase
    changes = staticmethod(Workspaces.changes)

    # @chain-region Checkout.__init__ | calls: (self.root / name).mkdir, ID.fullmatch, Path, Path(home).resolve, ValueError, plain, self.root.mkdir, server.rstrip …
    def __init__(self, home, server, account, transport, progress=lambda *_: None, file_progress=lambda *_: None):
        if not ID.fullmatch(account): raise ValueError('invalid_checkout_account')
        self.scope = {'server': server.rstrip('/'), 'user_id': account}
        self.home = Path(home).resolve()
        self.root = self.home / source.digest(source.canonical(self.scope).encode())
        self.root.mkdir(parents=True, exist_ok=True)
        plain(self.root, True)
        self.call = transport
        self.source_progress = progress
        self.source_file_progress = file_progress
        for name in ('records', 'trees', 'blobs', 'sources', 'snapshots', 'staging', 'history', 'locks'):
            (self.root / name).mkdir(exist_ok=True)
        self.file = self.root / 'checkout.json'

    # @chain-region Checkout.sync | calls: ValueError, atomic, document, repository.get, secrets.token_hex, self._load, self._materialize, self._path …
    def sync(self):
        repository = self.call('/engineering/overview')['repository']
        revision = repository.get('development', repository.get('cloud'))
        if 'development' in repository and not revision:
            raise ValueError('开发版尚未提交')
        if not source.HEX.fullmatch(revision or ''): raise ValueError('source_pending')
        if self.file.exists():
            ident = document(self.file)['id']
            row = self._load(ident)
            if row['base'] != revision:
                value = self.rebase(ident, revision)
                if not value['applied']:
                    return {**value, 'path': str(self._path('trees', ident))}
        else:
            snapshot = self.download(revision)
            ident = secrets.token_hex(16)
            row = {'id': ident, 'scope': self.scope, 'agent_id': None, 'task_id': None,
                   'base': revision, 'files': snapshot['files'], 'created': time.time(), 'updated': time.time()}
            self._materialize(row['files'], self._path('trees', ident))
            atomic(self._path('records', ident, '.json'), row)
            atomic(self.file, {'id': ident})
        tree = self._path('trees', ident)
        current = self.scan(tree, persist=True)
        return {'id': ident, 'applied': True, 'path': str(tree), 'base': revision,
                'files': current, 'conflicts': [], 'changes': self.changes(self._load(ident)['files'], current)}
