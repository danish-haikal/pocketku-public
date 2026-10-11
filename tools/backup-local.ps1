# PocketKu Step 7.22: a real D1 schema + data SQL export (LOCAL database only).
# Run from the PocketKu project using:
# powershell -ExecutionPolicy Bypass -File .\tools\backup-local.ps1
param([string]$Database = 'pocketku-db')
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$config = Join-Path $project 'wrangler.jsonc'
if (-not (Test-Path -LiteralPath $config)) {
  throw 'PocketKu wrangler.jsonc not found. Check that the script was copied into PocketKu\tools.'
}
$folder = Join-Path (Split-Path -Parent $project) 'PocketKu-Backups'
New-Item -ItemType Directory -Force -Path $folder | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$path = Join-Path $folder ("pocketku-local-$stamp.sql")
Write-Host 'Exporting LOCAL PocketKu D1 (never remote)...'
Push-Location $project
try {
  & npx wrangler d1 export $Database --local --output $path --skip-confirmation
  if ($LASTEXITCODE -ne 0) { throw "Wrangler export failed with code $LASTEXITCODE" }
  if (-not (Test-Path -LiteralPath $path)) { throw 'Wrangler did not create a backup file.' }
  $bytes = (Get-Item -LiteralPath $path).Length
  if ($bytes -lt 500) { throw 'The export file is unexpectedly small. Inspect it before treating it as a backup.' }
  Write-Host "Backup saved: $path" -ForegroundColor Green
  Write-Host "File size: $bytes bytes"
  Write-Host 'Keep the file private. Restore to a separate TEST database before trusting it for recovery.'
} finally {
  Pop-Location
}
