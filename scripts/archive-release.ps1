param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$Destination
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$sourcePath = [System.IO.Path]::GetFullPath($Source)
$destinationPath = [System.IO.Path]::GetFullPath($Destination)
if (-not (Test-Path -LiteralPath $sourcePath -PathType Container)) {
  throw "打包目录不存在：$sourcePath"
}
if (Test-Path -LiteralPath $destinationPath) {
  Remove-Item -LiteralPath $destinationPath -Force
}
[System.IO.Compression.ZipFile]::CreateFromDirectory(
  $sourcePath,
  $destinationPath,
  [System.IO.Compression.CompressionLevel]::Optimal,
  $false
)

$archive = [System.IO.Compression.ZipFile]::OpenRead($destinationPath)
try {
  if ($archive.Entries.Count -eq 0) { throw 'ZIP 为空' }
  Write-Output "$($archive.Entries.Count) files"
} finally {
  $archive.Dispose()
}
