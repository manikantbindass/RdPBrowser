# Security policy

RemoteShield X is experimental. No release is currently certified for production security or universal platform protection. Known findings are recorded in [the defect register](docs/BUG_REGISTER.md); platform and enforcement limits are part of the supported engineering record.

Do not post credentials, private keys, personal browsing logs, customer data or weaponized exploit details in public issues. If the repository's GitHub Security tab offers **Report a vulnerability**, use that private reporting route. Availability of private reporting has not been confirmed; no monitored security email, response SLA or bug bounty is claimed here. If no private route is available, open a minimal issue requesting a secure contact channel without publishing sensitive details.

A useful report identifies the affected commit/platform, expected and observed behavior, impact, minimal non-sensitive reproduction and whether the environment is local/test/production. Keep original evidence private. Do not test against other people's devices or services without permission.

Contributors must not disable security checks, ship placeholders as enforcement, commit secrets or claim screenshot/tamper/VPN/DNS protection without platform-specific tests. A health response and a UI indicator are not attestations. Security fixes should include regression coverage, compatibility notes and operational recovery guidance.
