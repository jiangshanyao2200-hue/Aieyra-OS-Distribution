# @file-map:start
# 文件: link/agent/appcontainer.py
# 位置: 二环·Agent完整链路 | 协作CLI、接续、实际启动器、工作包、源码传输和本机运行。
# 约束: 使用本人已有身份和connection，不因压缩重建身份；写操作保留request_id；未知结果查回执，凭据不进入日志与文档
# 下游: link/agent/appcontainer-fs.cjs, link/agent/local_runner.py, link/agent/windows_debug.py, link/agent/windows_devices.py
# 上游: link/agent/cocreation.py
# 链路: source-transfer
# 验证: AIDEBUG/development-download.test.cjs, AIDEBUG/transfer-recovery.test.cjs
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   SIDAttributes | class
#   Capabilities | class
#   Startup | class
#   StartupEx | class
#   ProcessInfo | class
#   Process | class
#   Process.__init__ | function
#   Process.poll | function
#   Process.wait | function
#   Process.close | function
#   AppContainer | class
#   AppContainer.__init__ | function
#   AppContainer.mapped | function
#   AppContainer.grant | function
#   AppContainer.environment | function
#   AppContainer.start | function
#   AppContainer.start.launch | function
#   AppContainer._start | function
#   AppContainer.close | function
#   AppContainer._close | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Windows AppContainer processes. Only the supplied development directory is writable."""
import ctypes as c
from ctypes import wintypes as w
import os
from pathlib import Path
import subprocess
import threading


# @chain-region SIDAttributes
class SIDAttributes(c.Structure):
    _fields_ = [('sid', c.c_void_p), ('attributes', w.DWORD)]


# @chain-region Capabilities | calls: c.POINTER
class Capabilities(c.Structure):
    _fields_ = [('app', c.c_void_p), ('caps', c.POINTER(SIDAttributes)), ('count', w.DWORD), ('reserved', w.DWORD)]


# @chain-region Startup | calls: c.POINTER
class Startup(c.Structure):
    _fields_ = [('cb', w.DWORD), ('reserved', w.LPWSTR), ('desktop', w.LPWSTR), ('title', w.LPWSTR),
               ('x', w.DWORD), ('y', w.DWORD), ('width', w.DWORD), ('height', w.DWORD), ('xchars', w.DWORD), ('ychars', w.DWORD),
               ('fill', w.DWORD), ('flags', w.DWORD), ('show', w.WORD), ('reserved2', w.WORD), ('reserved3', c.POINTER(c.c_byte)),
               ('stdin', w.HANDLE), ('stdout', w.HANDLE), ('stderr', w.HANDLE)]


# @chain-region StartupEx
class StartupEx(c.Structure):
    _fields_ = [('startup', Startup), ('attributes', c.c_void_p)]


# @chain-region ProcessInfo
class ProcessInfo(c.Structure):
    _fields_ = [('process', w.HANDLE), ('thread', w.HANDLE), ('pid', w.DWORD), ('tid', w.DWORD)]


# @chain-region Process | calls: c.WinError, c.byref, c.get_last_error, int, self.debug_thread.join, self.job.close, self.kernel.CloseHandle, self.kernel.GetExitCodeProcess …
class Process:
    # @chain-region Process.__init__ | calls: threading.RLock
    def __init__(self, kernel, info, log):
        self.kernel, self.info, self.log, self.pid, self._handle = kernel, info, log, info.pid, info.process
        self.job = None
        self.debug_thread = None
        self.lock = threading.RLock()
        self.exit_code = None

    # @chain-region Process.poll | calls: c.WinError, c.byref, c.get_last_error, self.kernel.GetExitCodeProcess, w.DWORD
    def poll(self):
        with self.lock:
            if not self._handle: return self.exit_code
            code = w.DWORD()
            if not self.kernel.GetExitCodeProcess(self._handle, c.byref(code)):
                raise c.WinError(c.get_last_error())
            return None if code.value == 259 else code.value

    # @chain-region Process.wait | calls: int, self.kernel.WaitForSingleObject, self.poll, subprocess.TimeoutExpired
    def wait(self, timeout=30):
        if self.kernel.WaitForSingleObject(self._handle, int(timeout * 1000)) == 258:
            raise subprocess.TimeoutExpired('AppContainer', timeout)
        return self.poll()

    # @chain-region Process.close | calls: self.debug_thread.join, self.job.close, self.kernel.CloseHandle, self.kernel.WaitForSingleObject, self.log.close, self.poll, threading.current_thread
    def close(self):
        with self.lock:
            if self.job:
                self.job.close(); self.job = None
            if self._handle:
                self.kernel.WaitForSingleObject(self._handle, 2000)
                self.exit_code = self.poll()
                self.kernel.CloseHandle(self._handle); self._handle = None
            if self.log:
                self.log.close(); self.log = None
        if self.debug_thread and self.debug_thread is not threading.current_thread():
            self.debug_thread.join(2)


