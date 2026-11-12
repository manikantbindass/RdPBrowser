# Phase 05 — identity and access control

Baseline audit (2026-11-12): Phase 04 has persisted hashed sessions, one-use refresh rotation, live account/role/organization checks and forced tenant RLS. The 53 existing unit tests pass. Gaps: no OIDC/MFA, no possession proof for devices, no access policy decision model/decision log, refresh extends lifetime indefinitely and does not recheck revoked device state. Docker remains unavailable locally; no database check is counted as passing without real PostgreSQL evidence.

Plan:

1. Add migration003 for organization access policies, immutable identity links, bounded OIDC transactions, refresh families/absolute lifetime, device key challenges/trust and server-owned access decisions. Preserve legacy default-organization aliases and existing password hashes.
2. Extract reusable session issuance, add bounded idle/absolute expiry and refresh-family replay revocation, then enforce a shared decision model across REST/realtime using live identity/role/organization/device/session and server-classified resource sensitivity.
3. Use pinned standards-based openid-client with discovery, signed ID-token verification, PKCE S256, state, nonce, browser binding, exact issuer/audience/redirect, short-lived single-use state and no email/role auto-linking. Provider configuration is operator-controlled; secrets come from the environment. MFA requires provider-specific validated assurance claims; local password claims never establish MFA.
4. Add authenticated device-key enrollment/challenges and explicit admin trust transitions with expiry. An external device ID alone never satisfies a trusted-device requirement; key possession is not hardware attestation.
5. Add negative unit/real-PostgreSQL and OIDC protocol tests, update OpenAPI/config/flow/migration documentation, run lint/tests/security checks, and commit only after relevant checks pass. Missing production IdP tenants/credentials or real-provider acceptance is documented rather than simulated.

No Kubernetes, broker, Redis, custom identity provider, native attestation implementation or production credentials are introduced. Default legacy policy remains a documented compatibility profile; operators must explicitly enable their reviewed enterprise MFA/device/session policy.
