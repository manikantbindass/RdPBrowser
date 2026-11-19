# Threat model

This model covers the managed desktop/Android clients, TLS edge, backend, PostgreSQL, enterprise directory ingress, Linux WireGuard profile and CI delivery pipeline. Review it against each installation's network paths, identity providers and administrative roles before acceptance.

## Assets and trust

Protect tenant data, credentials, tokens, enrolled private keys, policy records, audit evidence, backups and release signing identities. Trust the OS kernel and managed configuration, approved identity providers, the terminating edge, authenticated gateway operators, database operators and approved release maintainers within their assigned scope. Treat client-supplied identifiers, posture claims, URL inputs, forwarding headers and incident signals as untrusted.

| Threat | Existing control and evidence | Residual risk or acceptance test |
| --- | --- | --- |
| Cross-tenant or role escalation | Session and role checks, transaction-local tenant scope, restricted runtime role, forced RLS and ownership constraints. Real PostgreSQL negative tests cover unauthorized access. | Owner and host compromise can bypass access boundaries. Review operator credentials and verify each privileged workflow. |
| Token theft or refresh replay | Short access lifetime, live session checks, hashed rotating refresh families, replay revocation and error redaction. | A usable bearer may be replayed within its allowed session and context. Require enforced MFA where applicable and verify loss, logout and revocation on the target client. |
| Device spoofing | Public-key challenge and administrative posture state. Per-device WireGuard keys bind allocated addresses. | Client checks can be bypassed on compromised endpoints. Hardware attestation and managed posture feeds remain future work. |
| Source-header spoofing or accidental direct exposure | Exact trusted proxy configuration, edge-owned forwarding headers and source-mode checks. Linux packet fixtures exercise tunnel ingress. | Miswired ingress, shared egress and host networking can change what the API observes. Retest on the real perimeter. |
| DNS leakage or alternate paths | Dual-stack routing, Linux kill switch and gateway DNS. Lab tests cover loss, reconnection and denied underlay paths. | Generic HTTPS can carry DoH or application tunnels. Verify endpoint resolver policy, IPv6, sleep/reboot and approved exceptions. |
| Untrusted site content | Validated HTTP(S) navigation, main-frame policy, restricted IPC, external-link and download controls. | WebView callbacks and native hooks have platform-specific gaps. Malicious content and OS compromise require separate endpoint protection. |
| Abusive provisioning or tenant onboarding | Scoped SCIM credentials, separate ingress/rate limits, provider and governance transactions, audit and deactivation. | Real IdP quirks, compromised administrator sessions and source allowlists require live acceptance and operational review. |
| False or missing security signals | Deterministic rules, bounded scans, deduplicated evidence and human review before containment. | Reported client behavior can be forged or missed. Synthetic fixtures do not establish production precision or recall. |
| Dependency or artifact compromise | Locked inputs, scanners, exact inventory, hashes, SBOMs, provenance and protected environments. | Remaining scan findings and absent production signing block release. Install/upgrade and platform signature verification remain acceptance steps. |
| Failure or destructive rollback | Readiness, bounded shutdown, encrypted backup, tested restore and schema-aware rollback. | Single-VPS failure takes down the reference system. Offsite restore, replacement-host recovery and agreed service objectives are deployment work. |

## Test the failure paths

Check untrusted origins and source headers, expired or revoked credentials, cross-tenant access, unapproved devices, tunnel loss, DNS failure and an image/schema mismatch. Use a disposable topology with a known target and private test data. Compare policy/API observations with actual packets and control-plane logs. Maintain a recovery path through operator console access and a previously verified deployment. [Testing](TESTING.md) · [Deployment](DEPLOYMENT.md)
