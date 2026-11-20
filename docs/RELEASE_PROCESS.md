# Release process

The repository uses one versioned delivery workflow with separate preview, signing and publication paths. This page covers release decisions. The [delivery runbook](RELEASE_DELIVERY.md) lists credentials, operators and commands.

| Channel | Version example | Release conditions |
| --- | --- | --- |
| Preview | `v2.5.0-preview.4` | Annotated tag runs the packaging rehearsal. The artifacts use a reserved origin and the Android APKs use a disposable key. The independent preview verifier checks the output while the main quality gate retains its actual result. |
| Release candidate | `v2.5.0-rc.1` | Reviewed commit on `main`, successful required checks, configured signing, protected environment approval and verified draft assets. |
| Stable | `v2.5.0` | Same production gates and a published, attested RC from the exact same source commit. Candidate and stable packaging apply their own version checks. |

## Verify before promotion

1. Review the changelog, intended source SHA, security gates, signing inputs and recovery plan. Tag one coherent source revision.
2. Inspect all required checks. An unavailable or skipped required platform check blocks signed promotion. Verify the protected signing and publication environments and tag ownership.
3. Check the exact artifact inventory, platform-signature status, SHA-256 list, SBOM scope and attestation identity. Validate installers and upgrades on the supported target systems.
4. Verify the downloaded manifest and artifact set as shown below. The expected SHA is the reviewed tagged commit. The manifest covers the file contents and run identity.
5. Apply the reviewed artifact with the [deployment runbook](DEPLOYMENT.md), then check revision, readiness, TLS and authorized sign-in. Retain the previous compatible deployment and verified backups.

```sh
repo=manikantbindass/RdPBrowser
tag=v2.5.0-preview.4
commit=8d0f7da776aa63317b5cad7e84071e62f4114ca6
gh run download 44484271833 --repo "$repo" --name release-payload-v2.5.0-preview.4-1 --dir release-dist
gh attestation verify release-dist/release-manifest.json --repo "$repo" \
  --signer-workflow "$repo/.github/workflows/delivery.yml" --source-ref "refs/tags/$tag"
python scripts/release/manifest.py verify release-dist "$tag" "$commit"
```

The preview payload is retained for 30 days and compact evidence for 90 days. The procedure requires a clean output directory. After retention expires use an approved archive or a new verification tag. For signed assets, download the published release using the runbook and apply the same verification. A rollback restores the previous compatible deployment. Keep old release tags and their evidence intact.

The verified preview's independent job passed all 16 entries. Its aggregate failed on open security findings. Production signing credentials were absent, so signed RC and stable publication acceptance remains open. [Preview run](https://github.com/manikantbindass/RdPBrowser/actions/runs/44484271833) · [Phase 14 report](PHASE14_REPORT.md)
