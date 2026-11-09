# Implementation status

Date: 2026-11-09. Status describes inspected evidence, not README promises.

| Capability | Classification | Evidence / acceptance gap |
|---|---|---|
| Backend lint / basic HTTP tests | Implemented, verified narrowly | Lint passes, 9 mocked tests pass; no real DB or VPN acceptance tests. |
| Desktop frontend compilation | Implemented, build verified | tsc and Vite pass; large bundle warning. |
| Desktop Windows/Linux/macOS packaging | Existing CI evidence | Latest CI desktop jobs succeeded; current local installer/signed distribution not verified. |
| Authentication/password validation | Partial | bcrypt/Joi/JWT present; successful login and account lifecycle integration untested. |
| Refresh/registration tokens | Broken by source contract | No corresponding persisted session for new token hash. |
| Admin REST roles | Implemented, partially verified | Role check exists; unauthenticated tests only. |
| Socket SSH / force logout | Experimental, insecure | No action-level authenticated session/role enforcement. |
| Real-time session snapshot | Incomplete | In-memory map present; complete population/synchronization not established. |
| URL policy | Partial / bypassable | REST rules exist; UI/native guest and error bypass; not traffic proxying. |
| VPN/kill switch/static egress | Unverified / incomplete | Templates and health probes do not prove OS routing or traffic blocking. |
| Android native app/VPN/security | Missing native integration | Native classes referenced but absent; no wrapper scripts; Flutter unavailable locally. |
| Android browser UI | Source exists | Flutter screens, provider, models; analyzer/device acceptance not verified. |
| Screenshot/debug/tamper protection | Unverified / fail-open paths | Missing native checks; absent desktop expected hash accepted. |
| Database migration lifecycle | Missing / broken command | migrate script points to absent file; startup DDL is not versioned migration. |
| Database readiness/TLS | Defective defaults | Init errors swallowed; peer verification disabled. |
| Multi-tenancy/device attestation | Missing | No tenant schema/policies; device ID is supplied by client. |
| Audit and anomaly detection | Partial | SQL logs and rule detector; import/package mismatch; no verified tamper-resistant retention. |
| Admin UI | Source exists, security review needed | REST/socket UI; innerHTML interpolation; no accessibility or responsive acceptance run. |
| Docker production deployment | Configuration defects | Compose parses; daemon unavailable; paths/upstream/health/TLS issues identified. |
| CI/release gates | Present, insufficient | Android failing; analyzer/tests/security failures may be ignored; signing not verified. |
| E2E, load, failure recovery | Missing verification | No relevant test suites located beyond backend smoke tests. |
| Dependency security | Failing audit | Backend 30 / desktop 13 advisories; Rust/Dart scanning not completed. |

Only the four docs in this directory are intended audit changes. No feature was repaired, removed or enabled. Remaining work and acceptance gates are in ROADMAP.md. Overall verification status: PARTIAL.
