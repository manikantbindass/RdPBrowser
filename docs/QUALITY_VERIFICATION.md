# Quality verification

Run the catalog from the repository root with Python 3.10 or later. Install each Node project's locked dependencies with `npm ci` and fetch the Rust lockfile before offline Rust tests. Use Node 22 in CI. The Windows reference setup uses PowerShell 7, a disposable PostgreSQL 15 binary distribution, Chrome or Playwright Chromium, Rust and the Flutter 3.38.9 toolchain. Existing CI workflows run their native toolchains independently.

```powershell
python scripts/quality/run.py --list
python scripts/quality/run.py --select backend-lint,backend-unit,database,desktop-state,desktop-types,desktop-build,desktop-ui
python scripts/quality/run.py --select flutter-analyze,flutter-test,flutter-integration
python scripts/quality/collect.py .quality-results
```

Use `RSX_QUALITY_PG_BIN` to point at the PostgreSQL fixture executables. The database harness initializes an isolated data directory with a fresh credential and a free loopback port. It runs the migration, tenant and authentication suites against a dedicated `_test` database, followed by the nine real console workflows. It stops the fixture in `finally`. Set `ADMIN_CHROME_PATH` if the browser executable is outside the normal search path. Install Playwright Chromium when no system Chrome is available. Run the desktop build before its UI check. The UI check serves the real frontend bundle on loopback and verifies the native IPC boundary without simulating authenticated Tauri behavior.

Set `RSX_QUALITY_FLUTTER` to the Flutter executable when it is outside `PATH`, and set `ANDROID_HOME` to the installed SDK. Run `flutter pub get --enforce-lockfile` before the checks. Set `RSX_ANDROID_TEST_DEVICE` to the serial of an authorized disposable device or emulator listed by `adb devices`. Leave it unset when no test device is available. Use `ADB_SERVER_SOCKET` if running a separate test ADB server. The Windows test fixture can use the existing short workspace alias for native toolchain paths. Do not select a device with an active VPN profile for the no-VPN fixture.

Use the Linux packet and deployment checks on a disposable Linux runner with WireGuard, nftables, Nginx, Unbound, curl, OpenSSL, tcpdump, age and Docker. The harnesses assert separate network namespaces before adding addresses, routes and Docker bridges. On Windows, set `RSX_QUALITY_WSL_DISTRO` to the dedicated fixture distro. Build the immutable fixture images and archive using the commands in the [deployment workflow](../.github/workflows/operations.yml), then pass the archive via `RSX_QUALITY_IMAGES` in the guest. The Compose packet check exercises the actual edge, while the native packet check isolates gateway and DNS failure. The [scanner installer](../scripts/quality/install-scanners.sh) verifies fixed Linux x86-64 archive hashes before extraction. Set `RSX_SCANNER_DIRECTORY` to that directory and use a fresh vulnerability database. Only the Docker fixture images are needed for image scans. CI also builds both images from the checked-out source in an independent job.

The runner stores per-check exit codes, durations, revision, available source fingerprints, log hashes and prerequisite status in `results.json`. It writes Jest, Flutter machine output and Playwright results through the respective test runners. The collector merges explicit captures and keeps the latest executed attempt for each check. Keep earlier failures when they explain a fix or a test constraint. Store full local scanner and test outputs in the ignored results directory and publish redacted summaries without credentials. `PASS` requires a successful command, `FAIL` records a failing check or execution, `BLOCKED` indicates a missing prerequisite, and `SKIPPED` identifies checks omitted from the capture. An aggregate containing any of the last three states exits nonzero.

## Acceptance thresholds

| Gate | Threshold and measured baseline |
|---|---|
| Backend, migrations, identity, admin and native checks | All selected assertions pass with zero unexpected failures or skipped assertions in required suites. Phase 12 established 153 backend, 48 PostgreSQL and nine console checks. Desktop and Flutter baselines came from their platform reports. |
| Access boundaries | Zero cross-tenant access, successful invalid/revoked or expired sessions, unauthorized configuration changes or rollback across incompatible schema. Verify both successful and denied requests. |
| Network and DNS | Zero observed unapproved underlay traffic in the documented packet sample. Reconnection restores the authorized route. DNS outage produces no direct fallback. Peer revocation blocks access before and after gateway recovery. |
| Accessibility | Zero automated axe violations in the tested console/login states, working keyboard focus and no horizontal overflow in the 360 px desktop login fixture. Screen-reader and assistive-device acceptance remain manual. |
| Load and recovery | At least 300 authenticated HTTPS requests at concurrency 10, zero errors, at least 20 requests/s, p95 at most 1 s, p99 at most 2 s, verified fixture restore at most 60 s and activation at most 90 s. Phase 12 measured 108 requests/s, p95 138 ms, p99 161 ms, 6.2 s restore and 26.3 s activation. Shared runner margins allow normal host contention while catching large regressions. These thresholds cover the isolated small dataset smoke run. |
| Security scans | Zero unresolved high/critical vulnerability or configuration findings, zero unresolved Gitleaks candidates, and no unreviewed static security findings. Scanner execution errors and missing reports fail the gate. Dependency audits retain advisory counts even when a separate production acceptance threshold only blocks high or critical findings. |

See the [Phase 13 completion report](PHASE13_REPORT.md) for measured results and open acceptance gates.
