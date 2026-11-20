# Phase 12: deployment and operational reliability

**Final status: PARTIAL for production acceptance.** The implemented single-VPS operational workflows pass the local checks below. Production cloud bootstrap, offsite-copy monitoring, external paging, an agreed workload/RTO/RPO and full replacement-host/gateway recovery still require an authorized deployment acceptance exercise. No cloud resources were provisioned or paid services enabled.

## Preserved functionality and delivered changes

The existing VPS/Compose topology, PostgreSQL schema/migrations, restricted runtime role, legacy/versioned APIs, password/OIDC sessions, enterprise governance, console, deterministic detections and separate WireGuard gateway remain. No public API contract or database migration is introduced in this phase. Existing installations must preserve their actual Compose project/volume names, credentials and optional integration mounts using the adoption procedure in [OPERATIONS.md](OPERATIONS.md).

Production/staging overrides add scoped file secrets, a UID101 TLS edge, read-only application filesystems, bounded CPU/memory/PIDs/tmpfs and rotated logs. Backend migration tools need only database secrets. Nginx re-resolves replacement backend addresses through Docker DNS. Graceful shutdown rejects new ordinary requests while draining and has a bounded watchdog. The backend adds authenticated private Prometheus/status endpoints, an operational dashboard, bounded route metrics and sampled HTTP/database JSON spans. Host timers record deduplicated health, backup, certificate and disk alert transitions; optional Prometheus configuration supports an operator's monitoring system.

The Linux operations CLI validates immutable release manifests, serializes maintenance, encrypts DB/configuration backups, verifies fresh-target restores and performs schema-aware artifact rollback. Restore activation revokes old sessions/provisioning credentials/devices, disables directory/SSO settings and locks users across organizations. A reviewed local superadmin recovery command resets a password through stdin and audits recovery. This requires deliberate identity and gateway reconciliation before users regain access.

Terraform defines a single DigitalOcean Ubuntu VPS, restricted operator SSH, WireGuard and optional source-restricted SCIM ingress. Provider selections/checksums are locked. Tests use mocked plans without real cloud credentials. The target remains a documented deployment option, with no Kubernetes, broker, Redis or service split. [ADR 0008](adr/0008-single-vps-operations.md) records the stateful recovery and scaling decisions. [Disaster recovery](DISASTER_RECOVERY.md) covers encrypted offsite copies, artifact rollback, database activation and gateway recovery.

## Executed verification

Baseline before functionality changes: **142 backend tests**, **48 real PostgreSQL tests**, **nine Chrome console scenarios**, and backend ESLint passed. Baseline logs are retained in [audit/phase12](audit/phase12/).

| Check | Actual result / evidence |
|---|---|
| Backend ESLint | PASS, zero warnings |
| Backend unit/contract/security suite | 153 passed in 16 suites; [unit output](audit/phase12/unit.txt) |
| Real PostgreSQL integration | 48 passed in five suites; [integration output](audit/phase12/integration.txt) |
| Admin components/API client | Three passed |
| Real Chrome console | Nine passed; [browser output](audit/phase12/browser.txt) |
| Operator configuration/atomic-file guards | Five passed without Docker/cloud; [output](audit/phase12/operations-unit.txt) |
| Production/staging Compose operational drill | 35 passed; [output](audit/phase12/operations-lab.txt) |
| Development Compose and loopback publications | Four passed; [development smoke output](audit/phase12/development-lab.txt) |
| Actual Compose edge through WireGuard | Six packet/Compose assertions passed; [output](audit/phase12/compose-network.txt) |
| Terraform formatting, initialization, validation, mocked plans | PASS; four mocked plans; [output](audit/phase12/terraform.txt) |
| SCIM ingress TLS/header/path boundaries | PASS; [output](audit/phase12/scim-edge.txt) |
| WireGuard/DNS/IPv4/IPv6/reconnect/revocation packet regression | PASS; [output](audit/phase12/network.txt) |
| ShellCheck and Python compilation | PASS for new operational scripts and adjusted ingress/Compose harness |
| Limited secret signature scan | Zero candidates in 126 backend/contracts/deployment/scripts/security files at scan time; [scope/result](audit/phase12/secret-scan.json). Not a history or entropy audit |
| Production dependency advisories | `npm audit --omit=dev` exits 1: one high and one moderate existing GeoIP maintenance-chain finding; [report](audit/phase12/npm-audit.json) |