# @chain-region AppContainer | calls: '\x00'.join, (extra or {}).items, Capabilities, DeviceMap, OSError, Path, Path(__file__).with_name, Path(root).resolve …
class AppContainer:
    # @chain-region AppContainer.__init__ | calls: DeviceMap, OSError, Path, Path(__file__).with_name, Path(root).resolve, ValueError, a.ConvertSidToStringSidW, c.POINTER …
    def __init__(self, root, name):
        if os.name != 'nt':
            raise OSError('Windows AppContainer is required')
        self.lifetime = threading.RLock()
        self.closed = False
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        # Persist the exact lowbox identity across program-directory relocation.
        # Private files authorize this SID and must remain readable after a move.
        import json, re
        identity = self.root / 'container-identity.json'
        if identity.is_file():
            name = json.loads(identity.read_text(encoding='utf-8'))['name']
        if not re.fullmatch(r'aieyra\.together\.[a-z0-9.]{1,100}', name): raise ValueError('invalid_sandbox_identity')
        self.name = name
        if not identity.exists(): identity.write_text(json.dumps({'name':name}),encoding='utf-8')
        self.kernel = k = c.WinDLL('kernel32', use_last_error=True)
        self.advapi = a = c.WinDLL('advapi32', use_last_error=True)
        self.userenv = u = c.WinDLL('userenv', use_last_error=True)
        k.CloseHandle.argtypes = [w.HANDLE]
        k.LocalFree.argtypes = [c.c_void_p]
        k.GetExitCodeProcess.argtypes = [w.HANDLE, c.POINTER(w.DWORD)]
        k.WaitForSingleObject.argtypes = [w.HANDLE, w.DWORD]
        k.ResumeThread.argtypes = [w.HANDLE]
        k.TerminateProcess.argtypes = [w.HANDLE, w.UINT]
        a.FreeSid.argtypes = [c.c_void_p]
        u.CreateAppContainerProfile.argtypes = [w.LPCWSTR, w.LPCWSTR, w.LPCWSTR, c.c_void_p, w.DWORD, c.POINTER(c.c_void_p)]
        u.CreateAppContainerProfile.restype = c.c_long
        u.DeriveAppContainerSidFromAppContainerName.argtypes = [w.LPCWSTR, c.POINTER(c.c_void_p)]
        u.DeriveAppContainerSidFromAppContainerName.restype = c.c_long
        sid = c.c_void_p()
        hr = u.CreateAppContainerProfile(name, 'Aieyra 众创 OS', 'Local development', None, 0, c.byref(sid))
        if hr:
            hr = u.DeriveAppContainerSidFromAppContainerName(name, c.byref(sid))
        if hr:
            raise OSError('AppContainer profile: ' + hex(hr & 0xffffffff))
        self.sid = sid
        a.ConvertSidToStringSidW.argtypes = [c.c_void_p, c.POINTER(w.LPWSTR)]
        text = w.LPWSTR()
        if not a.ConvertSidToStringSidW(sid, c.byref(text)):
            raise c.WinError(c.get_last_error())
        self.sid_text = text.value
        k.LocalFree(text)
        self.granted = False
        self.drive = None
        k.QueryDosDeviceW.argtypes = [w.LPCWSTR, w.LPWSTR, w.DWORD]
        k.DefineDosDeviceW.argtypes = [w.DWORD, w.LPCWSTR, w.LPCWSTR]
        self.target = '\\??\\' + str(self.root)
        for letter in reversed('DEFGHIJKLMNOPQRSTUVWXYZ'):
            name = letter + ':'
            buffer = c.create_unicode_buffer(4096)
            if k.QueryDosDeviceW(name, buffer, len(buffer)): continue
            if k.DefineDosDeviceW(0x1 | 0x8, name, self.target): self.drive = name + '\\'; break
        if not self.drive: raise OSError('No local drive alias available for AppContainer')
        shim = Path(__file__).with_name('appcontainer-fs.cjs')
        import shutil
        shutil.copyfile(shim, self.root / 'appcontainer-fs.cjs')
        shutil.copyfile(shim.with_name('appcontainer-aidebug.cjs'), self.root / 'appcontainer-aidebug.cjs')
        try: from .windows_devices import DeviceMap
        except ImportError: from windows_devices import DeviceMap
        try:
            self.devices = DeviceMap(self)
        except Exception:
            self.close()
            raise

    # @chain-region AppContainer.mapped | calls: len, prefix.lower, str, value.lower, value.lower().startswith
    def mapped(self, value):
        value = str(value)
        prefix = str(self.root)
        if value.lower() == prefix.lower(): return self.drive
        if value.lower().startswith(prefix.lower() + '\\'): return self.drive + value[len(prefix) + 1:]
        return value

    # @chain-region AppContainer.grant | calls: str, subprocess.run
    def grant(self):
        if self.granted: return
        # Grant this exact container only its own directory. The DOS alias
        # avoids granting access to or enumerating any host ancestor.
        subprocess.run(['icacls', str(self.root), '/grant:r', '*' + self.sid_text + ':(OI)(CI)F', '/Q'],
                       check=True, capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
        self.granted = True

    # @chain-region AppContainer.environment | calls: (extra or {}).items, directory.mkdir, env.items, env.update, self.mapped, str
    def environment(self, extra=None):
        profile = self.root / 'profile'
        for directory in (profile, profile / 'AppData/Local', profile / 'AppData/Roaming', self.root / 'temporary',
                          profile / 'AppData/Local/Packages' / self.name / 'AC/Temp'):
            directory.mkdir(parents=True, exist_ok=True)
        env = {key: os.environ[key] for key in ('SystemRoot', 'WINDIR') if key in os.environ}
        env.update(PATH=str(self.root / 'tools') + ';' + os.environ['SystemRoot'] + '\\System32',
                   COMSPEC=os.environ['SystemRoot'] + '\\System32\\cmd.exe', USERPROFILE=str(profile),
                   LOCALAPPDATA=str(profile / 'AppData/Local'), APPDATA=str(profile / 'AppData/Roaming'),
                   TEMP=str(self.root / 'temporary'), TMP=str(self.root / 'temporary'),
                   PYTHONUTF8='1', PYTHONDONTWRITEBYTECODE='1', GOMAXPROCS='1', GOFLAGS='-p=1')
        env.update({key: self.mapped(value) for key, value in (extra or {}).items()})
        env.update(AIEYRA_APPCONTAINER_DRIVE=self.drive, NODE_OPTIONS='--require ' + self.drive + 'appcontainer-fs.cjs')
        return {key: self.mapped(value) for key, value in env.items()}

    # @chain-region AppContainer.start | calls: ValueError, pump, ready.set, ready.wait, result.get, self._start, self.kernel.TerminateProcess, thread.start …
    def start(self, argv, cwd, log, extra=None):
        with self.lifetime:
            if self.closed: raise ValueError('development_sandbox_closed')
            # Windows requires process creation and debug event handling on the
            # same thread. This thread owns the descendant creation notifications.
            ready, result = threading.Event(), {}
            # @chain-region AppContainer.start.launch | calls: pump, ready.set, self._start, self.kernel.TerminateProcess, threading.current_thread
            def launch():
                process = None
                try:
                    process = self._start(argv, cwd, log, extra)
                    process.debug_thread = threading.current_thread()
                    result['process'] = process
                    ready.set()
                    try: from .windows_debug import pump
                    except ImportError: from windows_debug import pump
                    pump(self.kernel, self.devices)
                except Exception as error:
                    result['error'] = error
                    if process and process._handle: self.kernel.TerminateProcess(process._handle, 1)
                    ready.set()
            thread = threading.Thread(target=launch, daemon=True)
            thread.start()
            if not ready.wait(30): raise ValueError('development_launch_timeout')
            if result.get('error'): raise result['error']
            return result['process']

    # @chain-region AppContainer._start | calls: '\x00'.join, Capabilities, Process, ProcessInfo, SIDAttributes, StartupEx, WindowsJob, a.ConvertStringSidToSidW …
    def _start(self, argv, cwd, log, extra=None):
        try: from .local_runner import WindowsJob
        except ImportError: from local_runner import WindowsJob
        import msvcrt
        k, a = self.kernel, self.advapi
        attributes = None
        capability_sids = []
        file = None
        info = ProcessInfo()
        try:
            a.ConvertStringSidToSidW.argtypes = [w.LPCWSTR, c.POINTER(c.c_void_p)]
            caps = (SIDAttributes * 3)()
            for i, name in enumerate(('S-1-15-3-1', 'S-1-15-3-2', 'S-1-15-3-3')):
                ptr = c.c_void_p()
                if not a.ConvertStringSidToSidW(name, c.byref(ptr)):
                    raise c.WinError(c.get_last_error())
                capability_sids.append(ptr); caps[i] = SIDAttributes(ptr, 4)
            security = Capabilities(self.sid, caps, 3, 0)
            size = c.c_size_t()
            k.InitializeProcThreadAttributeList.argtypes = [c.c_void_p, w.DWORD, w.DWORD, c.POINTER(c.c_size_t)]
            k.UpdateProcThreadAttribute.argtypes = [c.c_void_p, w.DWORD, c.c_size_t, c.c_void_p, c.c_size_t, c.c_void_p, c.c_void_p]
            k.DeleteProcThreadAttributeList.argtypes = [c.c_void_p]
            k.InitializeProcThreadAttributeList(None, 1, 0, c.byref(size))
            attributes = c.create_string_buffer(size.value)
            if not k.InitializeProcThreadAttributeList(attributes, 1, 0, c.byref(size)):
                raise c.WinError(c.get_last_error())
            if not k.UpdateProcThreadAttribute(attributes, 0, 0x20009, c.byref(security), c.sizeof(security), None, None):
                raise c.WinError(c.get_last_error())
            startup = StartupEx(); startup.startup.cb = c.sizeof(startup); startup.attributes = c.cast(attributes, c.c_void_p)
            file = open(log, 'ab', buffering=0)
            # All three standard handles refer to an owned file; no Link pipe/credential handle is inherited.
            os.set_inheritable(file.fileno(), True)
            startup.startup.flags = 0x100
            startup.startup.stdin = startup.startup.stdout = startup.startup.stderr = msvcrt.get_osfhandle(file.fileno())
            environment = self.environment(extra)
            block = c.create_unicode_buffer('\0'.join(key + '=' + value for key, value in sorted(environment.items())) + '\0\0')
            argv = [self.mapped(v) for v in argv]
            cwd = self.mapped(cwd)
            cmd = c.create_unicode_buffer(subprocess.list2cmdline(argv))
            k.CreateProcessW.argtypes = [w.LPCWSTR, w.LPWSTR, c.c_void_p, c.c_void_p, w.BOOL, w.DWORD, c.c_void_p,
                                        w.LPCWSTR, c.POINTER(StartupEx), c.POINTER(ProcessInfo)]
            if not k.CreateProcessW(str(argv[0]), cmd, None, None, True, 0x80000 | 0x400 | 0x08000000 | 0x4 | 0x1,
                                    block, str(cwd), c.byref(startup), c.byref(info)):
                raise c.WinError(c.get_last_error())
            process = Process(k, info, file)
            try:
                self.devices.apply(info.process)
                process.job = WindowsJob(process)
                if k.ResumeThread(info.thread) == 0xffffffff:
                    raise c.WinError(c.get_last_error())
            except Exception:
                k.TerminateProcess(info.process, 1); process.close(); raise
            return process
        except Exception:
            if file and not file.closed: file.close()
            raise
        finally:
            if info.thread: k.CloseHandle(info.thread)
            if attributes: k.DeleteProcThreadAttributeList(attributes)
            for sid in capability_sids: k.LocalFree(sid)
            if file and not file.closed: os.set_inheritable(file.fileno(), False)

    # @chain-region AppContainer.close | calls: self._close
    def close(self):
        with self.lifetime:
            if self.closed: return
            self.closed = True
            self._close()

    # @chain-region AppContainer._close | calls: getattr, self.advapi.FreeSid, self.devices.close, self.kernel.DefineDosDeviceW
    def _close(self):
        if getattr(self, 'devices', None):
            self.devices.close(); self.devices = None
        if self.drive:
            self.kernel.DefineDosDeviceW(0x1 | 0x2 | 0x4 | 0x8, self.drive[:2], self.target); self.drive = None
        if self.sid:
            self.advapi.FreeSid(self.sid); self.sid = None
