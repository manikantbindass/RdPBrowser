# Phase 01 verified feature inventory

## Phase 13 automated quality update

The verification catalog records functional, platform, packet, performance and security checks with machine-readable status and evidence. New desktop UI checks cover keyboard focus, accessibility, narrow layout and the native authentication boundary. The release acceptance gates and unverified platform coverage are recorded in the [Phase 13 report](PHASE13_REPORT.md) and [quality instructions](QUALITY_VERIFICATION.md).

## Phase 12 deployment and reliability update

Production/staging Compose profiles add scoped file secrets, a non-root TLS edge, read-only application filesystems and bounded resources/logs. The backend exposes authenticated private metrics, sampled request/database spans and an operational dashboard. Host tooling supplies health/backup/certificate/disk alert transitions, encrypted DB/configuration backups, fresh-target restoration, restored-identity revocation and schema-compatible artifact rollback. A DigitalOcean single-VPS target has mocked plan tests; no cloud resources are provisioned. [Phase 12 report](PHASE12_REPORT.md) records actual verification and production acceptance limits. [Operations](OPERATIONS.md) · [Disaster recovery](DISASTER_RECOVERY.md)

## Phase 11 enterprise governance update

Migration 006 adds scoped directory credentials, SCIM users/groups, group roles and URL policy assignment, provider activation and console SSO, access reviews, audited evidence exports, device posture and operator organization lifecycle. Local signed protocol fixtures, PostgreSQL, Chrome and isolated ingress verification cover the implemented boundaries. Live provider acceptance and deployed governance processes remain open. [Phase 11 report](PHASE11_REPORT.md) · [Integration setup](ENTERPRISE_GOVERNANCE.md)

## Phase 10 detection and response update

Versioned deterministic rules now consume tenant-scoped observations for password failures, token reuse, session sources, asserted device changes, server policy denials, request volume and selected untrusted VPN reports. Migration 005 adds atomic incident deduplication, consumed evidence, worker health and append-only review history. The console provides severity/confidence filters, explanations, evidence, revision-checked review, manual session termination/account lock and live-authorized in-app notifications. Collection remains explicitly disabled by default. No production ML accuracy, automatic native VPN telemetry or complete traffic inspection is claimed. See [operations and evaluation](DETECTION_AND_RESPONSE.md) and [Phase 10 evidence](PHASE10_REPORT.md).

## Phase 09 admin console update

The responsive console integrates organization, user, device, session, policy, event, audit and alert APIs with explicit data states. Migration 004 adds user policy assignments and append-only revision snapshots. Local PostgreSQL and Chromium acceptance cover role boundaries, actions, tenant isolation and accessibility checks. See the [Phase 09 report](PHASE09_REPORT.md) and [console operations](ADMIN_CONSOLE.md).

## Phase 08 network update

The Linux gateway provisions and revokes per-device WireGuard peers and applies scoped dual-stack forwarding and DNS policy. The independent Linux client firewall remains active after tunnel teardown. The backend verifies the source of each protected request in tunnel-subnet or dedicated-egress mode. The production Compose files passed isolated TLS, DNS, source address and peer recovery checks. See [network operations](NETWORK_PROTECTION.md) and the [Phase 08 report](PHASE08_REPORT.md) for tested scope.

## Phase 07 Android update

The Android browser, native activity/channel, session lifecycle, Keystore device proof and restricted download interfaces have been implemented. Deployment uses an operator-managed WireGuard provider with Android network checks and backend source gating. Release and real-device acceptance remain governed by [PHASE07_REPORT.md](PHASE07_REPORT.md). Historical audit entries below describe the earlier baseline.


## Phase 05 update (2026-11-12)

Backend identity now includes confidential OIDC code/PKCE flow with signed-token checks, explicit issuer/subject links, provider-assurance MFA, refresh-family reuse revocation, absolute/idle lifetimes, live resource policy decisions, device key-possession/expiring admin trust and server-owned access logs. Verification and incomplete production/native/provider acceptance are in [PHASE05_REPORT.md](PHASE05_REPORT.md); flows/config/limitations are in [IDENTITY_AND_ACCESS.md](IDENTITY_AND_ACCESS.md). No native SSO UI, hardware attestation or live Okta/Entra acceptance is claimed. Historical tables below are superseded only to this stated extent.

## Phase 04 update (2026-11-12)

Backend tenant persistence/RLS, composite ownership constraints, restricted runtime role checks, atomic registration/session issuance, single-use refresh rotation, live account/role checks, device registry/revocation, policy revision/evaluation, event ingestion/deduplication, bounded lists, transactional audit, realtime tenant delivery, shutdown/readiness and validated OpenAPI are implemented. See [PHASE04_REPORT.md](PHASE04_REPORT.md) for actual verification and unresolved dependency/operational limits. Phase 01/02 tables below remain historical evidence, not current backend status. Client network enforcement, device attestation, external immutable audit retention, full admin UI and Android remain separate acceptance work.

## Phase 02 update (2026-11-10)

The table below is the historical Phase 01 snapshot. Current architectural changes, verification evidence and remaining limits are in [PHASE02_REPORT.md](PHASE02_REPORT.md). Implemented: modular HTTP/realtime/runtime/config/logging boundaries, portable schemas, v1 with legacy aliases, explicit checksummed migrations/readiness, shared endpoint configuration, local Docker workflow and ADRs/diagrams. Organization/device/policy DTO definitions are design contracts, not tenant persistence or enforcement. Original auth/session/URL client interfaces remain; configuration and realtime handshake requirements have a migration guide.

