# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: scripts/AGENTS.md | ring 3
# Chains: module-local; query impact before editing
# Regions: module initialization / declarations
# Impact: python -B scripts/code-atlas.py show scripts/create-launchers.ps1
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

[CmdletBinding()]
param([string]$Root = (Split-Path -Parent $PSScriptRoot), [string]$Destination, [switch]$ProductSuite)
$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath($Root)
if (!$Destination) {
    $Destination = [Environment]::GetFolderPath('DesktopDirectory')
    if ($ProductSuite) { $Destination = Join-Path $Destination 'Aieyra OS' }
}
$Destination = [IO.Path]::GetFullPath($Destination)
$stage = (Get-Content -LiteralPath (Join-Path $Root 'Config/运行参数.json') -Raw -Encoding utf8 | ConvertFrom-Json).release_stage
$kinds = @('CLI', 'OS', 'Link')
if ($ProductSuite) {
    $launchers = Get-Content -LiteralPath (Join-Path $Root 'Client/Desktop/host/module-launchers.json') -Raw -Encoding utf8 | ConvertFrom-Json
    $kinds = @('CLI', 'OS') + @(foreach ($entry in $launchers.PSObject.Properties) {
        if ($entry.Name -eq 'link') { continue }
        if ($entry.Value -cnotmatch '^Aieyra ([A-Za-z]+)$') { throw 'Invalid module launcher name' }
        $Matches[1]
    })
} else {
    & (Join-Path $PSScriptRoot 'sync-cli-entry.ps1') -Root $Root -Destination $Destination | Out-Null
}
$shell = New-Object -ComObject WScript.Shell
$plans = foreach ($kind in $kinds) {
    if ($kind -eq 'CLI' -and $stage.cli -ne $true) { continue }
    $target = Join-Path $Root "Aieyra $kind.exe"
    if (!(Test-Path -LiteralPath $target -PathType Leaf)) { throw "Missing executable: $target" }
    $icon = if ($kind -eq 'Link') { Join-Path $Root 'Client\Desktop\assets\link.ico' } else { $target }
    if (!(Test-Path -LiteralPath $icon -PathType Leaf)) { throw "Missing icon: $icon" }
    $path = Join-Path $Destination "Aieyra $kind.lnk"
    if (Test-Path -LiteralPath $path) {
        $old = $shell.CreateShortcut($path)
        $retiredRoot = Join-Path (Split-Path -Parent $Root) ((Split-Path -Leaf $Root) + ' beta')
        $retiredTarget = Join-Path $retiredRoot "Aieyra $kind.exe"
        if ($old.TargetPath -ne $target -and !($old.TargetPath -eq $retiredTarget -and !(Test-Path -LiteralPath $retiredRoot))) { throw "Existing unrelated shortcut preserved: $path" }
    }
    @{kind=$kind; target=$target; icon=$icon; path=$path}
}
$null = New-Item -ItemType Directory -Force -Path $Destination
$receipts = foreach ($plan in $plans) {
    $shortcut = $shell.CreateShortcut($plan.path)
    $shortcut.TargetPath = $plan.target
    $shortcut.Arguments = ''
    $shortcut.WorkingDirectory = $Root
    $shortcut.IconLocation = $plan.icon + ',0'
    $shortcut.Description = switch ($plan.kind) {
        'CLI' { 'Aieyra CLI · Eyra母体与共享记忆' }
        'OS' { 'Aieyra OS · 主会话与协同' }
        'Link' { 'Aieyra Link · device coordination' }
        default { "Aieyra $($plan.kind)" }
    }
    $shortcut.Save()
    $verified = $shell.CreateShortcut($plan.path)
    if ($verified.TargetPath -ne $plan.target -or $verified.Arguments -ne '' -or $verified.WorkingDirectory -ne $Root -or $verified.IconLocation -ne ($plan.icon + ',0')) { throw 'Shortcut verification failed' }
    @{path=$plan.path; target=$verified.TargetPath; icon=$verified.IconLocation; arguments=$verified.Arguments; workingDirectory=$verified.WorkingDirectory}
}
$receipts | ConvertTo-Json -Depth 3
