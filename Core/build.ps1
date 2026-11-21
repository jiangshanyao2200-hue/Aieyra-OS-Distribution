# <AI-CHAIN v1>
# Map: CODEMAP.md
# Owner: Core/AGENTS.md | ring 0
# Chains: module-local; query impact before editing
# Regions: Write-Step; Fail
# Impact: python -B scripts/code-atlas.py show Core/build.ps1
# Rules: follow the linked map and nearest AGENTS; retain semantic/why comments.
# </AI-CHAIN>

# 同源双入口：图形 OS 与独立控制台 CLI。
# Desktop 提供 Electron 主界面与共享设置服务；Terminal 仅供显式诊断回退。

[CmdletBinding()]
param(
    [string]$Version = '',
    [switch]$LegacyConsole,
    [switch]$Check,
    [switch]$Tests,
    [switch]$SkipTests,
    [switch]$LiveTests,
    [switch]$Config,
    [switch]$Run,
    [string]$BuildReceiptDir = ''
)

$ErrorActionPreference = 'Stop'
# WSL 调用和日志重定向也必须输出 UTF-8，避免构建日志被 GBK 再解码。
$buildUtf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $buildUtf8
$OutputEncoding = $buildUtf8
Set-Location -Path $PSScriptRoot

$root = Split-Path -Parent $PSScriptRoot
if (-not $Version) {
    $versionSource = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'host/app.go') -Raw
    if ($versionSource -notmatch 'var Version = "([^"]+)"') { throw 'Cannot read host.Version' }
    $Version = $Matches[1]
}
# Build the one authoritative project directly; no staging or promotion.
$exeChat = Join-Path $root 'Aieyra OS.exe'
$env:GOMAXPROCS = '1'
$env:GOFLAGS = '-p=1'
$env:PYTHONDONTWRITEBYTECODE = '1'
$null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $exeChat)
$cfgDir = Join-Path $root 'Client/Desktop'

function Write-Step($n, $total, $text) { Write-Host "[$n/$total] $text" -ForegroundColor Cyan }
function Fail($msg) {
    Write-Host "  错误：$msg" -ForegroundColor Red
    exit 1
}

$runTests = $Tests -and -not $SkipTests
$step = 0
$total = 2 + [int][bool]$Check + [int][bool]$runTests + [int][bool]$LiveTests + [int][bool]$Config

Write-Step (++$step) $total '准备主工程构建…'
if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
    Fail '未找到 go 命令，请先安装 Go 并加入 PATH。'
}
Write-Host "  $((go version))"

& (Join-Path $PSScriptRoot 'tools/build-resources.ps1') -Version $Version
& (Join-Path $PSScriptRoot 'tools/install-ripgrep.ps1')

# The optional-provider fallback is an offline, pinned part of Windows delivery.
# Runtime verification is explicitly selected with -Check; installation is separate.
if ($Check) {
    python -B (Join-Path $root 'scripts/provision-search.py') --verify-only
    if ($LASTEXITCODE -ne 0) { Fail '本地搜索运行时校验失败，请先按锁定清单准备 runtime/search。' }
    python -B (Join-Path $root 'scripts/provision-media.py') --verify-only
    if ($LASTEXITCODE -ne 0) { Fail '本地视频运行时校验失败，请先按锁定清单准备 runtime/media。' }
}

