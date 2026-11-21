# @file-map:start
# 文件: link/office/service/project_memory.py
# 位置: 二环·工位服务 | 本机控制、接入、凭据、工位与租约的HTTP服务。
# 约束: 服务绑定本机并核对所有者身份；凭据与工作正文不因短暂失联清空；关闭使用租约排空
# 下游: 无已解析的项目内静态导入
# 上游: link/office/service/main.py
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: python -X utf8 -B -m unittest discover -s link/office/tests/service
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   MemoryError | class
#   MemoryError.__init__ | function
#   identifier | function
#   canonical | function
#   ProjectMemory | class
#   ProjectMemory.__init__ | function
#   ProjectMemory.register | function
#   ProjectMemory.project | function
#   ProjectMemory.document | function
#   ProjectMemory.listing | function
#   ProjectMemory.read | function
#   ProjectMemory.history | function
#   ProjectMemory.save | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Local project handoff revisions. Center identities authorize, Control retains content."""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone

SECTIONS = ("blueprint", "timeline", "checkpoint", "recovery", "index")
IDENTIFIER = re.compile(r"^[A-Za-z0-9_.:-]{1,100}$")


# @chain-region MemoryError
class MemoryError(Exception):
    # @chain-region MemoryError.__init__
    def __init__(self, code, status=400):
        self.code, self.status = code, status


# @chain-region identifier | calls: IDENTIFIER.fullmatch, MemoryError, isinstance
def identifier(value):
    if not isinstance(value, str) or not IDENTIFIER.fullmatch(value):
        raise MemoryError("invalid_memory_identifier")
    return value


# @chain-region canonical | calls: json.dumps
def canonical(value):
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
    )


