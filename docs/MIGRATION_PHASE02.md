# Phase 02 compatibility and cutover

This change does not introduce tenant APIs, organization tables or a packet-enforcement service. The existing user/session/policy tables and /api clients remain. Back up before adopting migration tracking on existing data.

## Configuration changes

| Previous behavior | New contract / action |
|---|---|
| Environment strings read independently across backend | Immutable validated config at bootstrap; use config:check before serving/migrating |
| Production placeholder secrets accepted | Rejected; use distinct cryptographically random access/refresh secrets of at least32 characters |
| Production VPN_REQUIRED=false or implicit dev bypass | Production rejects false; development must explicitly opt out; test mode alone no longer bypasses it |
| Any X-Forwarded-For trusted | Only configured proxy CIDRs trusted; edge must overwrite forwarding headers; default direct-host config trusts none |
| DASHBOARD_ORIGIN with /admin or loose localhost match | Exact CORS_ORIGINS, without paths. Legacy DASHBOARD_ORIGIN remains one exact-origin alias |
| Production DB certificate verification disabled | DB_SSL_MODE=verify-full with system/custom CA, or explicitly DB_NETWORK_TRUSTED=true with disable for a reviewed private network. TLS query parameters in DATABASE_URL are rejected to prevent override ambiguity |
| LOG_FILE/file logger | Backend JSON stdout with correlation IDs and structured-field redaction; configure collection/retention outside the process |
| Hardcoded frontend/SSH/search endpoints | Desktop VITE_SERVER_URL shared UI config; Rust REMOTESHIELD_SERVER validated independently; Dart SERVER_URL adapter; admin defaults same origin |
| Native release placeholder origin | Rust release requires HTTPS origin via runtime or build-time REMOTESHIELD_SERVER; local HTTP is debug-only |
| SSH exposed as ordinary socket feature | SSH_ENABLED=false by default, forbidden in production, opt-in development only; authenticated admin needed; host trust/destination limits remain future work |

No environment key is copied into logs. Unknown legacy variables are ignored; obsolete ADMIN_USERNAME/PASSWORD_HASH never constituted a working admin bootstrap. The templates deliberately contain placeholders and are expected to fail until provisioned. setup-dev.mjs is local-only and refuses existing files.

## Database adoption

1. Snapshot/backup the existing DB and volume; test restore independently. Compare its current schema with backend/src/db/migrations/001_initial.sql. A matching original schema is supported; arbitrary manual drift is not certified.
2. Configure database trust and new secrets/origins deliberately. If keeping old signing secrets, satisfy the new validation; changing secrets invalidates old tokens and requires a user sign-in window.
3. Run npm run migrate before npm start. It acquires a transaction-scoped migration lock, applies the existing idempotent schema, records checksum/version and preserves existing rows. Running twice is a no-op; concurrency, rollback and adoption are integration-tested.
4. Server startup and /ready reject unavailable/pending/edited/unknown history. /health reports only process liveness. Apply future versioned files in order; never edit an applied file or re-stamp checksums.
5. New migrations should expand first, backfill with checked progress, then contract in a later reviewed release. The current strict compatibility checker refuses unknown newer versions; a future mixed-version rollout needs an explicit compatibility window and tests.

Compose project name is now remoteshield. Existing deployments may use a differently named volume (for example docker_postgres_data). Do not assume a fresh default volume is your old database. After backups, supply an explicit operator override mapping postgres_data to the reviewed existing external volume. Phase 02's local workflow only creates its own development volume; no existing volume was deleted or migrated automatically.

## HTTP/realtime/client compatibility

Existing /api/auth, /api/admin and /api/proxy handlers remain; /api/v1 provides the same behavior. Success fields and HTTP status codes remain; errors retain error:string and existing codes, adding default code and requestId where absent. Login validation now uses the shared schema (same username/password/device shape); error text becomes Request validation failed with safe field/rule details. New /api/v1/meta is public and reports enforcement as external. New clients should prefer v1 and tolerate additive response fields. No sunset is scheduled for legacy paths.

Socket.io clients must send auth.token at handshake. Admin's existing handshake already does; desktop Terminal now passes its session token. join_admin and force_logout recheck an active session/role. The legacy socket map/force_logout notification is not a complete durable session inventory/revocation implementation; use the existing REST force-logout path for DB state. Full token rotation, current-account/role revocation and device attestation remain tracked defects. Unique jti values fix same-second mint collisions; session expiry now follows the configured JWT expiry. Old valid access tokens remain verifiable under unchanged secrets.

The admin Socket.io script is served same-origin, and row actions use DOM listeners to work with CSP. This is not a complete XSS remediation of legacy HTML rendering. Android endpoint configuration was centralized but missing screen/native implementations remain. No generated Dart/Rust dependencies are required by JSON schemas.

## Rollback

Use reviewed revert commits/artifacts, never force-reset shared history. An old backend can use the preserved original tables; schema_migrations is additive. Reverting requires reviewing config/startup/secret behavior, not blindly launching insecure defaults. No automatic down migration or volume deletion is provided. If future data changes require backup restoration, approve the loss of newer writes explicitly. Keep the previous artifacts and out-of-band network access before deployment; no production deployment was performed here.
