$ErrorActionPreference = 'Stop'
if (-not (Test-Path '.\wrangler.jsonc')) { throw 'Run this from the PocketKu project root.' }
$paths = @(
    '.dev.vars', '.dev.vars.*', '.env', '.env.*',
    '.wrangler/', 'node_modules/', 'dist/',
    'PocketKu-Backups/', 'backups/', 'backup/',
    '*.sqlite', '*.sqlite3', '*.db', '*.db-shm', '*.db-wal',
    'pocketku-local-*.sql', '*-d1-backup*.sql', '*.local.sql',
    'private-data/', 'private-exports/'
)
$path = '.gitignore'
$existing = if (Test-Path $path) { Get-Content $path } else { @() }
$missing = @($paths | Where-Object { $existing -notcontains $_ })
if ($missing.Count -gt 0) {
    Add-Content -Path $path -Value ("`n# PocketKu private local data and secrets`n" + ($missing -join "`n") + "`n")
}
Write-Host 'Safety ignore rules added (or already present).'
Write-Host 'Confirm: git check-ignore -v .dev.vars'
