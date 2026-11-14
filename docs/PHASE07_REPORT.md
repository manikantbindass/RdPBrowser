# Phase 07 Android delivery

Status: **PARTIAL**. The app builds and its local checks pass. Deployment acceptance still requires a provisioned WireGuard profile, backend and physical devices.

The starting Android build failed on five absent screens and native method channels. The delivered browser restores those functions through integrated tab, bookmark, history, download, search and settings panels. Flutter, Dart and Android remain the application stack.

The application uses versioned backend authentication, rotating secure refresh storage, session restoration, organization-scoped preferences, policy synchronization and Android Keystore possession proof. It invalidates managed content when backgrounded, revoked or disconnected. Android supplies VPN network observations and a settings handoff to an administrator-provisioned WireGuard provider. The previous missing service and manual bypass are removed. This deployment decision requires operator-managed full-tunnel routes, DNS and lockdown acceptance.

The Android manifest now uses the actual Kotlin activity, system TLS anchors, restricted cleartext debug origins and disabled backup. WebView access to files, content, geolocation, camera, microphone and uploads is restricted. External schemes are denied. Downloads are limited to explicit HTTPS text saves in application storage. Authentication and managed content use FLAG_SECURE, with its bypass limitations documented.

Gradle versions are unified, API 36 is targeted, the wrapper and distribution checksums are tracked, Dart dependencies are locked, and analyzer/test failure suppression is removed from the Android workflows. Production release workflows require signing secrets and an HTTPS server origin. Verification APK builds use disposable keys.

## Verification evidence

- `flutter pub get --enforce-lockfile` and `flutter analyze --no-pub` passed using Flutter 3.38.9 and Dart 3.10.8. All 9 unit/widget tests passed, including preference ownership and small-screen bookmark layout regressions.
- The ARM64 release build completed with Java 17, AGP 8.11.1, Gradle 8.13, build-tools 36.0.0 and NDK 28.2.13676358. A disposable key signed the verification APK; `apksigner verify`, 16 KiB ZIP alignment and 64-bit ELF load segment alignment passed. The APK declares min SDK 26 and target SDK 36. No production signing credentials were used. Local APK SHA-256: `0ad4417ff252ef19162eea33024ec09f91984dc9873219163ba847f2f7815997`.
- Workflow YAML parsing, Git whitespace and a limited staged credential signature scan passed. The wrapper JAR hash and configured distribution checksum match the [Gradle 8.13 checksum reference](https://gradle.org/release-checksums/).
- The Android 16 (API 36) x86_64 emulator built, installed and ran the debug integration test successfully. It exercised VPN state and the no-VPN guard, the screen protection channel, WebView data clearing and Android Keystore key generation and signing. Earlier attempts failed in the Windows native toolchain before app launch. Flutter reported a teardown warning because it tried to uninstall the release package name instead of the debug application ID. No other OS versions or physical devices were tested.

## Remaining acceptance

Verify installation, upgrades and signing continuity with production artifacts. Exercise supported Android versions, screen readers, large fonts, orientation changes, background transitions, device enrollment, secure-storage restoration and revocation with the real backend.

Verify the organization's WireGuard route/DNS/IPv6/lockdown profile and tunnel failure behavior. Android WebView top-level callbacks can omit form POSTs and do not constrain subresources. The page-start policy check is defense in depth. Network-level URL filtering remains a deployment requirement for complete confinement.

Native OIDC handoff, hardware attestation, app integrity verification, automatic malware scanning and file exports remain future work. Local root/debug indicators and FLAG_SECURE have platform and bypass limitations. The app displays foreground connection failures and relies on the VPN provider for background tunnel notifications.

See [Android operations](ANDROID_OPERATIONS.md) for configuration, signing and deployment requirements.
