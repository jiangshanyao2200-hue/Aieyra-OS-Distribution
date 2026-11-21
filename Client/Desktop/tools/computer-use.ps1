# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: Client/Desktop/tools/AGENTS.md | ring 3
# Chains: module-local; query impact before editing
# Regions: Identity
# Impact: python -B scripts/code-atlas.py show Client/Desktop/tools/computer-use.ps1
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

# stdin JSON，stdout结构化结果。只在已核对的目标窗口内查找控件。
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,System.Drawing,System.Windows.Forms
Add-Type -Path (Join-Path $PSScriptRoot 'computer-input.cs')
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class AgentWindow {
 [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
 [DllImport("user32.dll")] public static extern IntPtr GetWindowDpiAwarenessContext(IntPtr window);
 public delegate bool Callback(IntPtr h,IntPtr p);
 [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }
 [DllImport("user32.dll")] public static extern bool EnumWindows(Callback cb,IntPtr p);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out int pid);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h,StringBuilder text,int count);
 [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h,IntPtr dc,uint flags);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out RECT r);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h,StringBuilder text,int count);
 [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h,int index);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr SendMessageTimeout(IntPtr h,uint msg,IntPtr wp,string lp,uint flags,uint timeout,out IntPtr result);
 public static string ClassOf(IntPtr h){var b=new StringBuilder(256);GetClassName(h,b,b.Capacity);return b.ToString();}
 public static bool IsEdit(IntPtr h){return ClassOf(h).ToUpperInvariant().Contains("EDIT");}
 public static bool IsButton(IntPtr h){return ClassOf(h).ToUpperInvariant().Contains("BUTTON");}
 public static bool IsPassword(IntPtr h){return IsEdit(h)&&(GetWindowLong(h,-16)&32)!=0;}
 public static void Message(IntPtr h,uint msg,string text){IntPtr result;if(SendMessageTimeout(h,msg,IntPtr.Zero,text,2,2000,out result)==IntPtr.Zero)throw new Exception("Native control did not respond");}
 [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access,bool inherit,int pid);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h,int flags,StringBuilder name,ref int size);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
 public static string PathOf(int pid){var h=OpenProcess(0x1000,false,pid);if(h==IntPtr.Zero)throw new Exception("Process unavailable");try{var b=new StringBuilder(32768);int n=b.Capacity;if(!QueryFullProcessImageName(h,0,b,ref n))throw new Exception("Cannot identify process");return b.ToString();}finally{CloseHandle(h);}}
}
'@
[void][AgentWindow]::SetThreadDpiAwarenessContext([IntPtr](-4))
function Identity([IntPtr]$handle){
 $processId=0;[void][AgentWindow]::GetWindowThreadProcessId($handle,[ref]$processId)
 $process=Get-Process -Id $processId
 $title=[Text.StringBuilder]::new(2048);[void][AgentWindow]::GetWindowText($handle,$title,$title.Capacity)
 $style=[AgentWindow]::GetWindowLong($handle,-20)
 @{pid=$processId;handle=$handle.ToInt64().ToString();path=[AgentWindow]::PathOf($processId);started=$process.StartTime.ToUniversalTime().Ticks.ToString();title=$title.ToString();window_state=@{visible=[AgentWindow]::IsWindowVisible($handle);foreground=([AgentWindow]::GetForegroundWindow() -eq $handle);no_activate=(($style -band 0x08000000) -ne 0);mouse_passthrough=(($style -band 0x80020) -eq 0x80020)}}
}
try {
 $a=[Console]::In.ReadToEnd()|ConvertFrom-Json
 if($a.action -eq 'list'){
  $items=[Collections.Generic.List[object]]::new()
  $unavailable=[Collections.Generic.List[object]]::new()
  [void][AgentWindow]::EnumWindows({param($h,$p)
   $candidateId=0;[void][AgentWindow]::GetWindowThreadProcessId($h,[ref]$candidateId)
   if($a.pid -and $candidateId -ne $a.pid){return $true}
   if([AgentWindow]::IsWindowVisible($h)){try{$i=Identity $h;if($i.title){$items.Add($i)}}catch{if($a.pid){$unavailable.Add(@{handle=$h.ToInt64().ToString();error=$_.Exception.Message})}}}
   return $true
  },[IntPtr]::Zero)
  @{ok=$true;windows=@($items.ToArray());unavailable=@($unavailable.ToArray())}|ConvertTo-Json -Depth 8 -Compress;exit 0
 }
 $handle=[IntPtr]([long]$a.identity.handle);$identity=Identity $handle
 foreach($field in @('pid','handle','path','started')){if([string]$identity[$field] -ne [string]$a.identity.$field){throw 'Window identity changed; attach again'}}
 $root=[Windows.Automation.AutomationElement]::FromHandle($handle)
 $capture=$null
 if($a.action -eq 'screenshot' -or $a.action -eq 'observe'){
  $physical=[AgentInput+RECT]::new();if(-not [AgentInput]::GetWindowRect($handle,[ref]$physical)){throw 'Window bounds unavailable'}
  if([AgentInput]::IsIconic($handle)){throw 'Window is minimized; restore it before observation'}
  # PrintWindow按目标窗口的DPI绘制；匹配其上下文，避免未感知DPI的应用只填满位图的一部分。
  [void][AgentWindow]::SetThreadDpiAwarenessContext([AgentWindow]::GetWindowDpiAwarenessContext($handle))
  $rect=[AgentWindow+RECT]::new();[void][AgentWindow]::GetWindowRect($handle,[ref]$rect)
  $w=$rect.Right-$rect.Left;$h=$rect.Bottom-$rect.Top
  if($w -le 0 -or $h -le 0 -or $w*$h -gt 32000000){throw 'Invalid window dimensions'}
  $bitmap=[Drawing.Bitmap]::new($w,$h);$g=[Drawing.Graphics]::FromImage($bitmap);$dc=$g.GetHdc()
  try{if(-not [AgentWindow]::PrintWindow($handle,$dc,2)){throw 'Window capture unavailable'}}finally{$g.ReleaseHdc($dc);$g.Dispose()}
  try{$bitmap.Save($a.capture_path,[Drawing.Imaging.ImageFormat]::Png)}finally{$bitmap.Dispose()}
  $observation=@{width=$w;height=$h;left=$physical.Left;top=$physical.Top;screen_width=$physical.Right-$physical.Left;screen_height=$physical.Bottom-$physical.Top;coordinate_space='original_screenshot_pixels';captured_at=[DateTime]::UtcNow.ToString('o')}
  $capture=@{ok=$true;path=$a.capture_path;width=$w;height=$h;identity=$identity;observation=$observation;next='view_image(path) then use this revision; coordinates refer to original screenshot pixels'}
  [void][AgentWindow]::SetThreadDpiAwarenessContext([IntPtr](-4))
  if($a.action -eq 'screenshot'){$capture|ConvertTo-Json -Depth 8 -Compress;exit 0}
 }
 $pixel=($a.PSObject.Properties.Name -contains 'x') -or $a.action -in @('double_click','right_click','scroll','drag')
 if($a.action -eq 'focus'){
  if(-not [AgentInput]::Focus($handle)){throw 'Windows refused focus; no input dispatched'}
  @{ok=$true;performed='focus';identity=$identity;next='observe after focus'}|ConvertTo-Json -Depth 6 -Compress;exit 0
 }
 if($pixel -or $a.action -eq 'type_text' -or ($a.action -eq 'keypress' -and -not $a.element_id)){
  if($pixel){
   $o=$a.observation;if(-not $o -or $o.width -le 0 -or $o.height -le 0){throw 'Screenshot observation required'}
   if(([DateTime]::UtcNow-[DateTime]::Parse($o.captured_at).ToUniversalTime()).TotalSeconds -gt 120){throw 'stale_snapshot: screenshot is older than 120 seconds'}
   [AgentInput]::Geometry($handle,$o.left,$o.top,$o.screen_width,$o.screen_height)
   $x=[int][Math]::Floor($o.left+[double]$a.x*$o.screen_width/$o.width);$y=[int][Math]::Floor($o.top+[double]$a.y*$o.screen_height/$o.height)
  }
  switch($a.action){
   'click' {if($a.element_id){throw 'Use either element_id or screenshot coordinates'};[AgentInput]::Click($handle,$x,$y,$false,1)}
   'double_click' {[AgentInput]::Click($handle,$x,$y,$false,2)}
   'right_click' {[AgentInput]::Click($handle,$x,$y,$true,1)}
   'scroll' {$dx=[int]$a.delta_x;$dy=[int]$a.delta_y;if([Math]::Abs($dx) -gt 2400 -or [Math]::Abs($dy) -gt 2400 -or ($dx -eq 0 -and $dy -eq 0)){throw 'Scroll delta must be nonzero and within 2400 wheel units'};[AgentInput]::Scroll($handle,$x,$y,$dx,$dy)}
   'drag' {$tx=[int][Math]::Floor($o.left+[double]$a.to_x*$o.screen_width/$o.width);$ty=[int][Math]::Floor($o.top+[double]$a.to_y*$o.screen_height/$o.height);[AgentInput]::Drag($handle,$x,$y,$tx,$ty,[string]$a.cancel_path)}
   'type_text' {if($null -eq $a.text){throw 'type_text requires text'};[AgentInput]::Type($handle,[string]$a.text,[string]$a.cancel_path)}
   'keypress' {$key=[string]$a.key;if($key -eq 'SelectAll'){$key='Ctrl+A'};[AgentInput]::Press($handle,$key)}
   default {throw 'Unsupported pixel operation'}
  }
  $effect=@{}
  if($a.action -eq 'scroll'){$effect=@{delta_x=$dx;delta_y=$dy;horizontal_notches=$dx/120.0;vertical_notches=$dy/120.0;positive_y='down';repetition='Already dispatched this entire delta once; observe before any further scroll'}}
  @{ok=$true;performed=$a.action;effect=$effect;identity=$identity;next='observe to verify the actual result before another action'}|ConvertTo-Json -Depth 6 -Compress;exit 0
 }
 # BFS有界遍历，避免枚举整个桌面或一次展开无限长文档。
 $queue=[Collections.Generic.Queue[object]]::new();$queue.Enqueue($root)
 $elements=[Collections.Generic.List[object]]::new();$walker=[Windows.Automation.TreeWalker]::ControlViewWalker
 while($queue.Count -gt 0 -and $elements.Count -lt 500){
  $e=$queue.Dequeue();$elements.Add($e)
  try{$c=$walker.GetFirstChild($e);while($null -ne $c -and $queue.Count -lt 600){$queue.Enqueue($c);$c=$walker.GetNextSibling($c)}}catch{}
 }
 if($a.action -ne 'inspect' -and $a.action -ne 'observe'){
  $target=$elements | Where-Object {($_.GetRuntimeId() -join '.') -eq $a.element_id} | Select-Object -First 1
  if(-not $target){throw 'Element is stale or unavailable; inspect again'}
  if(-not $target.Current.IsEnabled){throw 'Element disabled'}
  switch($a.action){
   'click' {
    $pattern=$null
    if($target.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)){$pattern.Invoke()}
    elseif($target.TryGetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern,[ref]$pattern)){$pattern.Select()}
    elseif($target.TryGetCurrentPattern([Windows.Automation.TogglePattern]::Pattern,[ref]$pattern)){$pattern.Toggle()}
    elseif($target.TryGetCurrentPattern([Windows.Automation.ExpandCollapsePattern]::Pattern,[ref]$pattern)){$pattern.Expand()}
    elseif([AgentWindow]::IsButton([IntPtr]$target.Current.NativeWindowHandle)){[AgentWindow]::Message([IntPtr]$target.Current.NativeWindowHandle,245,$null)}
    else{throw 'Control has no supported semantic click pattern'}
   }
   'set_value' {
    $pattern=$null
    if($target.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern,[ref]$pattern)){$pattern.SetValue([string]$a.value)}
    elseif($target.TryGetCurrentPattern([Windows.Automation.RangeValuePattern]::Pattern,[ref]$pattern)){$pattern.SetValue([double]$a.value)}
    elseif([AgentWindow]::IsEdit([IntPtr]$target.Current.NativeWindowHandle)){[AgentWindow]::Message([IntPtr]$target.Current.NativeWindowHandle,12,[string]$a.value)}
    else{throw 'Control does not support setting a value'}
   }
   'keypress' {
    [AgentInput]::Ready($handle);$target.SetFocus()
    $key=[string]$a.key;if($key -eq 'SelectAll'){$key='Ctrl+A'};[AgentInput]::Press($handle,$key)
   }
   default {throw 'Unknown computer action'}
  }
  @{ok=$true;performed=$a.action;identity=$identity;next='inspect to obtain current state'}|ConvertTo-Json -Depth 6 -Compress;exit 0
 }
 $offset=if($null -eq $a.offset){0}else{[int]$a.offset};$limit=if($null -eq $a.limit){100}else{[int]$a.limit}
 if($offset -lt 0 -or $limit -lt 1 -or $limit -gt 200){throw 'Invalid page range'}
 $rows=@($elements | Select-Object -Skip $offset -First $limit | ForEach-Object {
  $e=$_;$c=$e.Current;if($null -eq $c){return};$b=$c.BoundingRectangle;$text='';$pattern=$null;$native=[IntPtr]([long]$c.NativeWindowHandle)
  $password=$c.IsPassword -or [AgentWindow]::IsPassword($native)
  if(-not $password){
   if($e.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern,[ref]$pattern)){$text=$pattern.Current.Value}
   elseif($e.TryGetCurrentPattern([Windows.Automation.TextPattern]::Pattern,[ref]$pattern)){$text=$pattern.DocumentRange.GetText(1200)}
  }
  if($text.Length -gt 1200){$text=$text.Substring(0,1200)}
  $role=$c.ControlType.ProgrammaticName
  if([AgentWindow]::IsEdit($native)){$role='ControlType.Edit'}elseif([AgentWindow]::IsButton($native)){$role='ControlType.Button'}
  $name=if($password){'[password]'}else{$c.Name}
  # Virtual or collapsed Chromium controls can return Rect.Empty (Infinity).
  # Windows PowerShell emits these numbers as invalid JSON; unavailable bounds
  # are null, never fabricated coordinates. Semantic patterns remain usable.
  $bounds=$null
  if($b -and -not $b.IsEmpty -and -not [double]::IsNaN($b.X) -and -not [double]::IsNaN($b.Y) -and -not [double]::IsInfinity($b.Width) -and -not [double]::IsInfinity($b.Height)){$bounds=@{x=$b.X;y=$b.Y;width=$b.Width;height=$b.Height}}
  $screenshotBounds=$null
  if($bounds -and $capture){$o=$capture.observation;$screenshotBounds=@{x=($b.X-$o.left)*$o.width/$o.screen_width;y=($b.Y-$o.top)*$o.height/$o.screen_height;width=$b.Width*$o.width/$o.screen_width;height=$b.Height*$o.height/$o.screen_height}}
  @{id=($e.GetRuntimeId() -join '.');name=$name;automation_id=$c.AutomationId;type=$role;native_class=[AgentWindow]::ClassOf($native);enabled=$c.IsEnabled;password=$password;offscreen=$c.IsOffscreen;text=$text;bounds=$bounds;screenshot_bounds=$screenshotBounds;patterns=@($e.GetSupportedPatterns()|ForEach-Object {$_.ProgrammaticName})}
 })
 $result=@{ok=$true;identity=$identity;elements=$rows;offset=$offset;limit=$limit;total=$elements.Count;has_more=($offset+$limit -lt $elements.Count -or $queue.Count -gt 0);traversal_capped=($queue.Count -gt 0)}
 if($capture){foreach($key in @('path','width','height','observation','next')){$result[$key]=$capture[$key]}}
 $result|ConvertTo-Json -Depth 8 -Compress
}catch{[Console]::Out.WriteLine((@{ok=$false;error=$_.Exception.Message}|ConvertTo-Json -Compress));exit 1}
