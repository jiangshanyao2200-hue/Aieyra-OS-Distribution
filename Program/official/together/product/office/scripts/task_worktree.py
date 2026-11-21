# @file-map:start
# 文件: link/office/scripts/task_worktree.py
# 位置: 二环·工位CLI | 工位 Agent 接入、原编号投递回执、续接及本地工单工作区。
# 约束: 从当前响应读取身份与可用端点；日志脱敏且有界，不以命令返回替代实际工位状态
# 下游: 无已解析的项目内静态导入
# 上游: link/office/scripts/agent-station.py, link/office/scripts/project_space.py
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: python -X utf8 -B -m unittest discover -s link/office/tests/service -p test_agent_client.py
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   WorkspaceError | class
#   run_git | function
#   git | function
#   outside_repository | function
#   worktree_destination | function
#   common_directory | function
#   workspace_key | function
#   task_worktree | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Prepare or inspect a local Git worktree for an authorized office task."""

import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess


COMMIT = re.compile(r"(?:[0-9a-f]{40}|[0-9a-f]{64})\Z")
GIT_REDIRECT = {
    "GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE", "GIT_NAMESPACE",
    "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_QUARANTINE_PATH",
}


# @chain-region WorkspaceError
class WorkspaceError(ValueError):
    pass


# @chain-region run_git | calls: WorkspaceError, key.upper, map, os.environ.items, shutil.which, str, subprocess.run
def run_git(repository, *arguments):
    executable = shutil.which("git")
    if not executable:
        raise WorkspaceError("git_not_available")
    env = {key: value for key, value in os.environ.items() if key.upper() not in GIT_REDIRECT}
    env["GIT_TERMINAL_PROMPT"] = "0"
    try:
        return subprocess.run(
            [executable, "-C", str(repository), *map(str, arguments)],
            env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            encoding="utf-8", errors="replace", timeout=120,
        )
    except subprocess.TimeoutExpired:
        raise WorkspaceError("git_worktree_operation_timed_out") from None


# @chain-region git | calls: WorkspaceError, result.stdout.rstrip, run_git
def git(repository, *arguments, missing_ok=False):
    result = run_git(repository, *arguments)
    if result.returncode == 1 and missing_ok:
        return None
    if result.returncode:
        raise WorkspaceError("git_worktree_operation_failed")
    return result.stdout.rstrip("\r\n")


# @chain-region outside_repository | calls: WorkspaceError
def outside_repository(worktree, repository, common):
    if worktree == repository or repository in worktree.parents or worktree == common or common in worktree.parents:
        raise WorkspaceError("task_worktree_must_be_outside_project")


# @chain-region worktree_destination | calls: Path.home, WorkspaceError, hashlib.sha256, hashlib.sha256(os.fsencode(os.path.normcase(str(common)))).hexdigest, os.fsencode, os.path.normcase, str, workspace_root.is_absolute …
def worktree_destination(workspace_root, common, key):
    if workspace_root is None:
        workspace_root = Path.home() / ".aieyra-link" / "worktrees"
    if not workspace_root.is_absolute():
        raise WorkspaceError("absolute_workspace_root_required")
    repository_key = hashlib.sha256(os.fsencode(os.path.normcase(str(common)))).hexdigest()[:16]
    return workspace_root.resolve() / repository_key / key


# @chain-region common_directory | calls: Path, Path(git(repository, 'rev-parse', '--path-format=absolute', '--git-common-dir')).resolve, git
def common_directory(repository):
    return Path(git(repository, "rev-parse", "--path-format=absolute", "--git-common-dir")).resolve()


# @chain-region workspace_key | calls: hashlib.sha256, hashlib.sha256(json.dumps([office, project, task], ensure_ascii=True).encode()).hexdigest, json.dumps, json.dumps([office, project, task], ensure_ascii=True).encode
def workspace_key(office, project, task):
    return hashlib.sha256(json.dumps([office, project, task], ensure_ascii=True).encode()).hexdigest()[:24]


