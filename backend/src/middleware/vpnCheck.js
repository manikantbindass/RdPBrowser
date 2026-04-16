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
  if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
    req.vpnClientIp = req.ip;
    return next();
  }

  const vpnSubnet = process.env.VPN_SUBNET || '10.8.0.0/24';

  // Support X-Forwarded-For when behind Nginx (but only trust internal forwarding)
  const forwardedFor = req.headers['x-forwarded-for'];
  const clientIp = forwardedFor
    ? forwardedFor.split(',')[0].trim()
    : req.socket.remoteAddress;

  // Strip IPv6 prefix if needed (::ffff:10.8.0.x)
  const normalizedIp = clientIp.replace(/^::ffff:/, '');

  try {
    const inVpn = ipRangeCheck(normalizedIp, vpnSubnet);
    if (!inVpn) {
      console.warn(`[VPN BLOCK] Non-VPN request from ${normalizedIp} to ${req.path}`);
      return res.status(403).json({
        error: 'Access denied: All traffic must route through the RemoteShield VPN tunnel.',
        code: 'VPN_REQUIRED',
      });
    }
    req.vpnClientIp = normalizedIp;
    next();
  } catch (err) {
    console.error('[VPN CHECK ERROR]', err);
    return res.status(500).json({ error: 'VPN verification failed' });
  }
}

module.exports = { vpnCheck };