The operational drill uses real Node22/PostgreSQL15.19/Nginx containers under Docker29.9.3/Compose5.6.1 in an Alpine3.24.4 guest on the WSL2 5.15.153.1 kernel. Each test topology uses an independent Docker daemon inside private mount/network namespaces. Only that disposable namespace receives bridge, firewall and address changes. The developer's Windows networking, production services and cloud accounts are untouched. Local host backend checks use Node24.14.1; CI uses Node22. Terraform1.14.0 validates DigitalOcean provider2.107.0.

The 35 operational assertions cover hardened startup, secret isolation, authenticated telemetry, actual TLS login, tenant API availability, encrypted DB/configuration backups, an active-session/policy fixture, successful restore, existing-target/wrong-key/corruption rejection, removal of only a failed new restore target, readiness during DB outage, firing/resolved host alerts, application crash restart, changed upstream address without edge restart, two immutable executable revisions, rollback data preservation, incompatible-schema rollback rejection before downtime, cross-organization recovery locks, restored credential/device/SSO revocation, controlled admin recovery, sampled traces and credential-free application logs.

The new [CI workflow](../.github/workflows/operations.yml) runs blocking isolated deployment/recovery and development-topology checks plus mocked Terraform tests. No tests, analyzers or security checks were disabled. Existing native release/provider acceptance gates remain separate.

## Measured limits

One bounded smoke run issued **300 authenticated `/api/v1/organization` requests through verified TLS**, at concurrency10, in 2.77seconds: approximately **108 requests/second**, with **zero errors**. Latencies were p50 **92.8ms**, p95 **138.5ms**, p99 **161.1ms**. The backend had a 768MiB container limit, one CPU ceiling and staging pool10. This is a small fixture on shared WSL hardware with trace sampling set to1; it is not sustained load, a supported-user count, tunnel throughput, production capacity or an SLA.

The small encrypted DB fixture restored and verified in **6.22seconds**; activation including service recreation and identity revocation took **26.31seconds**. The first readiness probe after restarting PostgreSQL succeeded in **0.54seconds**; the crash-restart readiness observation took **3.25seconds**. The raw `dnsRecoverySeconds` value starts after Compose has already waited for the new backend's health, so it measures only the final probe; it is **not** total replacement downtime. Production RTO must additionally include provisioning, offsite transfer, dataset size, operator availability, identity reconciliation and stateful gateway acceptance.

Resource ceilings, scaling prerequisites, failure behavior and an indicative $24/month basic VPS estimate ($28.80 with optional weekly provider backups, before other costs) are documented with official pricing links in [OPERATIONS.md](OPERATIONS.md). Local backups alone do not establish disaster durability. There is no WAL/PITR, multi-region failover, automatic offsite upload/retention or zero-downtime database migration.

## Defects repaired and remaining gates

The work repairs secret delivery through inspectable environments, root edge execution, unbounded resources/logs, stale Nginx upstream addresses, missing executable backup/restore and rollback procedures, restored identity reactivation and absent private operational health signals. Initial container tests found that the non-root edge could not create its generated configuration directory and the gateway's post-DNAT port rule needed to admit the new internal8443 destination. Startup now prepares its writable tmpfs directory; the gateway rule constrains both original443 and translated edge destinations. Initial test-only failures from copied configuration permissions, sandbox loopback denial, an outdated login response-field assumption and Docker's deliberate-stop semantics were corrected and rerun. A source-archive build avoided Windows/WSL enumeration of unrelated local toolchains; normal Docker builds use the restricted repository context.

Operator gates remain: authorized Ubuntu/cloud-init acceptance, real CA/renewal and management access, protected host/secret delivery, independently monitored offsite copies and retention, external notification delivery, full host/gateway recovery, realistic sustained load and agreed RTO/RPO. Compose file mounts are not encrypted secret storage; root/Docker operators remain trusted. Restored gateway peers require a separate current revocation ledger. Existing high/moderate dependency advisories and native release/live IdP limitations remain unresolved rollout risks. No complete device-wide protection, certification or paid deployment success is claimed.

Implementation commit: `458da3f8d955c9343c8e613d7f3865c82482f4c2`. Branch: `codex/remoteshield-enterprise-completion`. Changes extend [draft PR #3](https://github.com/manikantbindass/RdPBrowser/pull/3) targeting `main`; merge remains gated by required checks and review. See [changed files](audit/phase12/changed-files.txt). A documentation follow-up normalizes captured Windows log line endings for clean repository whitespace checks without changing test results.
