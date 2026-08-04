$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$appName = 'Web Profile'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$sourceExe = Join-Path $root 'src-tauri\target\release\web-profile.exe'
$releaseRoot = Join-Path $root 'release'
$outputDir = Join-Path $releaseRoot "$appName-portable-x64"
$outputExe = Join-Path $outputDir "$appName.exe"

if (-not (Test-Path -LiteralPath $sourceExe)) {
  throw "未找到 Tauri release 可执行文件：$sourceExe"
}

if (Test-Path -LiteralPath $outputDir) {
  $resolvedOutput = (Resolve-Path -LiteralPath $outputDir).Path
  if (-not $resolvedOutput.StartsWith($releaseRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "拒绝清理 release 目录外路径：$resolvedOutput"
  }

  $portableProcesses = Get-Process -Name $appName -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -and $_.Path.Equals($outputExe, [System.StringComparison]::OrdinalIgnoreCase)
  }
  if ($portableProcesses) {
    $portableProcesses | Stop-Process -Force
    $portableProcesses | Wait-Process -Timeout 10 -ErrorAction Stop
    Write-Output "Stopped running portable instance: $outputExe"
  }

  Remove-Item -LiteralPath $resolvedOutput -Recurse -Force
}

New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
Copy-Item -LiteralPath $sourceExe -Destination $outputExe -Force

Write-Output "Tauri portable build generated: $outputDir"
Write-Output "Launcher: $outputExe"
