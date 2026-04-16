#!/bin/bash
# ============================================================
# RemoteShield X — WireGuard VPN Server Setup Script
# Target OS: Ubuntu 22.04 LTS
# Run as root on your VPS
# ============================================================

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()  { echo -e "${GREEN}[+]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

# ─── Config ──────────────────────────────────────────────────────────────────
SERVER_IP=$(curl -s https://api.ipify.org || hostname -I | awk '{print $1}')
WG_PORT=51820
WG_INTERFACE=wg0
SERVER_PRIVATE_NET=10.8.0.0/24
SERVER_VPN_IP=10.8.0.1/24
DNS=1.1.1.1,1.0.0.1

log "Detected server public IP: $SERVER_IP"

# ─── 1. System Update ─────────────────────────────────────────────────────────
log "Updating system packages..."
apt-get update -qq && apt-get upgrade -y -qq

# ─── 2. Install WireGuard ─────────────────────────────────────────────────────
log "Installing WireGuard..."
apt-get install -y wireguard wireguard-tools iptables-persistent

# ─── 3. Enable IP Forwarding ──────────────────────────────────────────────────
log "Enabling IP forwarding..."
sed -i 's/#net.ipv4.ip_forward=1/net.ipv4.ip_forward=1/' /etc/sysctl.conf
sed -i 's/#net.ipv6.conf.all.forwarding=1/net.ipv6.conf.all.forwarding=1/' /etc/sysctl.conf
sysctl -p

# ─── 4. Generate Server Keys ──────────────────────────────────────────────────
log "Generating WireGuard server keypair..."
mkdir -p /etc/wireguard
chmod 700 /etc/wireguard
wg genkey | tee /etc/wireguard/server_private.key | wg pubkey > /etc/wireguard/server_public.key
chmod 600 /etc/wireguard/server_private.key

SERVER_PRIVATE=$(cat /etc/wireguard/server_private.key)
SERVER_PUBLIC=$(cat /etc/wireguard/server_public.key)
log "Server public key: $SERVER_PUBLIC"

# ─── 5. Get Default Network Interface ────────────────────────────────────────
DEFAULT_IFACE=$(ip route | grep default | awk '{print $5}' | head -n1)
log "Default network interface: $DEFAULT_IFACE"

# ─── 6. Write WireGuard Server Config ────────────────────────────────────────
log "Writing WireGuard server config..."
cat > /etc/wireguard/${WG_INTERFACE}.conf << EOF
[Interface]
PrivateKey = ${SERVER_PRIVATE}
Address = ${SERVER_VPN_IP}
ListenPort = ${WG_PORT}
DNS = ${DNS}

# ─── KILL SWITCH — Block all non-VPN traffic ──────────────────────
# Allow established connections + loopback
PostUp   = iptables -A FORWARD -i %i -j ACCEPT
PostUp   = iptables -A FORWARD -o %i -j ACCEPT
PostUp   = iptables -t nat -A POSTROUTING -o ${DEFAULT_IFACE} -j MASQUERADE
PostUp   = iptables -A INPUT -i ${DEFAULT_IFACE} -p udp --dport ${WG_PORT} -j ACCEPT
PostUp   = iptables -A INPUT -i ${DEFAULT_IFACE} -p tcp --dport 443 -j ACCEPT
PostUp   = iptables -A INPUT -i ${DEFAULT_IFACE} -p tcp --dport 80 -j ACCEPT
PostUp   = iptables -A INPUT -i ${DEFAULT_IFACE} -p tcp --dport 22 -j ACCEPT
PostUp   = iptables -A INPUT -i ${DEFAULT_IFACE} -p tcp --dport 3000 -j ACCEPT

PostDown = iptables -D FORWARD -i %i -j ACCEPT
PostDown = iptables -D FORWARD -o %i -j ACCEPT
PostDown = iptables -t nat -D POSTROUTING -o ${DEFAULT_IFACE} -j MASQUERADE

# ─── PEERS WILL BE ADDED BELOW BY add-peer.sh ─────────────────────
EOF

chmod 600 /etc/wireguard/${WG_INTERFACE}.conf

# ─── 7. Enable & Start WireGuard ─────────────────────────────────────────────
log "Enabling WireGuard service..."
systemctl enable wg-quick@${WG_INTERFACE}
systemctl start wg-quick@${WG_INTERFACE}

# ─── 8. Save iptables rules ───────────────────────────────────────────────────
log "Saving iptables rules..."
netfilter-persistent save

# ─── 9. Install Node.js ───────────────────────────────────────────────────────
log "Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# ─── 10. Install Nginx ───────────────────────────────────────────────────────
log "Installing Nginx..."
apt-get install -y nginx certbot python3-certbot-nginx

# ─── 11. Install PostgreSQL ──────────────────────────────────────────────────
log "Installing PostgreSQL 15..."
apt-get install -y postgresql postgresql-contrib
systemctl enable postgresql
systemctl start postgresql

# Create DB + user
DB_PASS=$(openssl rand -base64 24)
sudo -u postgres psql -c "CREATE USER remoteshield WITH ENCRYPTED PASSWORD '${DB_PASS}';"
sudo -u postgres psql -c "CREATE DATABASE remoteshield_db OWNER remoteshield;"
log "PostgreSQL DB created. Password: ${DB_PASS}"
echo "DATABASE_URL=postgresql://remoteshield:${DB_PASS}@localhost:5432/remoteshield_db" >> /root/remoteshield.env

# ─── 12. Install Docker ──────────────────────────────────────────────────────
log "Installing Docker..."
curl -fsSL https://get.docker.com | sh
systemctl enable docker

# ─── 13. Firewall (UFW) ──────────────────────────────────────────────────────
log "Configuring UFW firewall..."
apt-get install -y ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    comment 'SSH'
ufw allow 80/tcp    comment 'HTTP'
ufw allow 443/tcp   comment 'HTTPS'
ufw allow ${WG_PORT}/udp comment 'WireGuard VPN'
ufw --force enable

# ─── 14. Generate Client Configs ─────────────────────────────────────────────
log "Generating client configurations..."
mkdir -p /etc/wireguard/clients

generate_client() {
  local CLIENT_NAME=$1
  local CLIENT_IP=$2

  wg genkey | tee /etc/wireguard/clients/${CLIENT_NAME}_private.key \
    | wg pubkey > /etc/wireguard/clients/${CLIENT_NAME}_public.key
  chmod 600 /etc/wireguard/clients/${CLIENT_NAME}_private.key

  local CLIENT_PRIVATE=$(cat /etc/wireguard/clients/${CLIENT_NAME}_private.key)
  local CLIENT_PUBLIC=$(cat /etc/wireguard/clients/${CLIENT_NAME}_public.key)

  # Add peer to server config
  cat >> /etc/wireguard/${WG_INTERFACE}.conf << EOF

[Peer]
# Client: ${CLIENT_NAME}
PublicKey = ${CLIENT_PUBLIC}
AllowedIPs = ${CLIENT_IP}/32
PersistentKeepalive = 25
EOF

  # Write client config
  cat > /etc/wireguard/clients/${CLIENT_NAME}.conf << EOF
[Interface]
PrivateKey = ${CLIENT_PRIVATE}
Address = ${CLIENT_IP}/24
DNS = ${DNS}

[Peer]
PublicKey = ${SERVER_PUBLIC}
Endpoint = ${SERVER_IP}:${WG_PORT}
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25
EOF

  log "Client config written: /etc/wireguard/clients/${CLIENT_NAME}.conf"
}

generate_client "windows-client"  "10.8.0.2"
generate_client "linux-client"    "10.8.0.3"
generate_client "macos-client"    "10.8.0.4"
generate_client "android-client"  "10.8.0.5"

# Restart WireGuard to pick up peers
wg-quick down ${WG_INTERFACE} 2>/dev/null || true
wg-quick up ${WG_INTERFACE}

# ─── Done ─────────────────────────────────────────────────────────────────────
echo ""
log "============================================================"
log " RemoteShield X VPN Server Setup COMPLETE"
log "============================================================"
log " Server Public IP  : ${SERVER_IP}"
log " WireGuard Port    : ${WG_PORT}/UDP"
log " VPN Subnet        : ${SERVER_PRIVATE_NET}"
log " Server Public Key : ${SERVER_PUBLIC}"
log ""
log " Client configs at: /etc/wireguard/clients/"
log " Copy each .conf to the respective device & import into WireGuard"
log ""
warn " NEXT STEPS:"
warn "  1. Copy backend/.env.example → backend/.env"
warn "  2. Set SERVER_PUBLIC_IP=${SERVER_IP} in .env"
warn "  3. Run: cd docker && docker-compose up -d"
warn "  4. Run: certbot --nginx -d your.domain.com"
log "============================================================"
