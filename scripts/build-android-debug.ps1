$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$jdk = Resolve-Path (Join-Path $root ".tools\jdk-21.0.11+10")
$sdk = Resolve-Path (Join-Path $root ".tools\android-sdk")

$env:JAVA_HOME = $jdk.Path
$env:ANDROID_HOME = $sdk.Path
$env:ANDROID_SDK_ROOT = $sdk.Path
$env:Path = "$($jdk.Path)\bin;$($sdk.Path)\platform-tools;$env:Path"

Push-Location $root
try {
  npm.cmd run build
  npx cap sync android
  Push-Location (Join-Path $root "android")
  try {
    .\gradlew.bat assembleDebug
  } finally {
    Pop-Location
  }
  Copy-Item -LiteralPath (Join-Path $root "android\app\build\outputs\apk\debug\app-debug.apk") -Destination (Join-Path $root "FruitFit-test-debug.apk") -Force
  Get-Item (Join-Path $root "FruitFit-test-debug.apk")
} finally {
  Pop-Location
}
