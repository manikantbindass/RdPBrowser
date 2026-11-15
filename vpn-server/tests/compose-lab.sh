#!/usr/bin/env bash
# Run a second Docker daemon and the production Compose file in a private namespace.
set -euo pipefail
repo=$(cd -- "$(dirname -- "$0")/../.." && pwd)
if (( EUID != 0 || $# != 1 )); then
    echo 'Usage: sudo bash vpn-server/tests/compose-lab.sh PREBUILT_IMAGE_ARCHIVE' >&2
    exit 2
fi
images=$(realpath "$1")
[[ -f "$images" ]]
if [[ ! -v RSX_COMPOSE_PARENT ]]; then
    export RSX_COMPOSE_PARENT
    RSX_COMPOSE_PARENT=$(readlink /proc/self/ns/net)
    exec unshare --mount --net --propagation private bash "$0" "$images"
fi
[[ "$(readlink /proc/self/ns/net)" != "$RSX_COMPOSE_PARENT" ]]

umask 077
work=$(mktemp -d)
mount -t tmpfs -o mode=0755 tmpfs /run
mount -t tmpfs -o mode=0755 tmpfs /etc/unbound
ip link set lo up
export DOCKER_HOST=unix://$work/docker.sock
unset DOCKER_CONTEXT COMPOSE_FILE COMPOSE_PROFILES
mkdir -p "$work/docker/certs"
cp "$repo/docker/docker-compose.yml" "$work/docker/"
compose_files=(-f "$work/docker/docker-compose.yml")
compose() { docker compose --project-name remoteshield --env-file "$work/fixture.env" "${compose_files[@]}" "$@"; }
cleanup() {
    local result=$?
    if [[ -n "${resolver:-}" ]]; then
        kill "$resolver" 2>/dev/null || :
        wait "$resolver" || :
    fi
    if [[ -n "${daemon:-}" ]] && kill -0 "$daemon" 2>/dev/null; then
        if (( result != 0 )); then
            compose ps -a >&2 || :
            tail -35 "$work/dockerd.log" >&2
        fi
        compose down --volumes --timeout 3 >/dev/null 2>&1 || :
        kill "$daemon" 2>/dev/null || :
        wait "$daemon" || :
    fi
    rm -rf -- "$work"
}
trap cleanup EXIT

add_link() {
    local peer=$1 access=$2 gateway_ip=$3 client_ip=$4
    ip netns add "$peer"
    ip link add "$access" type veth peer name underlay netns "$peer"
    ip addr add "$gateway_ip/24" dev "$access"
    ip link set "$access" up
    ip -n "$peer" addr add "$client_ip/24" dev underlay
    ip -n "$peer" link set underlay up
    ip -n "$peer" link set lo up
    ip -n "$peer" route add default via "$gateway_ip"
}
add_link client access0 192.0.2.1 192.0.2.2
add_link outsider outsider0 192.0.3.1 192.0.3.2
sysctl -qw net.ipv4.ip_forward=1 net.ipv6.conf.all.forwarding=1
export RSX_WG_STATE_DIR="$work/gateway"
bash "$repo/vpn-server/setup.sh" init 192.0.2.1
bash "$repo/vpn-server/setup.sh" up access0
peer() { python3 "$repo/vpn-server/peerctl.py" --state-dir "$RSX_WG_STATE_DIR" "$@"; }
device=00000000-0000-4000-8000-000000000801
wg genkey > "$work/client.key"
peer add "$device" "$(wg pubkey < "$work/client.key")"
peer profile "$device" --linux | python3 -c '
from pathlib import Path
import sys
text = sys.stdin.read().replace("<INSERT DEVICE PRIVATE KEY LOCALLY>", Path(sys.argv[1]).read_text().strip())
print("\n".join(line for line in text.splitlines() if not line.startswith("DNS =")))
' "$work/client.key" > "$work/wg0.conf"
ip netns exec client bash "$repo/vpn-server/linux-client.sh" up "$work/wg0.conf" 192.0.2.1

domain=control.phase08.test
cp "$repo/vpn-server/wireguard/unbound.conf" /etc/unbound/rsx-gateway.conf
cat > /etc/unbound/rsx-compose.conf <<EOF
include: "/etc/unbound/rsx-gateway.conf"
server:
    username: ""
    chroot: ""
    directory: "/etc/unbound"
    pidfile: ""
    use-syslog: no
    local-zone: "phase08.test." static
    local-data: "$domain. 60 IN A 10.8.0.1"
EOF
unbound-checkconf /etc/unbound/rsx-compose.conf
unbound -d -c /etc/unbound/rsx-compose.conf >"$work/dns.log" 2>&1 &
resolver=$!
printf 'nameserver 10.8.0.1\n' > "$work/resolv.conf"
{
    printf 'DOMAIN=%s\nCORS_ORIGINS=https://%s\nDB_NETWORK_TRUSTED=true\n' "$domain" "$domain"
    for key in DB_PASS DB_RUNTIME_PASS JWT_SECRET JWT_REFRESH_SECRET; do
        printf '%s=%s\n' "$key" "$(openssl rand -hex 32)"
    done
} > "$work/fixture.env"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=$domain" \
    -addext "subjectAltName=DNS:$domain" -keyout "$work/docker/certs/tls.key" \
    -out "$work/docker/certs/tls.crt" >"$work/tls.log" 2>&1
printf '{"userland-proxy":false,"ip-forward-no-drop":true}\n' > "$work/daemon.json"
dockerd --config-file "$work/daemon.json" --host "$DOCKER_HOST" \
    --data-root "$work/engine" --exec-root "$work/exec" --pidfile "$work/daemon.pid" \
    >"$work/dockerd.log" 2>&1 &
daemon=$!
for _ in {1..30}; do
    if docker info >/dev/null 2>&1; then break; fi
    kill -0 "$daemon"
    sleep 1
done
docker version --format 'Docker Engine {{.Server.Version}}'
docker compose version
docker load --input "$images"
postgres_image=$(compose config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["postgres"]["image"])')
if ! docker image inspect "$postgres_image" >/dev/null 2>&1; then
    # Offline OCI import can preserve the manifest ID without the registry name.
    postgres_digest=${postgres_image##*@}
    [[ "$postgres_digest" =~ ^sha256:[[:xdigit:]]{64}$ ]]
    docker image inspect "$postgres_digest" >/dev/null
    docker image tag "$postgres_digest" rsx-lab-postgres:verified
    printf 'services:\n  postgres:\n    image: rsx-lab-postgres:verified\n' > "$work/docker/offline.yml"
    compose_files+=(-f "$work/docker/offline.yml")
fi
compose up -d --no-build --pull never --wait --wait-timeout 90

query() {
    local namespace=$1 address=$2 path=$3
    ip netns exec "$namespace" curl -fsS --noproxy '*' --max-time 3 \
        --cacert "$work/docker/certs/tls.crt" --resolve "$domain:443:$address" \
        -H 'X-Forwarded-For: 10.8.0.99' "https://$domain$path"
}
status() {
    query client 10.8.0.1 /api/v1/network/status | python3 -c '
import json,sys
assert json.load(sys.stdin) == {"sourceGate":"accepted", "observedAddress":"10.8.0.2",
                               "sourceMode":"tunnel", "trafficEnforcement":"external"}
'
}
denied() {
    if query "$@" >/dev/null 2>&1; then
        echo "Unexpected network access: $*" >&2
        return 1
    fi
}
status
echo 'PASS actual Compose TLS edge preserves WireGuard source and overwrites spoofed forwarding'
# The child shell expands its own fixture arguments inside the private mount.
# shellcheck disable=SC2016
ip netns exec client unshare --mount --propagation private bash -euo pipefail -c '
    mount --bind "$1" /etc/resolv.conf
    curl -fsS --noproxy "*" --max-time 3 --cacert "$2" "https://$3/api/v1/network/status"
' bash "$work/resolv.conf" "$work/docker/certs/tls.crt" "$domain" | python3 -c '
import json,sys
assert json.load(sys.stdin)["observedAddress"] == "10.8.0.2"
'
echo 'PASS control hostname resolves and reaches the Compose edge through tunnel DNS'
query client 10.8.0.1 /ready | python3 -c 'import json,sys; assert json.load(sys.stdin)["status"] == "ready"'
query client 10.8.0.1 '/socket.io/?EIO=4&transport=polling' | python3 -c 'import json,sys; data=sys.stdin.read(); assert data[0]=="0" and json.loads(data[1:])["sid"]'
echo 'PASS migrated PostgreSQL readiness and Socket.IO handshake through Compose'
denied outsider 10.8.0.1 /api/v1/network/status
denied outsider 192.0.3.1 /api/v1/network/status
denied outsider 172.20.0.10 /api/v1/network/status
denied client 172.20.0.10 /api/v1/network/status
echo 'PASS off-tunnel and direct container access denied'

ip link delete wg0
denied client 10.8.0.1 /api/v1/network/status
bash "$repo/vpn-server/setup.sh" up access0
reconnected=false
for _ in {1..5}; do
    if status 2>/dev/null; then
        reconnected=true
        break
    fi
done
[[ "$reconnected" == true ]]
echo 'PASS recreated gateway reloads its peer registry and existing Compose edge reconnects'

peer revoke "$device"
denied client 10.8.0.1 /api/v1/network/status
ip link delete wg0
bash "$repo/vpn-server/setup.sh" up access0
[[ -z "$(wg show wg0 peers)" ]]
denied client 10.8.0.1 /api/v1/network/status
echo 'PASS revoked peer cannot reach the running Compose edge after gateway recreation'
