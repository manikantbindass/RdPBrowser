# Phase 14 delivery verification

**Status PARTIAL.** The artifact-only prerelease passed end-to-end verification. The required quality gate reported open security findings, and the protected signing environment has no production signing credentials. Publication remains gated.

## Workflow audit

The audit started at `4dead92ad5baf0bcb87d1b266ace2ee7d258c9ad`. Phase 13 had already removed explicit `continue-on-error` from the audited workflows. The old CI workflow still granted broad write permissions to validation jobs. Two workflows were eligible to publish a version tag. Release and registry jobs could run without waiting for every security check. Asset selection used optional or wildcard outputs, and the repository had no protected deployment environments. A read-only PR workflow and a single versioned delivery workflow now replace those publishers.

The existing backend, desktop, Android, VPN and Compose functionality was preserved. The pipeline change retains the PostgreSQL integration, browser, Rust, Flutter, isolated packet and recovery suites. It requires an exact set of release artifacts, verifies the checksums and binds them to a GitHub build attestation. Image publication moved to tagged, verifiable Docker archives. Existing releases and registries retain their published contents. [Release procedure](RELEASE_DELIVERY.md)

## Local checks and GitHub configuration

- All 10 versioning and manifest tests passed, including wrong-source, missing-platform, attempt-mixing, checksum tampering and incomplete SBOM cases.
- Actionlint 1.7.12, ShellCheck 0.11.0, the Windows signing script parser and `git diff --check` passed. Actionlint and ShellCheck binaries were downloaded from their release repositories and verified against the GitHub-published SHA-256 values.
- GitHub API reads verified three tag-restricted environments. `release-signing` and `release-publication` require owner review and disable administrator bypass. `release-verification` admits preview tags without credentials. The configured owner may self-review. The environments did not list signing secrets.

## Blocking findings

