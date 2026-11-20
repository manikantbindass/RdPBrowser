# Security policy

RemoteShield X is experimental software. The published preview is not certified for production security or universal platform protection. Known issues and release gates are listed in the [roadmap](docs/ROADMAP.md) and [Phase 14 report](docs/PHASE14_REPORT.md). The [security model](docs/SECURITY_MODEL.md), [threat model](docs/THREAT_MODEL.md), and [release evidence](docs/PHASE14_REPORT.md) define known limits. The latest hosted quality gate has two required scanner failures; do not treat the preview as a security endorsement.

## Reporting a vulnerability

Do not disclose credentials, private keys, personal browsing history, customer data, or weaponized exploit details in public issues. If GitHub offers **Report a vulnerability** in this repository's Security tab, submit a private report there. Private reporting availability is unconfirmed. No monitored security email, response SLA, or bounty program is claimed. If no private route is available, open a minimal issue requesting a secure channel and do not include sensitive details.

Include the affected commit and platform, impact, expected and observed behavior, a minimal non-sensitive reproduction, and whether the environment is local, test, or production. Keep original evidence private. Test only systems and devices you are authorized to assess.

## Security expectations for contributions

- Validate untrusted input at service boundaries and enforce organization scope at service and database boundaries.
- Never log passwords, access or refresh tokens, private VPN keys, or customer browsing data.
- Keep security checks enabled. Do not present UI state, device IDs, build success, or client-side signals as proof of trustworthy enforcement.
- Include regression tests, migration and compatibility notes, audit behavior, and operational rollback guidance for security-sensitive changes.
- State platform, configuration, test topology and limits of any protection claim. Screenshot controls, root signals, WebView controls and VPN indicators are not tamper-proof guarantees.

For ordinary changes see [CONTRIBUTING.md](CONTRIBUTING.md). For production concerns and accepted risks use the [roadmap](docs/ROADMAP.md) and [release process](docs/RELEASE_PROCESS.md).
