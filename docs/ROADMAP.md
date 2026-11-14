# Phase 01 roadmap and recovery plan

## Phase 05 identity delivery and remaining gates

Implemented backend OIDC/PKCE/signature checks, provider-assurance MFA, linked identities, bounded token families, organization/resource/session policy, device possession/admin posture and decision logs. Read PHASE05_REPORT.md and IDENTITY_AND_ACCESS.md. Next identity acceptance requires real Okta/Entra tenant testing, native/browser secure handoff/storage UX, MDM/hardware posture/per-request proof, external deprovisioning and production recovery/load/security review. Existing dependency/network/Android/release gates remain open; no subsequent phase starts automatically.

## Phase 04 delivered backend and next gates

Tenant-aware backend interfaces, atomic token/session lifecycle, database RLS/constraints/indexes, OpenAPI and negative integration coverage are delivered; [PHASE04_REPORT.md](PHASE04_REPORT.md) records verification. Upgrade using [MIGRATION_PHASE04.md](MIGRATION_PHASE04.md), which supersedes earlier migration/local-setup instructions where they differ. Production approval remains withheld: remediate/review GeoIP maintenance advisories, validate an operator backup/restore, measure load/outage targets, review deployment role/secret scopes and perform independent security testing. Device attestation, managed client/network enforcement, Android completion and admin UI acceptance remain future phases. No later phase starts automatically.

Phase 02 was explicitly authorized to modernize architecture. Its implementation plan is PHASE02_PLAN.md; architecture/config/contracts/migrations/local deployment/ADR work and final verification are reported in PHASE02_REPORT.md. Use LOCAL_DEVELOPMENT.md and MIGRATION_PHASE02.md for the current workflow. Proposed later work below remains gated on a new phase prompt; Phase 02 does not authorize tenant enforcement, Android feature completion or production deployment.

The user's phase prompts define scope. Phase 01 is audit plus safe baseline repair; the earlier proposed phase numbering is superseded by this explicit Phase 01 scope. No later product phase starts automatically. PLAN and BUG_REGISTER contain the scoped work and defect references.

## Delivered Phase 01 baseline

Audited all component families and documented 52 grouped defects/risks, dependency inventory, feature inventory and reproducible command output. Fixed only filtered IP-log SQL alias and backend import/test lifecycle (291f6e5), retaining API shapes and production startup. Captured the already-tested Rust resolution as application Cargo.lock. No authentication, VPN, UI feature, database schema, deployment topology or CI-gate redesign was attempted. No tests/security gates were disabled.

Acceptance record:

| Criterion | Evidence / disposition |
|---|---|
| Reproducible baseline | scripts/audit-baseline.mjs, command/output/input-hash JSON snapshots, npm locks and desktop Cargo.lock; all available checks recorded. Android and container runtime baseline blocked explicitly, not fabricated. |
| Prioritized defect register | BUG_REGISTER B01–B52 includes severity, impact, component, evidence, status and remediation. |
| Verified feature inventory | IMPLEMENTATION_STATUS separates compiled/tested/source-only/missing/unverified behavior. |
| Dependency matrix | DEPENDENCY_MATRIX generated from manifests/locks, advisory snapshots retained. |
| Recovery plan | Ordered stabilization and rollback procedure below; no destructive recovery executed. |
| Runtime acceptance | PARTIAL: real DB, Android, VPN, signed installers and live deployment not established. |

## Proposed subsequent work (requires phase prompt)

