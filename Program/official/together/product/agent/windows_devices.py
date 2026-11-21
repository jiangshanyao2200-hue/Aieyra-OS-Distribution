# @file-map:start
# 文件: link/agent/windows_devices.py
# 位置: 二环·Agent完整链路 | 协作CLI、接续、实际启动器、工作包、源码传输和本机运行。
# 约束: 使用本人已有身份和connection，不因压缩重建身份；写操作保留request_id；未知结果查回执，凭据不进入日志与文档
# 下游: 无已解析的项目内静态导入
# 上游: link/agent/appcontainer.py
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: python -X utf8 -B -m unittest discover -s AIDEBUG -p test_aidebug_launch.py, AIDEBUG/startup-review.py
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   UnicodeString | class
#   ObjectAttributes | class
#   wide | function
#   check | function
#   DeviceMap | class
#   DeviceMap.__init__ | function
#   DeviceMap.apply | function
#   DeviceMap.close | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Private DOS devices for AppContainer children; the host device map is untouched."""
import ctypes as c
from ctypes import wintypes as w
import os
import secrets


# @chain-region UnicodeString
class UnicodeString(c.Structure):
    _fields_ = [('length', w.USHORT), ('maximum', w.USHORT), ('buffer', w.LPWSTR)]


# @chain-region ObjectAttributes | calls: c.POINTER
class ObjectAttributes(c.Structure):
    _fields_ = [('length', w.ULONG), ('root', w.HANDLE), ('name', c.POINTER(UnicodeString)),
                ('attributes', w.ULONG), ('security', c.c_void_p), ('quality', c.c_void_p)]


# @chain-region wide | calls: UnicodeString, c.cast, c.create_unicode_buffer, c.sizeof, len, value.encode
def wide(value):
    buffer = c.create_unicode_buffer(value)
    return UnicodeString(len(value.encode('utf-16-le')), c.sizeof(buffer), c.cast(buffer, w.LPWSTR)), buffer


# @chain-region check | calls: OSError, hex
def check(status):
    if status: raise OSError('AppContainer device map: ' + hex(status & 0xffffffff))


# @chain-region DeviceMap | calls: (container.root / 'null-device').touch, ObjectAttributes, advapi.ConvertStringSecurityDescriptorToSecurityDescriptorW, c.POINTER, c.WinDLL, c.WinError, c.byref, c.c_void_p …
class DeviceMap:
    # @chain-region DeviceMap.__init__ | calls: (container.root / 'null-device').touch, ObjectAttributes, advapi.ConvertStringSecurityDescriptorToSecurityDescriptorW, c.POINTER, c.WinDLL, c.WinError, c.byref, c.c_void_p …
    def __init__(self, container):
        self.nt = nt = c.WinDLL('ntdll')
        self.kernel, self.handles = container.kernel, []
        nt.NtCreateDirectoryObject.argtypes = [c.POINTER(w.HANDLE), w.ULONG, c.POINTER(ObjectAttributes)]
        nt.NtCreateDirectoryObject.restype = c.c_long
        nt.NtCreateSymbolicLinkObject.argtypes = [c.POINTER(w.HANDLE), w.ULONG, c.POINTER(ObjectAttributes), c.POINTER(UnicodeString)]
        nt.NtCreateSymbolicLinkObject.restype = c.c_long
        nt.NtSetInformationProcess.argtypes = [w.HANDLE, w.ULONG, c.c_void_p, w.ULONG]
        nt.NtSetInformationProcess.restype = c.c_long
        session = w.DWORD()
        if not self.kernel.ProcessIdToSessionId(os.getpid(), c.byref(session)):
            raise c.WinError(c.get_last_error())
        descriptor = c.c_void_p()
        advapi = container.advapi
        advapi.ConvertStringSecurityDescriptorToSecurityDescriptorW.argtypes = [w.LPCWSTR, w.DWORD, c.POINTER(c.c_void_p), c.c_void_p]
        if not advapi.ConvertStringSecurityDescriptorToSecurityDescriptorW(
                'D:(A;;GA;;;SY)(A;;GA;;;OW)(A;;GA;;;' + container.sid_text + ')', 1, c.byref(descriptor), None):
            raise c.WinError(c.get_last_error())
        try:
            name, name_buffer = wide('\\Sessions\\' + str(session.value) + '\\BaseNamedObjects\\Aieyra-Dos-' + secrets.token_hex(12))
            attributes = ObjectAttributes(c.sizeof(ObjectAttributes), None, c.pointer(name), 0x40, descriptor, None)
            directory = w.HANDLE()
            check(nt.NtCreateDirectoryObject(c.byref(directory), 0xF000F, c.byref(attributes)))
            self.directory = directory
            self.handles.append(directory)
            volume = c.create_unicode_buffer(4096)
            if not self.kernel.QueryDosDeviceW(container.root.drive, volume, len(volume)):
                raise c.WinError(c.get_last_error())
            native = volume.value + str(container.root)[2:]
            (container.root / 'null-device').touch()
            for key, target in [('GLOBAL', '\\GLOBAL??'), (container.drive[:2], native), ('NUL', native + '\\null-device')]:
                name, name_buffer = wide(key)
                destination, destination_buffer = wide(target)
                attributes = ObjectAttributes(c.sizeof(ObjectAttributes), directory, c.pointer(name), 0x40, descriptor, None)
                link = w.HANDLE()
                check(nt.NtCreateSymbolicLinkObject(c.byref(link), 0xF0001, c.byref(attributes), c.byref(destination)))
                self.handles.append(link)
        except Exception:
            self.close()
            raise
        finally:
            self.kernel.LocalFree(descriptor)

    # @chain-region DeviceMap.apply | calls: c.byref, c.sizeof, check, self.nt.NtSetInformationProcess, w.HANDLE
    def apply(self, process):
        directory = w.HANDLE(self.directory.value)
        check(self.nt.NtSetInformationProcess(process, 23, c.byref(directory), c.sizeof(directory)))

    # @chain-region DeviceMap.close | calls: reversed, self.handles.clear, self.kernel.CloseHandle
    def close(self):
        for handle in reversed(self.handles): self.kernel.CloseHandle(handle)
        self.handles.clear()
