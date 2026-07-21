$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$toolchain = & (Join-Path $PSScriptRoot "resolve-android-toolchain.ps1") -Root $root.Path
$jdk = $toolchain.Jdk
$sdk = $toolchain.Sdk

$env:JAVA_HOME = $jdk
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
$env:Path = "$jdk\bin;$sdk\platform-tools;$env:Path"

Push-Location $root
try {
  powershell -ExecutionPolicy Bypass -File (Join-Path $root "scripts\sync-android.ps1")
  if ($LASTEXITCODE -ne 0) { throw "Android sync failed with exit code $LASTEXITCODE." }
  Push-Location (Join-Path $root "android")
  try {
    .\gradlew.bat assembleDebug
    if ($LASTEXITCODE -ne 0) { throw "Gradle assembleDebug failed with exit code $LASTEXITCODE." }
  } finally {
    Pop-Location
  }
  Copy-Item -LiteralPath (Join-Path $root "android\app\build\outputs\apk\debug\app-debug.apk") -Destination (Join-Path $root "FruitFit-test-debug.apk") -Force
  Get-Item (Join-Path $root "FruitFit-test-debug.apk")
} finally {
  Pop-Location
}