# Freeze the reviewed source after resource generation, before checks and builds.
# Receipts stay outside the product tree; linker values describe this process's
# compiled Core even when the files on disk are updated later.
$provenanceTool = Join-Path $root 'scripts/build-provenance.py'
$provenanceArgs = @('-B', $provenanceTool, 'begin', '--root', $root)
if ($BuildReceiptDir) { $provenanceArgs += @('--receipt-dir', $BuildReceiptDir) }
$provenanceJSON = & python @provenanceArgs
if ($LASTEXITCODE -ne 0) { Fail '无法冻结公开构建来源。' }
$buildProvenance = ($provenanceJSON -join "`n") | ConvertFrom-Json
# Newer PowerShell parses JSON timestamps as DateTime. Its default string form
# contains spaces, which Go splits into extra linker arguments. Keep the receipt's
# UTC wire format on both Windows PowerShell 5.1 and PowerShell 7.
$buildTimestamp = $buildProvenance.built_at
if ($buildTimestamp -is [datetime]) {
    $buildTimestamp = $buildTimestamp.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", [Globalization.CultureInfo]::InvariantCulture)
}
if ($buildTimestamp -notmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$') { Fail '构建时间格式无效。' }
$buildIdentityFlags = "-X github.com/aieyra/aieyra-os/CORE/host.Version=$Version -X github.com/aieyra/aieyra-os/CORE/host.BuildID=$($buildProvenance.build_id) -X github.com/aieyra/aieyra-os/CORE/host.SourceDigest=$($buildProvenance.source_digest) -X github.com/aieyra/aieyra-os/CORE/host.BuiltAt=$buildTimestamp"
Write-Host "  构建ID：$($buildProvenance.build_id)"
Write-Host "  来源收据：$($buildProvenance.snapshot)"
Write-Host "  包载荷预检：$($buildProvenance.package_payload_files) 项公开声明文件；摘要与大小一致。"

if ($Check -or $runTests) {
    # Standalone modules are outside Core's go test ./... .
    $productLayout = Get-Content -LiteralPath (Join-Path $root 'Contracts/product-layout.json') -Raw -Encoding utf8 | ConvertFrom-Json
    $moduleNames = @($productLayout.source_trees + $productLayout.source_files | ForEach-Object { ($_ -split '/')[0] } | Sort-Object -Unique)
    $moduleDirs = @($moduleNames | ForEach-Object { Join-Path $root $_ } | Where-Object { Test-Path -LiteralPath (Join-Path $_ 'go.mod') })
}
if ($Check) {
    Write-Step (++$step) $total '格式与静态检查…'
    $formatDirs = @('.') + $moduleDirs
    $unformatted = @(gofmt -l @formatDirs | Where-Object {
        # Compare CRLF checkouts without rewriting source.
        $original = (Get-Content -LiteralPath $_ -Encoding utf8) -join "`n"
        $formatted = (gofmt $_) -join "`n"
        $original -cne $formatted
    })
    if ($unformatted) {
        $unformatted | ForEach-Object { Write-Host "    $_" }
        Fail '请先格式化列出的文件；构建不会改写工作区源码。'
    }

    go vet ./...
    if ($LASTEXITCODE -ne 0) { Fail 'go vet 未通过。' }
    foreach ($moduleDir in $moduleDirs) {
        go -C $moduleDir vet ./...
        if ($LASTEXITCODE -ne 0) { Fail "模块静态检查未通过：$moduleDir" }
    }
    if ($LiveTests) {
        go vet -tags live ./...
        if ($LASTEXITCODE -ne 0) { Fail 'go vet -tags live 未通过。' }
    }
}

if ($runTests) {
    Write-Step (++$step) $total '运行显式选择的单元测试…'
    go test -count=1 -timeout 20m ./...
    if ($LASTEXITCODE -ne 0) { Fail '测试未通过，已中止构建。' }
    foreach ($moduleDir in $moduleDirs) {
        go -C $moduleDir test -count=1 ./...
        if ($LASTEXITCODE -ne 0) { Fail "模块测试未通过：$moduleDir" }
    }
}

if ($LiveTests) {
    Write-Step (++$step) $total '运行真实 API 集成测试（会计费）…'
    go test -count=1 -tags live ./ -run TestLive -timeout 600s
    if ($LASTEXITCODE -ne 0) { Fail '真实 API 集成测试未通过。' }
}

# 所有产物直接写入主工程；不创建另一套构建目录。
$desktopMain=Join-Path $cfgDir 'host/main.cjs'
$electron=Join-Path $cfgDir 'node_modules/electron/dist/electron.exe'
if (!(Test-Path -LiteralPath $desktopMain) -or !(Test-Path -LiteralPath $electron)) { Fail '缺少 Electron 主界面或运行时，请先准备 Desktop 依赖。' }
if ($Check -or $runTests) {
    Push-Location $cfgDir
    try {
        if ($Check) {
            npm run syntax
            if ($LASTEXITCODE -ne 0) { Fail '前端语法检查未通过。' }
        }
        if ($runTests) {
            npm run selftest
            if ($LASTEXITCODE -ne 0) { Fail '前端与配置测试未通过。' }
        }
    } finally { Pop-Location }
}

# Link 是 OS 内部模块，每次构建使用同一源码，不输出独立发行包。
$linkSource = Join-Path $root 'Link/app/link-core'
$linkRuntime = Join-Path $root 'Link/app/runtime/link/aieyra-link.exe'
$null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $linkRuntime)
Push-Location $linkSource
try {
    if ($Check) {
        go vet ./...
        if ($LASTEXITCODE -ne 0) { Fail 'Link 静态检查失败。' }
    }
    if ($runTests) {
        go test -count=1 ./...
        if ($LASTEXITCODE -ne 0) { Fail 'Link 模块测试失败。' }
    }
    go build -mod=readonly -trimpath -o $linkRuntime ./cmd/aieyra-link
    if ($LASTEXITCODE -ne 0) { Fail 'Link 内部运行时构建失败。' }
} finally { Pop-Location }

