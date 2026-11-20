# ADR 0007 Directory provisioning and governance

Accepted in Phase 11. OIDC external identity validation remains in the existing monolith and uses operator-supplied issuer and credentials. Provider activation is tenant-scoped and bound to the validated configuration fingerprint. Console authorization uses the existing local session after a short, encrypted one-use browser exchange. Existing JSON authentication clients keep their contract.

Separate the SCIM transport from end-user VPN admission. The public TLS listener exposes only the SCIM prefix. The backend binds a hashed, expiring credential to a specific organization and directory and rechecks its revocation state inside mutation transactions. PostgreSQL RLS plus composite foreign keys protect cross-tenant and cross-directory references. An operator-only owner workflow performs organization lifecycle changes with explicit tenant filters even when RLS can be bypassed.

Provision directories without adopting local accounts. Enable stable signed-subject mapping explicitly. Only approved directory group IDs confer a local role, with no path to directory-owned superadmin. Preserve policy assignments and revocation in the same persistence layer. Record durable change and access-review evidence. Use bounded administrative export pages with authenticated cursors and audited content digests. Evidence is confidential and includes a provenance boundary for operator posture.

A future delivery worker can use signed event envelopes and a tenant-scoped outbox. Start with the signing and retry contract until external delivery requirements, egress restrictions and receipt retention are established. [Setup and responsibilities](../ENTERPRISE_GOVERNANCE.md)
