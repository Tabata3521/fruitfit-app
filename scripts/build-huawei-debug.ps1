$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$toolchain = & (Join-Path $PSScriptRoot "resolve-android-toolchain.ps1") -Root $root.Path
$jdk = $toolchain.Jdk
$sdk = $toolchain.Sdk
$huaweiFolderName = -join ([char[]](0x0445, 0x0443, 0x0430, 0x0432, 0x0435, 0x0439))
$huaweiDir = Join-Path $root $huaweiFolderName
$apkSource = Join-Path $root "android\app\build\outputs\apk\debug\app-debug.apk"
$apkTarget = Join-Path $huaweiDir "FruitFit-huawei-diagnostic-debug.apk"

$env:JAVA_HOME = $jdk
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
$env:Path = "$jdk\bin;$sdk\platform-tools;$env:Path"
$env:VITE_FRUITFIT_HUAWEI_DIAGNOSTICS = "1"

Push-Location $root
try {
  if (-not (Test-Path -LiteralPath $huaweiDir)) {
    New-Item -ItemType Directory -Path $huaweiDir | Out-Null
  }

  powershell -ExecutionPolicy Bypass -File (Join-Path $root "scripts\sync-android.ps1")
  if ($LASTEXITCODE -ne 0) { throw "Huawei Android sync failed with exit code $LASTEXITCODE." }

  Push-Location (Join-Path $root "android")
  try {
    .\gradlew.bat assembleDebug
    if ($LASTEXITCODE -ne 0) { throw "Huawei Gradle assembleDebug failed with exit code $LASTEXITCODE." }
  } finally {
    Pop-Location
  }

  Copy-Item -LiteralPath $apkSource -Destination $apkTarget -Force
  Get-Item -LiteralPath $apkTarget
} finally {
  Pop-Location
  Remove-Item Env:\VITE_FRUITFIT_HUAWEI_DIAGNOSTICS -ErrorAction SilentlyContinue
}
