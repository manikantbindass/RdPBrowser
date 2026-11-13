# Phase 06 desktop delivery

**Status: PARTIAL.** The managed browser runs on Windows WebView2. Cross-platform GUI and signed installer acceptance, native enterprise SSO, and production WireGuard routing verification remain open.

## Delivered

- Rust now owns remote WebViews. The control plane authorizes addresses, redirects and top-level navigation. The shell applies a restrictive CSP and grants application capabilities only to its main window. Popups require an explicit open and automatic WebView downloads are canceled.
- The React workspace supports address navigation, tabs, back and forward, bookmarks, history, explicit tab restoration, appearance, keyboard shortcuts and loading or policy errors. The organization and user scope saved browsing preferences. Passwords, tokens and private keys stay in memory.
- Password authentication uses backend session checks, serialized refresh rotation and best-effort server logout. Policy changes, session revocation and control-plane outages close managed content. The Devices panel supports registration and P-256 possession challenges.
- An optional local WireGuard peer-handshake check and the server's source-address gate inform the browser decision. Explicit downloads accept direct HTTPS UTF-8 plain text within a 5 MiB limit. The updater supports release notifications and explicitly approved, signature-verified installation when configured.
- The backend adds a bounded authenticated status endpoint and documents it in OpenAPI. Existing route aliases and tenant scoping are preserved. Deploy the backend first.

## Verification

| Check | Result |
| --- | --- |
| Desktop TypeScript/Vite production build | Passed on Windows |
| Desktop Node tests | 3 passed |
| Rust formatting, tests and strict Clippy | Passed on Windows, 6 tests |
| Native Windows debug build | Passed, using Tauri without installer bundling |
| Windows WebView2 runtime and disposable PostgreSQL backend | Password login, top-level navigation, form POST body preservation, automatic download blocking, and content closure after session revocation or a URL-policy change verified. The popup test produced no additional WebView. The shell notification still needs manual confirmation. |
| Backend ESLint and unit suite | Passed, 77 tests |
| PostgreSQL integration and migration suite | 24 passed on PostgreSQL 15.19, including own-session status and URL policy checks |
| Desktop npm audit | No production advisories after removing the unused shell plugin and updating Socket.IO transitives. The full audit still reports 9 build/development findings. Rust advisory audit was unavailable because cargo-audit is absent. |
| OpenAPI | Generated and validated, 42 paths |
| macOS and Linux | Three-platform source verification is configured in Desktop checks. Local GUI tests were Windows only. |

See [desktop operations](DESKTOP_OPERATIONS.md) for the Windows fixture, verification commands, package dependencies and updater configuration.

## Remaining acceptance

- Verify WebView behavior and installed artifacts on Windows, macOS and Linux, including focus, mixed-DPI layout, redirects, ephemeral profiles and error handling. Moving or resizing the main window currently closes its content windows. History navigation opens the selected URL again. The browser does not replay prior form bodies when revisiting a history entry.
- Validate a real WireGuard deployment's routes, DNS, IPv6 and fail-closed behavior with OS-level tests. The handshake probe verifies peer activity. WebView navigation callbacks cover top-level navigation and have a bounded synchronous policy deadline. Subresources, service workers, OS inspection, screenshots and bypass require independent controls.
- Verify signed upgrades and failure scenarios with a provisioned release feed and signed artifacts. Installer and production update installation remain untested. The restricted download path excludes authenticated, executable and non-text downloads. Malware scanning and user-selected destinations remain open.
- Add a native OIDC handoff and an OS-backed device key lifecycle. The current session-only key requires new enrollment after restart. Administrator posture approval remains independent. The new workspace supersedes the old desktop dashboard and its experimental SSH and Laila entry points.
