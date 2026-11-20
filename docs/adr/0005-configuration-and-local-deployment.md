# ADR 0005: explicit configuration and reproducible local deployment

Status: accepted in Phase 02.

Preserve the exact http://tauri.localhost UI origin in production when configured: [Tauri 2 uses this Windows custom-protocol origin by default](https://v2.tauri.app/start/migrate/from-tauri-1/). Other HTTP production origins are rejected. This is an origin allowlist exception, not permission to use plaintext remote API transport; the native release control-plane endpoint still requires HTTPS.

Central Joi configuration validates startup/CLI input, exact origins, numeric/boolean ranges, distinct secrets, CIDRs, expiries and explicit DB TLS trust. Error output names invalid keys without exposing values. Unknown environment entries are ignored. Legacy DASHBOARD_ORIGIN remains accepted as one exact origin; path values are rejected. Most backend environment reads now use one validated immutable object; healthcheck and environment loading are standalone bootstrap utilities.

Production rejects placeholder/same/short secrets, VPN_REQUIRED=false, plaintext database transport without explicit private-network trust, missing origins and experimental SSH. DB_SSL_MODE=verify-full verifies peers using system/custom CA; disable requires an intentional production private-network decision. Never restore rejectUnauthorized=false. TLS edge certificates are operator-provided, not generated or falsely reported as valid.

setup-dev.mjs generates unique local credentials into ignored files once, never overwrites existing files, and does not print secrets. Development Compose publishes only loopback ports and explicitly sets VPN_REQUIRED=false; it is not a managed deployment. Production uses a separate TLS edge template and no DB/backend host port. Packages use npm ci; Rust uses Cargo.lock/--locked. Container versions are pinned to the tested inputs; refresh via reviewed rebuilds, not silent dependency upgrades.

Backend logs are JSON to stdout for host/container collection. Request logs contain route pattern, method, status, duration and server-owned correlation ID, not query/body/Authorization. Structured fields with credential/token/password names are redacted. JSON error bodies keep legacy error strings plus stable code/requestId and never expose internal DB/parser failures. CLI/OS logs remain separate streams; this is not a tamper-proof audit sink or universal secret scrubber for arbitrary text.
