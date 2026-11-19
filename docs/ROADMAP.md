# Roadmap

This roadmap tracks work still required after the verified preview. It intentionally records acceptance outcomes that remain open. Implementation history and raw support evidence remain in the [Phase 14 evidence](PHASE14_REPORT.md).

## Release gates

| Priority | Remaining work | Exit evidence |
| --- | --- | --- |
| P0 | Review the five Terraform firewall findings and 52 backend static analyzer findings. | Document intended ingress/egress and inspect each backend site. Run the agreed packet and regression tests with the quality gate passing. |
| P0 | Configure production signing, environment review and release-tag controls. | A reviewed, attested signed RC on `main`, with installer signatures, notarization where applicable, upgrade QA and explicit approval. |
| P1 | Accept managed endpoints on Windows, Linux, macOS and physical Android devices. | Per-profile packet evidence for routing, DNS, IPv6, tunnel loss, reboot and recovery. Include WebView behavior and supported OS versions. |
| P1 | Accept live enterprise identity and lifecycle operations. | Controlled Okta and Entra tenant tests for assurance, SCIM deactivation and revocation. Complete native OIDC handoff and stronger posture support before advertising them. |
| P1 | Establish operational recovery and service objectives. | Off-host restore and gateway reconciliation on a replacement host. Agree retention, capacity, alerting and recovery targets. Verify the intended workload. |
| P2 | Improve audit integrations and detection evaluation. | Signed webhook delivery with replay handling where justified. Representative labeled data and measured false positives, false negatives and latency before any ML release. |

Hardware attestation, universal traffic confinement, guaranteed capture prevention and production ML detection are outside the verified baseline. Architecture changes such as horizontal scaling or queue services need measured requirements. [Threat model](THREAT_MODEL.md) · [Release process](RELEASE_PROCESS.md)
