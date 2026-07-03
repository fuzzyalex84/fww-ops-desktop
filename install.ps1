# Fuzzywumpets Ops — one-line installer.
#
#   irm https://raw.githubusercontent.com/fuzzyalex84/fww-ops-desktop/master/install.ps1 | iex
#
# Downloads the latest release and installs it SILENTLY (per-user, no admin). This
# path has NONE of the double-click friction — no browser Captcha, no SmartScreen
# "unknown publisher", no "mark as safe" — because a programmatic download isn't
# tagged with Mark-of-the-Web and a silent install never shows the SmartScreen
# dialog. After the first install the app auto-updates itself, so you only run this
# once per PC.

$ErrorActionPreference = 'Stop'
$repo = 'fuzzyalex84/fww-ops-desktop'

Write-Host "Fetching the latest Fuzzywumpets Ops release..." -ForegroundColor Cyan
$rel   = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest" -Headers @{ 'User-Agent' = 'fww-ops-install' }
$asset = $rel.assets | Where-Object { $_.name -like 'Fuzzywumpets-Ops-Setup-*.exe' } | Select-Object -First 1
if (-not $asset) { throw "No installer asset found on the latest release ($($rel.tag_name))." }

$out = Join-Path $env:TEMP $asset.name
Write-Host ("Downloading {0} ({1:N1} MB)..." -f $asset.name, ($asset.size / 1MB)) -ForegroundColor Cyan
Invoke-WebRequest $asset.browser_download_url -OutFile $out -UseBasicParsing

Write-Host "Installing (silent, per-user)..." -ForegroundColor Cyan
$p = Start-Process $out -ArgumentList '/S' -Wait -PassThru
if ($p.ExitCode -ne 0) { throw "Installer exited with code $($p.ExitCode)." }

$exe = Join-Path $env:LOCALAPPDATA 'Programs\fww-ops-desktop\Fuzzywumpets Ops.exe'
Write-Host ("Installed Fuzzywumpets Ops {0}." -f ($rel.tag_name -replace '^v','')) -ForegroundColor Green
if (Test-Path $exe) {
  Write-Host "Launching — sign in with your @fuzzywumpets.com Google account." -ForegroundColor Green
  Start-Process $exe
} else {
  Write-Host "Installed. Find 'Fuzzywumpets Ops' in the Start Menu." -ForegroundColor Green
}
