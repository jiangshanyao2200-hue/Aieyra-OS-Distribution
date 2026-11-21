[CmdletBinding()]
param([string]$TogetherRoot, [switch]$AssetsOnly)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../../..')).ProviderPath
if (!$TogetherRoot) {
    $TogetherRoot = Join-Path (Split-Path -Parent (Split-Path -Parent $root)) 'Aieyra OS Together'
}
$source = (Resolve-Path -LiteralPath (Join-Path $TogetherRoot 'link')).ProviderPath
$toolbarAssets = Join-Path $source 'desktop/ui/vendor'
[void](New-Item -ItemType Directory -Force -Path $toolbarAssets)
foreach ($filename in 'program-toolbar.css', 'program-toolbar.mjs') {
    Copy-Item -LiteralPath (Join-Path $root "Theme/runtime/$filename") -Destination (Join-Path $toolbarAssets $filename) -Force
}
$destination = Join-Path $PSScriptRoot 'product'
$included = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($component in 'desktop', 'office', 'agent', 'runtime') {
    $sourceDir = Join-Path $source $component
    foreach ($file in Get-ChildItem -LiteralPath $sourceDir -Recurse -File) {
        $name = [IO.Path]::GetRelativePath($source, $file.FullName).Replace('\','/')
        if ($name -match '(?:^|/)(?:\.[^/]+|__pycache__|tests|node_modules)(?:/|$)' -or
            $file.Name -match '^(?:CODEMAP|AGENTS)\.md$|\.(?:pyc|pyo)$') { continue }
        if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Invalid Together asset: $name" }
        $null = $included.Add($name)
        $target = Join-Path $destination $name
        $existing = Get-Item -LiteralPath $target -ErrorAction SilentlyContinue
        if ($null -ne $existing -and !$existing.PSIsContainer -and
            $existing.Length -eq $file.Length -and
            (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash -eq
            (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash) { continue }
        [void](New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target))
        Copy-Item -LiteralPath $file.FullName -Destination $target -Force
    }
}
foreach ($file in Get-ChildItem -LiteralPath $destination -Recurse -File) {
    $relative = [IO.Path]::GetRelativePath($destination, $file.FullName).Replace('\','/')
    if (!$included.Contains($relative)) { Remove-Item -LiteralPath $file.FullName }
}
$manifestPath = Join-Path $PSScriptRoot 'manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json -AsHashtable
$packageFiles = @('program.json','service.cjs') + @($included | ForEach-Object { 'product/' + $_ })
$manifest.files = [ordered]@{}
$bytes = 0L
foreach ($name in ($packageFiles | Sort-Object -CaseSensitive)) {
    $file = Get-Item -LiteralPath (Join-Path $PSScriptRoot $name)
    $bytes += $file.Length
    $manifest.files[$name] = [ordered]@{
        sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        size = $file.Length
    }
}
if ($bytes -ge 64MB) { throw 'Together exceeds the official package size limit' }
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding utf8
$debugSource = Join-Path (Split-Path -Parent $source) 'AIDEBUG'
$debugDestination = Join-Path $root 'AIDEBUG/together'
[void](New-Item -ItemType Directory -Force -Path $debugDestination)
foreach ($name in 'os-together.cjs', 'os-together-electron.cjs') {
    Copy-Item -LiteralPath (Join-Path $debugSource $name) -Destination (Join-Path $debugDestination $name) -Force
}
node (Join-Path $root 'Program/official/catalog.cjs') --write-navigation
if ($LASTEXITCODE) { throw '生成 OS 程序导航失败' }
[pscustomobject]@{ Program = $manifest.id; Files = $packageFiles.Count; Bytes = $bytes }
if (!$AssetsOnly) { & (Join-Path $root 'scripts/build-module-launchers.ps1') -Module together }
