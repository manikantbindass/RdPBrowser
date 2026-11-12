# Phase 05 — enterprise identity and access controls

Date: 2026-11-12. Branch: `codex/remoteshield-enterprise-completion`. [Draft PR #3](https://github.com/manikantbindass/RdPBrowser/pull/3), target main. Overall status: **PARTIAL**. Backend implementation and automated identity/access acceptance are delivered; live enterprise-provider/native-client/device acceptance and production security review remain open. No production identity-provider credentials were invented, and no main merge/deployment was performed.

## Audit and implementation

Audited the existing Phase 04 authentication, hashed token/session storage, tenant middleware/RLS, migrations/runtime grants, route roles, realtime authorization, device registry, configuration/logging and unit/real-database suites. Baseline53 unit tests passed before changes. Existing refresh rotation and tenant isolation were extended incrementally rather than replaced.

| Requirement | Implemented behavior / evidence |
|---|---|
| Authentication/token lifecycle | Extracted session service, explicit access-token type, live identity/org/session/role checks, absolute and idle lifetimes; original password hashes and compatibility aliases retained |
| Refresh rotation/revocation | Stable refresh families and absolute/authentication/proof times; single-use token hashes; consumed-token replay commits family revocation instead of rolling it back |
| Session termination/expiry | Local logout/admin lock/unlink/device quarantine/revocation terminate applicable sessions; expired JWT, idle and absolute expiry negatives; sensitive realtime deliveries use the same live policy |
| RBAC / organization authorization | Existing user/admin/superadmin roles, organization-scoped admin privileges and strict allowed-role policy; provider roles ignored; forced RLS/composite tenant foreign keys extended to new identity tables |
| OIDC SSO | Pinned openid-client6.8.9; confidential code/query flow, PKCE S256, state+nonce, secure browser binding, encrypted single-use state, explicit RS256 JWKS signature verification, exact issuer/audience/time/redirect and stable subject link |
| MFA | Only validated IdP assurance claims under reviewed provider-specific acr/amr mappings can mark OIDC sessions MFA-verified; local passwords/client booleans cannot satisfy it; MFA age preserved across refresh |
| Device registration/trust | Existing registry retained; immutable owner P-256 public-key enrollment, session-bound one-use signature challenges, unknown/approved/quarantined/revoked states, expiring admin posture and proof freshness |
| Access/session policy | Versioned organization configuration and server-owned low/medium/high resources; checks identity, role, org, device owner/posture/key proof, method/MFA and live session; invalid policy/unknown resource denies |
| Access event logging | Server-owned append-only access_decisions, request IDs/reasons/policy revisions; anonymous failures emit safe structured access.denied; client security events remain explicitly untrusted |

Important fixed defects: refresh no longer extends authentication/absolute/proof indefinitely; replay revokes the surviving family; refresh rejects expired policy/session and invalid devices; known quarantined legacy IDs no longer bypass invalid-device lookup; external provider roles/email cannot create or upgrade local users; a string device ID cannot satisfy a trusted-device policy. Device revocation covers both legacy IDs and proven registry IDs. Policy bootstrap checks reduce accidental loss of all administrator access, without inventing a public recovery bypass.

## Preserved functionality and files

Preserved Express/PostgreSQL/Socket.io, existing password/user rows, tenant RLS, `/api` and `/api/v1`, response wrapper keys, admin role names, URL policy evaluator and direct-development profile. No Tauri/Flutter UI, VPN routing/firewall or cloud resources were changed. OIDC is disabled until operator configuration/secrets exist. The no-row default access policy is explicitly a legacy compatibility profile; enterprise MFA/device restrictions need deliberate activation.

New: migration003, access/session/OIDC/config services, OIDC and identity routes, provider example, access/OIDC config unit suites, native signed-OIDC/real-DB integration fixture, isolated PostgreSQL fallback/verification runner, identity flow documentation and ADR0005. Modified: auth/middleware/realtime/device routes, runtime grants/config/logging, manifests/lock, OpenAPI/generator, Compose/templates/ignore rules and feature/architecture/roadmap documentation. The commit diff is the authoritative full file list.

Migration/flow/operator/client details and explicit recovery tradeoffs are in [IDENTITY_AND_ACCESS.md](IDENTITY_AND_ACCESS.md). Read it before changing access policies. Migration003 uses the existing operator migration command and reapplies restricted runtime grants; it never converts legacy IDs into attested device identities. No destructive down migration is supplied.

## Verification and evidence

Run `node scripts/verify-phase05.mjs`. With INTEGRATION_DATABASE_URL it uses a dedicated `_test` database; otherwise this Windows host used the documented isolated PostgreSQL fallback. Full command output/exit codes/source hashes and exact test-binary provenance are in [verification.json](audit/phase05/verification.json); PostgreSQL results are also in [local-postgres.json](audit/phase05/local-postgres.json).

| Check | Actual result |
|---|---|
| Baseline before functionality | PASS53 unit tests |
| ESLint with zero warnings | PASS |
| Unit/config/HTTP/domain/lifecycle/OpenAPI | PASS77 tests /11 suites, including unsafe provider config, role/tenant/device/MFA/session negatives and late async shutdown guard |
| PostgreSQL migration/API/realtime/identity | PASS23 tests /3 suites; final verification record is authoritative |
| Native signed OIDC fixture |19 protocol/lifecycle scenarios inside the identity integration test, with actual openid-client/JWKS/RSA verification and real PostgreSQL/HTTP |
| OIDC negatives | Wrong nonce/audience/issuer/expiry/signature/algorithm/authentication time, missing browser cookie, state replay/expiry, cross-tenant provider mix-up, matching-email unlinked subject and missing MFA rejected |
| Session/device/access negatives | Expired JWT, revoked/idle/absolute sessions, consumed refresh replay, stale proof/posture, invalid signature/replayed challenge, immutable keys, quarantine/revocation, cross-tenant ownership, forged MFA/trust fields and malformed policies rejected |
| OpenAPI |41 paths; parser validation and deterministic generation pass |
| Limited current-tree secret signatures | Zero private-key/GitHub/AWS candidates; not a full history/entropy/security audit |
| Production dependency audit | FAIL:2 existing GeoIP maintenance-chain findings (1 high,1 moderate); openid-client adds no reported production advisory in this snapshot |
| Docker engine / production-container final run | Unavailable locally; no claim that Docker recovered. No existing volume was reset or daemon force-killed |
| Live Okta/Entra, native SSO handoff/attestation, penetration/load/restore | Not performed / unavailable; not counted as passing |

The OIDC fixture replaces only outbound HTTPS provider transport with deterministic metadata/token/JWKS responses and generated keys. It does not mock signature/issuer/audience/nonce/PKCE verification or PostgreSQL authorization. This is automated protocol acceptance, not a simulated production identity provider or evidence of an actual vendor tenant. The native child uses Node's ESM interoperability, outside Jest29's CommonJS loader.

Docker remained unavailable. To meet the requirement to run relevant checks **before committing**, a pinned test-only PostgreSQL15.19 Windows binary package was downloaded into ignored `.local-tests`, initialized with a random password and random loopback port, used only for dedicated test databases and stopped afterward. No existing database or Docker data was changed. Initial Windows process-pipe handling timed out after PostgreSQL had started; the identified test-only instance was stopped, inherited pipe handling was corrected, and subsequent runs completed successfully. An early OIDC harness count assertion exposed14 grouped scenarios against a15 minimum; additional algorithm/browser/auth-time and policy-activation cases were added, yielding19 rather than reducing the assertion or suppressing failures.

Unit coverage output is retained without changing thresholds. Most authenticated paths execute in the separate real-DB suite and the native protocol child, so unit-only coverage is not represented as total combined coverage. Host Node24.14.1 and PostgreSQL15.19 were actually exercised; configured Node22/PostgreSQL15 CI is a separate verification gate after push. No test, analyzer or security check was disabled.

The main identity commit `1a8666a07e03bb1e600f065aa31f205e34237b1a` passed [Architecture baseline on Node22/PostgreSQL15](https://github.com/manikantbindass/RdPBrowser/actions/runs/43211406523): lint/OpenAPI reproducibility,76 unit tests and23 integration tests. A final lifecycle review then added a pool-closed guard so asynchronous OIDC work cannot reopen a database pool after shutdown. Explicit configure begins a new lifecycle; in-flight drain semantics remain. Before committing that follow-up, the full local verification passed again with77 unit tests/11 suites and23 integration tests/3 suites. The final machine record includes this guard and regression test; live-provider acceptance remains separate.

## Security limitations and remaining acceptance

Final code commit `8459103c1b0f244b5a9a47fb0210b2fcb11f57d3` passed [Architecture baseline run43212014411](https://github.com/manikantbindass/RdPBrowser/actions/runs/43212014411): clean install, zero-warning lint, OpenAPI generation/no drift,77 unit tests/11 suites and23 real PostgreSQL integration tests/3 suites, including native signed OIDC. Job steps and decoded logs were read; [github-ci.json](audit/phase05/github-ci.json) records this final source acceptance. This does not convert fixture-provider tests into live vendor acceptance or resolve dependency/security debt. Following changes only record evidence/documentation; the PR stays draft.

1. No production IdP tenant/client credentials were supplied. Actual Okta/Entra discovery/redirect, provider MFA/Conditional Access claim semantics, secret/key rotation, outage and administrator recovery must be validated with the operator. The standards adapter is implemented; vendor-wide presets/certification are not claimed.
2. Native external-browser handoff, SSO UI and secure device private-key/token storage in Tauri/Flutter remain unimplemented integrations. No bearer tokens are put in redirect URLs and no confidential client secret is shipped to clients as a workaround.
3. Device approval is a reviewed operator assertion; ECDSA proof establishes key possession, not hardware identity, malware/root compliance or MDM attestation. No per-request DPoP/mTLS. A copied key or stolen bearer session within its proof freshness window remains a risk. Compatibility mode is deliberately less restrictive and must not be presented as enforced enterprise posture.
4. Local sessions do not instantly follow IdP disable/logout: no SCIM/backchannel logout or provider introspection. Use reviewed lifetimes, local lock/unlink/revocation and future standards adapters. No local MFA recovery/TOTP engine or overlapping JWT keyring is introduced.
5. Two production GeoIP-chain advisories remain, along with prior development/platform findings. Process-local quotas, retention, production load/backup restore/TLS/topology and independent security review remain gates. Runtime append-only logs are not immutable against database operators.

Commit SHA and current review URL are reported at delivery; no self-referential SHA is embedded in its own commit. Only the dedicated branch is pushed. Main requires review and required checks.
