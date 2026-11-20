# Phase 06 desktop audit and plan — 2026-11-13

Baseline inspected: React browser/App/login/tab components, Rust IPC/server configuration/VPN probe, Tauri capabilities/CSP/package targets and manifests. TypeScript/Vite baseline passed; Windows Rust baseline passed one test. Branch was clean; remote fetched.

Confirmed critical defects: navigation errors become allowed, guest bypass in frontend/native, native content windows not globally closed on unmount, history transitions bypass policy, health probe labeled VPN, broad capability wildcard, no caller check on token-setting/navigation IPC. These are repaired first.

Remaining implementation sequence: move content WebView creation and every top-level navigation/popup/download decision into a reviewed native controller; implement cancellable policy/revocation polling and race-safe window lifetimes; bounded validated preferences/history/bookmarks/restoration; native credential/refresh/device-proof integration; actual OS VPN adapters; accessible premium shell; native download quarantine and user-selected destinations; signed updater after reviewed signing/distribution provisioning. Verify Windows runtime, then macOS/Linux on their respective runners. Do not substitute a UI flag for enforcement.

This delivery is a partial stabilization, not completion of all requested Phase 06 acceptance criteria. No signed updater, complete managed browser or platform protection is claimed.
