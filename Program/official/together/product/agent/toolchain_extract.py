# @file-map:start
# 文件: link/agent/toolchain_extract.py
# 位置: 二环·Agent完整链路 | 协作CLI、接续、实际启动器、工作包、源码传输和本机运行。
# 约束: 使用本人已有身份和connection，不因压缩重建身份；写操作保留request_id；未知结果查回执，凭据不进入日志与文档
# 下游: 无已解析的项目内静态导入
# 上游: tests/test_cocreation_checkout.py
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: tests/test_cocreation_checkout.py
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   extract | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Extract a checksum-verified official Go/Node ZIP without running its contents."""
import argparse
import hashlib
import os
from pathlib import Path, PurePosixPath
import secrets
import shutil
import zipfile


# @chain-region extract | calls: PurePosixPath, ValueError, archive.open, h.hexdigest, h.update, hashlib.sha256, iter, len …
def extract(archive, target, prefix, expected):
    h = hashlib.sha256()
    with archive.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''): h.update(chunk)
    if h.hexdigest() != expected: raise ValueError('toolchain_checksum')
    target.parent.mkdir(parents=True, exist_ok=True)
    stage = target.with_name(target.name + '-' + secrets.token_hex(8))
    stage.mkdir()
    try:
        total, seen = 0, set()
        with zipfile.ZipFile(archive) as z:
            if len(z.infolist()) > 60000: raise ValueError('toolchain_entries')
            for row in z.infolist():
                p = PurePosixPath(row.filename)
                if not row.filename.startswith(prefix + '/') or p.is_absolute() or '..' in p.parts or '\\' in row.filename or ':' in row.filename:
                    raise ValueError('toolchain_path')
                if row.is_dir(): continue
                name = p.relative_to(prefix).as_posix()
                if name in seen or (row.external_attr >> 16) & 0o170000 == 0o120000: raise ValueError('toolchain_link')
                seen.add(name); total += row.file_size
                if total > 2 * 1024 ** 3: raise ValueError('toolchain_size')
                output = stage / name; output.parent.mkdir(parents=True, exist_ok=True)
                with z.open(row) as source, output.open('xb') as destination: shutil.copyfileobj(source, destination, 1024 * 1024)
        if not seen: raise ValueError('toolchain_empty')
        if target.exists(): shutil.rmtree(target)
        os.replace(stage, target)
    finally:
        if stage.exists(): shutil.rmtree(stage)


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--archive', type=Path, required=True); p.add_argument('--target', type=Path, required=True)
    p.add_argument('--prefix', required=True); p.add_argument('--sha256', required=True)
    a = p.parse_args(); extract(a.archive, a.target, a.prefix, a.sha256)
