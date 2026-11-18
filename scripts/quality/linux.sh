#!/usr/bin/env bash
set -euo pipefail
repo=$(cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$repo"
out=${RSX_QUALITY_LINUX_OUTPUT:-"$repo/.quality-results"}
mkdir -p "$out"
case "${1:-}" in
native)
  bash vpn-server/tests/lab.sh
  bash scripts/test-scim-edge.sh
  ;;
compose)
  : "${RSX_QUALITY_IMAGES:=/root/rsx-phase12/images.tar}"
  export BACKEND_IMAGE=remoteshield-backend:phase12-a EDGE_IMAGE=remoteshield-nginx:phase12
  bash vpn-server/tests/compose-lab.sh "$RSX_QUALITY_IMAGES"
  ;;
production|development)
  : "${RSX_QUALITY_IMAGES:=/root/rsx-phase12/images.tar}"
  set -o pipefail
  bash operations/tests/lab.sh "$RSX_QUALITY_IMAGES" "$1" | tee "$out/$1.jsonl"
  if [[ "$1" == production ]]; then python3 scripts/quality/performance.py "$out/production.jsonl"; fi
  ;;
scan)
  : "${RSX_SCANNER_DIRECTORY:=/root/rsx-quality-tools}"
  [[ -x "$RSX_SCANNER_DIRECTORY/trivy" && -x "$RSX_SCANNER_DIRECTORY/gitleaks" ]] || { echo 'BLOCKED: install checksummed scanners'; exit 77; }
  export TRIVY_CACHE_DIR="$repo/.local-tests/trivy-cache"
  work=$(mktemp -d)
  trap 'rm -rf -- "$work"' EXIT
  # Scan only repository-owned source; never walk private local toolchains or test databases.
  git ls-files --cached --others --exclude-standard -z > "$work/paths"
  python3 - "$work" <<'PY'
import sys,tarfile
from pathlib import Path
work=Path(sys.argv[1])
with tarfile.open(work/'source.tar','w') as output:
    for name in (work/'paths').read_bytes().decode().split('\0'):
        if name and Path(name).is_file():output.add(name,arcname=name,recursive=False)
PY
  mkdir "$work/source"
  tar -xf "$work/source.tar" -C "$work/source"
  result=0
  "$RSX_SCANNER_DIRECTORY/gitleaks" dir "$work/source" --redact=100 --report-format json --report-path "$out/gitleaks.json" || result=1
  "$RSX_SCANNER_DIRECTORY/trivy" fs --scanners vuln,misconfig --severity HIGH,CRITICAL --format json --output "$out/filesystem-scan.json" --exit-code 1 "$work/source" || result=1
  for image in remoteshield-backend:phase12-a remoteshield-nginx:phase12; do
    name=${image%%:*}
    "$RSX_SCANNER_DIRECTORY/trivy" image --scanners vuln --severity HIGH,CRITICAL --format json --output "$out/$name-scan.json" --exit-code 1 "$image" || result=1
  done
  exit "$result"
  ;;
*) echo 'Choose native, compose, production, development or scan' >&2;exit 2;;
esac
