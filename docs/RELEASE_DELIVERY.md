# GitHub Actions delivery

The `Pull request validation` workflow runs for pull requests into `main` and pushes to `main` and `develop`. Require its **Required quality gate** in the repository ruleset once that job is present on `main`. The gate requires every reusable suite, Flutter analysis and tests, dependency and secret scans, and workflow validation to succeed. A skipped, failed or cancelled prerequisite blocks signed delivery. Test pull requests with fork credentials disabled and use ordinary `pull_request` events.

## Versions and inputs

| Tag | Outputs | Admission |
| --- | --- | --- |
| `v2.5.0-preview.1` | Workflow artifacts with an attested checksum manifest | Disposable Android key, desktop verification builds, and a reserved `.invalid` app origin. The required quality result remains visible separately. |
| `v2.5.0-rc.1` | A signed GitHub prerelease with a versioned changelog | Source on `main`, green quality gate, approved signing and publication, verified assets |
| `v2.5.0` | A signed stable GitHub release | Same requirements plus an available, published and attested RC built from the identical commit |

Use an annotated tag. Before the RC, commit the `## [2.5.0]` changelog entry, review the exact source SHA on `main` and record the deployment health and rollback expectations. Push one tag at a time. Give each new source candidate a new RC or preview number. To retry the same source and tag after infrastructure failure, rerun **all jobs**. Artifacts include the run attempt to prevent a retry from mixing outputs. Review any leftover draft before intervening. Keep released tags immutable.

Desktop installers and APK `versionName` use the numeric core version. The Android base code is `major × 1,000,000 + minor × 10,000 + patch × 100 + sequence`. The candidate sequence ranges from 1 to 98 and stable uses 99. Flutter adds 1,000, 2,000 and 4,000 for ARM32, ARM64 and x86-64 split APKs. Record the highest distributed base code in `ANDROID_MIN_VERSION_CODE`. Keep the same APK variant for in-place upgrades, or check that the incoming APK’s actual `versionCode` exceeds the installed one before changing variants. Use a separate test device or profile for preview APKs. The preview signing key cannot upgrade a distribution-signed installation.

## Repository settings and credentials

- `release-verification` admits preview tags and requires no approval or credentials.
- `release-signing` and `release-publication` admit version tags and require review. Administrator bypass is disabled. The owner is currently the configured reviewer and may approve a run they started. Add an independent reviewer and enable prevention of self-review when release staffing supports it.
- Restrict creation, updates and deletion of version tags to release maintainers through repository rulesets before stable distribution. The approval screens should identify the exact tag, workflow and SHA being authorized. `release-publication` needs only the job-scoped GitHub token. Store production signing credentials in `release-signing` environment secrets.

| Target | Environment secrets | Environment variables |
| --- | --- | --- |
| Desktop services | | `REMOTESHIELD_SERVER` (HTTPS origin) |
| Windows x64 MSI and NSIS | `WINDOWS_CERTIFICATE` (base64 PFX), `WINDOWS_CERTIFICATE_PASSWORD` | |
| macOS universal DMG | `APPLE_CERTIFICATE` (base64 Developer ID P12), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_PASSWORD` (app-specific) | `APPLE_SIGNING_IDENTITY`, `APPLE_TEAM_ID` |
| Linux x64 DEB, AppImage and archive | `LINUX_SIGNING_KEY` (armored secret key), `LINUX_SIGNING_PASSPHRASE` | `LINUX_SIGNING_FINGERPRINT` (uppercase fingerprint) |
| Android universal and split APKs | `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEY_ALIAS`, `ANDROID_STORE_PASSWORD`, `ANDROID_KEY_PASSWORD` | `ANDROID_SIGNING_SHA256` (lowercase certificate hash without separators), `ANDROID_MIN_VERSION_CODE`, `ANDROID_SERVER_URL` (HTTPS origin) |

The Windows job verifies an Authenticode signature, expected signer and timestamp. The macOS job verifies the app signature and stapled notarization. Linux detaches OpenPGP signatures and verifies them before upload. Android verifies its signing certificate, numeric build identity and zip alignment. Certificate accounts, hardware-backed signer requirements, operating-system install testing and Tauri updater signing require separate verification. No desktop updater feed is configured by this pipeline.

## Verify and deploy

Use the GitHub CLI to download the prerelease or stable assets into a clean directory. Obtain the verification script from a trusted checkout of the tagged source. Substitute the tag and expected commit from your release approval record.

```sh
repo=manikantbindass/RdPBrowser
tag=v2.5.0-rc.1
commit=$(git rev-parse "$tag^{commit}")
gh release download "$tag" --repo "$repo" --dir release-dist
gh attestation verify release-dist/release-manifest.json --repo "$repo" \
  --signer-workflow "$repo/.github/workflows/delivery.yml" --source-ref "refs/tags/$tag"
python3 scripts/release/manifest.py verify release-dist "$tag" "$commit"
```

For a preview, use `gh run download RUN_ID --name release-payload-TAG-ATTEMPT --dir release-dist` and the same verification. Preview payloads are retained 30 days, signed payloads 90 days, compact release evidence 90 days and most CI diagnostics 14 days. Archive the attestation, manifest, release jobs and scan results according to your retention requirements. The manifest records full commit, run ID and attempt and binds each artifact’s name, size and SHA-256. The SBOM set contains the backend runtime and edge runtime image inventories plus tracked source lockfiles. It is not a per-installer inventory.

Load each `remoteshield-*-linux-amd64.tar.gz` with `docker load -i PATH`. Compare `docker image inspect IMAGE --format '{{.Id}}'` with `image-identities.json` before registering the images in the deployment inventory. Release archives supply `remoteshield-backend:TAG` and `remoteshield-edge:TAG`. Use their verified IDs or separately recorded registry digests in the Compose rollout. Review the versioned database migrations and current backup before deploying. Check readiness, the expected revision, TLS and the critical login path after promotion. See [Phase 12 operations](PHASE12_REPORT.md) for the isolated Compose deployment and restore procedures.

## Rollback

Pause rollouts if verification, readiness or critical smoke tests fail. Use the retained previous release and the operations deployment state to restore the known-good backend and edge images. Check migration compatibility before resuming service. When a downgrade is incompatible, use the tested database restore procedure with the pre-release backup and record the recovery point. Android can reject a lower `versionCode` and a different signing identity. For a broadly deployed client regression, build a new higher version with the corrected source and the approved signing identity. Leave the original tag and manifest intact for investigation.

GitHub publishes all finalized assets from a draft only after verifying the actual uploaded digests. If publication fails, inspect the draft and failed step. Registry promotion is a separate operator action. The pipeline does not update an image `latest` alias or publish the backend to npm.

References [GitHub deployment environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments), [GitHub artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations), [Tauri distribution](https://v2.tauri.app/distribute/).
