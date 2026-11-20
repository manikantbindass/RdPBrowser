param([ValidateSet('analyze','test','integration')] [string]$Operation)
$ErrorActionPreference='Stop'
$root=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$androidRoot=if (Test-Path 'R:/android/pubspec.yaml') { 'R:/' } else { $root }
$tools=Join-Path $androidRoot '.local-tests/android-tools'
$flutter=$env:RSX_QUALITY_FLUTTER
if (!$flutter) {
  $flutter=Join-Path $tools 'flutter/bin/flutter.bat'
  if (Test-Path $flutter) {
    $env:JAVA_HOME=Join-Path $tools 'jdk-17.0.21+9'
    $env:ANDROID_HOME=Join-Path $tools 'sdk'
    $env:PUB_CACHE=Join-Path $tools 'pub-cache'
    $env:GRADLE_USER_HOME=Join-Path $tools 'gradle'
  } else { $flutter=(Get-Command flutter -ErrorAction SilentlyContinue).Source }
}
if (!$flutter) { Write-Output 'BLOCKED: Flutter SDK not found'; exit 77 }
Set-Location (Join-Path $androidRoot 'android')
if ($Operation -eq 'integration') {
  $adb=(Get-Command adb -ErrorAction SilentlyContinue).Source
  if ($env:ANDROID_HOME) {
    $adb=Join-Path $env:ANDROID_HOME $(if ($IsWindows) {'platform-tools/adb.exe'} else {'platform-tools/adb'})
  }
  if (!$adb -or !(Test-Path $adb)) { Write-Output 'BLOCKED: Android platform-tools not found'; exit 77 }
  $serial=$env:RSX_ANDROID_TEST_DEVICE
  if (!$serial -or ((& $adb -s $serial get-state 2>$null) -ne 'device')) {
    Write-Output 'BLOCKED: set RSX_ANDROID_TEST_DEVICE to an authorized connected test device'; exit 77
  }
  & $adb -s $serial shell getprop ro.build.version.release
  & $adb -s $serial shell getprop ro.build.version.sdk
  & $flutter test integration_test/platform_test.dart -d $serial --no-pub --machine
} elseif ($Operation -eq 'test') { & $flutter test --no-pub --machine }
else { & $flutter analyze --no-pub }
exit $LASTEXITCODE
