# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: scripts/AGENTS.md | ring 3
# Chains: module-local; query impact before editing
# Regions: module initialization / declarations
# Impact: python -B scripts/code-atlas.py show scripts/sync-cli-entry.ps1
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

[CmdletBinding()]
param([string]$Root = (Split-Path -Parent $PSScriptRoot), [string]$Destination = [Environment]::GetFolderPath('Desktop'))
$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath($Root)
$Destination = [IO.Path]::GetFullPath($Destination)
$enabled = (Get-Content -LiteralPath (Join-Path $Root 'Config/运行参数.json') -Raw -Encoding utf8 | ConvertFrom-Json).release_stage.cli -eq $true
$entry = Join-Path $Destination 'Aieyra CLI.lnk'
$target = Join-Path $Root 'Aieyra CLI.exe'
$archiveDir = Join-Path $Root 'Data/阶段隐藏入口/CLI'
$archive = Join-Path $archiveDir 'Aieyra CLI.lnk'
$record = Join-Path $archiveDir '入口记录.json'
$shell = New-Object -ComObject WScript.Shell
if (!$enabled -and (Test-Path -LiteralPath $entry)) {
    if ($shell.CreateShortcut($entry).TargetPath -ne $target) { throw 'Unrelated desktop shortcut preserved.' }
    if (Test-Path -LiteralPath $archive) { throw 'Archived shortcut already exists; preserve both and resolve explicitly.' }
    $null = New-Item -ItemType Directory -Force -Path $archiveDir
    $hash = (Get-FileHash -LiteralPath $entry -Algorithm SHA256).Hash
    @{original=$entry;stored=$archive;target=$target;sha256=$hash;hidden_at=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $record -Encoding utf8
    Move-Item -LiteralPath $entry -Destination $archive
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $hash) { throw 'Stored shortcut verification failed.' }
} elseif ($enabled -and (Test-Path -LiteralPath $archive)) {
    $saved = Get-Content -LiteralPath $record -Raw -Encoding utf8 | ConvertFrom-Json
    if ($saved.original -ne $entry -or $saved.target -ne $target -or $shell.CreateShortcut($archive).TargetPath -ne $target) { throw 'Restoration destination or target differs from the original.' }
    if (Test-Path -LiteralPath $entry) { throw 'Desktop entry already exists; no overwrite performed.' }
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $saved.sha256) { throw 'Archived shortcut has changed.' }
    Move-Item -LiteralPath $archive -Destination $entry
}
@{enabled=$enabled;desktop_present=(Test-Path -LiteralPath $entry);archived=(Test-Path -LiteralPath $archive);record=$record} | ConvertTo-Json
