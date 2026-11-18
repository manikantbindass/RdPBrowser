#!/usr/bin/env bash
set -euo pipefail
: "${GITHUB_REPOSITORY:?}" "${RELEASE_CHANNEL:?}" "${RELEASE_VERSION:?}" "${SOURCE_COMMIT:?}"
[[ "$RELEASE_CHANNEL" != preview ]]
for environment in release-signing release-publication; do
  gh api "repos/$GITHUB_REPOSITORY/environments/$environment" --jq '. | {can_admins_bypass,protection_rules,deployment_branch_policy}' |
    jq -e '.can_admins_bypass == false and .deployment_branch_policy.custom_branch_policies == true and any(.protection_rules[]; .type == "required_reviewers" and (.reviewers | length > 0))' >/dev/null
  gh api "repos/$GITHUB_REPOSITORY/environments/$environment/deployment-branch-policies" |
    jq -e '.branch_policies | length == 1 and all(.[]; .type == "tag" and .name == "v*.*.*")' >/dev/null
done
git merge-base --is-ancestor "$SOURCE_COMMIT" refs/remotes/origin/main
if [[ "$RELEASE_CHANNEL" == stable ]]; then
  verified=false
  work=$(mktemp -d "$RUNNER_TEMP/rsx-prerelease.XXXXXX")
  trap 'rm -rf -- "$work"' EXIT
  while IFS= read -r candidate; do
    [[ "$candidate" =~ ^v[0-9]+\.[0-9]+\.[0-9]+-rc\.[1-9][0-9]?$ ]] || continue
    [[ "$(git rev-parse "$candidate^{commit}")" == "$SOURCE_COMMIT" ]] || continue
    if ! gh release view "$candidate" --json isDraft,isPrerelease --jq '.isPrerelease and (.isDraft | not)' | grep -qx true; then continue; fi
    gh release download "$candidate" --pattern release-manifest.json --dir "$work" --clobber
    jq -e --arg tag "$candidate" --arg commit "$SOURCE_COMMIT" \
      '.tag==$tag and .commit==$commit and .channel=="rc" and .signing=="protected-release"' "$work/release-manifest.json" >/dev/null
    gh attestation verify "$work/release-manifest.json" --repo "$GITHUB_REPOSITORY" \
      --signer-workflow "$GITHUB_REPOSITORY/.github/workflows/delivery.yml" --source-ref "refs/tags/$candidate"
    verified=true
    break
  done < <(git tag --list "v$RELEASE_VERSION-rc.*" --sort=-version:refname)
  [[ "$verified" == true ]] || { echo 'A published and attested RC is required from the same source commit'; exit 1; }
fi
