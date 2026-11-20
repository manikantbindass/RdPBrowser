# ADR 0005 — standards identity, live authorization and bounded device evidence

Status: accepted for Phase 05 implementation; production/provider/client acceptance remains open.

Keep one Express/PostgreSQL control plane and forced tenant RLS. Use the maintained openid-client library for confidential OIDC code/PKCE flow and explicit signature verification rather than implementing a custom JWT/OAuth identity provider. Providers are operator-controlled HTTPS configuration, bound to one organization and exact issuer/client/redirect; stable subject links map to existing local users without email/role auto-provisioning.

MFA is an assurance assertion from a validated provider ID token under reviewed provider-specific acr/amr mappings, not a client checkbox or local password claim. Require fresh provider authentication and current organization policy; unsupported/missing assurance fails closed when required. Separate provider MFA time, local access expiry, refresh family/absolute lifetime and idle activity. Consumed refresh replay revokes the family even if concurrent legitimate refreshes then need login.

Evaluate live identity/role/organization/session/device against server-owned resource sensitivity for REST and realtime. Persist server decisions separately from untrusted client events and atomic mutation audits. Preserve a clearly labeled legacy compatibility policy by default to avoid silently stranding existing clients; enterprise policy activation has bootstrap checks and a documented privileged recovery path.

Device external IDs are not proof. Add immutable public-key enrollment, session-bound one-use signature challenges and separately reviewed/expiring admin posture. This bounds current evidence without claiming hardware/MDM attestation or per-request sender-constrained bearer tokens. No Redis, broker, new service topology or proprietary vendor SDK is justified.

Consequences: more database work per authenticated request; production load/retention review remains necessary. Native SSO handoff/UI, secure private-key storage/attestation, DPoP/mTLS, SCIM/backchannel logout, provider-specific authentication context and live Okta/Entra acceptance require separate implementations and tests. Operators must own claim mappings, secret rotation, TTLs and recovery; no production credentials or universal MFA preset is invented.
