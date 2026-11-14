'use strict';
const proxyAddress=require('proxy-addr');
const inRange=require('ip-range-check');
function createSourceGate(config) {
  const trust=config.trustedProxies.length ? proxyAddress.compile(config.trustedProxies) : () => false;
  const clients=new Map();
  return (req,callback) => {
    try {
      const origin=req.headers.origin;
      if (origin && !config.origins.includes(origin)) return callback('Origin denied',false);
      const address=proxyAddress(req,trust).replace(/^::ffff:/,'');
      if (config.VPN_REQUIRED && !inRange(address,config.VPN_SUBNET)) return callback('Source denied',false);
      const now=Date.now();
      if (clients.size>=10000) for (const [key,item] of clients) if (item.until<=now) clients.delete(key);
      const previous=clients.get(address);
      if (!previous && clients.size>=10000) return callback('Capacity exceeded',false);
      const item=previous && previous.until>now ? previous : { until:now+config.RATE_LIMIT_WINDOW_MS,count:0 };
      clients.set(address,item);
      if (++item.count>config.AUTH_RATE_LIMIT_MAX) return callback('Connection rate exceeded',false);
      callback(null,true);
    } catch { callback('Source verification failed',false); }
  };
}
module.exports={ createSourceGate };
