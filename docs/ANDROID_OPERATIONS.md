# Android operations

The Android client uses Flutter and the existing versioned Express APIs. Deploy the Phase 06 backend status contract before distributing this client.

## Toolchain and builds

Use Flutter 3.38.9 with Dart 3.10.8, Java 17, Gradle 8.13, AGP 8.11.1, Kotlin 2.2.20 and Android API 36. Install build-tools 36.0.0 and NDK 28.2.13676358. Plugins also require the API 35 platform, build-tools 35.0.0 and CMake 3.22.1. Minimum SDK is 26. The tracked Gradle wrapper verifies the distribution checksum and pubspec.lock fixes the resolved Dart dependencies. API targeting alone does not establish runtime compatibility.

From the android directory run the following.

```sh
flutter pub get --enforce-lockfile
flutter analyze --no-pub
flutter test --no-pub
flutter test integration_test/platform_test.dart -d emulator-5556
flutter build apk --release --dart-define=SERVER_URL=https://control.example.com
```

For an emulator, debug builds accept the local control-plane origin http://10.0.2.2:3001. Releases require an HTTPS origin. A Windows SDK path containing spaces can cause Dart native hook compilation failures. Use a toolchain location without spaces or a temporary workspace drive mapping. The integration test requires an Android emulator with no active VPN. Run native builds sequentially on memory-constrained hosts. Flutter 3.38.9 release builds must regenerate platform metadata after running integration tests, so the documented release commands allow normal package preparation.

## WireGuard and lifecycle

An administrator supplies the WireGuard profile through the WireGuard app or Android Enterprise. Configure IPv4 and IPv6 default routes, trusted DNS, Always-on VPN and Block connections without VPN. Android owns provider consent and lockdown. The browser opens Android VPN settings. The absent RemoteShieldVpnService declaration has been removed.

The native channel observes the active network's VPN transport, IPv4 and IPv6 default routes and configured DNS. Both this local candidate check and the backend source-address gate must pass in releases. An ordinary browser application cannot attest the provider identity or force another package's VPN permissions or lockdown. Real route, DNS, IPv6, reconnection and packet leakage tests remain required on a provisioned device. [Android enterprise VPN guidance](https://developer.android.com/work/dpc/network-telephony)

The app pauses browsing on backgrounding and invalidates content on network changes. Resume requires fresh checks. The foreground session and policy poll runs every 15 seconds. There is no background browsing or separate foreground service. The app displays connection failures in its foreground UI. The WireGuard provider owns tunnel notifications.

## Identity and local data

Passwords are used for sign-in and cleared from the input immediately. Access tokens remain in memory. Rotating refresh tokens are stored through flutter_secure_storage with Android Keystore support and consumed before refresh requests, preventing automatic replay after a lost response. A lost refresh response requires sign-in again. Logout clears local session state and attempts server revocation.

Device enrollment generates an Android Keystore P-256 key and registers its public coordinates with the backend. The private key signs a one-use session-bound challenge. Hardware backing and verified device posture remain separate deployment requirements. Administrative approval controls trust. Local root, test-key, ADB and debugger observations are advisory signals that can be bypassed. No hardware attestation or native OIDC browser handoff is delivered.

Saved browser addresses, bookmarks and history use bounded preferences scoped to the server, organization and user. Saved URLs omit query strings and fragments. Paths may still hold private data. Restored tabs remain inert until explicitly opened and authorized. Downloads are scoped to the same identity and stay in app storage. Clear app data before transferring a device between people.

## WebView and permissions

The WebView checks top-level destinations with the backend and blocks unsupported schemes and external app intents. Camera, microphone, geolocation and file access are denied. Website uploads are disabled. The app requests internet and network-state access and uses no storage or notification runtime permissions.

Android WebView may omit form POSTs from navigation callbacks. Page-start checks close denied views after loading begins. Subresources and service workers require network enforcement outside these callbacks. This browser policy cannot establish universal URL or traffic confinement.

Downloads require explicit action through the Downloads panel. Only direct HTTPS UTF-8 text/plain responses up to 5 MiB are saved, using generated filenames. Redirects, cookies and credential forwarding are excluded. Files are listed and deletable in app storage. Website attachments, executable downloads, malware scanning and exports remain unsupported.

FLAG_SECURE protects authentication, managed content and background transitions. It can reduce ordinary screenshot and recents capture. Rooted systems, OS modifications and external cameras can bypass capture restrictions. WebView debugging is disabled. Local inspection resistance cannot establish binary integrity.

## Signing and release

For local production signing, copy android/key.properties.template to android/key.properties and supply the real keystore path and credentials. Paths in that properties file resolve against the nested Android Gradle project. Alternatively set KEYSTORE_PATH, STORE_PASSWORD, KEY_ALIAS and KEY_PASSWORD in the environment. Incomplete signing configuration fails the build. Without keys, Gradle can produce an unsigned verification artifact.

The Android release workflow requires KEYSTORE_BASE64, STORE_PASSWORD, KEY_ALIAS and KEY_PASSWORD secrets and the ANDROID_SERVER_URL repository variable. It verifies APK signatures and 16 KiB ZIP alignment. CI pull requests use a disposable verification key and an unreachable example origin. Those artifacts require a deployment build with the organization's endpoint and signing identity.

Keep signing keys and symbol/debug information private. Before tagging a new release, increment the build number after `+` in `android/pubspec.yaml` above the last distributed Android version code. The tag sets the display version only. Verify install, upgrade, key continuity, native library alignment and runtime behavior on the deployment device matrix before publication. [Android page-size guidance](https://developer.android.com/guide/practices/page-sizes)
