param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$TauriArguments
)

$ErrorActionPreference = 'Stop'
$cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
$cargoExe = Join-Path $cargoBin 'cargo.exe'

if (-not (Test-Path -LiteralPath $cargoExe)) {
  throw "Rust toolchain not found at $cargoExe. Install the stable MSVC toolchain with rustup first."
}

$pathEntries = $env:Path -split ';'
if ($cargoBin -notin $pathEntries) {
  $env:Path = "$cargoBin;$env:Path"
}

& npx tauri @TauriArguments
exit $LASTEXITCODE
