# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: scripts/AGENTS.md | ring 3
# Chains: module-local; query impact before editing
# Regions: module initialization / declarations
# Impact: python -B scripts/code-atlas.py show scripts/build-module-launchers.ps1
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

#requires -Version 5.1
# 构建桌面程序启动器（Core/cmd/aieyra-module），与 OS/CLI 共用 Core。
# 图标与版本信息由 scripts/winres.py 生成 .syso 编入，每个启动器各编一次，不依赖外部工具。
[CmdletBinding()]
param(
  [string]$Version = '',
  [string]$OutDir,
  [string]$BuildLDFlags = '',
  [string[]]$Module,
  [string]$BuildReceiptDir = ''
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
if (-not $Version) {
  $versionSource = Get-Content -LiteralPath (Join-Path $root 'Core/host/app.go') -Raw
  if ($versionSource -notmatch 'var Version = "([^"]+)"') { throw 'Cannot read host.Version' }
  $Version = $Matches[1]
}
if (-not $OutDir) { $OutDir = $root }
$null = New-Item -ItemType Directory -Path $OutDir -Force
$core = Join-Path $root 'Core'
$launchers = Get-Content -LiteralPath (Join-Path $root 'Client/Desktop/host/module-launchers.json') -Raw | ConvertFrom-Json
$targets = @($launchers.PSObject.Properties | Where-Object { !$Module -or $_.Name -cin $Module })
if (!$targets.Count -or ($Module | Where-Object { $_ -cnotin $targets.Name })) {
  throw '请求中包含未登记的桌面程序'
}
$moduleProvenance = $null
if (!$BuildLDFlags) {
  if (!$BuildReceiptDir) {
    $BuildReceiptDir = Join-Path (Split-Path $root -Parent) 'AIDEBUG/runs/program-launchers'
  }
  $provenanceTool = Join-Path $PSScriptRoot 'build-provenance.py'
  $json = & python -B $provenanceTool begin --root $root --receipt-dir $BuildReceiptDir
  if ($LASTEXITCODE -ne 0) { throw '无法记录程序启动器的构建来源' }
  $moduleProvenance = ($json -join "`n") | ConvertFrom-Json
  $builtAt = $moduleProvenance.built_at
  if ($builtAt -is [datetime]) {
    $builtAt = $builtAt.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", [Globalization.CultureInfo]::InvariantCulture)
  }
  $hostPackage = 'github.com/aieyra/aieyra-os/CORE/host'
  $BuildLDFlags = "-X $hostPackage.Version=$Version -X $hostPackage.BuildID=$($moduleProvenance.build_id) -X $hostPackage.SourceDigest=$($moduleProvenance.source_digest) -X $hostPackage.BuiltAt=$builtAt"
}
$moduleTempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$temp = [IO.Path]::GetFullPath((Join-Path $moduleTempRoot ('aieyra-module-' + [guid]::NewGuid().ToString('N'))))
if (-not $temp.StartsWith($moduleTempRoot, [StringComparison]::OrdinalIgnoreCase)) { throw '模块构建临时目录越界' }
New-Item -ItemType Directory -Path $temp | Out-Null
try {
  $resource = Join-Path $core 'cmd\aieyra-module\zz_launcher_windows_amd64.syso'
  foreach ($entry in $targets) {
    $title = $entry.Value
    if ($title -cnotmatch '^Aieyra [A-Za-z]+$') { throw '程序启动器文件名无效' }
    $icon = Join-Path $root $(switch ($entry.Name) {
      'link' { 'Control/app/desktop/assets/icon.ico' }
      'settings' { 'Client/Desktop/assets/config.ico' }
      default { 'Client/Desktop/assets/os.ico' }
    })
    $staged = Join-Path $temp ($title + '.exe')
    & python -B (Join-Path $PSScriptRoot 'winres.py') --icon $icon --name $title --version $Version --out $resource
    if ($LASTEXITCODE -ne 0) { throw "$title 图标资源生成失败" }
    Push-Location $core
    $previousCgo = $env:CGO_ENABLED
    try {
      $env:CGO_ENABLED = '0'
      go build -trimpath -ldflags "-H=windowsgui -s -w $BuildLDFlags" -o $staged ./cmd/aieyra-module
      if ($LASTEXITCODE -ne 0) { throw "$title 构建失败" }
    } finally { $env:CGO_ENABLED = $previousCgo; Remove-Item -LiteralPath $resource -Force -ErrorAction SilentlyContinue; Pop-Location }
    # 先写临时名再替换，避免留下半个文件。
    $final = Join-Path $OutDir ($title + '.exe')
    $next = $final + '.next'
    Copy-Item -LiteralPath $staged -Destination $next -Force
    # Move-Item -Force deletes the old executable first, which fails while a
    # launcher is mapped by Windows. ReplaceFile swaps directory entries without
    # stopping that process; an unsuccessful replacement preserves the old file.
    if (Test-Path -LiteralPath $final -PathType Leaf) {
      [IO.File]::Replace($next, $final, [System.Management.Automation.Language.NullString]::Value)
    } else {
      [IO.File]::Move($next, $final)
    }
    $hash = (Get-FileHash -LiteralPath $final -Algorithm SHA256).Hash.ToLowerInvariant()
    [pscustomobject]@{ File = $final; Bytes = (Get-Item -LiteralPath $final).Length; SHA256 = $hash; Build = $moduleProvenance.build_id; SourceReceipt = $moduleProvenance.snapshot }
  }
} finally {
  Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
}
