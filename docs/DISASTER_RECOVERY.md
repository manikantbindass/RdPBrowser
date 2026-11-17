# Backup, restoration and disaster recovery

This procedure covers the single-VPS topology in [OPERATIONS.md](OPERATIONS.md). It deliberately separates artifact rollback, database restoration, identity reconciliation and gateway recovery. Rehearse on an isolated host before accepting production RTO/RPO. Never exercise network faults on the developer's host or on a live gateway as an automated test.

## Protect recovery material

Maintain an age recovery identity on a separate, access-controlled recovery workstation or offline medium. The VPS needs only its public recipient. An attacker with the VPS and a plaintext recovery identity could decrypt all backups; storing them together defeats this boundary. Test a second authorized recovery custodian under your policy. Recovery identities are not generated, committed or published by deployment automation.

```bash
sudo python3 operations/manage.py backup /opt/remoteshield-production
sudo python3 operations/manage.py backup-config /opt/remoteshield-production
```

Database dumps stream directly from `pg_dump --format=custom` into age encryption. Receipts record SHA-256, migration history, source database, duration and completion time. Dump and encryption failures prevent publication of a successful receipt/status. Configuration backups stream a tar archive containing environment settings, scoped secrets, TLS files and release metadata into age. They exclude backups and the recovery identity. Treat decrypted archives as highly sensitive. SHA-256 detects corruption; age authentication and the independently protected decryption identity provide the cryptographic integrity boundary. Receipt metadata is not a separately signed attestation.

Copy encrypted archives **and their JSON receipts** to a separate account/location over an approved authenticated channel. Verify copied hashes and perform a restore using an off-host copy. Configure retention externally (for example daily copies for 30 days plus reviewed monthly copies), account for privacy/deletion requirements and alert on offsite-copy failure. The bundled timer records local backup completion only; it cannot prove an operator's offsite copy or retention policy. Preserve a matching configuration archive and immutable images for every release. Do not delete the only tested recovery point.

Back up gateway material independently: the entire private `RSX_WG_STATE_DIR` (default shown by the network runbook), server key, peer registry, revoked-peer history, addresses, interface/firewall/DNS configuration and public endpoint metadata. Quiesce peer changes or take a consistent filesystem snapshot, then stream the protected directory through `tar | age` to an independently protected destination. Do not include a decryption identity or expose keys in command output. Preserve the most recent revocation ledger separately from historical snapshots. Application database backups do not contain or recover WireGuard state.

## Artifact rollback

```bash
sudo python3 operations/manage.py rollback /opt/remoteshield-production
# Or choose an explicit previously reviewed immutable manifest:
sudo python3 operations/manage.py rollback /opt/remoteshield-production \
  --release /opt/remoteshield-production/releases/PRIOR_RELEASE.json
```

The previous build must pass its runtime DB-role and migration-history checks before any application container is stopped. A schema unknown to that image blocks rollback. The database is preserved; there are no automatic down migrations. For a schema-incompatible release, prefer a reviewed forward repair. If loss of writes after the backup point is accepted explicitly, use a restored database plus reconciliation below. Keep old images available in a private registry; local image IDs do not transfer between hosts reliably.

If deploy fails after stopping writers, keep the service in maintenance, inspect `events.jsonl` and private migration/container logs, record current DB history and artifacts, and choose the compatible prior image or a forward repair. `current.json` advances only after successful startup. A successful health check is not approval to overwrite data. Keep original DB volumes until the recovery is independently verified.

## Restore a fresh database

```bash
sudo python3 operations/manage.py restore /opt/remoteshield-production \
  --archive /protected-copy/POINT.dump.age --identity /protected-recovery/identity.txt \
  --database rsx_restore_incident001
```

The target must be a **new** `rsx_restore_...` database. The tool checks the receipt/hash before creation, refuses an existing target, decrypts directly into a single-transaction `pg_restore`, verifies migration history and writes a protected restore receipt. Failure drops only the database it just created. It never replaces the active database. Use an ephemeral recovery identity delivered under your incident procedure, restrict permissions, and remove its local copy after recovery. CLI arguments include its path, never its contents.

Review restored organizations, row counts, critical policies and audit history. Determine which writes occurred after the backup. Compare current IdP/SCIM directory users and groups, organization offboarding, device revocations, policy versions and access reviews against independent records. Reconcile the WireGuard gateway from its latest revocation ledger before reopening access.

