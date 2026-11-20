# Phase 12 deployment and operations plan

The VPS deployment already uses Compose, PostgreSQL, one Express/Socket.IO backend, Nginx and a separate stateful WireGuard gateway. Backend runs as UID 1001. Migration checks, request IDs, structured application logs and graceful shutdown exist. The current edge runs as root, service resource and log limits are absent, production secrets are interpolated into container environments, and there is no repository backup/restore workflow or operational telemetry endpoint. Nginx resolves the backend name at startup, so container replacement can leave a stale upstream address.

1. Establish the existing backend/database/browser baseline. Retain one supported backend replica and the existing VPS/Compose topology.
2. Add production/staging profiles with scoped file secrets, read-only application filesystems, non-root edge containers, resource/log limits and hardened TLS. Verify backend replacement and address re-resolution.
3. Add authenticated internal metrics, process and database health, sampled request/database traces, a private operational dashboard, and a host health observer with durable alert transitions.
4. Implement encrypted PostgreSQL backups, restore into a fresh isolated database, checksum verification, restored-session revocation, deployment and schema-aware artifact rollback. Keep gateway identity and routing recovery explicit.
5. Add a documented DigitalOcean Terraform target and offline/static validation. Define capacity and cost assumptions from measured lab results and official pricing. Provisioning remains an operator action.
6. Test real containers in a disposable Linux environment for deployment, restart/crash, database outage, backup/restore, rollback and load. Retain test outputs and limitations, update runbooks and commit verified changes.

The production topology stays on a single VPS unless measured requirements justify additional coordination. Socket.IO notifications and in-memory request limits are process-local. WireGuard identities, firewall state, routing, DNS and peer revocation need an independent stateful scaling/recovery design. No paid cloud resources are authorized.