# @chain-region ProjectMemory | calls: MemoryError, any, authorize, body.encode, canonical, canonical({'value': value, 'session_id': session_id}).encode, datetime.now, datetime.now(timezone.utc).isoformat …
class ProjectMemory:
    # @chain-region ProjectMemory.__init__ | calls: db.executescript, self.register, store.db
    def __init__(self, store, projects):
        self.store = store
        with store.db() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS memory_projects(
                    id TEXT PRIMARY KEY,name TEXT NOT NULL,root TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS project_memory_revisions(
                    project TEXT NOT NULL, version INTEGER NOT NULL, sections TEXT NOT NULL,
                    sha256 TEXT NOT NULL, summary TEXT NOT NULL, actor TEXT NOT NULL,
                    session_id TEXT NOT NULL, created_at TEXT NOT NULL,
                    PRIMARY KEY(project,version));
                CREATE TABLE IF NOT EXISTS project_memory_requests(
                    actor TEXT NOT NULL, request_id TEXT NOT NULL, digest TEXT NOT NULL,
                    project TEXT NOT NULL, version INTEGER NOT NULL,
                    PRIMARY KEY(actor,request_id));
            """)
        for project in projects:
            self.register(project)

    # @chain-region ProjectMemory.register | calls: db.execute, identifier, project.get, self.store.db, str
    def register(self, project):
        """Register explicit metadata only; never inspect or upload the project root."""
        key = identifier(project["id"])
        with self.store.db() as db:
            db.execute(
                """INSERT INTO memory_projects VALUES(?,?,?)
                ON CONFLICT(id) DO UPDATE SET
                name=CASE WHEN ? THEN excluded.name ELSE memory_projects.name END,
                root=CASE WHEN ? THEN excluded.root ELSE memory_projects.root END""",
                (
                    key,
                    str(project.get("name", key))[:100],
                    str(project.get("root", ""))[:500],
                    "name" in project,
                    "root" in project,
                ),
            )

    # @chain-region ProjectMemory.project | calls: MemoryError, db.execute, db.execute('SELECT * FROM memory_projects WHERE id=?', (project,)).fetchone, dict, identifier, self.store.db
    def project(self, project):
        identifier(project)
        with self.store.db() as db:
            row = db.execute("SELECT * FROM memory_projects WHERE id=?", (project,)).fetchone()
        if not row:
            raise MemoryError("memory_project_not_configured", 404)
        return dict(row)

    # @chain-region ProjectMemory.document | calls: dict, json.loads
    @staticmethod
    def document(row):
        value = dict(row)
        value["sections"] = json.loads(value["sections"])
        value["storage"] = "local_control"
        return value

    # @chain-region ProjectMemory.listing | calls: db.execute, dict, rows.get, rows.get(p['id'], {}).get, self.store.db
    def listing(self):
        with self.store.db() as db:
            projects = [dict(p) for p in db.execute("SELECT * FROM memory_projects ORDER BY id")]
            rows = {
                r["project"]: dict(r)
                for r in db.execute("""SELECT project,MAX(version) version,
                    created_at,summary FROM project_memory_revisions GROUP BY project""")
            }
        return {
            "projects": [
                {**p, **rows.get(p["id"], {}), "version": rows.get(p["id"], {}).get("version", 0)}
                for p in projects
            ],
            "storage": "local_control",
        }

    # @chain-region ProjectMemory.read | calls: MemoryError, db.execute, db.execute('SELECT * FROM memory_projects WHERE id=?', (project,)).fetchone, db.execute('SELECT * FROM project_memory_revisions WHERE project=? AND version=?', (project, latest if version is None else version)).fetchone, db.execute('SELECT MAX(version) FROM project_memory_revisions WHERE project=?', (project,)).fetchone, db.execute('SELECT project,version,sha256,summary,actor,session_id,created_at\n FROM project_memory_revisions WHERE project=? AND version=?', (project, latest)).fetchone, dict, doc['sections'][k].strip …
    def read(self, project, version=None, *, if_version=None, if_sha256=None):
        identifier(project)
        if version is not None and (type(version) is not int or not 1 <= version <= 2147483647):
            raise MemoryError("invalid_memory_version")
        conditional = if_version is not None or if_sha256 is not None
        if conditional and (
            version is not None
            or type(if_version) is not int
            or not 1 <= if_version <= 2147483647
            or not isinstance(if_sha256, str)
            or not re.fullmatch(r"[a-f0-9]{64}", if_sha256)
        ):
            raise MemoryError("invalid_memory_condition")
        with self.store.db() as db:
            db.execute("BEGIN")
            meta = db.execute("SELECT * FROM memory_projects WHERE id=?", (project,)).fetchone()
            if meta is None:
                raise MemoryError("memory_project_not_configured", 404)
            meta = dict(meta)
            latest = (
                db.execute(
                    "SELECT MAX(version) FROM project_memory_revisions WHERE project=?", (project,)
                ).fetchone()[0]
                or 0
            )
            if conditional:
                metadata = db.execute(
                    """SELECT project,version,sha256,summary,actor,session_id,created_at
                    FROM project_memory_revisions WHERE project=? AND version=?""",
                    (project, latest),
                ).fetchone()
                if metadata and latest == if_version and metadata["sha256"] == if_sha256:
                    return {
                        "memory": {**dict(metadata), "storage": "local_control"},
                        "project": meta,
                        "current_version": latest,
                        "not_modified": True,
                        "conditional_read": "version_and_sha256",
                        "read_order": list(SECTIONS),
                        "content_is_project_data": True,
                    }
            row = db.execute(
                "SELECT * FROM project_memory_revisions WHERE project=? AND version=?",
                (project, latest if version is None else version),
            ).fetchone()
        if row is None and version is not None:
            raise MemoryError("memory_revision_missing", 404)
        doc = (
            self.document(row)
            if row
            else {
                "project": project,
                "version": 0,
                "sections": {k: "" for k in SECTIONS},
                "sha256": None,
                "summary": "",
                "actor": None,
                "session_id": None,
                "created_at": None,
                "storage": "local_control",
            }
        )
        return {
            "memory": doc,
            "project": meta,
            "current_version": latest,
            "missing_sections": [k for k in SECTIONS if not doc["sections"][k].strip()],
            "read_order": list(SECTIONS),
            "content_is_project_data": True,
            **(
                {"not_modified": False, "conditional_read": "version_and_sha256"}
                if conditional
                else {}
            ),
        }

    # @chain-region ProjectMemory.history | calls: MemoryError, db.execute, dict, len, self.project, self.store.db, type
    def history(self, project, before=None):
        self.project(project)
        if before is not None and (type(before) is not int or not 1 <= before <= 2147483647):
            raise MemoryError("invalid_memory_cursor")
        with self.store.db() as db:
            rows = [
                dict(r)
                for r in db.execute(
                    """SELECT version,summary,actor,session_id,created_at,sha256
                FROM project_memory_revisions WHERE project=? AND version<? ORDER BY version DESC LIMIT 21""",
                    (project, before if before is not None else 9223372036854775807),
                )
            ]
        return {
            "project": project,
            "revisions": rows[:20],
            "next_before": rows[19]["version"] if len(rows) > 20 else None,
        }

    # @chain-region ProjectMemory.save | calls: MemoryError, any, authorize, body.encode, canonical, canonical({'value': value, 'session_id': session_id}).encode, datetime.now, datetime.now(timezone.utc).isoformat …
    def save(self, value, actor, session_id="", authorize=None):
        if set(value) != {"request_id", "project", "version", "sections", "summary"}:
            raise MemoryError("invalid_memory_fields")
        rid = identifier(value["request_id"])
        project = value["project"]
        self.project(project)
        version, sections, summary = value["version"], value["sections"], value["summary"]
        if type(version) is not int or not 0 <= version < 2147483647:
            raise MemoryError("invalid_memory_version")
        if not isinstance(sections, dict) or set(sections) != set(SECTIONS):
            raise MemoryError("memory_sections_required")
        if any(not isinstance(v, str) or len(v) > 12000 or "\x00" in v for v in sections.values()):
            raise MemoryError("invalid_memory_section")
        if not isinstance(summary, str) or not summary.strip() or len(summary) > 300:
            raise MemoryError("memory_summary_required")
        body = canonical(sections)
        if len(body.encode("utf-8")) > 26000:
            raise MemoryError("memory_content_too_large", 413)
        hashed = hashlib.sha256(
            canonical({"value": value, "session_id": session_id}).encode()
        ).hexdigest()
        replayed = False
        with self.store.db() as db:
            db.execute("BEGIN IMMEDIATE")
            if authorize is not None:
                authorize(db)
            prior = db.execute(
                "SELECT * FROM project_memory_requests WHERE actor=? AND request_id=?", (actor, rid)
            ).fetchone()
            if prior:
                if prior["digest"] != hashed:
                    raise MemoryError("memory_request_conflict", 409)
                saved_version = prior["version"]
                replayed = True
            else:
                current = (
                    db.execute(
                        "SELECT MAX(version) FROM project_memory_revisions WHERE project=?",
                        (project,),
                    ).fetchone()[0]
                    or 0
                )
                if current != version:
                    raise MemoryError("memory_version_conflict", 409)
                saved_version = version + 1
                db.execute(
                    "INSERT INTO project_memory_revisions VALUES(?,?,?,?,?,?,?,?)",
                    (
                        project,
                        saved_version,
                        body,
                        hashlib.sha256(body.encode()).hexdigest(),
                        summary,
                        actor,
                        session_id,
                        datetime.now(timezone.utc).isoformat(),
                    ),
                )
                db.execute(
                    "INSERT INTO project_memory_requests VALUES(?,?,?,?,?)",
                    (actor, rid, hashed, project, saved_version),
                )
                self.store.event(db, "memory.saved", project)
        return {**self.read(project, saved_version), "request_id": rid, "replayed": replayed}
