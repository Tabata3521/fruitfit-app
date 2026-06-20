$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$jdk = Resolve-Path (Join-Path $root ".tools\jdk-21.0.11+10")
$sdk = Resolve-Path (Join-Path $root ".tools\android-sdk")
$huaweiFolderName = -join ([char[]](0x0445, 0x0443, 0x0430, 0x0432, 0x0435, 0x0439))
$huaweiDir = Join-Path $root $huaweiFolderName
$apkSource = Join-Path $root "android\app\build\outputs\apk\debug\app-debug.apk"
$apkTarget = Join-Path $huaweiDir "FruitFit-huawei-diagnostic-debug.apk"

$env:JAVA_HOME = $jdk.Path
$env:ANDROID_HOME = $sdk.Path
$env:ANDROID_SDK_ROOT = $sdk.Path
$env:Path = "$($jdk.Path)\bin;$($sdk.Path)\platform-tools;$env:Path"
$env:VITE_FRUITFIT_HUAWEI_DIAGNOSTICS = "1"

Push-Location $root
try {
  if (-not (Test-Path -LiteralPath $huaweiDir)) {
    New-Item -ItemType Directory -Path $huaweiDir | Out-Null
  }

  powershell -ExecutionPolicy Bypass -File (Join-Path $root "scripts\sync-android.ps1")

  Push-Location (Join-Path $root "android")
  try {
    .\gradlew.bat assembleDebug
  } finally {
    Pop-Location
  }

  Copy-Item -LiteralPath $apkSource -Destination $apkTarget -Force
  Get-Item -LiteralPath $apkTarget
} finally {
  Pop-Location
  Remove-Item Env:\VITE_FRUITFIT_HUAWEI_DIAGNOSTICS -ErrorAction SilentlyContinue
}
