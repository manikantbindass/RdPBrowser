# ADR 0008: Single VPS operations and recovery boundaries

Status: accepted for Phase 12 implementation; live deployment acceptance remains an operator gate.

The control plane stays one Express/Socket.IO process, PostgreSQL 15 and Nginx under Compose. Production and staging share hardened configuration but use independent hosts or namespaces. Fixed bridge/source trust addresses mean they must not share one ordinary Docker daemon without a reviewed address plan. Kubernetes, Redis and brokers add no demonstrated benefit for this workload.

Production uses immutable backend/edge image references, scoped file mounts for secrets, a restricted runtime database role, resource/log limits and private operational telemetry. Migration jobs alone receive owner credentials. Compose file secrets restrict delivery; their host files and Docker administrators remain trusted. They do not provide encryption at rest.

Deployment stops application writers, takes an encrypted logical backup, applies checksummed forward migrations and starts the selected artifacts. Artifact rollback runs the selected build's database-role/history preflight before stopping the running application. Destructive down migrations and automatic database replacement are excluded. A failed migration or deployment requires operator assessment and may cause a documented maintenance outage.

Restore writes a new database and verifies its migration history. Activation revokes all restored sessions and locks restored users, preventing an old backup from silently reactivating identities removed after the recovery point. Operators must reconcile organizations, IdP settings, provisioning credentials, device trust and gateway revocations before unlocking access. A local superadmin recovery command resets its password through standard input and records an audit event. This conservative recovery policy increases recovery time deliberately.

WireGuard gateway keys, peer registry, firewall and DNS state are separate persistent infrastructure. Application scaling cannot preserve that identity/routing state automatically. One backend replica is supported: Socket.IO subscriptions and abuse counters are process-local. Scale only after measuring sustained CPU, database pool wait, latency and tunnel bandwidth. Multiple backend instances would first require shared rate limits, verified Socket.IO coordination and explicit connection routing.

Metrics have bounded route labels and no user, organization, URL query or SQL parameter dimensions. Request and database spans use server-generated identifiers and sampled JSON logs. No distributed tracing collector is required. Host timers publish durable alert transitions; Prometheus rules are optional integration configuration, with external paging owned by the operator.
