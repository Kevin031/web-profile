$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$appName = 'Web Profile'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$packageJsonPath = Join-Path $root 'package.json'
$appVersion = (Get-Content -LiteralPath $packageJsonPath -Raw -Encoding UTF8 | ConvertFrom-Json).version

if ([string]::IsNullOrWhiteSpace($appVersion)) {
  throw "Application version not found: $packageJsonPath"
}

$portableDir = Join-Path $root "release\$appName-portable-x64"
$portableExe = Join-Path $portableDir "$appName.exe"
$desktopDir = [Environment]::GetFolderPath([Environment+SpecialFolder]::Desktop)
$shortcutPath = Join-Path $desktopDir "$appName v$appVersion.lnk"

if (-not (Test-Path -LiteralPath $portableExe -PathType Leaf)) {
  throw "Portable executable not found: $portableExe"
}

if (-not (Test-Path -LiteralPath $desktopDir -PathType Container)) {
  throw "Desktop directory not found: $desktopDir"
}

if (Test-Path -LiteralPath $shortcutPath) {
  Remove-Item -LiteralPath $shortcutPath -Force
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $portableExe
$shortcut.WorkingDirectory = $portableDir
$shortcut.IconLocation = "$portableExe,0"
$shortcut.Description = "Launch Web Profile portable v$appVersion"
$shortcut.Save()

Write-Output "Desktop shortcut created: $shortcutPath"
Write-Output "Target: $portableExe"
