# Phase 13 automated verification

**Status: PARTIAL.** Functional verification, security scans and performance checks now have reproducible commands and evidence. Open security gates and unverified platform coverage prevent release acceptance.

Phase 13 started from `9d4020ca9ff20a17c20d3d1552558dd96d439bbf`. The previous GitHub runs passed architecture and desktop checks. Network tests failed because the Ubuntu Nginx package did not support the Docker upstream `resolve` parameter. The deployment drill failed because the hosted runner’s temporary runtime path was hidden inside the private `/run` mount. Android CI stopped before compilation because `sdkmanager` was missing. The changes adapt the native loopback fixtures to older Nginx, set writable runtime paths inside isolated Docker namespaces and install Android command-line tools explicitly. Production dynamic DNS and the existing VPN firewall remain enforced. The prior failures are documented in the [network run](https://github.com/manikantbindass/RdPBrowser/actions/runs/44107364659), [deployment run](https://github.com/manikantbindass/RdPBrowser/actions/runs/44107364843) and [Android job](https://github.com/manikantbindass/RdPBrowser/actions/runs/44107364969/job/134123870763).

The desktop login now provides a main landmark, announces errors and keeps text contrast above the automated threshold. The new real-bundle browser tests cover keyboard focus, narrow layout, accessibility and the refusal to submit credentials without native IPC. The backend bounds and validates country-code lists without the flagged repeated regular expression. GeoIP now uses 2.0.3, which removed the two previously recorded production npm advisories. The Rust lockfile updates `quinn-proto` and the current `rustls-webpki` dependency within their existing compatibility ranges. Runtime images advance to pinned Node 22.23.5 and Nginx 1.30.6. No authentication, routing, database or release signing checks were relaxed to obtain a pass.

CI now retains scan artifacts and reports failures from dependency, source, static and runtime-image checks. It no longer forces Jest to exit or suppresses the selected security checks. The deployment workflow checks measured load and recovery thresholds. The architecture workflow builds the desktop frontend and runs its UI checks alongside the console. [Quality instructions and acceptance thresholds](QUALITY_VERIFICATION.md)

## Verification evidence

The [per-check results](audit/phase13/results.json) and [generated quality table](audit/phase13/QUALITY_REPORT.md) distinguish passed, failed, blocked and skipped work. Selected suites were run on Windows with real PostgreSQL and Chrome. Linux packet tests and deployment drills used a separate Linux guest and private namespaces. Android results are scoped to the installed Flutter toolchain and its authorized API 36 emulator. Older hosted CI results are baseline evidence. The hosted run for this phase must validate the CI-specific repairs.

| Coverage | Recorded result |
|---|---|
| Backend unit, contracts, configuration and authorization | 156 passed in 16 suites. Backend ESLint passed. |
| Real migration, API, tenant and identity integration | See database result. A separate run under concurrent host pressure recorded connection timeouts and a detection timing failure, so the original deadlines were retained. |
| Admin console | Three component/API tests and nine real Chrome workflows passed, including axe checks, permission denial, policy assignment, session termination, incident review and evidence export. |
| Desktop | Three state tests, TypeScript compilation, Vite build and three Chrome UI checks passed. The local Rust suite covers six tests. |
| Flutter and Android | Analysis and nine Flutter unit/widget tests passed. See the native integration check for its final device outcome. |
| Network | Native WireGuard, IPv4/IPv6, DNS failure, reconnection and peer revocation checks passed. SCIM ingress and real Compose edge packet checks passed. |
| Operations and performance | See the isolated deployment drill and measured load report. |
| Verification tooling | Four Python tests, workflow YAML parsing, ShellCheck and README link/asset verification passed. |

## Release gates

The [redacted scanner summary](audit/phase13/security-summary.json) records affected packages, severities and source locations without capturing matched secrets or source snippets. The simple signature scan passed and the broader Gitleaks scan found candidates that require triage. Many matches identify test fixtures or saved evidence hashes. They are retained for review. Static analysis still reports nonliteral filesystem-path and dynamic property accesses. Those findings need review, with source changes or narrow, documented dispositions where warranted. Scan results count findings in the scanned artifacts and may repeat an advisory across packages or platforms.

The current Tauri updater pins a ZIP dependency whose affected major has no compatible scanner-reported fix. Upgrading it requires an upstream-supported dependency range or a separately verified updater migration. Signed installer/update acceptance, physical Android devices, native macOS/Linux UI, assistive-device testing, and deployed provider, VPN and cloud acceptance also remain open. The contained load results set a regression gate for the small fixture.

The dedicated branch is `codex/remoteshield-enterprise-completion`. The [existing draft PR](https://github.com/manikantbindass/RdPBrowser/pull/3) targets `main`.
