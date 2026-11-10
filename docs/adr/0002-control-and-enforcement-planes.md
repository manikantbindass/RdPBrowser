# ADR 0002: separate policy control from traffic enforcement

Status: accepted in Phase 02.

The control plane manages authentication/session records, policy decisions, administration and events. /api/proxy/navigate is retained for compatibility but authorizes a URL; it does not fetch browser content. /health is process liveness, /ready tests database/schema, and /api/v1/meta reports trafficEnforcement=external. None attest to VPN state.

WireGuard, OS route/firewall/DNS policy and native WebView navigation are the enforcement plane. Neither a client boolean nor an API response proves that the next network packet is tunneled. Backend VPN_REQUIRED is an API source-address filter. It cannot guarantee traffic egress, screenshot protection, binary integrity or DNS isolation. Existing native fail-open/bypass defects remain tracked in the Phase 01 register.

Express trusts only configured proxy addresses; Nginx overwrites forwarding headers. This follows the [Express trust-proxy model](https://expressjs.com/en/guide/behind-proxies/): configuration must match actual network hops. Production template uses an explicit edge IP; default direct-host mode trusts no proxy.

SSH remains an experimental network relay adapter, separate from policy routes, disabled by default and forbidden by production config. Existing development functionality can be explicitly enabled; it is not an enterprise SSH host-trust/destination policy. Realtime handshake and privileged room/actions reuse active session authentication. Future transport/enforcement adapters need their own threat model and acceptance suite before enabling production use.
