# Architecture: current state and intended boundaries

Baseline inspected: 0aa4b400aeb87c248632f7760db1be30ba4bac88. See PROJECT_AUDIT.md for evidence and limitations.

Phase 01 update: backend module imports no longer initialize DB or listen; direct execution remains the production entry point. Filtered IP-log count SQL alias is repaired. The desktop application's tested dependency graph is now retained in Cargo.lock. No network, auth, schema or deployment boundary has otherwise changed. BUG_REGISTER.md is the current detailed defect inventory; earlier initial-audit observations are superseded by Phase 01 command snapshots where applicable.

## Current components

| Component | Implementation | Responsibility and limitation |
|---|---|---|
| Desktop | React/TypeScript, Vite, Rust/Tauri 2 | Browser UI, native commands, token memory, health watchdog. Managed policy has bypasses; health is not VPN attestation. |
| Android | Flutter/Dart | Browser state/screens, secure-storage dependency, security/VPN MethodChannels. Required native implementations are absent. |
| API | Node.js/Express JavaScript | Joi validation, bcrypt passwords, JWT, REST roles and session lookup. No tenant isolation or complete refresh lifecycle. |
| Realtime/remote access | Socket.io, ssh2 | Admin room events and SSH relay. Privileged handlers lack authentication gates. |
| Persistence | PostgreSQL | Users, sessions, URL rules, audit/IP logs and alerts; startup schema application, no migration runner. |
| Admin | Static HTML/CSS/JavaScript | REST queries and socket updates; unsafe HTML interpolation needs review. |
| Edge/network | Nginx, WireGuard templates | TLS reverse proxy and external VPN setup. Compose edge wiring and tunnel enforcement unverified. |
| Security utilities | Node integrity tool, rule detector, Rust/Dart checks | Partial signals; cannot establish trustworthy device or binary state. |

## Current request flow

Clients call /api/auth for credentials and tokens. Protected REST routes run VPN middleware and token/session validation; admin router adds role validation. /api/laila is mounted before VPN middleware. /health is public and does not test DB readiness. Socket.io runs separately from Express middleware, so REST authentication does not secure socket events.

Navigation policy returns permission and a target URL. WebViews load content themselves; the backend is not a content proxy. VPN routing therefore depends on actual OS configuration, not this REST response. Desktop uses separate VITE_SERVER_URL (frontend) and REMOTESHIELD_SERVER (native) settings; defaults differ and include placeholders. Android channels require native services before their state can be trusted.

## Trust boundaries

Treat client device IDs, VPN flags, Origin headers, URLs, socket payloads and forwarded headers as untrusted. Verify identity, active session, role and future tenant scope server-side on every privileged path. Terminate TLS at a defined edge, trust only configured proxy hops, and prevent direct backend exposure. SSH destinations and host keys require an explicit policy. Certificates, refresh credentials and signing keys need managed lifecycles.

## Incremental target design (not implemented)

Preserve Tauri/Rust/React, Flutter/Dart, Express/PostgreSQL, Socket.io, WireGuard, Nginx and Docker. Establish validated configuration, modular API services, migrations, transactional session/token management, tenant-scoped authorization and auditable device enrollment. Separate liveness from readiness. Add shared socket authorization and destination restrictions. Managed mode must enforce policy in native/network layers and fail closed under a documented availability policy.

UI indicators are observations, not security proofs. Document unmanaged development mode explicitly and keep it unavailable to managed production policy. Use feature flags for unfinished features. Validate platform support through native builds, real-device checks and routing tests before making claims. Any schema/API change needs a migration and compatibility note in its phase report.

## Operational gaps

No verified horizontal socket/session coordination, graceful shutdown, readiness contracts, backup/restore drills, load targets, tenant isolation or signed supply-chain attestations were established. A future design must specify retention, audit integrity, recovery objectives and bounded resource use. No cloud resources or production settings were changed during this audit.
