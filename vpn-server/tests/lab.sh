#!/usr/bin/env bash
set -euo pipefail
base=$(cd -- "$(dirname -- "$0")/.." && pwd)
if (( EUID != 0 )); then
    echo 'Run the packet lab with sudo on Linux or as root in a disposable guest.' >&2
    exit 2
fi
if [[ "${1:-}" != isolated ]]; then
    export RSX_PARENT_NET
    RSX_PARENT_NET=$(readlink /proc/self/ns/net)
    exec unshare --mount --net --propagation private bash "$0" isolated
fi
[[ -n "${RSX_PARENT_NET:-}" && "$(readlink /proc/self/ns/net)" != "$RSX_PARENT_NET" ]]
umask 077
work=$(mktemp -d)
declare -a processes=()
cleanup() {
    local result=$?
    if (( result != 0 )) && [[ -f "$work/services.log" ]]; then
        cat "$work/services.log" >&2
    fi
    for pid in "${processes[@]}"; do kill "$pid" 2>/dev/null || :; done
    wait || :
    rm -rf -- "$work"
}
trap cleanup EXIT
mount -t tmpfs -o mode=0755 tmpfs /run
# Distribution AppArmor profiles allow resolver configuration in /etc/unbound.
# Mount a private directory there so the real system configuration stays intact.
[[ -d /etc/unbound ]]
mount -t tmpfs -o mode=0755 tmpfs /etc/unbound
for ns in gateway client outsider edge; do
    ip netns add "$ns"
    ip -n "$ns" link set lo up
done
run() { ip netns exec "$@"; }
link() {
    ip link add "$1" type veth peer name "$3"
    ip link set "$1" netns "$2"
    ip link set "$3" netns "$4"
    ip -n "$2" link set "$1" up
    ip -n "$4" link set "$3" up
}
link access0 gateway underlay0 client
link outsider0 gateway underlay0 outsider
link wan0 gateway edge0 edge
link br-rsx-control gateway control0 edge
ip -n gateway addr add 192.0.2.1/24 dev access0
ip -n gateway addr add 192.0.3.1/24 dev outsider0
ip -n gateway addr add 198.51.100.1/24 dev wan0
ip -n gateway -6 addr add 2001:db8:1::1/64 dev wan0 nodad
ip -n gateway -6 addr add 2001:db8:2::1/64 dev access0 nodad
ip -n client addr add 192.0.2.2/24 dev underlay0
ip -n client -6 addr add 2001:db8:2::2/64 dev underlay0 nodad
ip -n client route add default via 192.0.2.1
ip -n client -6 route add default via 2001:db8:2::1
ip -n outsider addr add 192.0.3.2/24 dev underlay0
ip -n outsider route add default via 192.0.3.1
ip -n edge addr add 198.51.100.2/24 dev edge0
ip -n edge -6 addr add 2001:db8:1::2/64 dev edge0 nodad
ip -n gateway addr add 172.20.0.1/24 dev br-rsx-control
ip -n edge addr add 172.20.0.10/24 dev control0
ip -n edge route add 10.8.0.0/24 via 172.20.0.1
run gateway sysctl -qw net.ipv4.ip_forward=1 net.ipv6.conf.all.forwarding=1
export RSX_WG_STATE_DIR="$work/state"
peer() { run gateway python3 "$base/peerctl.py" --state-dir "$RSX_WG_STATE_DIR" "$@"; }
identity=00000000-0000-4000-8000-000000000001
second=00000000-0000-4000-8000-000000000002
run gateway bash "$base/setup.sh" init 192.0.2.1
run gateway bash "$base/setup.sh" up wan0
run gateway bash "$base/firewall/apply.sh" gateway wan0
wg genkey > "$work/client.key"
wg genkey > "$work/next.key"
wg genkey > "$work/outsider.key"
public=$(wg pubkey < "$work/client.key")
replacement=$(wg pubkey < "$work/next.key")
peer add "$identity" "$public"
if peer add "$second" "$public" > /dev/null 2>&1; then
    echo 'Duplicate public key accepted' >&2; exit 1
