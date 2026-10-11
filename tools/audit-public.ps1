$ErrorActionPreference = 'Stop'
if (-not (Test-Path '.git')) { throw 'Run from the PocketKu Git repository.' }
Write-Host '--- Git tracked files that may contain sensitive data ---'
$files = git ls-files
$pattern = '(?i)(\.dev\.vars|(?:^|/)\.env(?:\.|$)|\.wrangler/|(?:^|/)backups?/|\.sqlite|\.db$|\.local\.sql|d1-backup|private-data)'
$risky = @($files | Where-Object { $_ -match $pattern })
if ($risky.Count) { $risky | ForEach-Object { Write-Warning "Tracked sensitive path: $_" } }
else { Write-Host 'No matching sensitive file paths currently tracked.' }
Write-Host '--- Public frontend hardcoded-data history check ---'
$commits = git log --all --format='%h' -- src/pocketku/seed.ts
if ($commits) {
    Write-Warning 'seed.ts exists in Git history. Old versions may still include private account names, monthly bills and repayment figures.'
    Write-Warning 'Do not switch THIS repository to public solely because the latest seed.ts is clean.'
    Write-Host 'Recommended: create a fresh public repository from reviewed clean working files; keep the original history private.'
}
Write-Host '--- Ignore status ---'
git check-ignore -v .dev.vars
if ($LASTEXITCODE -ne 0) { Write-Warning '.dev.vars is not ignored! Run tools/ensure-gitignore.ps1 before creating credentials.' }
Write-Host '--- Current changes ---'
git status --short
Write-Host 'This audit is a reminder, not proof that the repository or its history is free of confidential data.'
