# Local development

**Phase 05 identity:** apply migration003/review runtime grants, then follow [IDENTITY_AND_ACCESS.md](IDENTITY_AND_ACCESS.md) for private OIDC config, HTTPS requirements and policy bootstrap/recovery. `node scripts/verify-phase05.mjs` runs lint/unit/OpenAPI and real PostgreSQL identity suites before commit. If Docker is unavailable on Windows, its documented ignored/loopback PostgreSQL fallback runs the same database tests without changing existing DB/volumes. No live IdP credentials are generated.

**Phase 04 upgrade:** existing settings require distinct restricted runtime credentials before starting the new backend. Follow [MIGRATION_PHASE04.md](MIGRATION_PHASE04.md); do not reuse the previous superuser URL as DATABASE_URL. Fresh setup-dev generates migration/runtime URLs and both Compose passwords. Compose public registration defaults false; set REGISTRATION_ENABLED=true only for deliberate local public signup. Registration/session/refresh defects described in the historical Phase 02 instructions below are repaired. Current API schemas are [OpenAPI](../contracts/openapi.json). Local real database checks: `node scripts/test-phase04.mjs` reads ignored owner settings and uses only unique schemas in the dedicated `_test` database. CI runs `npm run test:integration --prefix backend` with an explicit INTEGRATION_DATABASE_URL.

Prerequisites: Node22 (matches CI/container), npm with lockfile support, Git, Docker Engine/Desktop in Linux-container mode and Compose>=2.24.4 (the local override uses !override). Rust/MSVC/WebView2 for Windows native builds; Linux/macOS need their respective Tauri toolchains. For Android builds use the toolchain and commands in [ANDROID_OPERATIONS.md](ANDROID_OPERATIONS.md).

Run from the repository root. Windows with Docker Desktop: use `$env:DOCKER_CONTEXT='desktop-linux'` in this shell, or prefix Docker commands with `docker --context desktop-linux`. The agent did not change your global Docker context. Linux/macOS can use their normal context.

## First setup

```powershell
node scripts/setup-dev.mjs
npm ci --prefix backend
npm ci --prefix desktop
npm run config:check --prefix backend
docker compose --env-file docker/.env -f docker/docker-compose.yml -f docker/compose.dev.yml config --quiet
docker compose --env-file docker/.env -f docker/docker-compose.yml -f docker/compose.dev.yml up -d --build --wait
```

setup-dev generates ignored backend/.env, docker/.env and desktop/.env.local with distinct random secrets and one local DB password. It refuses to overwrite any existing config. If configuration already exists, preserve it and compare against the templates/MIGRATION_PHASE02; keep the local DB passwords synchronized. Never reset a populated volume merely because credentials changed. Files are created with mode0600 where supported; Windows ACLs remain OS-managed. No generated secret is printed or committed.

The full stack runs a one-shot migrator, then a ready backend, then Nginx/admin. Visit http://127.0.0.1:8180/admin/ and check http://127.0.0.1:3001/ready or /api/v1/meta. Local URLs are HTTP by design, published only on loopback. VPN_REQUIRED=false, device binding disabled and experimental SSH disabled are explicit development choices; they do not prove managed routing or provide a default admin account. Register a normal test user through /api/v1/auth/register then login; refresh/registration session defects from Phase 01 remain open. Admin bootstrap must use reviewed provisioning; no default admin password is invented.

If Windows reserves the chosen port or another service uses it, set DEV_ADMIN_PORT in docker/.env and update CORS_ORIGINS to the same exact origin. The default8180 was verified on this host; no host reservations or firewall rules were changed. Keep loopback publication intact.

## Hot-reload backend / desktop instead of container backend

