# @file-map:start
# 文件: link/office/service/evidence.py
# 位置: 二环·工位服务 | 本机控制、接入、凭据、工位与租约的HTTP服务。
# 约束: 服务绑定本机并核对所有者身份；凭据与工作正文不因短暂失联清空；关闭使用租约排空
# 下游: 无已解析的项目内静态导入
# 上游: link/office/service/main.py
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: python -X utf8 -B -m unittest discover -s link/office/tests/service
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   read_brief | function
#   read_brief.reference | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Explicitly registered engineering briefs, with source freshness checks."""

import datetime as dt
import hashlib
import json
from pathlib import Path


LIMIT = 262144


# @chain-region read_brief | calls: (root / location).resolve, Path, Path(configuration['root']).resolve, Path(location).is_absolute, ValueError, dt.datetime.now, dt.datetime.now(dt.timezone.utc).isoformat, feature.update …
def read_brief(configuration):
    path = Path(configuration["path"])
    with path.open("rb") as stream:
        raw = stream.read(LIMIT + 1)
    if len(raw) > LIMIT:
        raise ValueError("brief_too_large")
    value = json.loads(raw.decode("utf-8-sig"))
    if not isinstance(value, dict) or not isinstance(value.get("features"), list):
        raise ValueError("invalid_brief")
    root = Path(configuration["root"]).resolve()

    # @chain-region read_brief.reference | calls: (root / location).resolve, Path, Path(location).is_absolute, file.is_relative_to, file.read_bytes, file.stat, hashlib.sha256, hashlib.sha256(file.read_bytes()).hexdigest …
    def reference(item):
        if not isinstance(item, dict):
            return {"freshness": "unknown"}
        result = {
            key: item[key]
            for key in ("path", "line", "name", "sha256", "observed_at")
            if key in item
        }
        result["freshness"] = "unknown"
        location = item.get("path")
        expected = item.get("sha256")
        if not isinstance(location, str) or not isinstance(expected, str):
            return result
        file = (root / location).resolve()
        if Path(location).is_absolute() or not file.is_relative_to(root):
            result["freshness"] = "outside_project"
            return result
        try:
            if file.stat().st_size > 16 * 1024 * 1024:
                return result
            actual = hashlib.sha256(file.read_bytes()).hexdigest()
            result["freshness"] = "matches_record" if actual == expected else "source_changed"
        except OSError:
            result["freshness"] = "unavailable"
        return result

    result = {
        key: value[key]
        for key in (
            "schema_version",
            "project_id",
            "workstation_id",
            "observed_at",
            "scope",
            "coverage",
        )
        if key in value
    }
    result.update(
        source_ref=str(path),
        source_sha256=hashlib.sha256(raw).hexdigest(),
        checked_at=dt.datetime.now(dt.timezone.utc).isoformat(),
        features=[],
    )
    for item in value["features"][:200]:
        if not isinstance(item, dict):
            continue
        feature = {key: item[key] for key in ("id", "summary", "verification") if key in item}
        feature.update(source=reference(item.get("source")), test=reference(item.get("test")))
        result["features"].append(feature)
    result["verification_receipt"] = reference(value.get("verification_receipt"))
    result["needs_coordination"] = [
        v[:2000] for v in value.get("needs_coordination", [])[:30] if isinstance(v, str)
    ]
    return result
