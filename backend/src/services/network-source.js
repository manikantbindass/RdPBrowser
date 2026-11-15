'use strict';

const { isIP, SocketAddress } = require('node:net');
const proxyAddress = require('proxy-addr');
const inRange = require('ip-range-check');

function normalizeAddress(value) {
  const family = typeof value === 'string' ? isIP(value) : 0;
  if (!family || value.includes('%')) return null;
  if (family === 4) return value;
  return new SocketAddress({ address: value, family: 'ipv6' }).address.replace(/^::ffff:(?=\d+\.)/, '');
}

function createNetworkSource(config) {
  const trust = config.trustedProxies.length ? proxyAddress.compile(config.trustedProxies) : () => false;
  const egress = new Set(config.vpnEgressIps);
  return req => {
    const direct = normalizeAddress(req.socket.remoteAddress);
    if (!direct) return { state: 'denied', address: null };
    let address = direct;
    if (trust(direct)) {
      // The dedicated edge overwrites this header. Trust exactly one address.
      address = normalizeAddress(typeof req.headers['x-forwarded-for'] === 'string' ? req.headers['x-forwarded-for'].trim() : null);
      if (!address) return { state: 'denied', address: null };
    }
    if (!config.VPN_REQUIRED) return { state: 'disabled', address };
    const approved = config.VPN_SOURCE_MODE === 'egress'
      ? egress.has(address)
      : inRange(address, config.vpnSubnets);
    return { state: approved ? 'accepted' : 'denied', address };
  };
}

module.exports = { createNetworkSource, normalizeAddress };
