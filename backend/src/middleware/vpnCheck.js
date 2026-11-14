'use strict';

const ipRangeCheck = require('ip-range-check');

/**
 * VPN Enforcement Middleware
 *
 * Blocks any request that does NOT originate from the WireGuard VPN subnet.
 * On a properly configured VPS, all client traffic arrives via wg0 with
 * source IPs in the VPN_SUBNET (e.g. 10.8.0.0/24).
 *
 * In development mode (NODE_ENV=development) this check is bypassed.
 */
function vpnCheck(req, res, next) {
  const config = req.app.locals.config;
  if (!config.VPN_REQUIRED) {
    req.vpnClientIp = req.ip;
    return next();
  }

  const vpnSubnet = config.VPN_SUBNET;

  // Support X-Forwarded-For when behind Nginx (but only trust internal forwarding)
  const clientIp = req.ip;

  // Strip IPv6 prefix if needed (::ffff:10.8.0.x)
  const normalizedIp = clientIp.replace(/^::ffff:/, '');

  try {
    const inVpn = ipRangeCheck(normalizedIp, vpnSubnet);
    if (!inVpn) {
      req.app.get('logger').warn({ event: 'api.source_denied', requestId: req.requestId });
      return res.status(403).json({
        error: 'Access denied: API source address is outside the configured VPN subnet.',
        code: 'VPN_REQUIRED',
      });
    }
    req.vpnClientIp = normalizedIp;
    next();
  } catch (err) {
    req.app.get('logger').error({ event: 'api.source_check_failed', requestId: req.requestId });
    return res.status(500).json({ error: 'VPN verification failed' });
  }
}

module.exports = { vpnCheck };
