# @file-map:start
# 文件: link/desktop/aidebug-native-hit.ps1
# 位置: 二环·桌面能力 | Electron生命周期、权限边界、本机服务、云账号与可诊断桌面模块。
# 约束: renderer通过preload白名单进入主进程，禁止开放任意IPC；启动失败先持久取证；关闭须收束服务租约和诊断
# 下游: 无已解析的项目内静态导入
# 上游: link/desktop/workspace-aidebug.cjs
# 链路: 目录 CODEMAP.md → docs/CODE-MAP.json
# 验证: npm --prefix link/desktop run check, AIDEBUG/startup-review.py
# 目录: <module> 为导入、状态与入口接线；以下为稳定区域锚点，调用名是静态线索。
# 维护: 修改接口/入口/约束后运行 scripts/code_map.py --write；具体经验写入本目录 CODEMAP.md 的经验区。
# @file-map:end
param([string]$WindowHandle='',[Parameter(Mandatory)][int]$TaskProcessId,[double]$X=0.4,[double]$Y=24,[double]$LogicalHeight=780)
$ErrorActionPreference='Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class OwnedWindowHit {
 [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr w,out Rect r);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr w,out uint p);
 [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
 [DllImport("user32.dll",SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr w,uint m,IntPtr wp,IntPtr lp,uint flags,uint timeout,out IntPtr result);
}
'@
$taskWindow=if($WindowHandle){[IntPtr]::new([long]::Parse($WindowHandle))}else{(Get-Process -Id $TaskProcessId).MainWindowHandle}
$taskOwner=[uint32]0
[void][OwnedWindowHit]::GetWindowThreadProcessId($taskWindow,[ref]$taskOwner)
if($taskOwner -ne $TaskProcessId){throw 'Hit test target is not the explicitly owned process'}
$taskDpi=[OwnedWindowHit]::SetThreadDpiAwarenessContext([IntPtr]::new(-4))
try {
 $taskRect=New-Object OwnedWindowHit+Rect
 if(-not [OwnedWindowHit]::GetWindowRect($taskWindow,[ref]$taskRect)){throw 'Owned window has no bounds'}
 $taskX=[int]($taskRect.Left+($taskRect.Right-$taskRect.Left)*$X)
 $taskY=[int]($taskRect.Top+$Y*($taskRect.Bottom-$taskRect.Top)/$LogicalHeight)
 $taskPacked=($taskX -band 65535) -bor (($taskY -band 65535) -shl 16)
 $taskResult=[IntPtr]::Zero
 if([OwnedWindowHit]::SendMessageTimeout($taskWindow,0x84,[IntPtr]::Zero,[IntPtr]::new($taskPacked),2,3000,[ref]$taskResult) -eq [IntPtr]::Zero){throw 'Native hit test timed out'}
 @{process=$taskOwner;handle=$taskWindow.ToInt64().ToString();hit=$taskResult.ToInt64();caption=($taskResult.ToInt64() -eq 2);point=@($taskX,$taskY);method='WM_NCHITTEST';focusChanged=$false;pointerMoved=$false} | ConvertTo-Json -Compress
} finally {[void][OwnedWindowHit]::SetThreadDpiAwarenessContext($taskDpi)}
