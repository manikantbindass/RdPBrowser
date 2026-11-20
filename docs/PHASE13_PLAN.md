# Phase 13 verification plan

1. Record the existing clean Git revision and actual prior CI results. Inspect existing assertions rather than counting README claims.
2. Repair Linux runner portability failures in the native Nginx fixtures and isolated Docker runtime directory. Preserve production dynamic DNS, container restrictions and packet boundaries.
3. Add a reproducible quality command catalog with machine-readable per-check results, bounded execution, evidence files and explicit required/optional prerequisites. Aggregate a human report without treating unavailable tools, devices or scans as passes.
4. Run backend unit/contract and real PostgreSQL migration/identity/tenant suites, desktop state/UI/build/Rust checks, Flutter checks and emulator integration where available, console/accessibility/end-to-end checks, isolated packet/failure and real-container recovery/load tests.
5. Run dependency, secret, static and container scans. Retain unresolved findings as failed acceptance gates. Add measured performance thresholds with functional reliability requirements; avoid broad coverage percentages that reward superficial tests.
6. Record source revisions, toolchain versions, test counts, thresholds, discovered defects and platform limits. Commit verified changes on the existing dedicated branch and keep the PR draft.
