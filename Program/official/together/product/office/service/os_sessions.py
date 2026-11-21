# @file-map:start
# 文件: link/office/service/os_sessions.py
# 位置: 二环·工位服务 | 本机控制、接入、凭据、工位与租约的HTTP服务。
# 约束: 服务绑定本机并核对所有者身份；凭据与工作正文不因短暂失联清空；关闭使用租约排空
# 下游: link/office/service/link_paths.py
# 上游: link/office/service/collaboration.py, link/office/service/main.py, link/office/service/product_commands.py
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: python -X utf8 -B -m unittest discover -s link/office/tests/service
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   read_json | function
#   bridge_config | function
#   OSSessions | class
#   OSSessions.__init__ | function
#   OSSessions.refresh | function
#   OSSessions.sources | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""本产品Matrix的本机登记；只有原Bridge执行器可以消费任务。"""

import hashlib
import json
from pathlib import Path
import re
import threading


# @chain-region read_json | calls: ValueError, hashlib.sha256, hashlib.sha256(raw).hexdigest, isinstance, json.loads, len, path.open, raw.decode …
def read_json(path):
    with path.open("rb") as stream:
        raw = stream.read(32769)
    if len(raw) > 32768:
        raise ValueError("local_registration_too_large")
    value = json.loads(raw.decode("utf-8-sig"))
    if not isinstance(value, dict):
        raise ValueError("local_registration_object_required")
    return value, hashlib.sha256(raw).hexdigest()


# @chain-region bridge_config | calls: Path, ValueError, read_json, source.get
def bridge_config(source):
    # 登记和策略均固定于一次启动。更换发现文件或改策略不能沿用旧动作身份。
    if source.get("registration_ref"):
        _, checksum = read_json(Path(source["registration_ref"]))
        if checksum != source["registration_sha256"]:
            raise ValueError("os_registration_changed")
    value, checksum = read_json(Path(source["config_ref"]))
    if source.get("config_sha256") and checksum != source["config_sha256"]:
        raise ValueError("os_registration_policy_changed")
    return value


# @chain-region OSSessions | calls: (os_root / 'Aieyra OS.exe').resolve, Path, Path(data_dir).resolve, Path(item).is_absolute, Path(item).resolve, Path(item['executable']).is_absolute, Path(item['executable']).resolve, ValueError …
class OSSessions:
    # @chain-region OSSessions.__init__ | calls: (os_root / 'Aieyra OS.exe').resolve, Path, Path(data_dir).resolve, Path(item).is_absolute, Path(item).resolve, ValueError, config.get, db.execute …
    def __init__(self, config, data_dir, product_root, store):
        self.store = store
        self.static = list(config.get("collaboration_sources", []))
        self.directory = Path(data_dir).resolve() / "os-sessions"
        self.adapter = product_root / "service/product_bridge"
        from link_paths import os_source_root
        os_root = os_source_root(product_root)
        self.executables = (
            {str((os_root / "Aieyra OS.exe").resolve()).casefold()} if os_root else set()
        )
        for item in config.get("os_runtime_executables", []):
            if not isinstance(item, str) or not Path(item).is_absolute():
                raise ValueError("explicit_os_executable_required")
            self.executables.add(str(Path(item).resolve()).casefold())
        self.enabled = config.get("os_runtime_registration", True) is True
        self.lock = threading.Lock()
        self.dynamic = {}
        if self.enabled:
            with store.db() as db:
                for row in db.execute(
                    "SELECT payload FROM cache WHERE id LIKE 'os-registration:%' ORDER BY id DESC LIMIT 16"
                ):
                    saved = json.loads(row[0])
                    if saved.get("runtime_executable", "").casefold() in self.executables:
                        saved["adapter_dir"] = str(self.adapter)
                        self.dynamic[saved["id"]] = saved
        self.refresh()

    # @chain-region OSSessions.refresh | calls: Path, Path(item['executable']).is_absolute, Path(item['executable']).resolve, ValueError, any, bridge_config, db.execute, db.execute('SELECT payload FROM cache WHERE id=?', (key,)).fetchone …
    def refresh(self):
        if not self.enabled:
            return
        # 仅本服务既有数据目录，最多保留16个登记；不扫描用户配置或其他进程。
        try:
            paths = sorted(
                self.directory.glob("os-*/source.json"),
                key=lambda p: p.stat().st_mtime_ns,
                reverse=True,
            )[:16]
        except OSError:
            return
        rows = {}
        for path in paths:
            try:
                item, checksum = read_json(path)
                if set(item) != {
                    "version",
                    "id",
                    "session_id",
                    "pid",
                    "executable",
                    "created_at",
                    "config_sha256",
                }:
                    raise ValueError("invalid_os_registration")
                if (
                    item["version"] != 1
                    or not re.fullmatch(r"os-[a-f0-9]{40}", item["id"])
                    or path.parent.name != item["id"]
                ):
                    raise ValueError("invalid_os_registration")
                if (
                    not Path(item["executable"]).is_absolute()
                    or str(Path(item["executable"]).resolve()).casefold() not in self.executables
                ):
                    raise ValueError("foreign_os_executable")
                source = dict(
                    id=item["id"],
                    name="Matrix",
                    project="os",
                    adapter_dir=str(self.adapter),
                    runtime_executable=str(Path(item["executable"]).resolve()),
                    config_ref=str(path.parent / "bridge.json"),
                    config_sha256=item["config_sha256"],
                    registration_ref=str(path),
                    registration_sha256=checksum,
                )
                value = bridge_config(source)
                expected = dict(
                    expected_session=item["session_id"],
                    expected_pid=item["pid"],
                    expected_executable=item["executable"],
                    expected_created_at=item["created_at"],
                    state_dir=str(path.parent / "bridge"),
                    work_root=str(path.parent / "work"),
                )
                if (
                    any(value.get(key) != val for key, val in expected.items())
                    or value.get("mode") != "os"
                ):
                    raise ValueError("os_registration_binding_mismatch")
                # 同一持久登记不能通过服务重启换策略；共用Control原缓存账本。
                key = "os-registration:" + item["id"]
                with self.store.db() as db:
                    db.execute("INSERT OR IGNORE INTO cache VALUES(?,?)", (key, json.dumps(source)))
                    rows[item["id"]] = json.loads(
                        db.execute("SELECT payload FROM cache WHERE id=?", (key,)).fetchone()[0]
                    )
                    rows[item["id"]]["adapter_dir"] = str(self.adapter)
            except (OSError, ValueError, TypeError, KeyError):
                continue
        with self.lock:
            # 原登记损坏/消失仍投影旧事实并标离线，不能静默隐藏在途任务。
            for key, row in rows.items():
                if key not in self.dynamic:
                    self.dynamic[key] = row

    # @chain-region OSSessions.sources | calls: dict, len, max, self.dynamic.items
    def sources(self):
        with self.lock:
            known = {x["id"] for x in self.static}
            extra = [dict(x) for k, x in self.dynamic.items() if k not in known]
            limit = max(0, 16 - len(self.static))
            return self.static + (extra[-limit:] if limit else [])
