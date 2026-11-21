// <AI-CHAIN v1>
// Map: CODEMAP.md
// Owner: Client/Desktop/tools/AGENTS.md | ring 3
// Chains: module-local; query impact before editing
// Regions: module initialization / declarations
// Impact: python -B scripts/code-atlas.py show Client/Desktop/tools/computer-input.cs
// Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
// </AI-CHAIN>

using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

// Physical input is confined to a freshly observed, foreground target window.
// Down/up pairs are sent together; drag always releases the button in finally.
public static class AgentInput {
 [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X,Y; }
 [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }
 [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx,dy; public uint mouseData,dwFlags,time; public UIntPtr extra; }
 [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort vk,scan; public uint flags,time; public UIntPtr extra; }
 [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public MOUSEINPUT mouse; [FieldOffset(0)] public KEYBDINPUT key; }
 [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION value; }
 [DllImport("user32.dll")] static extern uint SendInput(uint count,INPUT[] inputs,int size);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,IntPtr process);
 [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
 [DllImport("user32.dll")] static extern bool AttachThreadInput(uint from,uint to,bool attach);
 [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr window);
 [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window,int command);
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr window);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window,out RECT rect);
 [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT point);
 [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr window,uint flag);
 [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
 [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
 static INPUT Mouse(int x,int y,uint flags,uint data) {return new INPUT{type=0,value=new UNION{mouse=new MOUSEINPUT{dx=x,dy=y,dwFlags=flags,mouseData=data}}};}
 static INPUT Key(ushort vk,ushort scan,uint flags) {return new INPUT{type=1,value=new UNION{key=new KEYBDINPUT{vk=vk,scan=scan,flags=flags}}};}
 static void Send(params INPUT[] values) {if(SendInput((uint)values.Length,values,Marshal.SizeOf(typeof(INPUT)))!=values.Length)throw new Exception("Input blocked by Windows; outcome may be partial, observe before retry");}
 public static void Ready(IntPtr window) {
  if(IsIconic(window)||GetForegroundWindow()!=window)throw new Exception("target_not_foreground: focus the target, then observe again");
  foreach(int key in new[]{0x10,0x11,0x12,0x5B,0x5C,1,2,4})if(GetAsyncKeyState(key)<0)throw new Exception("user_input_active: release physical modifiers/buttons before automation");
 }
 static void Foreground(IntPtr window) {if(GetForegroundWindow()!=window)throw new Exception("Target changed during input; observe before continuing");}
 public static bool Focus(IntPtr window) {
  if(IsIconic(window))ShowWindow(window,9);
  if(GetForegroundWindow()==window)return true;
  uint own=GetCurrentThreadId(),foreground=GetWindowThreadProcessId(GetForegroundWindow(),IntPtr.Zero),target=GetWindowThreadProcessId(window,IntPtr.Zero);
  bool joinedForeground=false,joinedTarget=false;
  try{if(foreground!=0&&foreground!=own)joinedForeground=AttachThreadInput(own,foreground,true);if(target!=0&&target!=own&&target!=foreground)joinedTarget=AttachThreadInput(own,target,true);BringWindowToTop(window);SetForegroundWindow(window);return GetForegroundWindow()==window;}
  finally{if(joinedTarget)AttachThreadInput(own,target,false);if(joinedForeground)AttachThreadInput(own,foreground,false);}
 }
 public static void Geometry(IntPtr window,int left,int top,int width,int height) {RECT r;if(!GetWindowRect(window,out r)||r.Left!=left||r.Top!=top||r.Right-r.Left!=width||r.Bottom-r.Top!=height)throw new Exception("stale_geometry: window moved or resized; observe again");}
 static INPUT Move(IntPtr window,int x,int y) {
  POINT p=new POINT{X=x,Y=y};if(GetAncestor(WindowFromPoint(p),2)!=window)throw new Exception("target_obscured: coordinate belongs to another window; observe again");
  int l=GetSystemMetrics(76),t=GetSystemMetrics(77),w=GetSystemMetrics(78),h=GetSystemMetrics(79);
  if(x<l||y<t||x>=l+w||y>=t+h||w<2||h<2)throw new Exception("Coordinate is outside the virtual screen");
  return Mouse((int)Math.Round((x-l)*65535.0/(w-1)),(int)Math.Round((y-t)*65535.0/(h-1)),0x8000|0x4000|1,0);
 }
 public static void Click(IntPtr window,int x,int y,bool right,int count) {
  Ready(window);for(int i=0;i<count;i++){Foreground(window);INPUT move=Move(window,x,y);Send(move,Mouse(0,0,right?8u:2u,0),Mouse(0,0,right?16u:4u,0));if(count>1)Thread.Sleep(70);}
 }
 public static void Scroll(IntPtr window,int x,int y,int dx,int dy) {
  Ready(window);Foreground(window);Send(Move(window,x,y));
  if(dy!=0)Send(Mouse(0,0,0x0800,unchecked((uint)-dy)));
  if(dx!=0)Send(Mouse(0,0,0x1000,unchecked((uint)dx)));
 }
 public static void Drag(IntPtr window,int x,int y,int toX,int toY,string cancelFile) {
  Ready(window);Send(Move(window,x,y));bool down=false;
  try {down=true;Send(Mouse(0,0,2,0));for(int i=1;i<=20;i++){if(File.Exists(cancelFile))throw new Exception("Input cancelled; observe result");Foreground(window);Send(Move(window,x+(toX-x)*i/20,y+(toY-y)*i/20));Thread.Sleep(15);}}
  finally{if(down)Send(Mouse(0,0,4,0));}
 }
 public static void Type(IntPtr window,string text,string cancelFile) {
  Ready(window);
  foreach(char c in text){if(File.Exists(cancelFile))throw new Exception("Typing cancelled; partial text may exist");Foreground(window);Send(Key(0,c,4),Key(0,c,6));}
 }
 public static void Press(IntPtr window,string chord) {
  Ready(window);string[] parts=chord.Split('+');var inputs=new System.Collections.Generic.List<INPUT>();var keys=new System.Collections.Generic.List<ushort>();
  foreach(string raw in parts){string p=raw.Trim().ToUpperInvariant();ushort key;
   switch(p){case "CTRL":case "CONTROL":key=0x11;break;case "SHIFT":key=0x10;break;case "ALT":key=0x12;break;case "ENTER":key=13;break;case "TAB":key=9;break;case "ESC":case "ESCAPE":key=27;break;case "BACKSPACE":key=8;break;case "DELETE":key=46;break;case "SPACE":key=32;break;case "ARROWLEFT":key=37;break;case "ARROWUP":key=38;break;case "ARROWRIGHT":key=39;break;case "ARROWDOWN":key=40;break;case "HOME":key=36;break;case "END":key=35;break;case "PAGEUP":key=33;break;case "PAGEDOWN":key=34;break;
   default:if(p.Length==1&&((p[0]>='A'&&p[0]<='Z')||(p[0]>='0'&&p[0]<='9')))key=p[0];else if(p.Length>=2&&p[0]=='F'){int n;if(!int.TryParse(p.Substring(1),out n)||n<1||n>12)throw new Exception("Unsupported key");key=(ushort)(111+n);}else throw new Exception("Unsupported key");break;}
   if(keys.Contains(key)||keys.Count>=4)throw new Exception("Invalid key chord");keys.Add(key);inputs.Add(Key(key,0,0));}
  for(int i=keys.Count-1;i>=0;i--)inputs.Add(Key(keys[i],0,2));Foreground(window);Send(inputs.ToArray());
 }
}
