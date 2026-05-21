$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

$envPath = Join-Path $root ".env"
if (!(Test-Path $envPath)) {
  New-Item -Path $envPath -ItemType File | Out-Null
}

$envText = Get-Content $envPath -Raw
if ($envText -notmatch "(?m)^OPENAI_MODEL=") {
  Add-Content -Path $envPath -Value "OPENAI_MODEL=gpt-5-nano"
}

if ($envText -notmatch "(?m)^OPENAI_API_KEY=.+") {
  Write-Host "OPENAI_API_KEY is not set in .env. Coach API will start, but /api/health will show openaiKeyLoaded:false." -ForegroundColor Yellow
  Write-Host "To set it safely, run: powershell -ExecutionPolicy Bypass -File scripts\set-openai-key.ps1" -ForegroundColor Yellow
}

Write-Host "Starting FruitFit on http://127.0.0.1:5176" -ForegroundColor Green
npm.cmd run dev -- --port 5176