fi
peer add "$second" "$(wg pubkey < "$work/outsider.key")"
[[ "$(stat -c %a "$RSX_WG_STATE_DIR/server.key")" == 600 ]]
mkdir "$work/client" "$work/outsider"
client_config() {
    local profile=$1 private=$2 config=$3
    # The lab explicitly queries the resolver. It never changes the host resolver.
    python3 - "$profile" "$private" "$config" <<'PY'
from pathlib import Path
import sys
profile, private, config = map(Path, sys.argv[1:])
text = profile.read_text().replace("<INSERT DEVICE PRIVATE KEY LOCALLY>", private.read_text().strip())
Path(config).write_text("\n".join(line for line in text.splitlines() if not line.startswith("DNS ="))
                        + "\n")
PY
}
peer profile "$identity" --linux > "$work/template"
client_config "$work/template" "$work/client.key" "$work/client/wg0.conf"
peer profile "$second" --linux > "$work/second"
# Verify active devices get different addresses and then remove the second peer.
grep -q '10.8.0.3/32, fd42:5253:5800::3/128' "$work/second"
peer revoke "$second"
client_config "$work/second" "$work/outsider.key" "$work/outsider/wg0.conf"
run client bash "$base/firewall/apply.sh" client 192.0.2.1
run client bash "$base/firewall/apply.sh" client 192.0.2.1

start() {
    ip netns exec "$@" >>"$work/services.log" 2>&1 &
    last_pid=$!
    processes+=("$last_pid")
}
start edge python3 "$base/tests/observer.py" 198.51.100.2 80
start edge python3 "$base/tests/observer.py" 2001:db8:1::2 80
start edge python3 "$base/tests/observer.py" 198.51.100.2 8080
start edge python3 "$base/tests/observer.py" 127.0.0.1 3000 forwarded
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=gateway.phase08.test \
    -addext subjectAltName=DNS:gateway.phase08.test -keyout "$work/tls.key" -out "$work/tls.crt" \
    >> "$work/services.log" 2>&1
sed -e "s/\${DOMAIN}/gateway.phase08.test/g" -e 's/backend:3000 resolve/127.0.0.1:3000/' \
    -e 's/listen 8080;/listen 172.20.0.10:80;/' -e 's/listen 8443 ssl;/listen 172.20.0.10:443 ssl;/' \
    -e "s@/etc/nginx/certs/@$work/@" "$base/../nginx/nginx.conf.template" > "$work/edge.conf"
cat > "$work/nginx.conf" <<EOF
pid $work/nginx.pid;
error_log stderr;
events {}
http {
    access_log stderr;
    include $work/edge.conf;
}
EOF
run edge nginx -t -e stderr -p "$work" -c "$work/nginx.conf"
start edge nginx -e stderr -p "$work" -c "$work/nginx.conf" -g 'daemon off;'
start gateway python3 "$base/tests/observer.py" 10.8.0.1 443
cp "$base/wireguard/unbound.conf" /etc/unbound/rsx-gateway.conf
cat > /etc/unbound/rsx-lab.conf <<'EOF'
include: "/etc/unbound/rsx-gateway.conf"
server:
    username: ""
    chroot: ""
    directory: "/etc/unbound"
    pidfile: ""
    use-syslog: no
    local-zone: "phase08.test." static
    local-data: "gateway.phase08.test. 60 IN A 198.51.100.2"
EOF
start gateway unbound -d -c /etc/unbound/rsx-lab.conf
resolver=$last_pid
cat > /etc/unbound/rsx-edge.conf <<'EOF'
server:
    username: ""
    chroot: ""
    directory: "/etc/unbound"
    pidfile: ""
    use-syslog: no
    interface: 198.51.100.2
    interface: 2001:db8:1::2
    access-control: 0.0.0.0/0 allow
    access-control: ::/0 allow
    local-zone: "phase08.test." static
    local-data: "gateway.phase08.test. 60 IN A 198.51.100.2"
