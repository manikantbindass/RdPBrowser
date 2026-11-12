# Phase 01 verified feature inventory

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
