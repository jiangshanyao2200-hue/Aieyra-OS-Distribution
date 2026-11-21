# @file-map:start
# 文件: link/office/service/office_runtime.py
# 位置: 二环·工位服务 | 本机控制、接入、凭据、工位与租约的HTTP服务。
# 约束: 服务绑定本机并核对所有者身份；凭据与工作正文不因短暂失联清空；关闭使用租约排空
# 下游: link/office/service/paths.py, link/office/service/service_common.py
# 上游: link/office/service/main.py
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: python -X utf8 -B -m unittest discover -s link/office/tests/service
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   InstanceLock | class
#   InstanceLock.__init__ | function
#   InstanceLock.close | function
#   OfficeRuntime | class
#   OfficeRuntime.__init__ | function
#   OfficeRuntime.publish | function
#   OfficeRuntime.close | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""One local office per OS user, regardless of installation, data root or port.

The kernel owns the lock. Metadata only helps a second launcher find the office;
it never authorizes deleting a lock or stopping another owner. Explicitly isolated
test user directories have their own runtime, as well as their own private data.
"""

import json
import os
import uuid

from paths import user_storage_base, external_path
from service_common import Problem

DEFAULT_PORT = 17931


# @chain-region InstanceLock | calls: (directory / 'instance.lock').open, Problem, directory.mkdir, fcntl.flock, msvcrt.locking, os.fstat, self.file.close, self.file.fileno …
class InstanceLock:
    """Hold a directory until every writer has stopped, including after cleanup errors."""

    # @chain-region InstanceLock.__init__ | calls: (directory / 'instance.lock').open, Problem, directory.mkdir, fcntl.flock, msvcrt.locking, os.fstat, self.file.close, self.file.fileno …
    def __init__(self, directory):
        directory.mkdir(parents=True, exist_ok=True)
        self.file = (directory / "instance.lock").open("a+b")
        try:
            if os.fstat(self.file.fileno()).st_size == 0:
                self.file.write(b"0")
                self.file.flush()
            self.file.seek(0)
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(self.file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(self.file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self.file.close()
            raise Problem("already_running", "该数据目录已由运行中的协作台占用。", 409) from None

    # @chain-region InstanceLock.close | calls: self.file.close
    def close(self):
        self.file.close()


# @chain-region OfficeRuntime | calls: InstanceLock, Problem, external_path, json.dump, json.loads, os.chmod, os.environ.get, os.fsync …
class OfficeRuntime:
    # @chain-region OfficeRuntime.__init__ | calls: InstanceLock, Problem, external_path, json.loads, os.environ.get, os.getpid, self.lock.close, self.publish …
    def __init__(self, port):
        self.directory = (external_path(os.environ["AIEYRA_TOGETHER_RUNTIME"])
                          if os.environ.get("AIEYRA_TOGETHER_RUNTIME")
                          else user_storage_base() / "Aieyra Together Link" / "runtime")
        self.record = self.directory / "office.json"
        try:
            self.lock = InstanceLock(self.directory)
        except Problem:
            address = ""
            try:
                value = json.loads(self.record.read_text(encoding="utf-8"))
                previous_port = value.get("port")
                if type(previous_port) is int and 1 <= previous_port <= 65535:
                    address = f" http://127.0.0.1:{previous_port}"
            except (OSError, ValueError, AttributeError):
                pass
            raise Problem(
                "already_running", "本机已有 Link 办公室，请连接现有办公室。" + address, 409
            ) from None
        self.value = {"schema_version": 1, "runtime_id": uuid.uuid4().hex,
                      "pid": os.getpid(), "port": port, "state": "starting"}
        try:
            self.publish()
        except BaseException:
            self.lock.close()
            raise

    # @chain-region OfficeRuntime.publish | calls: json.dump, os.chmod, os.fsync, os.replace, self.record.with_name, stream.fileno, stream.flush, temporary.open …
    def publish(self, *, ready=False, port=None):
        if ready:
            self.value["state"] = "ready"
        if port is not None:
            self.value["port"] = port
        temporary = self.record.with_name("office." + self.value["runtime_id"] + ".tmp")
        try:
            with temporary.open("x", encoding="utf-8") as stream:
                os.chmod(temporary, 0o600)
                json.dump(self.value, stream)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.record)
        finally:
            temporary.unlink(missing_ok=True)

    # @chain-region OfficeRuntime.close | calls: self.lock.close, self.record.unlink
    def close(self):
        try:
            self.record.unlink(missing_ok=True)
        finally:
            self.lock.close()