The [PR run](https://github.com/manikantbindass/RdPBrowser/actions/runs/44363422768) reports 52 static analysis findings, five high-severity desktop npm audit entries, 30 redacted Gitleaks candidates, six critical and two high Trivy source findings, and seven backend plus three edge high-severity image findings. The redacted Gitleaks report flagged no new entries under the release scripts or workflows. The gate treats unresolved scans as failures. These counts represent scanner observations and may include false positives or repeated advisories. [Phase 13 baseline and analysis](PHASE13_REPORT.md)

## Rehearsal evidence

The annotated `v2.5.0-preview.1` tag triggered [Versioned delivery](https://github.com/manikantbindass/RdPBrowser/actions/runs/44363413507) from `13ec0bbd117c2d019c11f53038a0bbdb7d55d30a`. Its packaging jobs waited for the entire quality matrix, including queued macOS runners. Commit `6389ceac3b529e7d6a3b986befd485092e680f84` lets preview packaging start after tag validation and retains the quality and protection dependencies for signed releases. It selects the supported `macos-15-intel` runner for the universal package. The replacement rehearsal is [v2.5.0-preview.2](https://github.com/manikantbindass/RdPBrowser/actions/runs/44364433363).

| Area | Hosted preview result |
| --- | --- |
| Windows x64 | MSI and NSIS packages built and uploaded |
| Linux x64 | DEB, AppImage and compressed archive built and uploaded |
| macOS | Universal DMG built on the Intel runner and uploaded |
| Android | Universal and all three ABI APKs built with the disposable key. The signature, version and zip alignment checks passed. |
| Containers | Both Linux AMD64 runtime images built and reloaded. Their image IDs matched. |
| SBOM and provenance | The inventory contained 360 backend image components, 72 edge image components and 991 tracked lockfile components. The manifest and all 16 artifact entries passed hash verification. GitHub provenance verification passed for the exact repository, workflow and tag. |
| Distribution | Signed packaging, release admission and publication were skipped for the preview. GitHub’s latest published stable release remained `v2.4.0`. |

The [verified payload](https://github.com/manikantbindass/RdPBrowser/actions/runs/44364433363/artifacts/14458566400) was uploaded with a 30-day retention period. The [manifest, checksums and SBOM evidence](https://github.com/manikantbindass/RdPBrowser/actions/runs/44364433363/artifacts/14458496410) has a 90-day retention period. The rehearsal job passed even though the overall run failed its required quality gate. [Saved attested manifest](audit/phase14/preview-2-manifest.json) · [Rehearsal verification job](https://github.com/manikantbindass/RdPBrowser/actions/runs/44364433363/job/135028445491)

The complete preview download exposed a portability defect. Python’s Windows path ordering differed from Linux for the mixed-case filenames, even though every hash and size matched. Commit `3eb2724a20862a26da5a7283bb6ef9a47993212c` uses exact filename ordering and retains the manifest format emitted on Linux. All 16 files in the downloaded preview passed local checksum verification on Windows with that fix. A separate `gh attestation verify` passed for the downloaded manifest and the exact preview workflow and tag.

The final rehearsal [`v2.5.0-preview.3`](https://github.com/manikantbindass/RdPBrowser/actions/runs/44380172362) used the source with the timestamp fix and the Intel macOS runner. It built all 16 entries, attested the manifest, verified all hashes again in a separate job and reloaded both Docker images with matching IDs. Local GitHub CLI verification confirmed the final manifest’s provenance. The preview’s aggregate run failed for the outstanding security findings and the independent artifact verification passed. Publication was skipped. [Final verification job](https://github.com/manikantbindass/RdPBrowser/actions/runs/44380172362/job/135087299913) · [Final payload](https://github.com/manikantbindass/RdPBrowser/actions/runs/44380172362/artifacts/14464339486) · [Final SBOM and checksum evidence](https://github.com/manikantbindass/RdPBrowser/actions/runs/44380172362/artifacts/14464663939) · [Saved manifest](audit/phase14/preview-3-manifest.json)

## Pull request validation and delivery state

The hosted backend run passed 156 unit tests and 48 PostgreSQL integration tests, along with nine admin browser checks and three desktop browser checks. Flutter analysis and nine tests passed. Linux and Windows TypeScript, Rust and Clippy checks passed. The isolated packet tests, Compose deployment and recovery drill and mocked Terraform validation passed. The `macos-latest` quality job reported cancellation before runner assignment. The workflow now runs macOS quality checks on `macos-15-intel` in `b44938ab602200db60e7dd581bb23107ecd87916`. This checks macOS natively on Intel. The universal package also compiles for Apple silicon, where native installer execution was unverified in this phase.

The [runner-change PR run](https://github.com/manikantbindass/RdPBrowser/actions/runs/44379145028/job/135066293740) found a timing defect in the PostgreSQL detection scan. The upper window bound passed through the JavaScript `Date` type and lost PostgreSQL’s microseconds. A signal created in the same millisecond could be deferred to a later scan. Commit `82149285513ebcea60784a7a7ff3c01151064be0` compares both window bounds in PostgreSQL and exercises a same-transaction observation in the retention regression test. Local backend lint, all 156 unit tests, 48 PostgreSQL integration tests and nine admin browser tests passed. The initial local unit attempt was denied loopback connections by the sandbox. The passing run used loopback access for the existing Supertest fixtures.

The final [code-only PR validation run](https://github.com/manikantbindass/RdPBrowser/actions/runs/44381075856) includes the portable verifier and both prior fixes. It passed workflow tooling, backend and browser checks, Flutter, Linux, Windows and Intel macOS checks, WireGuard packet tests, Compose recovery and mocked infrastructure validation. Three security scan jobs failed. The required aggregate gate failed accordingly. [Required run after the detection fix](https://github.com/manikantbindass/RdPBrowser/actions/runs/44380176222)

Required work before stable distribution includes remediation of the blocking security findings, configuring approved signing credentials, merging the reviewed workflow, registering the required PR gate on `main`, and verifying a published signed RC from the same source as the stable tag. No stable tag was pushed. The changes are on `codex/remoteshield-enterprise-completion` and the existing [draft PR #3](https://github.com/manikantbindass/RdPBrowser/pull/3).

[Machine-readable validation results](audit/phase14/validation.json) · [Changed files](audit/phase14/changed-files.txt)

## Security gate follow-up

The [baseline PR scan](https://github.com/manikantbindass/RdPBrowser/actions/runs/44385464372) identified seven high-severity findings inside the backend image’s bundled npm installation and three in the unused Nginx XSLT library. The backend keeps npm in the build stage and copies the Node runtime and production dependencies into a digest-pinned Alpine image. The first slim edge scan exposed five advisories in Nginx 1.30.6 itself. The final edge uses digest-pinned Nginx 1.30.7 slim. Startup checks retain UIDs 1001 and 101 and verify the removed packages are absent. [Official Node container guidance](https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md#smaller-images-without-npmyarn) · [Nginx security advisories](https://nginx.org/en/security_advisories.html)

The desktop uses Vite 8.3.8 and React plugin 6.3.0 with the previous browser targets. The npm audit reports zero high or critical findings and one moderate `fflate` finding. Reqwest 0.12.28 removes the affected `rustls-webpki` 0.101 branch. Tauri updater 2.14.1 supports ZIP 9. The lockfile uses the fixed ZIP 9.0.5 patch and its compatible `libc` update. The existing updater capability grants are unchanged. [Vite 8 migration guide](https://vite.dev/guide/migration.html) · [Published updater crate](https://crates.io/crates/tauri-plugin-updater/2.14.1)

All 28 historical audit matches were SHA-256 values verified against public Git blobs. The scanner applies an exception only to the exact reviewed checksum line in its original evidence file and only to the generic API key rule. Backend and SCIM test fixtures now generate their credentials per run. Gitleaks found zero matches on the reviewed snapshot and caught a synthetic replacement in the same approved field. [Verified digest inputs](audit/phase14/verified-public-hashes.json) · [Gitleaks rule configuration](https://github.com/gitleaks/gitleaks#configuration)

The [follow-up PR run](https://github.com/manikantbindass/RdPBrowser/actions/runs/44484220465) scanned commit `8d0f7da776aa63317b5cad7e84071e62f4114ca6`.

| Gate evidence | Before | After |
| --- | --- | --- |
| Gitleaks stock rules with reviewed digest exceptions | 30 candidates | 0 findings |
| Desktop npm audit at high or critical severity | 5 | 0 |
| Trivy source dependency vulnerabilities at high or critical severity | 3 | 0 |
| Trivy runtime images at high or critical severity | Backend 7, edge 3 | Backend 0, edge 0 |
| Trivy Terraform misconfigurations | 5 critical | 5 critical |
| Backend static analyzer | 52 findings | 52 findings |

The local production frontend build passed three desktop state tests and three Chrome scenarios. Windows Rust formatting, six tests and Clippy passed against the final lockfile. The backend authentication fixture passed all ten tests. Both images built in a dedicated Linux guest. The isolated runtime checks passed, as did local Trivy scans of the final images. The hosted image security job passed its startup checks and scans. [Hosted image verification](https://github.com/manikantbindass/RdPBrowser/actions/runs/44484220465/job/135423559226)

Terraform still flags public WireGuard and ICMP ingress and broad TCP, UDP and ICMP egress. The current single-VPS topology permits roaming clients and gateway egress. Changing those rules requires an approved deployment policy and packet verification on that topology. The backend analyzer still reports 25 nonliteral filesystem paths and 27 dynamic object accesses. Those findings remain blocking and require per-site review. The protected signing environment lists zero secrets. [DigitalOcean firewall configuration](../infrastructure/digitalocean/main.tf)

Ten hosted PR jobs passed. They include Windows, Linux and Intel macOS native checks, 156 backend unit tests, 48 PostgreSQL integration tests, nine admin Chrome scenarios, three desktop Chrome scenarios, nine Flutter tests, the isolated packet suite and 35 real Compose deployment and recovery assertions. The required quality gate failed on the two outstanding scan jobs. [Hosted PR result](https://github.com/manikantbindass/RdPBrowser/actions/runs/44484220465)

The artifact-only `v2.5.0-preview.4` delivered all 16 entries from the patched source, including installers for Windows, Linux and universal macOS, four Android APKs, both Docker images and CycloneDX SBOMs. GitHub verified the release manifest’s provenance, all hashes and both reloaded image identities in a separate job. Local GitHub CLI verification also passed for the manifest and exact tag. The preview’s aggregate status correctly reported failure for the remaining scan findings. The latest published stable version remained `v2.4.0`. [Independent verification job](https://github.com/manikantbindass/RdPBrowser/actions/runs/44484271833/job/135432691439) · [Preview payload](https://github.com/manikantbindass/RdPBrowser/actions/runs/44484271833/artifacts/14510333454) · [SBOM and checksums](https://github.com/manikantbindass/RdPBrowser/actions/runs/44484271833/artifacts/14510478932) · [Machine-readable remediation results](audit/phase14/security-remediation.json)
