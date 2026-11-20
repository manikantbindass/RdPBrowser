# Security model

RemoteShield X combines application authorization with a managed network path. Its production security depends on the configured TLS edge, runtime database role, endpoint policy, WireGuard gateway and operator controls. The [threat model](THREAT_MODEL.md) identifies what each control can establish.

## Identity and access lifecycle

1. Password sign-in validates credentials and account state. Server-side OIDC supports configured providers through issuer and token checks, PKCE, state and nonce. MFA enforcement depends on provider assurance accepted by organization policy.
2. The backend issues a short-lived access token and a persisted refresh family. A refresh is single use. Replay can revoke the family. Protected operations evaluate the live organization, user and session, including lock, termination and policy changes.
3. Enrollment registers a device public key. A short-lived session-bound challenge proves possession. Administrative approval, expiry, quarantine and revocation remain distinct from that proof.
4. Authorization uses a server-defined resource and live organization, role, session and device context. Native clients receive policy decisions and can close managed views after a session or network state change.

The backend includes enterprise OIDC paths and the console handoff. Native desktop and Android enterprise OIDC handoff and live Okta/Entra tenant acceptance remain open. Device identifiers and client signals are weak observations. A signed challenge establishes possession of a registered private key. Hardware backing, MDM posture and per-request proof require separate controls. [Administrator guide](ADMIN_GUIDE.md) · [API reference](API_REFERENCE.md)

## Network and navigation

Production config requires VPN source admission. In tunnel mode the trusted TLS edge forwards a peer source address. Egress mode compares the observed address with configured egress IPs and requires an independently restricted edge. The stock deployment uses tunnel mode. A shared address admits traffic from systems that share that address.

The Linux reference profile routes IPv4 and IPv6 through WireGuard. It uses an endpoint-specific firewall and gateway DNS. When the tunnel fails, the Linux client policy retains the firewall. With no IPv6 uplink, IPv6 Internet requests fail within the tunnel. Other operating systems require their managed policy and packet-level acceptance. Browser callbacks cover selected main-frame transitions. Redirect chains, subresources, service workers, other apps and alternative DNS protocols remain subject to endpoint and network policy. [Deployment and recovery](DEPLOYMENT.md)

## Tenant and operational controls

- Tenant context comes from verified server-side identity. Queries run using a transaction-local organization key, forced RLS and composite ownership constraints. The schema owner is isolated in one-shot operator workflows.
- Exact origins, trusted proxy boundaries, rate limits and input schemas reduce request abuse. Operator endpoints use separate credential and network assumptions.
- Structured logs record request IDs and decisions. Credentials, token values, private WireGuard keys and raw sensitive request bodies stay outside routine logs. Client-reported events remain distinguishable from server decisions.
- Production secrets enter through scoped files or approved release environments. Docker and host administrators can access resources on the host. Encrypt backups for an off-host recovery recipient and verify restores.
- Device or session revocation and WireGuard peer revocation are separate actions. Review both when containing a lost device.

## Platform and release evidence

Android uses Keystore-supported storage and selected secure-window behavior. Desktop confines IPC to its intended shell capabilities. Both depend on OS integrity. Rooted or privileged endpoints can defeat client observations and capture restrictions. Build and test results are scoped to the evidence in [testing](TESTING.md).

Preview artifacts have checksums, CycloneDX inventories and an attested release manifest. Production signing and publication remain gated by unresolved firewall and backend static findings and absent signing credentials. [Release process](RELEASE_PROCESS.md) · [Disclosure policy](../SECURITY.md)
