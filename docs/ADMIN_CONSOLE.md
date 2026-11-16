# Admin console operations

Phase 11 adds Integrations and Governance. Administrators can review provider/directory state, run independent access reviews and export evidence. Superadmins can validate and activate SSO providers, issue/revoke scoped directory credentials and set mappings. Apply migration 006 and reviewed runtime grants. The console now accepts an administrator SSO handoff from the same HTTPS origin. [Setup and responsibilities](ENTERPRISE_GOVERNANCE.md)

Phase 10 expands Risk & alerts into a deterministic incident queue with worker health, confidence/explanations, evidence and review history, revision conflict checks and manual account/session containment. New incident notifications use the existing tenant-authorized Socket.IO channel; reconnect recovery uses the persistent queue. Deploy migration 005 and reviewed runtime grants. See [detection operations](DETECTION_AND_RESPONSE.md) for enablement, limitations and rollback requirements.

The console is served at `/admin/` by the existing Nginx deployment. It calls the versioned API on the same origin and uses authenticated Socket.IO notifications. The current backend needs checksummed migrations through `006_enterprise_governance.sql`. Run the migration task and renew runtime grants before startup. Back up the database and verify restoration before rollout. Older application images reject migration history newer than their build.

## Access and controls

Use an administrator or superadmin account in the intended organization. Password sign-in supports an optional organization UUID. Enterprise SSO uses the configured provider ID and the same HTTPS origin as its callback. The server enforces administrative roles, MFA and the organization access policy for both sign-in paths.

- Administrators can manage ordinary accounts. Superadmins can also promote and demote subordinate accounts. The console cannot assign the superadmin role.
- A role change or account lock revokes the affected user's active sessions. A password change requires the administrator's current local password, is rate limited, revokes all of that administrator's sessions and requires a new sign-in. Identity provider credentials remain managed by the provider.
- Device approval is an operator decision with a one-hour validity in the console and needs an enrolled public key. Quarantining or revoking an application device revokes its associated application sessions. Revoke the WireGuard peer separately through gateway operations.
- Policy assignments apply to the whole organization, up to 100 existing users or up to 100 directory groups. User and group assignments use the current subject's ID and direct group memberships. Deny rules win and every applicable nonempty allow group must match. The legacy block list remains organization-wide.
- The initial history entry represents the latest revision available at migration. New edits write a snapshot of rules, activation state and assignment in the same transaction as the policy and audit entry. A stale editor must reload after a revision conflict. The application database role cannot update or delete snapshots.
- The VPN health page reports this request's source admission, API/database readiness and recent tenant URL observations. It also reads an optional gateway snapshot and counts only peers whose device UUID matches a device in the signed-in organization. Inspect kernel routes, DNS and packet capture using the network operations guide.

The overview chart uses seven UTC buckets. It separates server authorization denials from unverified client security reports. Source telemetry covers requests that reached the logged navigation route. Alerts reflect stored anomaly detections. The console never generates sample activity in deployed mode. Tokens are held in the current tab's memory. Reload the tab to start a new sign-in, and use Sign out to explicitly revoke the current server session.

## Gateway observation feed

Publish `peerctl.py status` to a dedicated read-only directory visible to the backend. Use a scheduler on the gateway every 30–60 seconds. Write a temporary mode-0640 file with a backend-readable group and rename it atomically to `status.json`. The directory and writer must be controlled by the gateway operator. Use a read-only directory mount for Compose so atomic replacement is visible, then set `VPN_PEER_STATUS_FILE` to the absolute container path. The backend user needs read and directory traversal permissions. Only the status JSON is distributed, and it contains no private keys.

The console reports unconfigured, unreadable and stale feeds explicitly. Snapshots expire after two minutes. A recent handshake is one observed within three minutes, including snapshot age. Export the gateway inventory using the same UUIDs as enrolled application devices. A WireGuard peer without a corresponding organization device is excluded from the organization's summary. Operator trust in the snapshot publisher remains required.

## Verification

Install the backend and test dependencies from their lockfiles. The browser suite requires Chromium and a disposable loopback PostgreSQL database whose name ends in `_test`. It creates and cleans up its own schema and restricted role.

```sh
npm ci --prefix backend
npm ci --prefix admin-dashboard
npm test --prefix admin-dashboard
cd admin-dashboard
npx playwright install chromium
npm run test:browser
```

Set `INTEGRATION_DATABASE_URL` in the environment before the browser suite. Use `ADMIN_CHROME_PATH` to point at an installed Chromium or Chrome executable. The same fixture seeds only local test records. Test screenshots live in the ignored test-results directory.

[Network operations](NETWORK_PROTECTION.md) · [Phase 09 verification](PHASE09_REPORT.md)
