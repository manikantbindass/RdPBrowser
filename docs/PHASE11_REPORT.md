# Phase 11 enterprise integrations and governance

**Status: PARTIAL for production acceptance.** The implemented integrations and governance workflows pass the local tests below. Live Okta and Entra tenants were unavailable for an interoperability acceptance run. The optional webhook deliverable is a signing, verification and retry design with tested protocol helpers. Delivery infrastructure remains a future integration.

## Delivered

- Extended the existing OIDC code and PKCE flow with sanitized provider inventory, server-side discovery validation, revision-checked activation, current provider checks on new sessions, and an origin-bound console handoff. The credential-free examples cover Okta and the single-tenant Microsoft workforce issuer. Local administrator links remain explicit. Optional `sub` or tenant-checked Entra `oid` binding can link only accounts provisioned in the configured directory.
- Added a tenant-scoped SCIM 2.0 subset for users and groups. Expiring, revocable directory credentials use hashed storage and a one-time disclosure. Mutations preserve directory ownership and commit with audit. Deactivation and changed group entitlements revoke live application sessions atomically. Assigned groups can apply versioned URL policies or, when a superadmin approves the mapping, confer the local administrator role.
- Added independent access-review campaigns with refreshed snapshots, stale revision detection, manual revocation and append-only decision evidence. The console reports server registry posture and approval expiry, and can download scoped JSON audit, administrative, review, policy and inventory evidence with digests and receipts.
- Added an owner-only onboarding/offboarding command with explicit tenant filters, including under an RLS-bypassing owner. It revokes application access and returns device IDs for separate WireGuard gateway action. Provisioning can use a dedicated TLS ingress containing only the SCIM routes.

Existing password and OIDC JSON flows, device trust, local user provisioning, tenant API aliases, policy assignments, audit and the detection console remain available. The new SSO handoff keeps application tokens in tab memory and out of the redirect URL. Reference Nginx access logs omit query strings. Core native, control and network technology remains in place.

## Verification

| Check | Result |
|---|---|
| Baseline before behavior changes | 138 backend unit tests, 39 real database integration tests, 3 component tests and 7 Chrome scenarios passed |
| Backend ESLint | Pass with zero warnings |
| Backend unit/config/contract/security tests | 142 passed across 15 suites |
| Real PostgreSQL 15.19 migrations and API integration | 48 passed across 5 suites |
| Console component and real Chrome tests | 3 component tests and 9 browser scenarios passed |
| Accessibility | No axe violations in the tested integration and governance views |
| Linux network namespace TLS test | Certificate verification, header overwrite, credential forwarding, and control/admin/WebSocket path isolation passed |
| ShellCheck | Isolated ingress test script passed |
| Compose and OpenAPI | Dev and production SCIM override render. The generated 85-path OpenAPI document validates without regeneration drift. |
| README and limited secret signatures | 104 local links and 14 assets passed. No private-key, GitHub-token or AWS-key signatures found in the scanned current tree. |
| npm advisory checks | Backend still reports 1 high and 1 moderate finding in the GeoIP chain. Console reports zero. |

Real database tests cover scoping by organization and directory, ordinary-user and peer privilege boundaries, token expiration/rotation, wrong credential kind, malformed operations, group role and URL policy effects, late and repeated patches, soft deletion, stale review state, cross-tenant cursor tampering, independent review, immutable evidence, data integrity and offboarding recovery. A forced audit write failure proves deactivation and its session revocation roll back together and retry succeeds. The upstream protocol fixtures use real signatures, PKCE and PostgreSQL. They exercise discovery failure, reactivation, Entra signed `tid` and `oid` binding to an actual SCIM-created account, deprovisioned sign-in rejection and the one-use administrator handoff. The live browser tests verify directory credential issuance and use, group policy assignment, access review creation and downloaded JSON digest verification against the real API.

The local test hosts were Windows with Node 24.14.1, disposable PostgreSQL 15.19 and Chrome, plus the isolated Linux guest for Nginx. Hosted acceptance targets Node 22, PostgreSQL 15 and Chromium. See [test output, source hashes and command evidence](audit/phase11).

## Files, requirements and limitations

Main changes include migration 006, directory/group and SCIM services/routes, provider setup/handoff, governance changes/reviews/exports, the organization operator CLI, browser governance views, the dedicated SCIM TLS edge, OpenAPI, OIDC examples, tests and an architecture decision. See the [changed-file inventory](audit/phase11/changed-files.txt).

Apply migration 006 and renew restricted runtime grants before deployment. Provisioning stays off until explicitly configured, and new provider examples require validation and activation. The stable subject binding, provisioning source and privileged groups must be verified on the real tenant. The Entra integration supports an exact single-tenant workforce authority. SCIM implements documented bounded filters and mutation shapes. Full provider marketplaces, native SSO, arbitrary extensions, nested groups and live MDM attestation remain outside the verified set.

Evidence supports organizational control review and SOC 2 readiness. The organization still owns entitlement reconciliation, evidence retention and integrity, exception review, separation of duties, provider credentials, device posture, WireGuard peers and assessor coordination. The exports contain confidential business and personal information, and their digests are an integrity aid rather than an independent signature. No SOC 2 certification is claimed. The pre-existing GeoIP maintenance-chain dependency findings and the separate Android runner SDK issue remain rollout risks recorded in Phase 10.

Development branch `codex/remoteshield-enterprise-completion` extends [draft PR #3](https://github.com/manikantbindass/RdPBrowser/pull/3) targeting `main`. Commit and hosted run references are recorded with the delivery and in Git history. [Setup, security responsibilities and recovery](ENTERPRISE_GOVERNANCE.md)
