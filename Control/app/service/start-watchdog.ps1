# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: Control/app/service/AGENTS.md | ring 2
# Chains: module-local; query impact before editing
# Regions: module initialization / declarations
# Impact: python -B scripts/code-atlas.py show Control/app/service/start-watchdog.ps1
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

#requires -Version 7.2
[CmdletBinding()]
param([switch]$Background)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$python = (Get-Command python -ErrorAction Stop).Source
$watchdog = Join-Path $projectRoot 'service/watchdog.py'
$config = Join-Path $projectRoot 'config/five-seat.watchdog.json'
$arguments = @('-X', 'utf8', $watchdog, '--config', $config)

if ($Background) {
    $quoted = $arguments | ForEach-Object { '"' + ($_ -replace '"', '\"') + '"' }
    Start-Process -FilePath $python -ArgumentList ($quoted -join ' ') -WorkingDirectory $projectRoot -WindowStyle Hidden
    exit 0
}

& $python @arguments
exit $LASTEXITCODE
