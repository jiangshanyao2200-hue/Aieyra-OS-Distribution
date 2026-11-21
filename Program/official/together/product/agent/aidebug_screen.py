# @file-map:start
# 文件: link/agent/aidebug_screen.py
# 位置: 二环·Agent完整链路 | 协作CLI、接续、实际启动器、工作包、源码传输和本机运行。
# 约束: 使用本人已有身份和connection，不因压缩重建身份；写操作保留request_id；未知结果查回执，凭据不进入日志与文档
# 下游: 无已解析的项目内静态导入
# 上游: 入口/动态加载；参阅链路与目录地图
# 链路: observation
# 验证: AIDEBUG/control.test.cjs, AIDEBUG/observe.test.cjs
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
#   BitmapInfo | class
#   record | function
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
"""Sample the actual Windows pixels of a Link window, including native views."""
import argparse
import ctypes as C
from ctypes import wintypes as W
import json
from pathlib import Path
import time


# @chain-region BitmapInfo
class BitmapInfo(C.Structure):
    _fields_ = [('size', W.DWORD), ('width', W.LONG), ('height', W.LONG),
                ('planes', W.WORD), ('bits', W.WORD), ('compression', W.DWORD),
                ('image_size', W.DWORD), ('x_ppm', W.LONG), ('y_ppm', W.LONG),
                ('used', W.DWORD), ('important', W.DWORD)]


# @chain-region record | calls: (output / 'samples.json').write_text, (output / file).write_bytes, BitmapInfo, C.POINTER, C.WinDLL, C.WinError, C.byref, C.create_string_buffer …
def record(window, output, duration, interval):
    user = C.WinDLL('user32', use_last_error=True)
    gdi = C.WinDLL('gdi32', use_last_error=True)
    user.SetProcessDpiAwarenessContext.argtypes = [W.HANDLE]
    user.SetProcessDpiAwarenessContext(W.HANDLE(-4))
    user.GetDC.argtypes = [W.HWND]
    user.GetDC.restype = W.HDC
    user.ReleaseDC.argtypes = [W.HWND, W.HDC]
    user.GetClientRect.argtypes = [W.HWND, C.POINTER(W.RECT)]
    user.ClientToScreen.argtypes = [W.HWND, C.POINTER(W.POINT)]
    user.WindowFromPoint.argtypes = [W.POINT]
    user.WindowFromPoint.restype = W.HWND
    user.GetAncestor.argtypes = [W.HWND, W.UINT]
    user.GetAncestor.restype = W.HWND
    user.GetSystemMetrics.argtypes = [C.c_int]
    gdi.CreateCompatibleDC.argtypes = [W.HDC]
    gdi.CreateCompatibleDC.restype = W.HDC
    gdi.CreateCompatibleBitmap.argtypes = [W.HDC, C.c_int, C.c_int]
    gdi.CreateCompatibleBitmap.restype = W.HBITMAP
    gdi.SelectObject.argtypes = [W.HDC, W.HANDLE]
    gdi.SelectObject.restype = W.HANDLE
    gdi.BitBlt.argtypes = [W.HDC, C.c_int, C.c_int, C.c_int, C.c_int,
                           W.HDC, C.c_int, C.c_int, W.DWORD]
    gdi.GetDIBits.argtypes = [W.HDC, W.HBITMAP, W.UINT, W.UINT,
                             W.LPVOID, C.POINTER(BitmapInfo), W.UINT]
    gdi.DeleteObject.argtypes = [W.HANDLE]
    gdi.DeleteDC.argtypes = [W.HDC]
    rect, point = W.RECT(), W.POINT()
    if not user.GetClientRect(window, C.byref(rect)) or not user.ClientToScreen(window, C.byref(point)):
        raise C.WinError(C.get_last_error())
    width, height = rect.right, rect.bottom
    if not (1 <= width <= 7680 and 1 <= height <= 4320):
        raise ValueError('Invalid or minimized window bounds')
    output.mkdir(parents=True, exist_ok=True)
    screen_dc = user.GetDC(None)
    memory_dc = gdi.CreateCompatibleDC(screen_dc)
    bitmap = gdi.CreateCompatibleBitmap(screen_dc, width, height)
    if not screen_dc or not memory_dc or not bitmap:
        raise C.WinError(C.get_last_error())
    previous = gdi.SelectObject(memory_dc, bitmap)
    info = BitmapInfo(size=C.sizeof(BitmapInfo), width=width, height=-height,
                      planes=1, bits=32, image_size=width * height * 4)
    pixels = C.create_string_buffer(width * height * 4)
    virtual = {'x': user.GetSystemMetrics(76), 'y': user.GetSystemMetrics(77),
               'width': user.GetSystemMetrics(78), 'height': user.GetSystemMetrics(79)}
    # Flush the native compositor before the first sample. DOM visibility alone
    # can precede the presented desktop frame after a zoom or window resize.
    dwm = C.WinDLL('dwmapi', use_last_error=True)
    dwm.DwmFlush.argtypes = []
    dwm.DwmFlush.restype = W.LONG
    frames, start = [], time.perf_counter()
    try:
        composed = dwm.DwmFlush()
        if composed:
            raise OSError(f'desktop_composition_sync_failed: {composed:#x}')
        while True:
            at = (time.perf_counter() - start) * 1000
            if not gdi.BitBlt(memory_dc, 0, 0, width, height, screen_dc,
                              point.x, point.y, 0x00CC0020 | 0x40000000):
                raise C.WinError(C.get_last_error())
            # GetDIBits requires the bitmap not to be selected into a DC.
            gdi.SelectObject(memory_dc, previous)
            copied = gdi.GetDIBits(memory_dc, bitmap, 0, height, pixels, C.byref(info), 0)
            gdi.SelectObject(memory_dc, bitmap)
            if copied != height:
                raise C.WinError(C.get_last_error())
            file = f'{len(frames):03}.bgra'
            (output / file).write_bytes(pixels.raw)
            points = [W.POINT(point.x + round(width * x / 8), point.y + round(height * y / 6))
                      for y in range(1, 6) for x in range(1, 8)]
            visible = sum(user.GetAncestor(user.WindowFromPoint(p), 2) == window.value for p in points)
            frames.append({'at': round(at, 2), 'file': file,
                           'visible_samples': visible, 'total_samples': len(points)})
            if len(frames) == 1:
                print(json.dumps({'ready': True, 'width': width, 'height': height}), flush=True)
            if (time.perf_counter() - start) * 1000 >= duration:
                break
            due = start + len(frames) * interval / 1000
            time.sleep(max(0, due - time.perf_counter()))
    finally:
        gdi.SelectObject(memory_dc, previous)
        gdi.DeleteObject(bitmap)
        gdi.DeleteDC(memory_dc)
        user.ReleaseDC(None, screen_dc)
    result = {'source': 'windows-desktop', 'composition_sync': 'DwmFlush', 'width': width, 'height': height,
              'screen': {'x': point.x, 'y': point.y}, 'virtual_screen': virtual,
              'inside_screen': point.x >= virtual['x'] and point.y >= virtual['y'] and
              point.x + width <= virtual['x'] + virtual['width'] and
              point.y + height <= virtual['y'] + virtual['height'], 'frames': frames}
    (output / 'samples.json').write_text(json.dumps(result), encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--window', type=int, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--duration', type=int, default=750)
    parser.add_argument('--interval', type=int, default=33)
    args = parser.parse_args()
    record(W.HWND(args.window), args.output, min(4000, max(0, args.duration)),
           min(250, max(16, args.interval)))
