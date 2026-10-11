$ErrorActionPreference = 'Stop'
if (-not (Test-Path '.\wrangler.jsonc')) { throw 'Run from the PocketKu project root, where wrangler.jsonc exists.' }
$alias = Read-Host 'Choose your dummy login email (for example alias@demo.local)'
$secure = Read-Host 'Choose a unique password (6+ characters)' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    (@{ login=$alias; password=$plain } | ConvertTo-Json -Compress) | node '.\tools\create-local-login.mjs'
    if ($LASTEXITCODE -ne 0) { throw 'Login setup failed.' }
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    $plain = $null
    $secure = $null
}
Write-Host 'Local login saved. Your dummy email does not need a mailbox.'
