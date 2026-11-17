#!/usr/bin/env bash
# All Docker bridges, addresses and firewall changes stay in a new network namespace.
set -euo pipefail
repo=$(cd -- "$(dirname -- "$0")/../.." && pwd)
if (( EUID != 0 || $# < 1 || $# > 2 )); then
    echo 'Usage: sudo bash operations/tests/lab.sh PREBUILT_IMAGE_ARCHIVE [production|development]' >&2
    exit 2
fi
images=$(realpath "$1")
mode=${2:-production}
[[ "$mode" == production || "$mode" == development ]]
[[ -f "$images" ]]
if [[ ! -v RSX_OPERATIONS_PARENT ]]; then
    export RSX_OPERATIONS_PARENT
    RSX_OPERATIONS_PARENT=$(readlink /proc/self/ns/net)
    exec unshare --mount --net --propagation private bash "$0" "$images" "$mode"
fi
[[ "$(readlink /proc/self/ns/net)" != "$RSX_OPERATIONS_PARENT" ]]
umask 077
work=$(mktemp -d)
mount -t tmpfs -o mode=0755 tmpfs /run
ip link set lo up
ip address add 10.8.0.1/32 dev lo
export DOCKER_HOST=unix://$work/docker.sock
unset DOCKER_CONTEXT COMPOSE_FILE COMPOSE_PROFILES BACKEND_IMAGE EDGE_IMAGE
cleanup() {
    local result=$?
    if [[ -n "${daemon:-}" ]] && kill -0 "$daemon" 2>/dev/null; then
        if (( result != 0 )); then
            docker ps -a >&2 || :
            tail -20 "$work/dockerd.log" >&2
            # Application logs are tested for secret leakage; never dump inspect environments.
            docker logs remoteshield-staging-backend-1 --tail 12 >&2 || :
        fi
        kill "$daemon" 2>/dev/null || :
        wait "$daemon" || :
    fi
    [[ "$work" == /tmp/tmp.* && "$work" != /tmp ]]
    rm -rf -- "$work"
}
trap cleanup EXIT
dockerd --host "$DOCKER_HOST" --data-root "$work/engine" --exec-root "$work/exec" --pidfile "$work/docker.pid" > "$work/dockerd.log" 2>&1 &
daemon=$!
for ((attempt=0; attempt<60; attempt++)); do
    if docker info >/dev/null 2>&1; then break; fi
    sleep 1
done
docker info >/dev/null
docker load --input "$images" >/dev/null
# Docker save/load drops registry digest metadata. A verified ID is retagged for offline Compose resolution.
database=sha256:aae6554de426ae1990f1a939ff183a0299146cf7142a6f4c379c3357af9cc2d8
if ! docker image inspect "$database" >/dev/null 2>&1; then
    database=''
    while read -r candidate; do
        if docker image inspect "$candidate" --format '{{json .Config.Env}}' | grep -q 'PG_MAJOR=15'; then database=$candidate;break;fi
    done < <(docker image ls --no-trunc --format '{{.ID}}')
fi
[[ "$database" == sha256:* ]]
export RSX_LAB_POSTGRES_IMAGE="$database"
mkdir -p "$work/repository"
cp -R "$repo/docker" "$repo/operations" "$repo/nginx" "$work/repository/"
chmod 0644 "$work/repository/nginx/dev.conf"
sed -i "s|image: postgres:15-alpine@sha256:[a-f0-9]*|image: $database|" "$work/repository/docker/docker-compose.yml"
if [[ "$mode" == production ]]; then
    python3 "$work/repository/operations/tests/scenarios.py" "$work"
else
    python3 "$work/repository/operations/tests/development.py" "$work"
fi
