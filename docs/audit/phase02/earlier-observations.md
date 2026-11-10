# Earlier Phase 02 observations

This note transcribes successful tool-run observations from the Phase 02 working session on 2026-11-09. It is not a machine-generated final-source verification record. The final captured outputs/input hashes are in verification.json; Docker availability changed during later verification.

- npm run test:integration --prefix backend: 1 suite, 4 tests passed after unique JWT IDs were added. Real PostgreSQL15 checked matching legacy-schema adoption/preserved rows, concurrent/repeat migrations, transactional DDL/history rollback, checksum rejection, both login API paths, filtered IP-log SQL and missing/revoked/live-admin Socket.io authentication. Later edits added bounded fixture DB timeouts and diagnostics; do not infer an identical final-source rerun from this note.
- Docker image builds completed using the existing technology stack and tested Node22/Nginx/PostgreSQL inputs. Local Compose reached healthy PostgreSQL, backend and Nginx; the one-shot migration exited successfully. Host npm run migrate later reported versions:[] as a no-op rerun.
- nginx -t succeeded inside the local edge container. Fetches through http://127.0.0.1:8180 returned200 for /health, /ready, /api/v1/meta, /admin/ and /socket.io/socket.io.js.
- The initial8080 host port was refused by Windows; an explicit loopback8180 bind succeeded. The development override now exposes a configurable admin port without changing host port reservations.
- During Docker network recreation, reused container DNS aliases were lost; recreating the owned development containers restored aliases while retaining the named PostgreSQL volume. Subsequent final verification was interrupted by Docker Desktop becoming unresponsive, followed by an absent engine endpoint after resuming on2026-11-10. No volume deletion or host firewall/routing change was performed.

These observations establish useful implementation evidence, not production TLS, VPN, Android, installer/signing or enterprise security acceptance.
