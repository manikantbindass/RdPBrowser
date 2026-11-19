# RemoteShield X release readiness checklist

**Audit snapshot:** `44efcf59133a10f8560dccd421292852673eea2b`

**Date:** 2026-11-19

**Current decision:** **NOT READY — required security gates fail.**
See the [final audit report](FINAL_AUDIT_REPORT.md) for evidence, severity and remediation owners.

## Merge gates

| Gate | Status | Evidence / required action |
| --- | --- | --- |
| Latest `main` fetched and compared | PASS | `origin/main` at `0aa4b400aeb87c248632f7760db1be30ba4bac88`; no history rewritten. |
| All required PR checks pass | **FAIL** | Run [44492760284](https://github.com/manikantbindass/RdPBrowser/actions/runs/44492760284): `dependency-and-secrets`, `backend / security-static`, and aggregate `Required quality gate` failed. Re-run only after remediating findings. |
| Backend lint/contracts/PostgreSQL tests | PASS in hosted CI | Latest contracts/PostgreSQL job passed. Prior evidence records 156 unit and 48 integration tests. |
| Desktop supported CI matrix | PASS for observed runners | Windows, Ubuntu 22.04, Intel macOS checks passed. Apple Silicon and signed install/upgrade acceptance remain open. |
| Android CI analysis/tests | PASS in hosted CI | No local Flutter SDK; managed physical device, signing and real tunnel acceptance still required. |
| WireGuard isolated enforcement suite | PASS in hosted CI | Packet-level proof remains scoped to the isolated lab; repeat on release profiles and target OS devices. |
| Compose deployment/recovery checks | PASS in hosted CI | Docker daemon unavailable locally; run local/non-production recovery drill before production. |
| Container image security | PASS in hosted CI | Does not clear the separate backend static analysis or Terraform configuration findings. |
| IaC security scan | **FAIL / unresolved** | Earlier detailed scan recorded five CRITICAL DigitalOcean firewall/misconfiguration findings. Latest syntax/plan validation is not a security scan. Clear and re-scan. |
| Backend static security analysis | **FAIL / unresolved** | Prior scanner evidence: 52 findings (25 non-literal filesystem paths, 27 object injection). Review each and rerun. |
| Dependency and secret scan | **FAIL / unresolved** | Latest job failed. Earlier scan reported 2 moderate backend, 1 moderate desktop dependency advisories and zero Gitleaks findings. Review current artifact, update/adjudicate, rerun. |
| Secret/signing material | **NOT READY** | No production signing credentials are configured. Ensure no private keys enter the repository; issue protected, short-lived signing credentials before release. |
| README/docs/assets | PASS locally | 210 relative links, 102 OpenAPI operation records, asset manifest/hashes/animation durations, PDF/PPTX structure passed `scripts/quality/verify_docs.py`. |
| Screenshot authenticity | PARTIAL | Desktop and admin captures have provenance; Android screenshot is explicitly unavailable and was not fabricated. |
| Published release artifact provenance | **FAIL / mismatch** | Latest stable `v2.4.0` tag is unsigned; desktop package filenames say `2.2.4`. Do not recommend these assets as current-source builds. Correct versioning and sign/attest a new release. |
| Branch protection and review approval | UNVERIFIED / pending | PR #3 is open and draft. Confirm required reviewers/branch protection, obtain explicit approval, then merge via permitted workflow only. |

## Required before merge

- [ ] Resolve or formally adjudicate every current dependency and secret scan finding.
- [ ] Resolve each backend static analysis data flow with tests; no suppressions used solely to turn the gate green.
- [ ] Address all five critical infrastructure security findings and pass a security configuration scan.
- [ ] Run current final-SHA PR checks; all required jobs and the aggregate gate must pass.
- [ ] Review tenant isolation, administrative authorization/audit, refresh/revocation and session-expiry behavior.
- [ ] Confirm merge review and branch-protection requirements are satisfied.
- [ ] Keep the existing user-worktree documentation deletions out of the audit change unless their owner explicitly decides otherwise.

## Required before stable release

- [ ] Build from a reviewed, passing source SHA through protected release workflow.
- [ ] Produce SBOM, checksums, provenance and valid signatures; independently verify signatures and artifact identity.
- [ ] Align Git tag, app metadata, installer names and release notes.
- [ ] Verify install, upgrade, rollback and uninstall behavior on every declared platform/architecture.
- [ ] Test Android on supported physical managed devices; document tested Android API levels and signing identity.
- [ ] Validate DNS, IPv4/IPv6 routes, reconnect, tunnel loss, kill-switch and peer revocation at packet level on each supported profile.
- [ ] Complete encrypted off-host backup restoration, failure recovery, alerts and resource-capacity exercise in non-production.
- [ ] Review final README feature claims, artifact links, screenshots, limitations and support matrix against produced artifacts.
- [ ] Obtain release approval and publish only after all required gates pass.

## Final disposition

**Blocked:** do not merge or label as production-ready while security scans and required PR gate fail. The open pull request should remain a draft until remediation and all checks pass; then it can be marked ready for human review without bypassing required controls.
