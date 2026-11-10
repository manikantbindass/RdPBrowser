# Phase 01: evidence-based repository audit

Phase 02 continuation: see [PHASE02_REPORT.md](PHASE02_REPORT.md), [architecture](ARCHITECTURE.md), [local development](LOCAL_DEVELOPMENT.md) and [cutover requirements](MIGRATION_PHASE02.md). This audit preserves Phase 01 findings and captured command results; the defect register's Phase 02 disposition identifies subsequent repairs without rewriting historical evidence.

Audit date: 2026-11-09, Asia/Calcutta. Scope: existing implementation, source/configuration/dependency review, reproducible available checks, prioritized defects and recovery planning. This is an engineering audit, not a penetration test or production certification.

## Repository and method

Phase 01 began on clean branch codex/remoteshield-enterprise-completion at c5f7c81cd99aab7fcc31b011e66fbf95e531c525 (initial audit documents). Application baseline is main commit 0aa4b400aeb87c248632f7760db1be30ba4bac88. Fetched origin; did not reset, merge, force-push or modify main. Existing draft PR #3 targets main. No repository AGENTS.md was found. The earlier empty-workspace clone history remains in Git.

The specific plan is PHASE01_PLAN.md. Inspected desktop React/Tauri/Rust, Android Dart/Flutter/Gradle/manifest, backend Express routes/middleware/SQL/schema/tests, admin HTML/JS/CSS, integrity and anomaly modules, all WireGuard client/server templates and setup script, Nginx, Docker/Compose, environment templates, README/release notes, manifests/locks and both workflows. Searched tracked sources for unresolved local imports, unused declarations, placeholders, swallowed errors, credential patterns, policy bypasses and missing tests. Did not run provisioning or change host routing/firewall.

Evidence is classified in BUG_REGISTER.md (B01–B52): confirmed source/config defects, command failures, unverified runtime risks and narrowly fixed defects. Source evidence is not proof of exploitability. Every entry states severity, affected component, impact and proposed remediation. IMPLEMENTATION_STATUS.md distinguishes source presence from actual verification; DEPENDENCY_MATRIX.md inventories direct declared/locked dependencies and unresolved platform requirements.

## Baseline reproduction

Prerequisites: Windows with Node/npm, Rust/MSVC/WebView2 toolchain and Git. Run from the repository root. Use the Node version recorded in reports to reproduce this host; CI currently uses a different Node version. Linux/macOS require their own native runners. Do not use production secrets in tests.

```powershell
# Install the checked-in npm resolutions. Earlier installation succeeded this way.
npm ci --prefix backend --ignore-scripts --no-audit
npm ci --prefix desktop --ignore-scripts --no-audit
# No automatic dependency upgrades, provisioning or audit fixes:
node scripts/audit-baseline.mjs local
node scripts/audit-source.mjs
node scripts/audit-dependencies.mjs
# Advisory refreshes (nonzero is expected while vulnerabilities remain):
npm audit --prefix backend --json
npm audit --prefix desktop --json
npm audit --json
```

The baseline runner records exact commands, exit codes, stdout/stderr, duration, UTC timestamp, Git head/status and SHA-256 input hashes under docs/audit/phase01/<label>.json. It returns nonzero if any command fails/is unavailable/times out; it never converts red checks to green. Labels before, after and final are recorded evidence; use local or another label to avoid overwriting them. Timeouts terminate the command tree. Commands use installed dependencies only. Fresh offline Rust runs require the locked crates already cached; use cargo fetch --locked on an approved network otherwise. No claim is made that skipped lifecycle scripts establish native package install acceptance.

Before/after reports were captured during work at c5f7c81 with working-tree state recorded. Final report was captured after backend fix commit 291f6e5 and before the documentation/lockfile commit; its input hashes identify the checked files. Before used unlocked offline Cargo with the generated local lock; final uses --locked. Final adds the native Windows debug build and uses Git Bash after PATH bash resolved to unavailable WSL. These differences are explicit, not hidden comparisons.

## Actual command results

