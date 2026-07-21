param(
  [Parameter(Mandatory = $true)]
  [string]$Root
)

$jdkCandidates = @(@(
  (Join-Path $Root ".tools\jdk-21.0.11+10"),
  $env:JAVA_HOME,
  "C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot"
) | Where-Object { $_ -and (Test-Path -LiteralPath (Join-Path $_ "bin\java.exe")) })

$sdkCandidates = @(@(
  (Join-Path $Root ".tools\android-sdk"),
  $env:ANDROID_SDK_ROOT,
  $env:ANDROID_HOME,
  (Join-Path $env:LOCALAPPDATA "Android\Sdk"),
  "C:\Users\Meyva\Documents\Codex\2026-05-08\files-mentioned-by-the-user-inskill\tagirfruit-fitness-app\.tools\android-sdk"
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) })

if (-not $jdkCandidates.Count) {
  throw "Android build requires JDK 21. Set JAVA_HOME or add .tools\jdk-21.0.11+10."
}
if (-not $sdkCandidates.Count) {
  throw "Android build requires Android SDK. Set ANDROID_SDK_ROOT/ANDROID_HOME or add .tools\android-sdk."
}

[PSCustomObject]@{
  Jdk = (Resolve-Path -LiteralPath $jdkCandidates[0]).Path
  Sdk = (Resolve-Path -LiteralPath $sdkCandidates[0]).Path
}
