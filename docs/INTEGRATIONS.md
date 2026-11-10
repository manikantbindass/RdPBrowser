# Enterprise extension boundaries

No dynamic plugin loading, network broker or integration service is enabled. The following are design ports inside the existing backend deployable; their implementations require explicit later scope and acceptance tests.

| Port | Input/output contract | Constraints before enablement |
|---|---|---|
| Identity provider (OIDC/SAML) | Verified external identity -> local user/membership mapping | Verify issuer/audience/signature, nonce/state, provisioning policy and revocation; never accept role/organization directly from untrusted claims |
| Directory provisioning (SCIM) | Versioned organization/user/device DTOs | Tenant-scoped authorization, idempotency, soft deletion and audit events; migration first |
| Device enrollment/MDM | Device DTO + platform evidence -> enrollment decision | Native verification, replay prevention, bounded evidence lifetime, admin approval policy |
| Policy evaluation | User/device/session context + policy revision -> decision/reasons | Deterministic rule semantics, tenant scope and version; do not equate decision with packet enforcement |
| Native enforcement | Signed/versioned policy -> applied revision + measured status | Rust/Android adapters, trusted evidence model, outage policy and OS routing/DNS tests |
| Audit/SIEM export | Versioned event envelope -> acknowledged event ID | Secret/PII minimization, retention, retry limits, authenticated sink, durable/idempotent delivery before guarantees |
| Remote protocol transport | Authorized session/destination -> bounded transport handle | Per-protocol host identity, credential lifetime, destination allowlist, revocation/backpressure/resource limits |
| Secrets provider | Secret reference -> short-lived material | External credentials never public contracts/UI bundles/logs; rotation and provider outage behavior |

Implement adapters behind dependency injection in runtime/services, not imports from UI or migration files. A future integration must supply configuration schema, capability/health reporting, fail-open/fail-closed rationale, contract tests and operational metrics. Add distributed infrastructure only if measurements exceed the single-process design and the ADR states the new consistency/recovery costs. Existing rule detector remains an optional local module with a stop handle; it is not a broker, AI service or durable event exporter.
