# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: Core/AGENTS.md | ring 0
# Chains: module-local; query impact before editing
# Regions: module initialization / declarations
# Impact: python -B scripts/code-atlas.py show Core/tools/install-ripgrep.ps1
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

# 固定官方版本和 SHA256；只安装到产品目录，不改系统 PATH。
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$version = '15.1.0'
$expected = '124510b94b6baa3380d051fdf4650eaa80a302c876d611e9dba0b2e18d87493a'
$target = Join-Path $PSScriptRoot 'runtime\ripgrep'
if (Test-Path (Join-Path $target 'rg.exe')) { return }
$temp = Join-Path ([IO.Path]::GetTempPath()) ('aieyra-rg-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($temp) | Out-Null
try {
    $archive = Join-Path $temp 'ripgrep.zip'
    Invoke-WebRequest "https://github.com/BurntSushi/ripgrep/releases/download/$version/ripgrep-$version-x86_64-pc-windows-msvc.zip" -OutFile $archive
    if ((Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'ripgrep SHA256 不匹配，未安装' }
    Expand-Archive -LiteralPath $archive -DestinationPath $temp
    $source = Join-Path $temp "ripgrep-$version-x86_64-pc-windows-msvc"
    [IO.Directory]::CreateDirectory($target) | Out-Null
    foreach ($name in @('rg.exe', 'COPYING', 'LICENSE-MIT', 'UNLICENSE')) {
        Copy-Item -LiteralPath (Join-Path $source $name) -Destination $target
    }
} finally {
    if (Test-Path $temp) { Remove-Item -LiteralPath $temp -Recurse -Force }
}
