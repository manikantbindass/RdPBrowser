# Administrator guide

Sign in at the deployment's `/admin/` path from an admitted network with the intended organization's account. The loopback URL is `http://127.0.0.1:8180/admin/`. The console keeps tokens in the active tab's memory. Reload can require a new sign-in. Sign out ends the current session. [Bootstrap setup](GETTING_STARTED.md)

## Manage access and devices

| Task | Workflow and authority |
| --- | --- |
| Establish an organization | Use the one-shot operator bootstrap after migrations. Set up an independent administrator and test recovery before adding users. |
| Manage users and roles | Administrators manage ordinary accounts. Superadmins can change subordinate roles. The console excludes assignment of the superadmin role. Role changes and locks revoke sessions. |
| Approve enrolled devices | Confirm organization, user and public key. The console's approval window is one hour. Quarantine or revoke stale or lost devices and confirm associated sessions close. |
| Contain a lost device | Revoke the application device or session, then coordinate separate WireGuard peer revocation and reconcile gateway state. |
| Manage your account | Review settings and use the current local password to change it. The change revokes all sessions for that account. Manage IdP passwords at the provider. |

## Publish URL policy

Create or revise a policy under Policies. Assign it to the organization, selected users or direct directory groups. Review the impact before activating the new revision. Deny rules win. Where several nonempty allow groups apply, the URL must match each group. The legacy block list applies organization-wide. Verify representative allowed and denied URLs using a normal account. Reload policy state if an edit reports a revision conflict. The server stores revisions and audit entries transactionally.

## Review telemetry and incidents

- Overview uses recorded events in seven UTC buckets. Server denials and client reports have different evidentiary weight.
- Sessions and Devices show current application state. Network Health reports API source admission and optionally a read-only gateway status snapshot. Verify handshakes and routes separately when diagnosing a VPN problem.
- Risk & alerts uses deterministic rules when the organization is enabled. Review severity, confidence and original evidence before containment. Record the disposition and verify that a session or account action took effect.
- Use the audit log and access decision views for administrative history. Access reviews and evidence exports have their own scoped privileges. Handle exported records under the organization's privacy and retention rules.

## Configure integrations

A superadmin can validate and activate approved OIDC settings and issue scoped SCIM directory credentials. Test issuer, callback origin, MFA assurance, group mappings and deprovisioning in a disposable provider tenant before rollout. Validate user deactivation and session revocation independently. Store directory tokens in the provider's secret store. The built-in workflows have local fixture coverage. Live Okta and Entra deployment acceptance remains open. See the governance and incident operation endpoints in the [API reference](API_REFERENCE.md); local console scenarios are summarized in [testing](TESTING.md).
