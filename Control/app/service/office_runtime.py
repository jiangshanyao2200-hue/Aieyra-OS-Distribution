# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: Control/app/service/AGENTS.md | ring 2
# Chains: module-local; query impact before editing
# Regions: InstanceLock; OfficeRuntime
# Impact: python -B scripts/code-atlas.py show Control/app/service/office_runtime.py
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

"""One office per explicit profile; legacy launchers retain one per OS user.

The kernel owns the lock. Metadata only helps a second launcher find the office;
it never authorizes deleting a lock or stopping another owner. Explicitly isolated
test user directories have their own runtime, as well as their own private data.
"""

import json
import os
import uuid

from paths import user_storage_base, external_path
from service_common import Problem

DEFAULT_PORT = 17930


class InstanceLock:
    """Hold a directory until every writer has stopped, including after cleanup errors."""

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

    def close(self):
        self.file.close()


class OfficeRuntime:
    def __init__(self, port):
        directory = os.environ.get("AIEYRA_CONTROL_RUNTIME")
        self.directory = external_path(directory) if directory else user_storage_base() / "Aieyra Control" / "runtime"
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

    def close(self):
        try:
            self.record.unlink(missing_ok=True)
        finally:
            self.lock.close()