Backend unit/contract/lifecycle tests pass (42), and the earlier real PostgreSQL integration run passed four tests. Rust formatting, one config test and strict Clippy pass. Final container/database verification and its exact disposition are recorded in the Phase 02 report; do not infer full platform readiness from this summary. Missing Android implementations, refresh rotation, tenant isolation, network protection and signed release acceptance remain open.

Date: 2026-11-09. Baseline main0aa4b40; safe backend fixes291f6e5. Source presence is distinct from functional acceptance. Defect IDs refer to BUG_REGISTER.md.

| Capability | Observed implementation | Verification / actual status | Gaps |
|---|---|---|---|
| API server | Express/Helmet/rate limit/CORS/Winston | Lint and HTTP smoke tests pass; imports no longer bind ports | Origin policy, error/input validation, startup readiness B04/B08/B10/B27 |
| Login/passwords | Joi,bcrypt,JWT and SQL session insert | Only malformed/unauthenticated/mocked paths verified | Successful DB login/concurrency/device integration B05–B07 |
| Registration/refresh/logout | Routes exist | Source contract broken; refresh and registration don't persist matching sessions | Rotation/revocation/account lock and migration B05–B07 |
| Admin authorization | REST role check admin/superadmin | Missing-token tests; no authenticated full-stack role test | Current role/lock changes and tenant isolation B06/B28 |
| Session control | DB REST force logout; socket events/map | REST source present, map not populated into complete realtime snapshot; socket event not DB revocation | Authorized realtime client termination unverified B01/B06/B50 |
| SSH terminal | Xterm/socket/ssh2 | Experimental source, not runtime tested | No authenticated handler/host key/destination gate, embedded default credentials B01/B23 |
| RDP | Dashboard buttons only | Missing implementation; no-op UI | B24 |
| URL block/allow | SQL rule lookup and navigation approval | Auth-required smoke test only; no traffic proxy | Fail-open, guest/history/redirect/subresource gaps B09/B14 |
| Desktop tabs/history/search | React and Tauri WebviewWindows; local history/search settings | Frontend/Rust compilation and Windows native debug build PASS | GUI engine/geometry/lifetime, real navigation coverage B14/B15/B25 |
| Laila search | DuckDuckGo/Wikipedia JSON aggregation | Source exists; no upstream integration test | Hardcoded localhost, unbounded requests, neural claim unsupported B12/B23 |
| Browser media/library modules | PlaceholderDashboard | Not implemented; no evidence of real compute service | B24 |
| VPS/IP/network dashboard | Hardcoded online instances, hidden IP, buttons | Presentation only; VPN button changes UI state | No inventory/control/routing enforcement B24 |
| Desktop VPN guard | Public health polling and UI guard | Not verified tunnel/kill switch | B13–B15 |
| Flutter browser | Provider/screens/bookmark/history models | Source exists, does not form a buildable complete app | Five screens missing, native and wrapper absent B17/B18/B45 |
| Android startup | FlutterActivity and Dart channel call | Uncaught missing native setFlagSecure before runApp risk | B18 |
| Android VPN | Dart channels/event state and manifest service | Native channel/service absent; manual bypass | B13/B18/B19 |
| Android security | Root/debug/signature Dart method calls | Missing-channel exceptions swallowed; no native proof | Screenshot/debug/root/integrity claims unverified B18–B20 |
| Android tabs/bookmarks/history | Provider and model persistence | No analyzer/device test; missing destination screens | Background-tab ownership/lifecycle B22 |
| Incognito/downloads/settings | Toggle/menu/screen references | Incognito not isolated, screen modules missing | B17/B21 |
| Secure token storage/biometrics | Dependencies declared | No source use found; tokens primarily in UI/native memory | No demonstrated secure persistence/attestation B07/B52 |
| PostgreSQL | Users,sessions,URL rules,audit/IP logs,alerts | Schema inspected; no live DB integration | Init swallowed, TLS and tenant/migration gaps B26–B28/B33 |
| Filtered IP logs | Admin route/page/count | Query alias fixed; 2 mocked router regressions pass | Live PostgreSQL still unverified B11 |
| Admin dashboard | HTML/CSS/JS REST/socket views | JS syntax passes, no browser acceptance | XSS,CSP,JSONB details failures B29–B31 |
| Audit/anomaly | SQL log inserts and periodic fixed rules | Module path broken, optional load silently skipped | No AI model, immutable retention or offline sync B32/B35 |
| File integrity utility | Local hash manifest generator/verifier | Syntax only; not invoked as security acceptance | No trusted signing chain B16 |
| WireGuard | Templates and root Ubuntu provisioner | Syntax only where available | Per-OS DNS/IPv6/kill switch/provisioning recovery B41–B43 |
| Docker/Nginx | Multi-service Compose and images | Compose parses; engine unavailable | Miswired mount/upstream/health/cert/modules B26/B37–B40 |
| CI/CD/releases | Backend/desktop/Android/container/publish workflows | Baseline desktop/backend jobs previously passed; Android failed | Hidden failures, signing/permissions/artifact gaps B44–B48 |
| Multi-tenancy | None found | Missing tenant model and data isolation | B28 |
| E2E/performance/recovery/accessibility | No acceptance suites found | Not verified, no performance or recovery targets defined | B50 |

Backend safe fixes preserve API shapes, production entry point and existing clients. Only import-time startup intentionally changes for tests/tools. Desktop Cargo.lock pins the tested graph; no package upgrade, schema migration or product feature was introduced. Existing working frontend compilation and original smoke tests remain passing. Overall verification status: PARTIAL.