# @chain-region task_worktree | calls: (path / '.git').is_file, COMMIT.fullmatch, Path, Path(git(path, 'rev-parse', '--show-toplevel')).resolve, Path(git(project_root, 'rev-parse', '--show-toplevel')).resolve, Path(spec['path']).is_absolute, WorkspaceError, arguments.extend …
def task_worktree(project_root, station_root, office, task, operation, base, workspace_root, *, lock, atomic, read):
    repository = Path(git(project_root, "rev-parse", "--show-toplevel")).resolve()
    common = common_directory(repository)
    if station_root != repository and common_directory(station_root) != common:
        raise WorkspaceError("workspace_station_repository_mismatch")
    key = workspace_key(office, task["project"], task["id"])
    branch = "aieyra/tasks/" + key
    records = common / "aieyra-task-workspaces"
    if records.resolve().parent != common:
        raise WorkspaceError("invalid_task_worktree_records_directory")
    record = records / (key + ".json")
    if operation == "status" and not record.exists():
        return {"state": "missing", "task_id": task["id"], "project": task["project"]}
    if base is not None and not COMMIT.fullmatch(base):
        raise WorkspaceError("full_git_commit_required")
    with lock(records / (key + ".lock")):
        if record.is_symlink():
            raise WorkspaceError("invalid_task_worktree_record")
        if record.exists():
            spec = read(record)
            if (
                not isinstance(spec, dict)
                or spec.get("schema") != 1 or spec.get("key") != key or spec.get("branch") != branch
                or spec.get("task_id") != task["id"] or spec.get("project") != task["project"]
                or not isinstance(spec.get("base"), str) or not COMMIT.fullmatch(spec["base"])
                or not isinstance(spec.get("path"), str) or not Path(spec["path"]).is_absolute()
                or type(spec.get("registered", False)) is not bool
            ):
                raise WorkspaceError("invalid_task_worktree_record")
            path = Path(spec["path"])
            if base is not None and base != spec["base"]:
                raise WorkspaceError("task_worktree_baseline_changed")
            if workspace_root is not None and path != worktree_destination(workspace_root, common, key):
                raise WorkspaceError("task_worktree_location_changed")
        else:
            if base is None:
                raise WorkspaceError("task_worktree_baseline_required")
            if git(repository, "rev-parse", "--verify", "--end-of-options", base + "^{commit}") != base:
                raise WorkspaceError("task_worktree_baseline_not_a_commit")
            path = worktree_destination(workspace_root, common, key)
            spec = {
                "schema": 1, "key": key, "task_id": task["id"], "project": task["project"],
                "base": base, "branch": branch, "path": str(path),
            }
            outside_repository(path.resolve(), repository, common)
            if path.exists() or path.is_symlink():
                raise WorkspaceError("task_worktree_path_in_use")
            # Persist the exact branch and target before invoking Git so a retry can inspect them.
            atomic(record, spec)

        resolved = path.resolve()
        outside_repository(resolved, repository, common)
        if path != resolved:
            raise WorkspaceError("task_worktree_path_changed")
        ref = "refs/heads/" + branch
        created = False
        if not path.exists():
            if operation == "status":
                return {**spec, "state": "directory_missing"}
            if spec.get("registered"):
                raise WorkspaceError("original_task_worktree_directory_missing")
            branch_head = git(repository, "rev-parse", "--verify", "--quiet", ref, missing_ok=True)
            if branch_head and branch_head != spec["base"]:
                raise WorkspaceError("task_worktree_branch_advanced_without_directory")
            path.parent.mkdir(parents=True, exist_ok=True)
            arguments = ["worktree", "add"]
            if not branch_head:
                arguments.extend(("-b", branch))
            target = branch if branch_head else spec["base"]
            git(repository, "-c", "core.hooksPath=" + os.devnull, *arguments, "--", path, target)
            created = True
        if (
            not (path / ".git").is_file()
            or Path(git(path, "rev-parse", "--show-toplevel")).resolve() != path
            or common_directory(path) != common
            or git(path, "symbolic-ref", "--quiet", "HEAD") != ref
        ):
            raise WorkspaceError("task_worktree_directory_binding_changed")
        head = git(path, "rev-parse", "--verify", "HEAD")
        dirty = bool(git(path, "status", "--porcelain=v1", "-z", "--untracked-files=normal"))
        conflicts = git(path, "diff", "--name-only", "--diff-filter=U", "-z").split("\0")
        merge_head = git(path, "rev-parse", "--verify", "--quiet", "MERGE_HEAD", missing_ok=True)
        if operation == "prepare" and not spec.get("registered"):
            spec["registered"] = True
            atomic(record, spec)
        return {
            **spec, "repository": str(repository), "state": "ready", "created": created, "head": head, "dirty": dirty,
            "conflicts": [name for name in conflicts if name], "merge_head": merge_head,
        }
