# Phase 07 Android audit and plan

The baseline on commit 97a3833 fails Flutter release compilation in GitHub Actions. BrowserScreen imports five absent screens. Android declares a missing VPN service, uses a generic Flutter activity with absent method channels, and calls an unavailable security channel before starting the UI. Browser policy errors allow navigation, and the VPN guard offers a bypass. The manifest and network security XML disagree about cleartext. Gradle defines conflicting plugin versions, suppresses lint errors, and omits the tracked wrapper. No Android runtime test evidence is available at baseline.

- Establish a reproducible Java, Flutter and Android SDK build, then restore strict analysis, tests and package verification.
- Keep Flutter for the browser shell and use the existing versioned Express access, policy and device proof contracts. Persist only rotating credentials in Keystore-backed storage and keep passwords out of persistence.
- Integrate the operator-managed WireGuard app through Android VPN settings and native network observations. A browser-only process cannot attest another app's provider identity, mandate lockdown or take ownership of its consent. Remove the phantom VPN service. Deploy full-tunnel and lockdown using Android Enterprise or OS settings and verify routes and DNS on a real provisioned device.
- Bind browser state and request decisions to the current session. Invalidate WebViews on VPN loss, policy revocation, sign-out and backgrounding. Use bounded URL state and restore only after fresh authorization.
- Implement local posture indicators and Android Keystore P-256 possession proof. Use selective FLAG_SECURE for authentication and managed content. Document hardware and platform limits.
- Test unit, widget, Android package and release signing paths independently. Report the OS versions and device scenarios actually exercised.

[Android enterprise VPN guidance](https://developer.android.com/work/dpc/network-telephony)