EOF
start edge unbound -d -c /etc/unbound/rsx-edge.conf
start gateway tcpdump -U -n -i access0 -w "$work/underlay.pcap" 'ip or ip6'
capture=$last_pid
ready=false
for _ in {1..30}; do
    if run gateway ss -ltnH 'sport = :443' | grep -q 443 &&
        run gateway ss -ltnH 'sport = :53' | grep -q '10.8.0.1' &&
        run edge ss -ltnH 'sport = :80' | grep -q '2001:db8:1::2' &&
        run edge ss -ltnH 'sport = :53' | grep -q '2001:db8:1::2' &&
        run edge ss -ltnH 'sport = :443' | grep -q '172.20.0.10:443' &&
        run edge ss -ltnH 'sport = :3000' | grep -q 3000; then
        ready=true
        break
    fi
    sleep 0.2
done
[[ "$ready" == true ]]
kill -0 "$resolver"
kill -0 "$capture"
curl_lab() { run "$1" curl --silent --fail --noproxy '*' --max-time 3 "$2"; }
expect_failure() {
    if "$@" >/dev/null 2>&1; then echo "Unexpected success: $*" >&2; exit 1; fi
}
expect_dns_failure() {
    local result
    result=$(run client dig "$@" gateway.phase08.test A +short +time=1 +tries=1 2>/dev/null) || return 0
    [[ -z "$result" ]]
}
connect() { run "$1" bash "$base/linux-client.sh" "$2" "$work/$1/wg0.conf" 192.0.2.1; }
connect client up
if [[ $(curl_lab client http://10.8.0.1:443) != 10.8.0.2 ]]; then
    ip -n client route get 10.8.0.1 >&2
    run client wg show wg0 >&2
    run gateway wg show wg0 >&2
    run gateway ss -ltn >&2
    ip -n gateway route get 10.8.0.2 >&2
    run gateway nft list table inet rsx_gateway >&2
    exit 1
fi
[[ $(curl_lab client http://198.51.100.2) == 198.51.100.1 ]]
[[ $(curl_lab client 'http://[2001:db8:1::2]') == 2001:db8:1::1 ]]
echo 'PASS gateway, IPv4 and IPv6 NAT egress'
# Mirror a Docker IPv4 publication at the exact tunnel address. Preserve the
# peer source at the edge and exercise the pre-Docker ingress drop.
run gateway nft -f - <<'NFT'
table ip rsx_lab_edge {
    chain publish {
        type nat hook prerouting priority dstnat; policy accept;
        ip daddr 10.8.0.1 tcp dport 443 dnat to 172.20.0.10:443
    }
}
NFT
curl_edge() {
    run "$1" curl --silent --fail --noproxy '*' --max-time 3 --cacert "$work/tls.crt" \
        --resolve "gateway.phase08.test:443:$2" -H 'X-Forwarded-For: 10.8.0.99' \
        https://gateway.phase08.test/api/v1/network/status
}
actual=$(curl_edge client 10.8.0.1) || {
    run client curl -v --noproxy '*' --max-time 3 --cacert "$work/tls.crt" \
        --resolve 'gateway.phase08.test:443:10.8.0.1' https://gateway.phase08.test/api/v1/network/status >&2
    exit 1
}
[[ "$actual" == 10.8.0.2 ]]
expect_failure curl_edge outsider 10.8.0.1
expect_failure curl_edge client 172.20.0.10
echo 'PASS TLS edge overwrites forwarding, preserves peer IP and denies off-tunnel access'
[[ $(run client dig @10.8.0.1 gateway.phase08.test +short +time=2 +tries=1) == 198.51.100.2 ]]
[[ $(run client dig +tcp @fd42:5253:5800::1 gateway.phase08.test +short +time=2 +tries=1) == 198.51.100.2 ]]
[[ $(run edge dig @198.51.100.2 gateway.phase08.test +short +time=2 +tries=1) == 198.51.100.2 ]]
[[ $(run edge dig +tcp @2001:db8:1::2 gateway.phase08.test +short +time=2 +tries=1) == 198.51.100.2 ]]
expect_dns_failure @198.51.100.2
expect_dns_failure +tcp @2001:db8:1::2
expect_failure curl_lab client http://198.51.100.2:8080
echo 'PASS tunnel DNS over UDP and TCP, external DNS and unapproved port blocked'
kill "$resolver"
wait "$resolver" || :
expect_dns_failure @10.8.0.1
expect_dns_failure @fd42:5253:5800::1
expect_dns_failure @192.0.2.1
echo 'PASS DNS outage with no direct fallback'

ip -n gateway link set wg0 down
expect_failure curl_lab client http://198.51.100.2
expect_failure curl_lab client 'http://[2001:db8:1::2]'
ip -n gateway link set wg0 up
for _ in {1..4}; do
    observed=$(curl_lab client http://198.51.100.2) && break
done
[[ "$observed" == 198.51.100.1 ]]
echo 'PASS remote tunnel loss and recovery with client interface still up'
connect client down
expect_failure curl_lab client http://198.51.100.2
expect_failure curl_lab client 'http://[2001:db8:1::2]'
expect_dns_failure @192.0.2.1
expect_dns_failure @2001:db8:2::1
connect client up
[[ $(curl_lab client http://198.51.100.2) == 198.51.100.1 ]]
echo 'PASS tunnel removal, IPv4/IPv6 kill switch and reconnect'
ip -n outsider route add 192.0.2.1/32 via 192.0.3.1
connect outsider up
expect_failure curl_lab outsider http://10.8.0.1:443
expect_failure curl_lab outsider http://198.51.100.2
[[ $(run outsider wg show wg0 latest-handshakes | awk '{print $2}') == 0 ]]
peer rotate "$identity" "$replacement"
expect_failure curl_lab client http://198.51.100.2
run client wg set wg0 private-key "$work/next.key"
[[ $(curl_lab client http://198.51.100.2) == 198.51.100.1 ]]
peer status | python3 -c 'import json,sys; j=json.load(sys.stdin); assert j["registryMatchesLive"] and j["peers"][0]["handshakeAgeSeconds"] is not None'
peer revoke "$identity"
expect_failure curl_lab client http://198.51.100.2
[[ -z $(run gateway wg show wg0 peers) ]]
echo 'PASS unauthorized peer, key rotation, status and immediate revocation'

kill -INT "$capture"
wait "$capture"
filter='not (ip6 protochain 58) and not (udp port 51820 and host 192.0.2.1)'
# The gateway kernel can return ICMP port-unreachable during the simulated
# link outage. Match just that reply, including the quoted UDP destination.
filter+=' and not (icmp and src host 192.0.2.1 and dst host 192.0.2.2 and icmp[0] = 3 and icmp[1] = 3 and icmp[17] = 17 and icmp[30:2] = 51820)'
unexpected=$(tcpdump -nn -r "$work/underlay.pcap" "$filter" 2>/dev/null)
if [[ -n "$unexpected" ]]; then
    printf '%s\n' "$unexpected" >&2
    echo 'Unexpected cleartext IP payload on client underlay' >&2; exit 1
fi
packets=$(tcpdump -nn -r "$work/underlay.pcap" 'udp port 51820 and host 192.0.2.1' 2>/dev/null | wc -l)
(( packets > 0 ))
echo "PASS underlay packet capture: $packets WireGuard UDP packets, zero unexpected IP packets (ICMPv6 and WireGuard port-unreachable replies excluded)"
