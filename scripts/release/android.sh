#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${RELEASE_TAG:?Release tag required}" "${RELEASE_VERSION:?Release version required}" "${ANDROID_CODE:?Android versionCode required}" "${RELEASE_CHANNEL:?Release channel required}"
root=$(cd -- "$(dirname -- "$0")/../.." && pwd)
keystore=$(mktemp -d "$RUNNER_TEMP/rsx-android.XXXXXX")
trap 'rm -f -- "$KEYSTORE_PATH"; rmdir -- "$keystore"' EXIT
export KEYSTORE_PATH="$keystore/release.jks"
cd "$root/android"
if [[ "$RELEASE_CHANNEL" == preview ]]; then
  export KEY_ALIAS=preview STORE_PASSWORD=preview-build-only KEY_PASSWORD=preview-build-only
  SERVER_URL=https://android-ci.example.invalid
  keytool -genkeypair -keystore "$KEYSTORE_PATH" -storepass:env STORE_PASSWORD -keypass:env KEY_PASSWORD \
    -alias "$KEY_ALIAS" -keyalg RSA -keysize 2048 -validity 2 -dname 'CN=RemoteShield preview verification'
else
  : "${KEYSTORE_BASE64:?Missing Android signing keystore}" "${KEY_ALIAS:?Missing Android key alias}"
  : "${STORE_PASSWORD:?Missing Android store password}" "${KEY_PASSWORD:?Missing Android key password}"
  : "${SERVER_URL:?Missing Android release origin}" "${ANDROID_MIN_VERSION_CODE:?Missing distributed versionCode floor}"
  : "${ANDROID_SIGNING_SHA256:?Missing expected Android signing certificate fingerprint}"
  [[ "$ANDROID_SIGNING_SHA256" =~ ^[a-f0-9]{64}$ ]]
  [[ "$ANDROID_MIN_VERSION_CODE" =~ ^[0-9]{1,10}$ && "$ANDROID_CODE" -gt "$ANDROID_MIN_VERSION_CODE" ]]
  dart run scripts/validate_release_origin.dart "$SERVER_URL"
  printf '%s' "$KEYSTORE_BASE64" | base64 --decode > "$KEYSTORE_PATH"
  unset KEYSTORE_BASE64
fi
options=(--release --build-name "$RELEASE_VERSION" --build-number "$ANDROID_CODE" --dart-define="SERVER_URL=$SERVER_URL")
flutter build apk "${options[@]}" --split-per-abi
output="$root/release-payload"
mkdir "$output"
for abi in armeabi-v7a arm64-v8a x86_64; do
  cp "build/app/outputs/flutter-apk/app-$abi-release.apk" "$output/RemoteShield-$RELEASE_TAG-android-$abi.apk"
done
flutter build apk "${options[@]}"
cp build/app/outputs/flutter-apk/app-release.apk "$output/RemoteShield-$RELEASE_TAG-android-universal.apk"
tools="$ANDROID_HOME/build-tools/36.0.0"
for file in "$output"/*.apk; do
  cert=$("$tools/apksigner" verify --print-certs "$file" | sed -n 's/^Signer #1 certificate SHA-256 digest: //p')
  [[ "$cert" =~ ^[a-f0-9]{64}$ ]]
  if [[ "$RELEASE_CHANNEL" != preview ]]; then [[ "$cert" == "$ANDROID_SIGNING_SHA256" ]]; fi
  "$tools/zipalign" -c -P 16 4 "$file"
  # Flutter 3.38.9 adds an ABI-specific offset to split APKs.
  case "$file" in
    *-armeabi-v7a.apk) offset=1000 ;;
    *-arm64-v8a.apk) offset=2000 ;;
    *-x86_64.apk) offset=4000 ;;
    *-universal.apk) offset=0 ;;
  esac
  expected_code=$((ANDROID_CODE + offset))
  "$tools/aapt" dump badging "$file" | python3 "$root/scripts/release/android_metadata.py" \
    "${file##*/}" "$RELEASE_VERSION" "$expected_code"
done
