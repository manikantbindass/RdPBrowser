#!/usr/bin/env bash
set -euo pipefail
base=$(cd -- "$(dirname -- "$0")" && pwd)
if (( $# != 2 )); then
    echo 'Usage: apply.sh gateway UPLINK | apply.sh client ENDPOINT_IPV4' >&2
    exit 2
fi
case "$1" in
    gateway)
        [[ "$2" =~ ^[a-zA-Z0-9_.-]{1,15}$ && "$2" != wg0 && "$2" != lo && "$2" != br-rsx-control ]]
        ip link show dev "$2" >/dev/null
        exec nft -D "uplink=\"$2\"" -f "$base/gateway.nft"
        ;;
    client)
        endpoint=$(python3 -c 'import ipaddress,sys; print(ipaddress.IPv4Address(sys.argv[1]))' "$2")
        exec nft -D "endpoint=$endpoint" -f "$base/linux-client.nft"
        ;;
    *)
        echo 'Unknown firewall role' >&2
        exit 2
        ;;
esac