```powershell
# Stop only the backend/edge containers if the full stack is already running:
docker compose --env-file docker/.env -f docker/docker-compose.yml -f docker/compose.dev.yml stop backend nginx
# Keep PostgreSQL; initialize/verify its schema explicitly:
docker compose --env-file docker/.env -f docker/docker-compose.yml -f docker/compose.dev.yml up -d --wait postgres
npm run migrate --prefix backend
npm run dev --prefix backend
# In another shell, frontend only:
npm run dev --prefix desktop
# Or Windows Tauri debug (same endpoint as desktop/.env.local):
$env:REMOTESHIELD_SERVER='http://127.0.0.1:3001'
npm run tauri:dev --prefix desktop
```

Run either host backend or container backend on3001, not both. Default native debug endpoint is127.0.0.1:3001; release Rust requires an HTTPS REMOTESHIELD_SERVER (runtime or build-time). Frontend VITE_SERVER_URL is public config, never a secret. Keep both origins aligned. Nginx admin is same-origin by default and loads its Socket.io client from the backend instead of an external CDN.

## Checks

```powershell
npm run lint --prefix backend
npm test --prefix backend -- --runInBand --detectOpenHandles
npm run build --prefix desktop
cargo fmt --manifest-path desktop/src-tauri/Cargo.toml -- --check
cargo test --locked --offline --manifest-path desktop/src-tauri/Cargo.toml
cargo clippy --locked --offline --manifest-path desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
```

For a fresh Rust cache use cargo fetch --locked on an approved network before offline checks. Windows native debug compilation: `npm run tauri --prefix desktop -- build --debug --no-bundle --ci -- --locked --offline`. This does not verify release installers, signing or GUI protections.

Real integration tests require a separate database named with suffix _test. They create/drop only a unique test-owned schema, preserve development data, and do not infer a production target:

```powershell
docker compose --env-file docker/.env -f docker/docker-compose.yml -f docker/compose.dev.yml exec -T postgres createdb -U remoteshield remoteshield_phase02_test
# Set privately to the local DB URL with the same password as backend/.env:
# INTEGRATION_DATABASE_URL=postgresql://remoteshield:<password>@127.0.0.1:5432/remoteshield_phase02_test
npm run test:integration --prefix backend
```

For a repeatable local verification record after the stack and dedicated test DB exist, run `node scripts/verify-phase02.mjs` (on Windows set DOCKER_CONTEXT=desktop-linux in that shell). It reads ignored local settings without printing credentials, runs the checks above plus integration/edge probes and records exit codes/output/input hashes in docs/audit/phase02/verification.json. Any failure stays nonzero; missing Docker/DB is not silently skipped.

The new Architecture baseline workflow executes unit/contract and real PostgreSQL integration tests on Node22; failures are not ignored. Integration suite checks legacy adoption/preservation, repeat/concurrent migrations, rollback/checksums, legacy/versioned HTTP login, filtered SQL and Socket.io missing/revoked/valid sessions. CI test credentials are fixtures only.

## Android and production limits

Android uses a public SERVER_URL Dart define through lib/config.dart. Emulator host access uses10.0.2.2, physical devices require an explicit reachable test endpoint; loopback8180 is not remotely exposed. Supply `flutter run --dart-define=SERVER_URL=https://your-test-endpoint` with an administrator-provisioned VPN profile. Phase 02 does not claim an Android build passes.

Production uses docker/docker-compose.yml without compose.dev.yml, a reviewed docker/.env based on .env.example, real certs at docker/certs/tls.crt and tls.key, strong secrets and VPN source policy. Run config:check with deployment settings, verify TLS and actual ingress/source addresses, and follow MIGRATION_PHASE02 before upgrading existing data. Do not run the privileged VPN setup script as a local-development step.

Stop local containers with `docker compose --env-file docker/.env -f docker/docker-compose.yml -f docker/compose.dev.yml stop`. Volumes and configuration remain. Do not use down -v as routine cleanup or recovery. Logs go to JSON stdout; Docker logs may contain identifiers, so redact before sharing. Use config --quiet rather than printing expanded Compose secrets.
