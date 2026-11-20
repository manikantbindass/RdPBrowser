# Phase 02 plan

Start: 9548c04, dedicated branch codex/remoteshield-enterprise-completion. Baseline backend lint and 12 tests pass. Preserve Rust/Tauri/React, Flutter/Dart, Express/PostgreSQL, Socket.io, WireGuard, Nginx and Docker. Keep one backend deployable; no Kubernetes, Redis, microservices or broker.

1. Split HTTP composition, realtime/SSH transport, bootstrap/lifecycle, database/migration adapter, configuration and logging into explicit modules. Keep existing routes and response shapes compatible.
2. Validate configuration once at startup/CLI; exact origins, explicit trusted proxies, explicit DB TLS mode, mandatory strong production secrets. Add development and production templates with environment parity.
3. Add language-neutral JSON Schema contracts for organizations, users, devices, sessions, policies and events; define persistence mapping and future integration ports without enabling tenant APIs. Add /api/v1 and legacy aliases; additive standard errors/request IDs; shared login/navigation contracts and tests.
4. Add checksum-verified, transaction/advisory-lock migrations with a baseline adoption path and no destructive auto-rollback. Separate migrate from serve; fail readiness when DB/schema is unavailable. Preserve existing tables and data.
5. Provide loopback-only development Compose, reproducible npm/locked Rust commands, backend image with correct module layout and migration workflow, Nginx development wiring plus explicit production TLS requirements. Attempt real database/container verification; report environment blockers honestly.
6. Add ADRs, dependency/data-flow Mermaid diagrams, ownership and extension documentation. Test configuration, contracts, compatibility/errors, lifecycle and migrations including real PostgreSQL where available. Refresh status/defect docs, commit and push verified work; do not merge main.

Out of scope: missing Android screens/native features, network kill-switch implementation, full token rotation/tenancy enforcement, production SSH/device trust redesign, unrelated dependency upgrades and production deployment. Existing security gaps remain documented; disabled experimental transports must be explicit flags with a migration note.
