#!/usr/bin/env bash
# Linux-only client routing. The independently installed firewall remains active.
set -euo pipefail
base=$(cd -- "$(dirname -- "$0")" && pwd)
if (( EUID != 0 || $# != 3 )) || [[ "${2##*/}" != wg0.conf ]]; then
    echo 'Usage (root): linux-client.sh up|down /absolute/path/wg0.conf ENDPOINT_IPV4' >&2
    exit 2
fi
config=$2
endpoint=$3
table=5395288
priority=11008
mark=0x525358

remove_routes() {
    for family in -4 -6; do
        if ip "$family" rule show | grep -Eq "^$priority:.*not.*fwmark $mark lookup $table$"; then
            ip "$family" rule del pref "$priority" not fwmark "$mark" table "$table"
        fi
    done
}

case "$1" in
    up)
        [[ "$config" == /* && -f "$config" && ! -L "$config" && $(stat -c '%a:%u' "$config") == 600:0 ]]
        grep -qx 'Table = off' "$config"
        grep -qx "FwMark = $mark" "$config"
        grep -Fxq "Endpoint = $endpoint:51820" "$config"
        for family in -4 -6; do
            if ip "$family" rule show | grep -q "^$priority:"; then
                echo "Policy rule priority $priority already in use. Inspect and recover from console." >&2
                exit 1
            fi
        done
        bash "$base/firewall/apply.sh" client "$endpoint"
        wg-quick up "$config"
        # Preserve the firewall and try both cleanup steps even if one fails.
        trap 'remove_routes || :; wg-quick down "$config" || :' ERR
        for family in -4 -6; do
            ip "$family" route add default dev wg0 table "$table"
            ip "$family" rule add pref "$priority" not fwmark "$mark" lookup "$table"
        done
        ;;
    down)
        nft list table inet rsx_client >/dev/null
        remove_routes
        if ip link show wg0 >/dev/null 2>&1; then wg-quick down "$config"; fi
        ;;
    *)
        echo 'Unknown Linux client operation.' >&2
        exit 2
        ;;
esac
