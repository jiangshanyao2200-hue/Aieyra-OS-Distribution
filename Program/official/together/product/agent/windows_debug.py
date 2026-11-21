# @file-map:start
# 文件: link/agent/windows_debug.py
# 位置: 二环·Agent完整链路 | 协作CLI、接续、实际启动器、工作包、源码传输和本机运行。
# 约束: 使用本人已有身份和connection，不因压缩重建身份；写操作保留request_id；未知结果查回执，凭据不进入日志与文档
# 下游: 无已解析的项目内静态导入
# 上游: link/agent/appcontainer.py
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: python -X utf8 -B -m unittest discover -s AIDEBUG -p test_aidebug_launch.py, AIDEBUG/startup-review.py
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   CreateProcess | class
#   Payload | class
#   Event | class
#   pump | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Propagate the private DOS map before any descendant executes user code.

Windows resets an AppContainer child's DOS map on CreateProcess. Debug events
pause each new process at creation, allowing the same private map to be applied
throughout the owned job. Tokens and filesystem permissions are never changed.
"""
import ctypes as c
from ctypes import wintypes as w


# @chain-region CreateProcess
class CreateProcess(c.Structure):
    _fields_ = [('file', w.HANDLE), ('process', w.HANDLE), ('thread', w.HANDLE)]


# @chain-region Payload
class Payload(c.Union):
    _fields_ = [('create', CreateProcess), ('file', w.HANDLE), ('exception', w.DWORD), ('bytes', c.c_byte * 160)]


# @chain-region Event
class Event(c.Structure):
    _fields_ = [('kind', w.DWORD), ('pid', w.DWORD), ('tid', w.DWORD), ('payload', Payload)]


# @chain-region pump | calls: Event, c.POINTER, c.WinError, c.byref, c.get_last_error, devices.apply, kernel.CloseHandle, kernel.ContinueDebugEvent …
def pump(kernel, devices):
    kernel.WaitForDebugEvent.argtypes = [c.POINTER(Event), w.DWORD]
    kernel.ContinueDebugEvent.argtypes = [w.DWORD, w.DWORD, w.DWORD]
    processes = set()
    while True:
        event = Event()
        if not kernel.WaitForDebugEvent(c.byref(event), 200):
            error = c.get_last_error()
            if error in (121, 258): continue
            raise c.WinError(error)
        continuation = 0x10002  # DBG_CONTINUE
        try:
            if event.kind == 3:  # CREATE_PROCESS_DEBUG_EVENT
                processes.add(event.pid)
                devices.apply(event.payload.create.process)
                if event.payload.create.file: kernel.CloseHandle(event.payload.create.file)
            elif event.kind == 6 and event.payload.file:  # LOAD_DLL_DEBUG_EVENT
                kernel.CloseHandle(event.payload.file)
            elif event.kind == 1:  # Let the process handle its own exceptions.
                if event.payload.exception not in (0x80000003, 0x80000004): continuation = 0x80010001
            elif event.kind == 5:  # EXIT_PROCESS_DEBUG_EVENT
                processes.discard(event.pid)
        finally:
            if not kernel.ContinueDebugEvent(event.pid, event.tid, continuation): raise c.WinError(c.get_last_error())
        if event.kind == 5 and not processes: return
