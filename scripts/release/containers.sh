#!/usr/bin/env bash
set -euo pipefail
: "${RELEASE_TAG:?}" "${SOURCE_COMMIT:?}" "${RELEASE_CHANNEL:?}"
root=$(cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$root"
mkdir release-payload
bash scripts/quality/install-scanners.sh "$RUNNER_TEMP/rsx-scanners"
trivy="$RUNNER_TEMP/rsx-scanners/trivy"
for svc in backend edge; do
  dockerfile=backend
  if [[ "$svc" == edge ]]; then dockerfile=nginx; fi
  image="remoteshield-$svc:$RELEASE_TAG"
  docker build --platform linux/amd64 --build-arg "APP_REVISION=$SOURCE_COMMIT" \
    --label "org.opencontainers.image.revision=$SOURCE_COMMIT" --label "org.opencontainers.image.version=$RELEASE_TAG" \
    -f "docker/Dockerfile.$dockerfile" -t "$image" .
  if [[ "$RELEASE_CHANNEL" != preview ]]; then
    "$trivy" image --scanners vuln --severity HIGH,CRITICAL --exit-code 1 "$image"
  fi
  docker save "$image" | gzip -n > "release-payload/remoteshield-$svc-$RELEASE_TAG-linux-amd64.tar.gz"
  "$trivy" image --format cyclonedx --output "release-payload/$svc-image.cdx.json" "$image"
done
backend=$(docker image inspect "remoteshield-backend:$RELEASE_TAG" --format '{{.Id}}')
edge=$(docker image inspect "remoteshield-edge:$RELEASE_TAG" --format '{{.Id}}')
jq -n --arg backend "$backend" --arg edge "$edge" --arg commit "$SOURCE_COMMIT" \
  '{backend:$backend,edge:$edge,sourceCommit:$commit,platform:"linux/amd64"}' > release-payload/image-identities.json
source="$RUNNER_TEMP/rsx-release-source"
mkdir "$source"
git archive HEAD | tar -xf - -C "$source"
"$trivy" fs --format cyclonedx --output release-payload/source-lockfiles.cdx.json "$source"
