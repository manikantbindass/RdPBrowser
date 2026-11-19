<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="assets/readme/remoteshield-hero.webp">
  <img src="assets/readme/remoteshield-hero.gif" alt="RemoteShield X. A conceptual shield connects desktop and Android clients." width="1280">
</picture>

# RemoteShield X

**Managed browsing and tenant-scoped access for remote teams.**

[![Project status](assets/readme/badge-status.svg)](docs/ROADMAP.md) [![Technology stack](assets/readme/badge-stack.svg)](docs/ARCHITECTURE.md) [![API compatibility](assets/readme/badge-contracts.svg)](docs/API_REFERENCE.md)

RemoteShield X lets an organization manage browser sessions, device enrollment, URL policy and security events from one console. A Node.js control plane handles identity and records decisions. Native WebViews load permitted pages. An independently managed WireGuard deployment and operating-system policy control how packets leave managed devices.

[Static, reduced-motion edition](docs/README_STATIC.md) · [Getting started](docs/GETTING_STARTED.md) · [Technical report](output/pdf/RemoteShield-X-Technical-Report.pdf) · [PowerPoint briefing](docs/deliverables/RemoteShield-X-Company-Briefing.pptx)

The [Phase 15 deliverable validation record](docs/deliverables/README.md) documents asset, link, command and rendering checks.

## Implementation and evidence

| Area | Implemented and verified | Acceptance still open |
| --- | --- | --- |
| Backend | Versioned REST, PostgreSQL migrations and tenant isolation, refresh rotation, revocation, URL policy, audit and events. Hosted run passed 156 unit and 48 database integration tests. | Review remaining static analysis findings and verify the deployment with the intended users and load. |
| Desktop | Tauri 2, Rust, React and TypeScript. Windows, Linux and Intel macOS native checks passed. The preview built Windows and Linux x64 installers and a universal macOS DMG. | Production signatures, notarization, native install and upgrade acceptance, and per-OS network enforcement. |
| Android | Flutter client with secure refresh storage, device key possession and WebView policy checks. Android 16/API 36 emulator boundary tests and four preview APK builds are recorded. | Physical managed-device acceptance, provisioned lockdown, signed distribution and native enterprise SSO handoff. |
| Network | Per-device WireGuard peers, Linux gateway and client firewall, IPv4/IPv6 routing, DNS and tunnel failure tests in isolated namespaces. | Packet verification of the operator’s complete topology and each managed OS profile. |
| Administration | Tenant-scoped users, devices, sessions, policies, incidents, governance and evidence export. Nine admin browser scenarios passed. | Live identity-provider tenants, independent evidence retention and operational staffing. |
| Delivery | Blocking PR matrix, protected signing and publication, SBOMs, checksums and provenance. The artifact-only preview independently verified all 16 entries. | Five firewall configuration findings, 52 backend static analyzer findings and production signing credentials. |

The verification snapshot uses source commit `8d0f7da` and preview `v2.5.0-preview.4`. The ten passing jobs include 35 Compose deployment and recovery assertions. The required quality gate failed on the two remaining scan jobs. The latest published stable release at this snapshot was `v2.4.0`. [Hosted checks](https://github.com/manikantbindass/RdPBrowser/actions/runs/44484220465) · [Preview verification](https://github.com/manikantbindass/RdPBrowser/actions/runs/44484271833/job/135432691439) · [Audit evidence](docs/audit/phase14/security-remediation.json)

## Architecture

![Control plane and independent native traffic enforcement](assets/readme/architecture.svg)

Nginx terminates TLS. Express and Socket.IO handle authenticated control traffic. PostgreSQL stores organization, identity, device, session, policy and event state. A restricted runtime role and forced row-level security protect tenant data. The browser loads destination pages through the OS network stack; `/api/v1/proxy/navigate` returns an authorization decision.

[Architecture](docs/ARCHITECTURE.md) · [API reference](docs/API_REFERENCE.md) · [Security model](docs/SECURITY_MODEL.md) · [Threat model](docs/THREAT_MODEL.md)

## Real application captures

| Windows desktop | Administration console |
| --- | --- |
| ![Archived Windows Tauri debug application](assets/readme/desktop-browser.png) | ![Live admin console backed by a disposable PostgreSQL organization](assets/readme/admin-dashboard.png) |
| Archived development capture from `ae49ba4`. Its placeholder infrastructure labels are illustrative. | Phase 09 browser acceptance fixture. Counts describe seeded lab records. |

The [capture ledger](assets/readme/SCREENSHOTS.md) also records the [device inventory](assets/readme/device-management.png) and [policy revision](assets/readme/policy-management.png) views. Android evidence currently covers build, emulator boundary tests and packaging. A managed Android screenshot awaits a provisioned fixture and an approved capture method.

## Platform and setup

Use Node 24 for the backend and shared development workflow, Python 3.10 or later for verification, and Docker Compose 2.24.4 or later in Linux-container mode. The desktop build supports Node 22.12 or later and the native Tauri prerequisites. Android uses Flutter 3.38.9, Java 17, minimum SDK 26 and compile/target SDK 36. The tested Android runtime was API 36 on an emulator. [Setup and platform requirements](docs/GETTING_STARTED.md)

In a fresh checkout on the development branch:

```sh
node scripts/setup-dev.mjs
npm ci --prefix backend
npm run config:check --prefix backend
docker compose --env-file docker/.env -f docker/docker-compose.yml -f docker/compose.dev.yml up -d --build --wait
```

Open `http://127.0.0.1:8180/admin/` and check backend readiness on `127.0.0.1:3001/ready`. The local stack publishes loopback ports and permits direct API access. The setup script creates local credentials once. An operator must provision the first administrator. [Bootstrap instructions](docs/GETTING_STARTED.md)

## Operating RemoteShield X

- [Deployment](docs/DEPLOYMENT.md) covers the single-VPS Compose topology, WireGuard, TLS, backups, recovery and capacity boundaries.
- [Administrator guide](docs/ADMIN_GUIDE.md) covers identity setup, device enrollment, policy revisions, incident response and audit export.
- [User guide](docs/USER_GUIDE.md) covers connection requirements, desktop and Android workflows, revocation and logout.
- [Testing](docs/TESTING.md) explains how to reproduce the evidence and distinguish a passing check from production acceptance.
- [Troubleshooting](docs/TROUBLESHOOTING.md) covers startup, admission, VPN, policy, and release failures.
- [Release process](docs/RELEASE_PROCESS.md) defines preview, signed RC, stable publication and rollback.
- [Roadmap](docs/ROADMAP.md) tracks remaining release, platform and operations acceptance.

Use [CONTRIBUTING.md](CONTRIBUTING.md) for development changes, [SECURITY.md](SECURITY.md) for vulnerability reporting, and [repository metadata](docs/REPOSITORY_METADATA.md) for the suggested GitHub description and topics. Package manifests declare MIT. The repository owner still needs to establish the standalone licensing record.

<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="assets/readme/remoteshield-footer.webp">
  <img src="assets/readme/remoteshield-footer.gif" alt="Conceptual network connections converge on a shield and lock." width="1280">
</picture>
