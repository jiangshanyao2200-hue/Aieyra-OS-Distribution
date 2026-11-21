# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: Core/AGENTS.md | ring 0
# Chains: module-local; query impact before editing
# Regions: module initialization / declarations
# Impact: python -B scripts/code-atlas.py show Core/tools/build-resources.ps1
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

param([string]$Version='0.1.6', [string]$OutputDir='')
$ErrorActionPreference='Stop'
$project=Split-Path (Split-Path $PSScriptRoot)
$core=Join-Path $project 'Core'
$out=if($OutputDir){[IO.Path]::GetFullPath($OutputDir)}else{Join-Path (Split-Path $project) 'AIDEBUG/build-resources'}
$rc=Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\rc.exe" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
$cvt=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\cvtres.exe'
if (-not $rc -or -not (Test-Path $cvt)) { throw '图标构建需要 Windows SDK 的 rc.exe 与 .NET cvtres.exe。' }
New-Item -ItemType Directory -Force $out | Out-Null
$versionParts=($Version -split '\.')
if ($versionParts.Count -ne 3 -or $Version -notmatch '^\d+\.\d+\.\d+$') { throw '版本号应为 x.y.z。' }
$quad=($versionParts -join ',')+',0'
foreach ($kind in @('os','config','cli')) {
 $package=Join-Path $core "cmd\aieyra-$kind"
 $name=if ($kind -eq 'os') { 'Aieyra OS' } elseif ($kind -eq 'cli') { 'Aieyra CLI' } else { 'Aieyra Config' }
 $icon=if ($kind -eq 'cli') { 'os' } else { $kind }
 $source=@"
1 ICON "../../../Client/Desktop/assets/$icon.ico"
1 VERSIONINFO
 FILEVERSION $quad
 PRODUCTVERSION $quad
 FILEOS 0x40004
 FILETYPE 0x1
BEGIN
 BLOCK "StringFileInfo"
 BEGIN
  BLOCK "040904b0"
  BEGIN
   VALUE "FileDescription", "$name\0"
   VALUE "FileVersion", "$Version\0"
   VALUE "ProductName", "$name\0"
   VALUE "ProductVersion", "$Version\0"
   VALUE "OriginalFilename", "$name.exe\0"
  END
 END
 BLOCK "VarFileInfo"
 BEGIN
  VALUE "Translation", 0x409, 1200
 END
END
"@
 $sourcePath=Join-Path $package 'resource.rc'
 [IO.File]::WriteAllText($sourcePath,$source,[Text.UTF8Encoding]::new($false))
 $res=Join-Path $out "$kind.res"
 Push-Location $package
 try {
  & $rc.FullName /nologo /fo $res resource.rc
  if ($LASTEXITCODE -ne 0) { throw "编译 $kind 图标失败。" }
  & $cvt /nologo /machine:x64 "/out:resource_windows_amd64.syso" $res
  if ($LASTEXITCODE -ne 0) { throw "转换 $kind 图标资源失败。" }
  # cvtres 的 @comp.id 是编译器元数据，Go 的 COFF 读取器只接受 @feat.00
  # 这一绝对符号。把 @comp.id 标为标准 DEBUG 符号，不改任何资源或重定位。
  $object=Join-Path $package 'resource_windows_amd64.syso'
  $bytes=[IO.File]::ReadAllBytes($object)
  $symbolOffset=[BitConverter]::ToUInt32($bytes,8)
  $symbolCount=[BitConverter]::ToUInt32($bytes,12)
  for ($i=0; $i -lt $symbolCount;) {
   $at=$symbolOffset+18*$i
   $symbolName=[Text.Encoding]::ASCII.GetString($bytes,$at,8)
   if ($symbolName -eq '@comp.id' -and [BitConverter]::ToInt16($bytes,$at+12) -eq -1) {
    $bytes[$at+12]=254; $bytes[$at+13]=255
   }
   $i+=1+$bytes[$at+17]
  }
  [IO.File]::WriteAllBytes($object,$bytes)
 } finally { Pop-Location }
}
