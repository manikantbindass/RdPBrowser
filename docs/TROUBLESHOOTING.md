# Troubleshooting

Start with the affected platform, source revision, timestamp and the request ID if available. Keep tokens, private keys, full browsing histories and customer data outside support messages.

| Symptom | Check | Recovery |
| --- | --- | --- |
| Setup says local configuration exists | Check whether `backend/.env`, `docker/.env` or `desktop/.env.local` already belong to a configured stack. | Preserve the files and compare names, origins and database settings privately. A new password file does not change an existing database role. |
| Compose rejects the override or binds an unexpected port | Check Linux-container context, Compose version, merged config and local port ownership. | Use Compose 2.24.4 or later and the documented loopback override. Keep production and staging separate. |
| `/health` passes but `/ready` is 503 | Inspect migration job, PostgreSQL TLS and the restricted runtime role. Check schema checksums and current release. | Correct the configuration or restore the last compatible image/schema. Preserve database volumes and backups. |
| Login returns 401 or repeated refresh fails | Verify origin and organization, active session, lock state and clock. A refresh grant is single use. | Sign in again and contact the administrator if the account or session was revoked. |
| Request returns 403 | Check source admission, role, MFA, session policy, device trust and URL policy. | Confirm each gate independently. Verify actual peer routes, resolver and IPv6 before changing a network policy. |
| Console cannot load or realtime stalls | Check Nginx same-origin requests, backend readiness and the token/session. | Reauthenticate and reload stored views after reconnect. Realtime events supplement persisted state. |
| Desktop browser closes a tab or denies a download | Recheck the connection, policy and session. Downloads have an explicit HTTPS/plain-text limit. | Reopen using a refreshed authorized session. Use the approved external workflow for other file types. |
| Android reports no managed VPN | Verify the appropriate Android profile, both default routes, resolver, lockdown and API source admission. | Use the approved provider and managed settings. Check the device and profile scope with the administrator. |
| Native build fails on Linux or Windows | Check WebKitGTK/D-Bus dependencies on Linux, MSVC/WebView2 on Windows, the Rust lockfile and Node version. | Use the platform packages listed in the corresponding workflow. Check the Android SDK path and Java version for Flutter. |
| Preview verifies but release still fails | Check the aggregate quality job, exact source/tag, signing and publication approvals and RC evidence. | Address blocking scan findings and complete environment configuration before a signed release. |

For a local stack, these commands identify the first failed dependency. Review logs on the trusted workstation.

```sh
docker compose --env-file docker/.env -f docker/docker-compose.yml -f docker/compose.dev.yml ps
curl --fail --show-error http://127.0.0.1:3001/ready
```

[Deployment and rollback](DEPLOYMENT.md) · [WireGuard and DNS recovery](DEPLOYMENT.md) · [Release process](RELEASE_PROCESS.md) · [Security reporting](../SECURITY.md)
