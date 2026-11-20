#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${LINUX_SIGNING_KEY:?Missing Linux release-signing key}" "${LINUX_SIGNING_PASSPHRASE:?Missing Linux signing passphrase}" "${LINUX_SIGNING_FINGERPRINT:?Missing Linux signing fingerprint}"
[[ "$LINUX_SIGNING_FINGERPRINT" =~ ^[0-9A-F]{40}$ ]]
export GNUPGHOME
GNUPGHOME=$(mktemp -d "$RUNNER_TEMP/rsx-gpg.XXXXXX")
trap 'gpgconf --kill gpg-agent; rm -rf -- "$GNUPGHOME"' EXIT
printf '%s' "$LINUX_SIGNING_KEY" | gpg --batch --import
unset LINUX_SIGNING_KEY
for file in release-payload/*; do
  printf '%s\n' "$LINUX_SIGNING_PASSPHRASE" | gpg --batch --pinentry-mode loopback --passphrase-fd 0 \
    --local-user "$LINUX_SIGNING_FINGERPRINT" --armor --detach-sign "$file"
  gpg --batch --verify "$file.asc" "$file"
done
