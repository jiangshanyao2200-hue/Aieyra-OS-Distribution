# @file-map:start
# 文件: link/office/scripts/project_space.py
# 位置: 二环·工位CLI | 工位 Agent 接入、原编号投递回执、续接及本地工单工作区。
# 约束: 从当前响应读取身份与可用端点；日志脱敏且有界，不以命令返回替代实际工位状态
# 下游: link/office/scripts/task_worktree.py
# 上游: link/office/scripts/agent-station.py
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: python -X utf8 -B -m unittest discover -s link/office/tests/service -p test_agent_client.py
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   ProjectSpace | class
#   ProjectSpace.__init__ | function
#   ProjectSpace.path | function
#   ProjectSpace.record_workspace | function
#   ProjectSpace.status | function
#   ProjectSpace.snapshot | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Record project worktrees and back up a reviewed Git commit locally."""

import hashlib
import json
import os
from pathlib import Path
import re
import uuid

from task_worktree import COMMIT, WorkspaceError, git, run_git, workspace_key


SPACE = "Aieyra Link SPACE"
STAGE = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}\Z")


# @chain-region ProjectSpace | calls: COMMIT.fullmatch, Path, Path(self.binding['root']).resolve, STAGE.fullmatch, WorkspaceError, any, authorize, binding_file.is_file …
class ProjectSpace:
    # @chain-region ProjectSpace.__init__ | calls: COMMIT.fullmatch, Path, Path(self.binding['root']).resolve, WorkspaceError, binding_file.is_file, isinstance, read, self.binding.get …
    def __init__(self, repository, office, project, *, lock, atomic, read):
        self.repository = repository
        self.folder = repository / SPACE
        self.office, self.project = office, project
        self.lock, self.atomic, self.read = lock, atomic, read
        binding_file = self.path("project.json")
        self.binding = read(binding_file) if binding_file.is_file() else None
        if self.binding is not None and (
            not isinstance(self.binding, dict)
            or self.binding.get("schema") != 1
            or self.binding.get("office") != office
            or self.binding.get("project") != project
            or not isinstance(self.binding.get("root"), str)
            or Path(self.binding["root"]).resolve() != repository
            or not isinstance(self.binding.get("baseline"), str)
            or not COMMIT.fullmatch(self.binding["baseline"])
        ):
            raise WorkspaceError("project_space_binding_mismatch")

    # @chain-region ProjectSpace.path | calls: WorkspaceError, path.is_symlink, path.resolve, self.folder.joinpath
    def path(self, *parts):
        path = self.folder.joinpath(*parts)
        if path.resolve() != path or path.is_symlink():
            raise WorkspaceError("project_space_path_changed")
        return path

    # @chain-region ProjectSpace.record_workspace | calls: evidence.exists, hashlib.sha256, hashlib.sha256(json.dumps(state).encode()).hexdigest, json.dumps, json.dumps(state).encode, self.atomic, self.lock, self.path …
    def record_workspace(self, task, record):
        if self.binding is None:
            return
        key = workspace_key(self.office, self.project, task["id"])
        path = self.path("tasks", key + ".json")
        metadata = {**record, "scope": task.get("scope"), "assignee": task.get("assignee")}
        with self.lock(self.path(".space.lock")):
            if record["conflicts"]:
                state = [record["head"], record["merge_head"], record["conflicts"]]
                revision = hashlib.sha256(json.dumps(state).encode()).hexdigest()[:24]
                evidence = self.path("conflicts", key + "-" + revision + ".json")
                if not evidence.exists():
                    self.atomic(evidence, metadata)
            self.atomic(path, metadata)

    # @chain-region ProjectSpace.status | calls: WorkspaceError, len, list, self.path, self.path('stages').glob, self.path('tasks').glob, str
    def status(self):
        if self.binding is None:
            raise WorkspaceError("project_space_not_registered")
        return {
            "folder": str(self.folder), "project": self.project, "office": self.office,
            "baseline": self.binding["baseline"],
            "task_records": len(list(self.path("tasks").glob("*.json"))),
            "stage_records": len(list(self.path("stages").glob("*.json"))),
        }

    # @chain-region ProjectSpace.snapshot | calls: COMMIT.fullmatch, STAGE.fullmatch, WorkspaceError, any, authorize, bundle.exists, bundle.is_file, bundle.open …
    def snapshot(self, name, revision, authorize):
        if not STAGE.fullmatch(name or ""):
            raise WorkspaceError("invalid_project_stage_name")
        if not isinstance(revision, str) or not COMMIT.fullmatch(revision):
            raise WorkspaceError("full_git_commit_required")
        if git(self.repository, "rev-parse", "--verify", "--end-of-options", revision + "^{commit}") != revision:
            raise WorkspaceError("project_stage_revision_not_a_commit")
        if run_git(self.repository, "merge-base", "--is-ancestor", self.binding["baseline"], revision).returncode:
            raise WorkspaceError("project_stage_revision_outside_baseline")
        metadata = self.path("stages", name + ".json")
        bundle = self.path("stages", name + ".bundle")
        ref = "refs/aieyra/stages/" + name
        with self.lock(self.path(".space.lock")):
            actor = authorize()
            if metadata.exists():
                prior = self.read(metadata)
                if prior.get("commit", prior.get("baseline")) != revision or not bundle.is_file():
                    raise WorkspaceError("project_stage_name_in_use")
                git(self.repository, "bundle", "verify", bundle)
                heads = git(self.repository, "bundle", "list-heads", bundle)
                with bundle.open("rb") as stream:
                    digest = hashlib.file_digest(stream, "sha256").hexdigest()
                recorded_digest = prior.get("bundle_sha256")
                if not any(line.startswith(revision + " ") for line in heads.splitlines()) or digest != recorded_digest:
                    raise WorkspaceError("project_stage_bundle_revision_changed")
                return prior
            pinned = git(self.repository, "rev-parse", "--verify", "--quiet", ref, missing_ok=True)
            if pinned and pinned != revision:
                raise WorkspaceError("project_stage_name_in_use")
            bundle.parent.mkdir(parents=True, exist_ok=True)
            if not pinned:
                git(self.repository, "update-ref", ref, revision, "0" * len(revision))
            if not bundle.exists():
                temporary = bundle.with_name("." + uuid.uuid4().hex + ".bundle")
                try:
                    git(self.repository, "bundle", "create", temporary, ref)
                    os.replace(temporary, bundle)
                finally:
                    temporary.unlink(missing_ok=True)
            git(self.repository, "bundle", "verify", bundle)
            if git(self.repository, "bundle", "list-heads", bundle, ref) != revision + " " + ref:
                raise WorkspaceError("project_stage_bundle_revision_changed")
            with bundle.open("rb") as stream:
                digest = hashlib.file_digest(stream, "sha256").hexdigest()
            result = {"name": name, "commit": revision, "bundle": str(bundle), "bundle_sha256": digest, "actor_id": actor}
            self.atomic(metadata, result)
            return result
