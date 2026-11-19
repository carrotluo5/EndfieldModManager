$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$TauriDir = Join-Path $RepoRoot "src-tauri"
$IconsDir = Join-Path $TauriDir "icons"
$BinDir = Join-Path $TauriDir "bin"
$OutDir = Join-Path $RepoRoot "release-artifacts"

Write-Host "=== EndfieldModManager Windows 发布构建脚本 ===" -ForegroundColor Cyan

# 1. Verify required application icons
$requiredIcons = @("32x32.png", "128x128.png", "128x128@2x.png", "icon.ico")
foreach ($icon in $requiredIcons) {
    $p = Join-Path $IconsDir $icon
    if (-not (Test-Path -LiteralPath $p)) {
        throw "缺少应用图标资源: $p"
    }
}
Write-Host "[OK] 应用图标检查通过 ($IconsDir)" -ForegroundColor Green

# 2. Check optional 7za.exe / UnRAR.exe bundled utilities
$has7za = Test-Path -LiteralPath (Join-Path $BinDir "7za.exe")
$hasUnrar = Test-Path -LiteralPath (Join-Path $BinDir "UnRAR.exe")
if ($has7za -or $hasUnrar) {
    Write-Host "[INFO] 检测到可选外部解压组件 (7za=$has7za, UnRAR=$hasUnrar)，将随便携包一并打包。"
} else {
    Write-Host "[INFO] 未检测到 src-tauri\bin\7za.exe 或 UnRAR.exe，运行时将使用内置 ZIP 引擎与 Windows 11 原生 tar.exe（如有需要可自行放入 bin\ 目录）。"
}

# 3. Ensure Rust toolchain is on PATH and build Tauri release + NSIS installer
if (Test-Path -LiteralPath "$env:USERPROFILE\.cargo\bin") {
    $env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
}

Push-Location $RepoRoot
try {
    Write-Host "`n[STEP 1/2] 正在执行 npm.cmd run tauri build（编译前端、Rust 发布版与 NSIS 安装包）..." -ForegroundColor Cyan
    & npm.cmd run tauri build
    if ($LASTEXITCODE -ne 0) {
        throw "tauri build 失败，退出码: $LASTEXITCODE"
    }
} finally {
    Pop-Location
}

$ReleaseExe = Join-Path $TauriDir "target\release\endfield-mod-manager.exe"
if (-not (Test-Path -LiteralPath $ReleaseExe)) {
    $AltExe = Join-Path $TauriDir "target\release\EndfieldModManager.exe"
    if (Test-Path -LiteralPath $AltExe) {
        $ReleaseExe = $AltExe
    } else {
        throw "未找到编译后的主程序: $ReleaseExe"
    }
}

# Read version from package.json
$PkgJson = Get-Content -LiteralPath (Join-Path $RepoRoot "package.json") -Raw | ConvertFrom-Json
$Version = $PkgJson.version

# 4. Copy NSIS installer & create Portable ZIP package
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$NsisDir = Join-Path $TauriDir "target\release\bundle\nsis"
$NsisInstallers = Get-ChildItem -LiteralPath $NsisDir -Filter "*.exe" -ErrorAction SilentlyContinue
if ($NsisInstallers) {
    foreach ($inst in $NsisInstallers) {
        Copy-Item -LiteralPath $inst.FullName -Destination (Join-Path $OutDir $inst.Name) -Force
        Write-Host "[OK] NSIS 安装包: $($inst.FullName)" -ForegroundColor Green
    }
}

$PortableStaging = Join-Path $OutDir "staging_portable"
if (Test-Path -LiteralPath $PortableStaging) {
    Remove-Item -LiteralPath $PortableStaging -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $PortableStaging | Out-Null

Copy-Item -LiteralPath $ReleaseExe -Destination (Join-Path $PortableStaging "EndfieldModManager.exe") -Force
# portable.flag instructs EndfieldModManager to save config.json / presets.json / tags-pool.json / backgrounds under ./data
Set-Content -LiteralPath (Join-Path $PortableStaging "portable.flag") -Value "portable=1" -Encoding ASCII

if ($has7za -or $hasUnrar) {
    $StageBin = Join-Path $PortableStaging "bin"
    New-Item -ItemType Directory -Force -Path $StageBin | Out-Null
    if ($has7za) { Copy-Item -LiteralPath (Join-Path $BinDir "7za.exe") -Destination $StageBin -Force }
    if ($hasUnrar) { Copy-Item -LiteralPath (Join-Path $BinDir "UnRAR.exe") -Destination $StageBin -Force }
}

$PortableReadme = @"
Endfield Mod Manager v$Version - Windows 便携版 (Portable)
============================================================

1. 便携数据模式已启用（同目录包含 portable.flag）：
   所有设置、预设方案、标签池与本地背景壁纸均保存在同级 data\ 文件夹中，
   不会写入 %APPDATA%\EndfieldModManager，可直接拷贝至任意盘符或移动硬盘使用。
   如希望恢复写入系统 %APPDATA% 目录，请删除 portable.flag 与 data\ 文件夹。

2. 解压组件说明：
   - ZIP 压缩包：内置 Rust 引擎直接解压（完整兼容 GBK / UTF-8 文件名）。
   - 7z / RAR 压缩包：优先调用 Windows 11 原生 tar.exe，也可将 7za.exe / UnRAR.exe 放入 bin\ 目录。
"@
Set-Content -LiteralPath (Join-Path $PortableStaging "便携版使用说明.txt") -Value $PortableReadme -Encoding UTF8

$PortableZip = Join-Path $OutDir "EndfieldModManager-v$Version-windows-x64-portable.zip"
if (Test-Path -LiteralPath $PortableZip) {
    Remove-Item -LiteralPath $PortableZip -Force
}
Compress-Archive -Path (Join-Path $PortableStaging "*") -DestinationPath $PortableZip -CompressionLevel Optimal
Remove-Item -LiteralPath $PortableStaging -Recurse -Force

Write-Host "[OK] 便携版压缩包: $PortableZip" -ForegroundColor Green
Write-Host "`n=== 发布制品列表 ===" -ForegroundColor Cyan
Get-ChildItem -LiteralPath $OutDir | Select-Object Name, @{Name="SizeMB";Expression={[math]::Round($_.Length / 1MB, 2)}} | Format-Table -AutoSize