| Order | Scope and defect references | Exit gate |
|---|---|---|
| 1 | Make build inputs/Android toolchain coherent; restore intended screens, wrapper and native channels; fix formatting/Clippy; enforce CI checks B17–B20/B44–B49. | Fresh CI builds with no ignored analyzer/test failures; explicit absence of production keys blocks signing clearly; real-device startup test. |
| 2 | Protect socket/SSH boundaries, trusted proxy/production configuration and critical dependencies B01–B10/B23. | Authenticated/unauthenticated/revoked-role socket tests, destination/host-key checks, malformed-input and header-spoofing tests; dependency updates pass platform builds. |
| 3 | Repair DB/session/token lifecycle and migrations/readiness B05–B07/B26–B28/B33/B34. | Real PostgreSQL integration, transactional concurrency, locked/revoked/refresh replay tests, explicit migrations/backup rollback and client migration notes. |
| 4 | Repair deployment topology and deterministic provisioning B37–B43. | Disposable Ubuntu deployment, nginx -t, verified TLS/DB trust, fresh/persisted-volume boot, controlled retry and outage recovery. |
| 5 | Implement managed browser/network enforcement B13–B16/B21/B43. | Per-OS tunnel failure/restore/reboot, IPv4/IPv6/DNS leak, redirects/subresources and native window logout tests. Explicit policy for availability vs fail-closed security. |
| 6 | Tenant isolation, device trust, admin safety and truthful product flows B24/B28–B35/B51. | Cross-tenant/role negative tests, XSS/CSP/JSONB UI tests, real policy distribution and auditable lifecycle; no placeholder production claims. |
| 7 | Reliability/performance/release readiness B46–B50. | Agreed latency/concurrency/RTO/RPO targets, load/fault/restore drills, signed/notarized artifacts, SBOM/provenance, reviewed security findings and required review gates. |

## Recovery procedure

1. Freeze deployment changes and record current Git/artifact SHAs, image digests, schema version, environment-variable names and platform versions. Keep actual secrets out of issue text/logs/source. Do not run vpn-server/setup.sh against a working VPS: it overwrites keys/config and changes host packages/firewall.
2. Before any later migration/provisioning, take PostgreSQL logical backup and snapshot persistent volumes; securely export existing WireGuard keys, peer config and firewall rules. Encrypt/restrict access, record ownership and verify a restoration on a disposable host. Backups without a successful restore are not an acceptance result.
3. Reproduce failing components on isolated runners using the checked locks and evidence commands. Install supported Flutter/Dart, matching Gradle/native toolchains and a running container engine where required. Preserve the old application/database versions and prepare forward/backward compatibility before rollout.
4. Stabilize in the order above, with a specific implementation plan, targeted regressions and no irreversible host changes as part of a diagnostic test. Do not remove bypass behavior until an explicit managed/unmanaged compatibility policy and recovery path are tested.
5. Deploy only a reviewed artifact to a test environment; verify readiness, authentication, role/session revocation and routing before opening traffic. Canary with agreed rollback triggers. No production rollout is performed in Phase 01.
6. If a later rollout fails, restore the previous verified application/config artifact while retaining evidence and audit logs. Roll back database only under its tested migration/restore contract; restoring an older backup can lose newer writes and requires an explicit recovery decision. Restore network configuration through console/out-of-band access to avoid lockout. Never use docker compose down -v, blind firewall flushes, key regeneration or git reset --hard as routine recovery.

## Undoing Phase 01 safely

No schema/data/network state changed. If the safe backend repair needs reversal, use a new git revert commit for 291f6e5 through review; this reintroduces the alias/import-time startup defects. Do not rewrite shared history. Revert the later audit/lockfile commit only if its pinned resolution causes a demonstrated platform issue; retain audit evidence separately and review an alternate lock instead of silently returning to drifting dependencies. Existing local build/cache outputs are ignored and not production deployment artifacts.

## Verification commands and prerequisites

PROJECT_AUDIT contains exact reproduction commands. Baseline runner records all commands and fails overall when tools/checks are unavailable or red. npm start remains the backend production entry point; npm run migrate is still broken and must not be described as a working migration command. Tauri debug --no-bundle can verify compilation but cannot certify installers, signing or runtime enforcement. Native Linux/macOS builds require corresponding runners; Android API35/min26 configuration does not establish compatibility with every Android version.

Each requested phase ends with files/features/defects, preservation, tests/results, security checks, limitations, remaining work, commit SHA, branch/PR and PASS/PARTIAL/BLOCKED. Push only the dedicated branch. Main requires required checks and review; no force push or merge in Phase 01.
