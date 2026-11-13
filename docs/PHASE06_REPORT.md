# Phase 06 desktop stabilization — PARTIAL

Date: 2026-11-13. Branch codex/remoteshield-enterprise-completion; draft PR3 targets main. Existing Tauri2/Rust/React/TypeScript stack retained. No merge/deployment.

## Audit and changes

Inspected actual desktop native/frontend/navigation/auth configuration and established build/test baseline before functionality changes. Removed frontend allow-on-policy-error and native guest authorization bypass. Native HTTP(S) validation rejects credentials, control characters, unsupported schemes and oversized URLs; native policy requests have an eight-second timeout with generic errors. Token/navigation commands require the main window; capabilities now target main rather than every window. History transitions reauthorize. Browser unmount closes registered native content windows, including sign-out transitions. Added explicit native sign-out token clearing. Removed guest login and automatic health/VPN bypass presentation from App; login requires a real native IPC session. Added keyboard tab selection/labels and URL input label. VPN button now explains that OS integration is unavailable; status text distinguishes control-plane reachability from VPN proof. Existing backend interfaces and tab/history components are retained.

Intentional compatibility tightening: guest navigation is no longer permitted through the enterprise policy path. Browser preview cannot create a native authenticated session. Password login remains; refresh/SSO handoff is not completed. The legacy check_vpn_status command still measures control-plane reachability, not OS tunnel state; it is not a security attestation. The old watchdog event is renamed control_plane_status so it no longer publishes a false VPN assertion. Existing working frontend builds and native configuration remain.

## Verification

Windows baseline: TypeScript/Vite PASS; Rust one test PASS. Updated Windows TypeScript/Vite, Rust tests, formatting and strict Clippy results are recorded with the delivery. Native URL regression covers unsafe schemes, embedded credentials, control characters and length bounds. Vite retains its existing large-chunk/deprecated-CJS warnings; no thresholds or tests are disabled. No visual/runtime acceptance or installer/signing test is claimed from compilation alone. macOS/Linux runtime tests were not performed locally; existing CI platform runners are separate evidence and must not be assumed passing.

Final local commands: `npm run build --prefix desktop` PASS; `cargo fmt --manifest-path desktop/src-tauri/Cargo.toml -- --check` PASS; `cargo test --locked --offline --manifest-path desktop/src-tauri/Cargo.toml` PASS2 tests; `cargo clippy --locked --offline --manifest-path desktop/src-tauri/Cargo.toml --all-targets -- -D warnings` PASS. Cargo reports a filesystem incremental-cache hard-link fallback warning, not a hidden Clippy diagnostic. `git diff --check` PASS after normalizing edited files to LF. Backend source/schema was not changed. No GUI dev server was started or screenshot fabricated.

## Critical remaining work

| Requested area | Status / limitation |
|---|---|
| Address/history policy | Explicit navigation fails closed; redirects, in-page links, popups and subresources still need native interception; not a complete managed browser |
| Tabs/history/bookmarks/restoration | Existing tab/history behavior retained; bookmarks and robust versioned restoration remain incomplete |
| Loading/error UI | Existing spinner/error presentation retained; real page-load lifecycle/error documents incomplete |
| Downloads/file safety | No verified native download controller, quarantine/scanning or safe destination workflow; no safety guarantee |
| Preferences | Existing localStorage search preference is not a secret store; validated native preferences/privacy lifecycle remain |
| Authentication/device | Native token stays in memory and is cleared on explicit sign-out; refresh rotation, backend logout, SSO handoff, enrollment/key proof and expiry/revocation closure remain incomplete |
| VPN | No OS tunnel/routing/DNS/kill-switch adapter; health/readiness cannot establish VPN state |
| Policy refresh/revocation | Per-address/history requests only; continuous revocation and race-safe closure require implementation |
| UI/accessibility | Narrow tab/address accessibility repairs; premium redesign, layout/contrast/keyboard/runtime QA incomplete |
| Updates | No trusted updater key/feed/signing credentials provisioned; no auto-download or unsigned installation is introduced |
| IPC/CSP/WebViews | Main-only capabilities and command caller checks added; broad existing CSP and JS-created content windows still require redesign and adversarial native acceptance |

Native content WebViews may outlive an in-flight asynchronous creation even with unmount cleanup; this known race is not certified fixed. DevTools settings do not prevent OS inspection, screenshots, binary tampering or traffic bypass. No screenshot or simulated security state substitutes for verification.

## Installer/runtime dependencies

Configuration lists MSI/NSIS, deb/AppImage and DMG targets; successful artifacts are not established by this phase's source inspection. Windows requires WebView2 and the Rust/MSVC build toolchain; Linux WebKitGTK4.1/system GUI libraries; macOS its native WebKit/Xcode toolchain and platform signing/notarization. Native release control-plane origin must be configured HTTPS; frontend and Rust origins must match. There are no signed updater/installer acceptance results. Never run an unsigned update automatically or claim universal platform compatibility.

Files: native navigation validator/tests and command/capability changes, App/login/browser/tab accessibility/lifecycle repairs, and Phase06 plan/report. Final commit identity and PR URL are supplied in delivery. Remaining work requires substantive native controllers and platform acceptance; this partial delivery does not satisfy complete Phase06 acceptance.
