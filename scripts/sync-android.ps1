param(
  [ValidateSet("default", "google-play", "rustore", "huawei", "direct-apk")]
  [string]$DistributionChannel = "default"
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")

Push-Location $root
try {
  $buildScript = if ($DistributionChannel -eq "default") { "build" } else { "build:$DistributionChannel" }
  npm.cmd run $buildScript
  if ($LASTEXITCODE -ne 0) { throw "Web build failed with exit code $LASTEXITCODE." }
  if ($DistributionChannel -eq "google-play") {
    npm.cmd run verify:google-play-attribution
    if ($LASTEXITCODE -ne 0) { throw "Google Play attribution bundle verification failed with exit code $LASTEXITCODE." }
  }
  npx cap sync android
  if ($LASTEXITCODE -ne 0) { throw "Capacitor Android sync failed with exit code $LASTEXITCODE." }
  if ($DistributionChannel -eq "google-play") {
    node scripts/verify-google-play-attribution-build.mjs android/app/src/main/assets/public/assets
    if ($LASTEXITCODE -ne 0) { throw "Synced Android attribution bundle verification failed with exit code $LASTEXITCODE." }
  }

  $settingsPath = Join-Path $root "android\capacitor.settings.gradle"
  $buildPath = Join-Path $root "android\app\capacitor.build.gradle"

  $settings = Get-Content -LiteralPath $settingsPath -Raw
  $settings = $settings -replace "`r?`ninclude ':capgo-capacitor-health'`r?`nproject\(':capgo-capacitor-health'\)\.projectDir = new File\('\.\./node_modules/@capgo/capacitor-health/android'\)", ""
  Set-Content -LiteralPath $settingsPath -Value $settings -NoNewline

  $build = Get-Content -LiteralPath $buildPath -Raw
  $build = $build -replace "`r?`n\s*implementation project\(':capgo-capacitor-health'\)", ""
  Set-Content -LiteralPath $buildPath -Value $build -NoNewline
} finally {
  Pop-Location
}
