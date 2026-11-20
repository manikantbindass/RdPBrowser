# RemoteShield X release readiness checklist

**Audit snapshot:** `44efcf59133a10f8560dccd421292852673eea2b`

**Date:** 2026-11-19

**Current decision:** **Stable release pending signing and platform acceptance.** The security fixes have local verification. Merge requires a passing hosted run for the final pull request commit.
See the [final audit report](FINAL_AUDIT_REPORT.md) for evidence, severity and remediation owners.

## Merge gates

| Gate | Status | Evidence / required action |
| --- | --- | --- |
| Latest `main` fetched and compared | PASS | `origin/main` at `0aa4b400aeb87c248632f7760db1be30ba4bac88`; no history rewritten. |
| All required PR checks pass | Hosted confirmation required | The [pre-fix run](https://github.com/manikantbindass/RdPBrowser/actions/runs/44608385684) failed the two security jobs and their aggregate gate. Verify all jobs for the final PR commit on GitHub. |
| Backend lint/contracts/PostgreSQL tests | PASS locally | After security remediation, 159 unit tests, 48 PostgreSQL integration tests and 9 admin browser tests passed. |
| Desktop supported CI matrix | PASS for observed runners | Windows, Ubuntu 22.04, Intel macOS checks passed. Apple Silicon and signed install/upgrade acceptance remain open. |
| Android CI analysis/tests | PASS in prior hosted CI | Local Flutter analysis passed. Local Flutter tests were blocked by the Windows native asset build hook. Managed physical device, signing and real tunnel acceptance still required. |
| WireGuard isolated enforcement suite | PASS in hosted CI | Packet-level proof remains scoped to the isolated lab; repeat on release profiles and target OS devices. |
| Compose deployment/recovery checks | PASS in hosted CI | Docker daemon unavailable locally; run local/non-production recovery drill before production. |
| Container image security | PASS in hosted CI | Does not clear the separate backend static analysis or Terraform configuration findings. |
| IaC security scan | PASS locally | Six mock plans passed. Trivy reported zero high or critical findings for the scoped DigitalOcean configuration with the example inputs. Verify the intended network paths in staging before applying. |
| Backend static security analysis | PASS locally | Object lookups and file readers were hardened. Remaining dynamic filesystem calls have a line-specific explanation for the operator or test-fixture trust boundary. ESLint still uses a zero-warning threshold and rejects unused suppressions. |
| Dependency and secret scan | npm PASS locally | Node watch replaces the vulnerable development dependency chain. Desktop `fflate` is locked to `0.8.3`. npm audit found zero vulnerabilities in all three projects. Confirm the full Trivy and Gitleaks jobs on GitHub. |
| Secret/signing material | **NOT READY** | No production signing credentials are configured. Ensure no private keys enter the repository; issue protected, short-lived signing credentials before release. |
| README/docs/assets | PASS locally | 210 relative links, 102 OpenAPI operation records, asset manifest/hashes/animation durations, PDF/PPTX structure passed `scripts/quality/verify_docs.py`. |
| Screenshot authenticity | PARTIAL | Desktop and admin captures have provenance; Android screenshot is explicitly unavailable and was not fabricated. |
| Published release artifact provenance | **FAIL / mismatch** | The `v2.4.0` release tag is unsigned and desktop filenames say `2.2.4`. The ARM64 APK reports `com.example.android` version `1.0.0` and launches the generic Flutter activity. The delivery workflow now validates the expected Android package, launcher, version and target SDK before upload. A replacement still needs signing and a launch check. |
| Branch protection and review approval | UNVERIFIED / pending | PR #3 is open and ready for review. Confirm required reviewers/branch protection, obtain explicit approval, then merge via permitted workflow only. |

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

Merge after GitHub verifies the final PR commit and any configured review requirements are satisfied. Signed distribution and physical Android acceptance remain open.
