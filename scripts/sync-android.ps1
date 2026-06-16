$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")

Push-Location $root
try {
  npm.cmd run build
  npx cap sync android

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
