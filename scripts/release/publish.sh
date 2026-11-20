#!/usr/bin/env bash
set -euo pipefail
: "${RELEASE_TAG:?}" "${RELEASE_VERSION:?}" "${RELEASE_CHANNEL:?}" "${SOURCE_COMMIT:?}"
[[ "$RELEASE_CHANNEL" == rc || "$RELEASE_CHANNEL" == stable ]]
python3 scripts/release/manifest.py verify release-dist "$RELEASE_TAG" "$SOURCE_COMMIT"
gh attestation verify release-dist/release-manifest.json --repo "$GITHUB_REPOSITORY" \
  --signer-workflow "$GITHUB_REPOSITORY/.github/workflows/delivery.yml" --source-ref "refs/tags/$RELEASE_TAG"
if gh release view "$RELEASE_TAG" >/dev/null 2>&1; then
  echo 'A release already exists for this tag. Review it before retrying.' >&2
  exit 1
fi
notes=$(mktemp "$RUNNER_TEMP/rsx-release-notes.XXXXXX")
trap 'rm -f -- "$notes"' EXIT
python3 - "$notes" <<'PY'
import os, re, sys
from pathlib import Path
version = os.environ['RELEASE_VERSION']
text = Path('CHANGELOG.md').read_text(encoding='utf8')
match = re.search(r'^## \['+re.escape(version)+r'\][^\n]*\n(.*?)(?=^## |\Z)', text, re.M | re.S)
if not match or not match[1].strip():
    raise SystemExit('A versioned changelog entry is required')
link = os.environ['GITHUB_SERVER_URL']+'/'+os.environ['GITHUB_REPOSITORY']+'/actions/runs/'+os.environ['GITHUB_RUN_ID']
Path(sys.argv[1]).write_text(match[1].strip()+'\n\nSource commit `'+os.environ['SOURCE_COMMIT']+'`. [Build evidence]('+link+').\n',encoding='utf8')
PY
flags=()
latest=false
if [[ "$RELEASE_CHANNEL" == rc ]]; then flags+=(--prerelease); else latest=true; fi
gh release create "$RELEASE_TAG" --draft --verify-tag --latest=false --title "RemoteShield X $RELEASE_TAG" \
  --notes-file "$notes" "${flags[@]}" release-dist/*
# The draft remains non-public if any uploaded file fails this comparison.
draft_id=$(gh api "repos/$GITHUB_REPOSITORY/releases" --paginate --slurp \
  | jq -er --arg tag "$RELEASE_TAG" '[.[][] | select(.tag_name==$tag and .draft) | .id] | if length==1 then .[0] else error("Expected one release draft") end')
gh api "repos/$GITHUB_REPOSITORY/releases/$draft_id" > "$RUNNER_TEMP/rsx-draft.json"
python3 - "$RUNNER_TEMP/rsx-draft.json" <<'PY'
import json, sys
from pathlib import Path
sys.path.insert(0,'scripts/release')
from manifest import hash_file
draft=json.loads(Path(sys.argv[1]).read_text())
expected={path.name:'sha256:'+hash_file(path) for path in Path('release-dist').iterdir()}
actual={row['name']:row.get('digest') for row in draft['assets'] if row['state']=='uploaded'}
if draft.get('draft') is not True or len(draft['assets']) != len(expected) or actual != expected:
    raise SystemExit('Draft asset digests or completeness differ from the verified payload')
PY
gh release edit "$RELEASE_TAG" --draft=false --latest="$latest" "${flags[@]}"
