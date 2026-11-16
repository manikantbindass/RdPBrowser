# Enterprise extension boundaries

Phase 11 implements an OIDC administration workflow, SCIM user/group provisioning, role and URL policy assignment, and governance evidence exports in the existing backend. The other integration ports below describe their acceptance boundaries. [Enterprise setup and responsibilities](ENTERPRISE_GOVERNANCE.md)

| Port | Input/output contract | Constraints before enablement |
|---|---|---|
| Identity provider (OIDC) | Verified issuer and subject -> local identity | Confirm tenant-specific discovery, claims, MFA, secret rotation and revocation |
| Directory provisioning (SCIM) | Scoped Users and Groups, roles and membership | Migration 006, expiring directory bearer, dedicated TLS ingress and tenant interoperability drill |
| Device enrollment/MDM | Device DTO + platform evidence -> enrollment decision | Native verification, replay prevention, bounded evidence lifetime, admin approval policy |
| Policy evaluation | User/device/session context + policy revision -> decision/reasons | Deterministic rule semantics, tenant scope and version; do not equate decision with packet enforcement |
| Native enforcement | Signed/versioned policy -> applied revision + measured status | Rust/Android adapters, trusted evidence model, outage policy and OS routing/DNS tests |
| Audit export and optional SIEM relay | Page manifest and digest, future signed event envelope | Evidence retention and recipient access for exports. A webhook relay needs durable retry, controlled egress and duplicate-safe receipts. |
| Remote protocol transport | Authorized session/destination -> bounded transport handle | Per-protocol host identity, credential lifetime, destination allowlist, revocation/backpressure/resource limits |
| Secrets provider | Secret reference -> short-lived material | External credentials never public contracts/UI bundles/logs; rotation and provider outage behavior |

Implement adapters behind dependency injection in runtime/services, not imports from UI or migration files. A future integration must supply configuration schema, capability/health reporting, fail-open/fail-closed rationale, contract tests and operational metrics. Add distributed infrastructure only if measurements exceed the single-process design and the ADR states the new consistency/recovery costs. Existing rule detector remains an optional local module with a stop handle; it is not a broker, AI service or durable event exporter.
