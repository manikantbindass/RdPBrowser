#!/usr/bin/env bash
# Prepare or start a dedicated gateway. Package installation is an operator step.
set -euo pipefail
base=$(cd -- "$(dirname -- "$0")" && pwd)
state=${RSX_WG_STATE_DIR:-/etc/remoteshield/wireguard}
if (( EUID != 0 )); then
    echo 'Run gateway setup as root on the dedicated Linux gateway.' >&2
    exit 2
fi
if (( $# != 2 )); then
    echo 'Usage: setup.sh init PUBLIC_IPV4 | setup.sh up UPLINK' >&2
    exit 2
fi
case "$1" in
    init)
        exec python3 "$base/peerctl.py" --state-dir "$state" init "$2"
        ;;
    up)
        if ip link show wg0 >/dev/null 2>&1; then
            echo 'wg0 already exists. Use peerctl sync for a managed interface.' >&2
            exit 1
        fi
        # Load the scoped firewall before making the tunnel reachable.
        bash "$base/firewall/apply.sh" gateway "$2"
        ip link add wg0 type wireguard
        trap 'ip link delete wg0' ERR
        ip address add 10.8.0.1/24 dev wg0
        ip -6 address add fd42:5253:5800::1/64 dev wg0
        python3 "$base/peerctl.py" --state-dir "$state" sync
        ip link set wg0 up
        ;;
    *)
        echo 'Unknown gateway operation.' >&2
        exit 2
        ;;
esac
