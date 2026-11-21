# @file-map:start
# 文件: link/office/service/catalog.py
# 位置: 二环·工位服务 | 本机控制、接入、凭据、工位与租约的HTTP服务。
# 约束: 服务绑定本机并核对所有者身份；凭据与工作正文不因短暂失联清空；关闭使用租约排空
# 下游: 无已解析的项目内静态导入
# 上游: link/office/service/main.py
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: python -X utf8 -B -m unittest discover -s link/office/tests/service
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   digest | function
#   server_inventory | function
#   ssh_endpoints | function
#   git_remote | function
#   collect | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""显式登记来源的资源元信息导入；不复制SSH配置、认证或原文。"""

from __future__ import annotations
import configparser
import hashlib
import ipaddress
from pathlib import Path
import re
from urllib.parse import urlsplit


# @chain-region digest | calls: hashlib.sha256, hashlib.sha256(path.read_bytes()).hexdigest, path.read_bytes
def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


# @chain-region server_inventory | calls: Path, address.replace, all, digest, headers.index, ipaddress.ip_address, len, line.startswith …
def server_inventory(source):
    path = Path(source["path"])
    lines = path.read_text(encoding="utf-8-sig").splitlines()
    allowed = ("服务器", "地址", "到期日期", "当前服务", "可用磁盘")
    rows = []
    for index in range(len(lines) - 1):
        if not lines[index].startswith("|") or not re.match(
            r"^\s*\|(?:\s*:?-+:?\s*\|)+\s*$", lines[index + 1]
        ):
            continue
        headers = [x.strip() for x in lines[index].strip("| ").split("|")]
        if not all(k in headers for k in ("服务器", "地址")):
            continue
        for line in lines[index + 2 :]:
            if not line.startswith("|"):
                break
            cells = [x.strip() for x in line.strip("| ").split("|")]
            if len(cells) != len(headers):
                continue
            values = {k: cells[headers.index(k)][:500] for k in allowed if k in headers}
            match = re.search(r"\b(?:\d{1,3}\.){3}\d{1,3}\b", values["地址"])
            if not match:
                continue
            address = str(ipaddress.ip_address(match[0]))
            rows.append(
                {
                    "id": "server-" + address.replace(".", "-"),
                    "name": values["服务器"],
                    "kind": "server",
                    "project": source.get("project", "coordination"),
                    "location": "ssh://" + address + ":22",
                    "summary": values.get("当前服务", "") + "；清单记录，未作实时探测。",
                    "details": values,
                    "source_ref": str(path),
                    "source_sha256": digest(path),
                }
            )
    return rows


# @chain-region ssh_endpoints | calls: (host + ':' + group.get('port', '22')).encode, Path, group.get, group.get('port', '22').isdigit, group['aliases'].split, groups.append, hashlib.sha256, hashlib.sha256((host + ':' + group.get('port', '22')).encode()).hexdigest …
def ssh_endpoints(source):
    path = Path(source["path"])
    groups = []
    current = None
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        parts = line.strip().split(None, 1)
        if len(parts) != 2 or parts[0].startswith("#"):
            continue
        key, value = parts
        if key.lower() == "host":
            if current:
                groups.append(current)
            current = {"aliases": value}
        elif current is not None and key.lower() in ("hostname", "port"):
            current[key.lower()] = value
    if current:
        groups.append(current)
    rows = []
    for group in groups:
        host = group.get("hostname", "")
        if not re.fullmatch(r"[a-zA-Z0-9.-]+", host) or not group.get("port", "22").isdigit():
            continue
        rows.append(
            {
                "id": "ssh-"
                + hashlib.sha256((host + ":" + group.get("port", "22")).encode()).hexdigest()[:16],
                "name": group["aliases"].split()[0],
                "kind": "server",
                "project": source.get("project", "coordination"),
                "location": "ssh://" + host + ":" + group.get("port", "22"),
                "summary": "SSH端点登记；未连接或验证远端。",
                "details": {"aliases": group["aliases"]},
                "source_ref": str(path),
            }
        )
    unique = {}
    for row in rows:
        if row["id"] in unique:
            unique[row["id"]]["details"]["aliases"] += " " + row["details"]["aliases"]
        else:
            unique[row["id"]] = row
    return list(unique.values())


# @chain-region git_remote | calls: Path, configparser.ConfigParser, hashlib.sha256, hashlib.sha256(url.encode()).hexdigest, parser.get, parser.read, parser.sections, re.fullmatch …
def git_remote(source):
    path = Path(source["path"]) / ".git/config"
    parser = configparser.ConfigParser(interpolation=None, strict=False)
    parser.read(path, encoding="utf-8")
    rows = []
    for section in parser.sections():
        if not section.startswith("remote "):
            continue
        value = parser.get(section, "url", fallback="")
        match = re.fullmatch(r"git@github\.com:([A-Za-z0-9_./-]+)", value)
        if match:
            url = "https://github.com/" + match[1]
        else:
            parts = urlsplit(value)
            if parts.hostname != "github.com" or not re.fullmatch(r"/[A-Za-z0-9_./-]+", parts.path):
                continue
            url = "https://github.com" + parts.path
        rows.append(
            {
                "id": "github-" + hashlib.sha256(url.encode()).hexdigest()[:16],
                "name": url.rsplit("/", 1)[-1].removesuffix(".git"),
                "kind": "github",
                "project": source.get("project", ""),
                "location": url,
                "summary": "本地仓库登记的GitHub远端；尚未联网核对。",
                "source_ref": str(Path(source["path"])),
            }
        )
    return rows


# @chain-region collect | calls: errors.append, existing.get, existing.setdefault, existing.setdefault('details', {}).update, list, merged.values, row.get, rows.extend …
def collect(sources):
    rows, errors = [], []
    handlers = {
        "server_inventory": server_inventory,
        "ssh_endpoints": ssh_endpoints,
        "git_remote": git_remote,
    }
    for source in sources:
        try:
            rows.extend(handlers[source["kind"]](source))
        except (OSError, ValueError, KeyError, configparser.Error):
            errors.append({"source": source.get("path"), "state": "unavailable"})
    merged = {}
    for row in rows:
        key = (row["kind"], row["location"])
        if key not in merged:
            merged[key] = row
        else:
            existing = merged[key]
            existing.setdefault("details", {}).update(row.get("details", {}))
            if row.get("source_ref") and row["source_ref"] != existing.get("source_ref"):
                existing["source_ref"] = existing.get("source_ref", "") + " ; " + row["source_ref"]
    return list(merged.values()), errors