| Check | Before / final result and limits |
|---|---|
| Backend npm run lint | PASS, no reported warnings/errors |
| Backend npm test -- --runInBand --detectOpenHandles | Before: all 9 assertions pass, but process fails to exit and is terminated at 45s. After fixes: 2 suites, 12 tests PASS, exits normally without forceExit; statements29.82%, branches14.55%, lines30.49%. DB mocked; VPN bypassed in original suite. |
| Regression tests before fix | 2 failures, 10 passes: filtered count SQL missing alias and import calling initDB. Same regressions pass after fixes. Router test checks SQL contract, not a real PostgreSQL execution. |
| Desktop npm run build | PASS TypeScript/Vite; 528.79kB minified JS chunk warning, CJS API deprecation. |
| Windows native debug build | PASS: npm run tauri -- build --debug --no-bundle --ci -- --locked --offline. No installer, release signing, GUI launch or runtime protection inference. |
| cargo test --locked --offline | PASS native test compilation; 0 Rust tests. Original unlocked run also passed. |
| cargo fmt -- --check | FAIL: existing source formatting differences. No formatting suppression applied. |
| cargo clippy --all-targets -- -D warnings (locked/offline in final) | FAIL: needless_return in integrity.rs debug branch. Check is stricter than current CI; no allow attribute added. |
| docker compose -f docker/docker-compose.yml config --quiet | PASS syntax/model validation; obsolete version warning. Does not check path existence, installed Nginx modules or healthy deployment. |
| docker info | UNAVAILABLE: Docker Desktop Windows engine pipe missing. No container build/start or PostgreSQL integration. |
| flutter version/analyze/test/APK build | UNAVAILABLE: command not found. Source scan independently confirms five missing screen imports and absent native service/channels/wrapper. No fake Dart compiler result. |
| bash -n vpn-server/setup.sh | PATH bash fails because WSL has no /bin/bash; final installed Git Bash check PASSES. Syntax check is not a provisioning/routing test. |
| npm ls --depth=0, backend and desktop | PASS; no missing installed direct dependencies reported. |
| node --check on tracked JS/CJS | PASS: 16 original tracked files, including backend/security/dashboard/root tools. Scripts added in this phase separately syntax-checked. |
| Source inventory | FAIL: 5 unresolved Dart imports; migration runner, Gradle wrapper and pubspec.lock absent; no tracked native Android source. Limited secret signatures yielded 0 candidates. |
| npm audit, backend | FAIL: 30 findings: 7 low,10 moderate,12 high,1 critical. Critical includes proxy-addr. |
| npm audit, desktop | FAIL: 13 findings: 1 low,4 moderate,7 high,1 critical. Critical includes JS plugin-shell2.0.0; Rust resolved version differs. |
| npm audit, root icon tools | FAIL: 29 high package findings; not 29 independent vulnerabilities proven reachable. |
| cargo audit/actionlint/Gitleaks | UNAVAILABLE: commands not installed. Rust/Dart advisory, workflow semantic lint and full secret/history scans not completed. |

Machine output is in audit/phase01/before.json, after.json, final.json, javascript-syntax.json and three *-npm-audit.json files. Advisory counts include transitive/development dependencies and inherited severity; snapshots retain exact ranges and URLs. Scanner coverage is intentionally bounded: no credentials were found by selected signatures, but this does not prove a secret-free repository/history.

## Safe changes and preservation

Backend fix commit 291f6e5 repairs the filtered IP-log count by defining alias l and guards start() with require.main===module. Existing npm start/direct node behavior and exported app/server/io remain intact; imports intentionally no longer initialize DB or bind a socket. Test teardown closes Socket.io and accepts only the expected ERR_SERVER_NOT_RUNNING from the deliberately unbound HTTP server. New tests verify import behavior and filtered/unfiltered pagination. No endpoint or response shape was removed.

The desktop application Cargo.lock is retained via a narrow gitignore exception, capturing the resolution already used by passing compilation. No dependency version upgrade was performed. This improves repeatability without asserting the graph is vulnerability-free or works on all OS/MSRV targets. Added read-only audit scripts, evidence and documentation. Other application features/configurations are preserved, including known defects; no security signal, native service or production function was simulated.

## GitHub review

Refreshed existing [draft PR #3](https://github.com/manikantbindass/RdPBrowser/pull/3) and latest runs. At inspection, the initial audit PR [CI run 42553874960](https://github.com/manikantbindass/RdPBrowser/actions/runs/42553874960) was in progress. Baseline main [CI run 25126670549](https://github.com/manikantbindass/RdPBrowser/actions/runs/25126670549) failed in Android; backend, desktop Windows/Linux/macOS and Docker jobs had succeeded. [Android release run 25126711621](https://github.com/manikantbindass/RdPBrowser/actions/runs/25126711621) also failed. Failed job metadata contained no step details, and both log endpoints returned HTTP410. Therefore Android CI root cause is not established from logs; missing code/wrapper and import failures are independently confirmed source defects.

Closed [issue #1](https://github.com/manikantbindass/RdPBrowser/issues/1) reports incompatibility above Android15; [#2](https://github.com/manikantbindass/RdPBrowser/issues/2) reports Android16 incompatibility. Closure is not validation of a fix. Earlier release inspection returned [v2.4.0](https://github.com/manikantbindass/RdPBrowser/releases/tag/v2.4.0), published2026-04-18. Artifacts were not installed or signatures verified. CI security success is insufficient: audit, Trivy, analyzers or tests may be non-blocking in current workflows.

## Claims and gaps

README claims all-traffic routing, kill switch, production readiness, all-platform integrity, Android14–17/ARMv7 support, full screenshot prevention, Windows Defender integration, Gatekeeper sandboxing, offline sync and AI detection exceed established evidence. Navigation is authorized by a REST endpoint but WebViews fetch directly. Public health reachability is not proof of VPN. Detector implements fixed rules, not a model. RDP and parts of browser modules are placeholder UI; no working RDP implementation found. See feature-by-feature evidence in IMPLEMENTATION_STATUS and B13–B25/B35/B51.

No real PostgreSQL transaction/migration acceptance, SSH host-key test, tenant isolation, tunnel/DNS/IPv6 leakage/failure check, native GUI E2E, accessibility assessment, load test, backup/restore drill or signed release verification was completed. These are explicit remaining gates, not successful tests.

## Disposition

PARTIAL: audit artifacts, prioritized register, available baseline and recovery plan delivered; cross-platform/infrastructure/security runtime acceptance remains unverified. Two narrowly understood backend defects are fixed and regression-tested. High/critical defects remain open. ROADMAP defines recovery order and rollback; no production deploy or main merge is authorized by this report.
