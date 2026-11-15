'use strict';

const { createNetworkSource } = require('../services/network-source');

function createVpnCheck(config) {
  const observe = createNetworkSource(config);
  return (req, res, next) => {
    const source = observe(req);
    if (source.state === 'denied') {
      req.app.get('logger').warn({ event: 'api.source_denied', requestId: req.requestId });
      return res.status(403).json({
        error: 'Access denied: API source address is outside the approved network.',
        code: 'VPN_REQUIRED',
      });
    }
    req.networkSource = source;
    req.vpnClientIp = source.address;
    next();
  };
}

module.exports = { createVpnCheck };
