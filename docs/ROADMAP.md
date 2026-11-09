# Proposed roadmap and phase gates

This is a proposed sequence, not authorization to execute it. Wait for the user's phase-specific prompt; reconcile that scope with the audit before editing functionality.

## 0. Audit and baseline

Inventory source, GitHub history/status and build commands; document findings and baseline limitations. Deliver PROJECT_AUDIT.md, ARCHITECTURE.md, IMPLEMENTATION_STATUS.md and this roadmap. Gate: reviewable documentation commit, honest available test results, explicit unavailable environments. No enterprise readiness claim.

## 1. Build and verification integrity

Repair Android native/wrapper gaps in a narrowly agreed scope; establish reproducible lockfiles and migration tooling; make analyzer, tests and security gates enforceable; repair Compose boot wiring. Preserve working desktop/backend behavior. Gate: clean installs/builds on supported CI runners, executable tests, valid Nginx config and healthy clean deployment; documented signing blockers and no suppressed failures.

## 2. Authentication, authorization and remote access

Secure socket handshakes/actions, SSH destinations/host keys and credential handling. Repair transactional sessions, registration and refresh rotation/revocation. Validate configuration and trusted proxy behavior. Gate: positive/negative integration tests, revoked/locked device tests, malformed payloads, concurrent sessions, spoofed headers and SSH authorization denial tests. Document client compatibility and migrations.

## 3. Managed browser and network enforcement

Design explicit managed policy and feature flags. Remove fail-open behavior from managed paths, implement real native VPN integration and enforce navigation including redirects/subresources. Gate: Windows/Linux/macOS/Android routing, IPv4/IPv6/DNS leak, tunnel flap/reboot, offline policy and recovery tests; clearly bounded screenshot/debug/tamper claims on tested OS versions.

## 4. Enterprise isolation and administration

Add tenant-scoped schema/services, device enrollment, RBAC and auditable policy distribution incrementally. Repair dashboard unsafe rendering and assess accessibility/responsiveness. Gate: migration/rollback checks, cross-tenant negative tests, role/device lifecycle E2E and UI acceptance.

## 5. Reliability, observability and release readiness

Define measurable latency, concurrency, recovery and retention targets before tests. Add readiness, graceful shutdown, shared realtime state where scaling requires it, secure TLS/storage, backup restoration and audit integrity. Pin and attest builds; verify signing and dependency remediation. Gate: load/fault and restore drills against agreed targets, reviewed security findings, signed platform artifacts, required CI/review gates and complete operating documentation. No production rollout or main merge before gates pass.

## Build command reference

| Location | Commands | Prerequisites / limits |
|---|---|---|
| backend | npm ci; npm run lint; npm test -- --runInBand; npm start | PostgreSQL and configured secrets for real API operation; tests currently need lifecycle cleanup. migrate command is broken at baseline. |
| desktop | npm ci; npm run build; npm run tauri dev; npm run tauri build | Rust/native toolchains, WebView2 on Windows; Linux WebKit dependencies; macOS runner for DMG. |
| desktop | npm run tauri build -- --target universal-apple-darwin | macOS with both Rust architecture targets; configured in CI, not locally verified. |
| desktop/src-tauri | cargo test | No committed lockfile; resolution may drift; no Rust unit tests located. |
| android | flutter pub get; flutter analyze; flutter test; flutter build apk --release --obfuscate --split-debug-info=build/debug-info --split-per-abi | Manifest requires Flutter >=3.24, Dart >=3.2 <4; CI Flutter 3.24.5/Java 17; minSdk26, targetSdk35. Native sources/wrapper/signing needed. Gradle includes arm64-v8a/x86_64 and universal; broader README claims unverified. |
| repository | docker compose -f docker/docker-compose.yml config --quiet | Configuration validation only. |
| docker | docker compose up --build -d | Requires corrected paths/upstream/health checks, actual TLS certs/secrets, working Docker engine. Not validated deployment instructions yet. |

For every requested implementation phase: inspect existing code; write a scoped plan; preserve working behavior; implement; add meaningful unit/integration/E2E tests; verify security and compatibility; update these docs; run checks before a focused conventional commit; push and prepare a PR to main when access permits. Never force-push or merge without required checks/review. Report PASS/PARTIAL/BLOCKED, exact tests, limitations, changes, SHA, branch and PR link.
