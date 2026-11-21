# @file-map:start
# 文件: link/office/service/paths.py
# 位置: 二环·工位服务 | 本机控制、接入、凭据、工位与租约的HTTP服务。
# 约束: 服务绑定本机并核对所有者身份；凭据与工作正文不因短暂失联清空；关闭使用租约排空
# 下游: 无已解析的项目内静态导入
# 上游: link/office/service/main.py, link/office/service/office_runtime.py
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: python -X utf8 -B -m unittest discover -s link/office/tests/service
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   installation_root | function
#   user_storage_base | function
#   storage_locator | function
#   external_path | function
#   data_root | function
#   shared_directory | function
#   configuration_file | function
#   initialize | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Software and private user storage have separate roots."""

from pathlib import Path
import json
import os
import sys

SOURCE_ROOT = Path(__file__).resolve().parents[1]


# @chain-region installation_root | calls: Path, Path(os.environ.get('AIEYRA_CONTROL_HOME', SOURCE_ROOT)).resolve, os.environ.get
def installation_root():
    return Path(os.environ.get("AIEYRA_CONTROL_HOME", SOURCE_ROOT)).resolve()


# @chain-region user_storage_base | calls: Path, Path.home, os.environ.get
def user_storage_base():
    if sys.platform == "win32":
        return Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData/Local"))
    if sys.platform == "darwin":
        return Path.home() / "Library/Application Support"
    return Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share"))


# @chain-region storage_locator | calls: Path, Path.home, ValueError, os.environ.get, target.is_absolute
def storage_locator():
    override = os.environ.get("AIEYRA_CONTROL_STORAGE")
    if override:
        target = Path(override)
        if not target.is_absolute():
            raise ValueError("storage_locator_must_be_absolute")
        return target
    if sys.platform == "win32":
        base = Path(os.environ.get("APPDATA", Path.home() / "AppData/Roaming"))
    elif sys.platform == "darwin":
        base = Path.home() / "Library/Application Support"
    else:
        base = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    return base / "Aieyra Together Link/storage.json"


# @chain-region external_path | calls: Path, SOURCE_ROOT.resolve, ValueError, installation_root, target.is_absolute, target.is_relative_to, target.resolve
def external_path(value):
    target = Path(value)
    if not target.is_absolute():
        raise ValueError("private_storage_must_be_absolute")
    target = target.resolve()
    software_roots = [installation_root(), SOURCE_ROOT.resolve()]
    for software in software_roots:
        if target == software or target.is_relative_to(software):
            raise ValueError("private_storage_must_be_outside_software")
    return target


# @chain-region data_root | calls: ValueError, any, external_path, installation_root, isinstance, json.loads, legacy.exists, legacy.iterdir …
def data_root():
    override = os.environ.get("AIEYRA_CONTROL_DATA")
    if override:
        return external_path(override)
    locator = storage_locator()
    if locator.exists():
        try:
            value = json.loads(locator.read_text(encoding="utf-8-sig"))
            if value.get("schema_version") != 1 or not isinstance(value.get("data_root"), str):
                raise ValueError()
            target = external_path(value["data_root"])
        except (OSError, ValueError, AttributeError, TypeError) as error:
            raise ValueError("invalid_storage_locator") from error
        if not target.is_dir():
            raise ValueError("configured_storage_unavailable")
        return target
    legacy = installation_root() / "data"
    if legacy.exists() and any(legacy.iterdir()):
        raise ValueError("legacy_storage_requires_explicit_migration")
    return external_path(user_storage_base() / "Aieyra Together Link/data")


# @chain-region shared_directory | calls: data_root
def shared_directory():
    return data_root() / "shared"


# @chain-region configuration_file | calls: data_root
def configuration_file():
    return data_root() / "config" / "control.json"


# @chain-region initialize | calls: (root / 'shared/projects').mkdir, (root / name).mkdir, configuration_file, data_root, installation_root, json.dump, str, target.exists …
def initialize(configuration=None):
    root = data_root()
    for name in ("config", "shared", "agents", "desktop", "logs", "cache", "updates", "backups"):
        (root / name).mkdir(parents=True, exist_ok=True)
    (root / "shared/projects").mkdir(exist_ok=True)
    target = configuration_file()
    if not target.exists():
        value = configuration or {
            "coordination_mode": "local",
            "os_runtime_registration": False,
            "hub_reconnect": False,
            "runtime_bindings": [],
            "human_projects": [],
            "resources": [],
            "local_projects": [
                {
                    "id": "os",
                    "name": "Aieyra Together Link",
                    "root": str(installation_root()),
                    "source": "README.md",
                }
            ],
        }
        # Exclusive creation preserves a concurrently created user configuration.
        try:
            with target.open("x", encoding="utf-8") as f:
                json.dump(value, f, ensure_ascii=False, indent=2)
        except FileExistsError:
            pass
    return root
