# Testing and verification

Use locked inputs and a disposable fixture for any check that opens ports, changes routes, creates schemas or issues credentials. Track the revision, toolchain, suite, scope and outcome. A build proves packaging or compilation. An emulator check verifies its exercised runtime path. Packet and recovery tests establish their observed topology and failure conditions.

## Reproduce selected checks

Run from the repository root with Node 24 and the locked dependencies installed. Prefer system Chrome or install the project's Playwright Chromium from `admin-dashboard`.

```sh
npm ci --prefix backend
npm ci --prefix desktop
npm ci --prefix admin-dashboard
npm run lint --prefix backend
npm test --prefix backend -- --runInBand --detectOpenHandles
npm test --prefix desktop
npm run build --prefix desktop
npm test --prefix admin-dashboard
cargo fmt --manifest-path desktop/src-tauri/Cargo.toml -- --check
cargo test --locked --manifest-path desktop/src-tauri/Cargo.toml
cargo clippy --locked --manifest-path desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
python -m unittest discover -s scripts/release
```

Run database suites with `INTEGRATION_DATABASE_URL` set privately to a disposable PostgreSQL database ending in `_test`. The owner fixture creates unique schemas and roles. Keep production database URLs outside the test environment. The desktop web check uses the real frontend bundle and checks the absence of native IPC in the web fixture.

```sh
npm run test:integration --prefix backend
npm run test:browser --prefix admin-dashboard
npm run test:desktop-ui --prefix admin-dashboard
python scripts/quality/run.py --list
```

In `android/`, with the documented SDK:

```sh
flutter pub get --enforce-lockfile
flutter analyze --no-pub
flutter test --no-pub
```

For native emulator tests, set the authorized serial and SDK variables in the [quality catalog](QUALITY_VERIFICATION.md). Linux packet checks need a disposable runner with the listed tools and privilege to create private namespaces. The deployment drill uses an isolated Docker daemon and verified image archive. [Network workflow](../.github/workflows/network.yml) · [Operations workflow](../.github/workflows/operations.yml)

## Evidence at the verified revision

| Check | Result and scope |
| --- | --- |
| Hosted backend | 156 unit tests and 48 real PostgreSQL integration tests passed. They cover migrations, auth, tenant isolation and administrative boundaries. |
| Desktop and console | Native TypeScript/Rust checks passed on Windows, Linux and Intel macOS. Chromium passed nine console and three desktop frontend scenarios, including selected automated accessibility checks. |
| Android | Nine hosted Flutter tests and analysis passed. The earlier API 36 emulator scenario verifies selected native boundaries. The four preview APKs passed signature and alignment checks with a disposable key. |
| Network | Isolated WireGuard and SCIM edge checks passed. Evidence is bounded to that kernel, route setup and packet sample. |
| Operations | 35 isolated Compose checks passed, including deploy, revision rollback, encrypted backup and restore, outages and readiness. Performance limits remain fixture thresholds. |
| Scans | Gitleaks and high/critical package and runtime-image scans were clear. Five critical Terraform firewall findings and 52 backend static-analysis observations remain open. |
| Preview delivery | The independent verification job passed for 16 assets. The aggregate remained failed because of required security gates. |

[Hosted PR run](https://github.com/manikantbindass/RdPBrowser/actions/runs/44484220465) · [Machine-readable scan and test results](audit/phase14/security-remediation.json) · [Android runtime evidence](PHASE13_REPORT.md) · [Preview verification](https://github.com/manikantbindass/RdPBrowser/actions/runs/44484271833/job/135432691439)

Reports retain actual failures and unavailable prerequisites. Keep live IdP, target hardware, installer upgrade, real tunnel and production scale acceptance separate. [Fixture thresholds and collection](QUALITY_VERIFICATION.md)

## Documentation and deliverable checks

Install the pinned Pillow dependency for README asset inspection, then run the Phase 15 verifier from the repository root. It checks all local Markdown links and heading anchors, the complete API operation catalogue against OpenAPI, requested README asset signatures and manifest hashes, animation duration/loop metadata, Mermaid fences, PDF signature, and editable presentation package and slide count.

```sh
python -m pip install -r scripts/requirements-readme.txt
python scripts/quality/verify_docs.py
```

The verifier records machine-readable output in `docs/deliverables/validation.json`. It does not provision services, execute VPN routes or replace visual inspection. See the [deliverable validation record](deliverables/README.md).