```bash
sudo python3 operations/manage.py activate-restore /opt/remoteshield-production \
  --database rsx_restore_incident001
```

Activation stops the app/edge, points owner/runtime URLs at the verified database, reapplies migrations/grants, then performs a transaction that revokes all restored sessions/refresh hashes, locks all restored users, revokes device trust and provisioning credentials, disables directory/OIDC configurations and removes outstanding enrollment/SSO handoffs. The app is restarted only after these operations succeed. This intentionally creates an identity reconciliation outage. Gateway peers are **not** revoked by this DB transaction; keep ingress restricted until the separate gateway ledger has been reconciled. A failed activation remains a maintenance incident; do not bypass these safeguards to restore availability.

A reviewed local superadmin can be recovered by passing a **new** password through standard input to the owner-only recovery command. It checks the `rsx_restore_` database, active organization, active local superadmin and writes an audit event. It cannot unlock directory-managed users or a normal admin.

```bash
# Run from a secure operator shell; do not put the password in argv, env or shell history.
read -rs -p 'New recovery password: ' recovery_password; printf '\n'
printf '%s\n' "$recovery_password" | sudo python3 operations/manage.py compose /opt/remoteshield-production -- \
  run --rm --no-deps -T migrate node src/db/recover.js unlock USER_UUID ORGANIZATION_UUID
unset recovery_password
```

Reconcile current directory state, reissue SCIM credentials, review/re-enable SSO, re-enroll approved devices and apply present-day revocations. Unlock approved ordinary users through the existing authorized account workflow. Do not bulk-unlock from the historical backup. Verify negative access, cross-tenant rejection, policy distribution, socket reconnect and device/VPN revocation before reopening the edge. Take fresh encrypted DB/configuration backups after reconciliation.

## Replacement-host recovery

1. Restrict cloud ingress to operators; preserve incident evidence and the failed volume. Build a replacement host through a reviewed Terraform plan or the documented manual topology. Do not run `apply` or create paid resources without explicit authorization.
2. Restore a matching repository commit and immutable registry artifacts. Decrypt the configuration archive into a **new protected staging directory**, list/review archive members first and check owner/modes; never extract an unreviewed archive over a running root filesystem. Restore deployment paths/0700 parent permissions, recover TLS or issue a fresh certificate, and recreate an empty `status` directory with mode0755. Adjust `DEPLOYMENT_DIRECTORY` in the environment file to match the final protected root. Restore the independent public backup recipient.
3. Start only PostgreSQL using the reviewed release manifest through `manage.py compose ... --release MANIFEST -- up -d postgres`. Restore the selected encrypted database into a new `rsx_restore_` target. Ensure `current.json` names the reviewed compatible artifacts before activating the restore. Do not bootstrap a second unrelated organization over restored data.
4. Recover the stateful gateway in isolation. Restore the correct endpoint keys/registry, reconcile all newer revocations, review firewall/NAT/IPv4/IPv6/DNS settings, then test authorized and unauthorized peers plus tunnel loss/reconnect. If gateway-key compromise is suspected, rotate gateway/peer trust through a managed re-enrollment rather than replaying old keys.
5. Activate/reconcile the database as above, run readiness and authorization checks, verify backups/alerts and test a restored sample. Update DNS/endpoint routing only after approval and packet-level acceptance. Keep the previous host fenced to avoid duplicate gateway addresses/identities and split-brain provisioning.

## Failure drills and recovery objectives

The isolated Phase 12 harness tests real deployment, DB outage/readiness, crash restart, edge DNS replacement, encrypted backup/restore, corruption/wrong-key/existing-target rejection, artifact rollback, schema-incompatible rollback rejection and restored identity revocation. It uses its own Docker daemon inside mount/network namespaces and deletes only its own temporary filesystem. [Evidence](audit/phase12/operations-lab.txt) records measured timings.

These are small-fixture lab times. Production RTO includes host provisioning, offsite transfer, data volume, operator availability, identity reconciliation and gateway verification; none is bounded by the lab result. Daily successful backups imply up to roughly 24 hours of scheduling data loss plus copy delay, with longer loss if a backup fails. No point-in-time recovery, multi-region failover or zero-downtime schema migration is implemented. Establish agreed RTO/RPO and rehearse loss of an entire VPS and recovery-key custodian before production sign-off.
