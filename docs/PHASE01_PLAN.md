# Phase 01 implementation plan

Authorized scope: comprehensive audit, reproducible baseline, prioritized defect register, feature/dependency inventories, recovery plan and safe baseline fixes. Starting commit: c5f7c81cd99aab7fcc31b011e66fbf95e531c525. Branch: codex/remoteshield-enterprise-completion. Initial working tree clean; origin fetched without changing application code.

1. Inspect all source/configuration families and current GitHub evidence; distinguish observed failures, source defects and unverified risks.
2. Add a bounded baseline runner and a source inventory checker. Capture baseline before changing behavior. Record tool versions, manifest/lock hashes, exact commands, exit status, output and skipped tools.
3. Correct only the filtered IP-log SQL alias defect and backend import/test lifecycle. Add regression coverage for the query and ensure tests exit without forceExit. Preserve API shapes, production entry point and security policies. Retain the already-tested Rust dependency resolution as an application lockfile; do not upgrade dependencies.
4. Run the same checks after fixes. Record failing analyzers/audits honestly; do not disable gates, fabricate native implementations or execute privileged provisioning scripts.
5. Update PROJECT_AUDIT, BUG_REGISTER, IMPLEMENTATION_STATUS, DEPENDENCY_MATRIX, ARCHITECTURE and ROADMAP, with reproduction commands and recovery order. Review diff, commit, push and update draft PR #3. No main merge.

Explicitly deferred: auth/token redesign, tenant schema, native Android features, VPN enforcement, deployment topology, dependency upgrades and CI policy changes. These require dedicated acceptance tests and may change behavior beyond baseline repair.