Write-Step (++$step) $total '直接构建主工程可执行文件…'
if ($LegacyConsole) {
    $consoleDir = Join-Path $PSScriptRoot 'tools/runtime/console'
    $null = New-Item -ItemType Directory -Path $consoleDir -Force
    go build -trimpath -ldflags '-s -w' -o (Join-Path $consoleDir 'aieyra-console.exe') ./cmd/aieyra-console
    if ($LASTEXITCODE -ne 0) { Fail '构建 Terminal 控制台连接程序失败。' }
}
$ldflags = "-H=windowsgui -s -w $buildIdentityFlags"
go build -trimpath -ldflags $ldflags -o $exeChat ./cmd/aieyra-os
if ($LASTEXITCODE -ne 0) { Fail '构建对话程序失败。' }
$exeCLI = Join-Path (Split-Path -Parent $exeChat) 'Aieyra CLI.exe'
go build -trimpath -ldflags "-s -w $buildIdentityFlags" -o $exeCLI ./cmd/aieyra-cli
if ($LASTEXITCODE -ne 0) { Fail '构建独立 CLI 失败。' }

# 各程序启动器使用同一主工程源码。
& (Join-Path $root 'scripts/build-module-launchers.ps1') -Version $Version -OutDir (Split-Path -Parent $exeChat) -BuildLDFlags $buildIdentityFlags | Out-Host
if ($LASTEXITCODE -ne 0) { Fail '构建桌面程序启动器失败。' }

# —— 配置中心（Electron）——

if ($Config) {
    Write-Host ''
    Write-Step (++$step) $total '准备配置中心（Electron）…'
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Fail '未找到 node，无法构建 Electron 配置中心。'
    }
    Push-Location $cfgDir
    try {
        if (-not (Test-Path (Join-Path $cfgDir 'node_modules'))) {
            Write-Host '  安装依赖…'
            $env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
            npm install --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { Fail 'npm install 失败。' }
        }
        node tools/ensure-electron.cjs
        if ($LASTEXITCODE -ne 0) { Fail 'electron 二进制未就位。' }

        if ($runTests) {
            node test/spec.test.cjs
            if ($LASTEXITCODE -ne 0) { Fail '配置中心逻辑自测未通过。' }
        }
    } finally {
        Pop-Location
    }
}

# Only a source-stable build can receive a complete four-artifact receipt.
& python -B $provenanceTool verify --root $root --snapshot $buildProvenance.snapshot --complete
if ($LASTEXITCODE -ne 0) { Fail '构建来源不一致或产物不完整；本次构建未验收。' }

Write-Host ''
Write-Host "构建完成，主工程：$(Split-Path -Parent $exeChat)" -ForegroundColor Green
Get-ChildItem (Split-Path -Parent $exeChat) -File | Sort-Object Name | ForEach-Object {
    $kb = [math]::Round($_.Length / 1KB, 0)
    Write-Host ("  {0,-24} {1,6} KB" -f $_.Name, $kb)
}
Write-Host ''
Write-Host '  "Aieyra OS.exe"      Go 核心 + Electron 工作屏'
Write-Host '  "Aieyra CLI.exe"     同一 Core · Eyra 母体、上下文与共享记忆'
Write-Host '  Client/Desktop/              Electron 工作屏与共享配置服务'
Write-Host ''
Write-Host '按需检查（默认构建不运行测试）：' -ForegroundColor DarkGray
Write-Host '  .\build.ps1 -Check       # 显式运行静态检查' -ForegroundColor DarkGray
Write-Host '  .\build.ps1 -Tests       # 显式运行全量单元测试' -ForegroundColor DarkGray
Write-Host '  .\build.ps1 -LiveTests   # 显式运行真实 API 集成测试，会计费' -ForegroundColor DarkGray
Write-Host '  ..\Aieyra OS.exe -list-prompts' -ForegroundColor DarkGray
Write-Host '  cd ..\Client\Desktop; npm run selftest' -ForegroundColor DarkGray
Write-Host '  node ..\AIDEBUG\aidebug.cjs foreground --launch  # 日常窗口实机' -ForegroundColor DarkGray

if ($Run) {
    Write-Host ''
    Write-Host '启动对话程序…' -ForegroundColor Cyan
    & $exeChat
}
