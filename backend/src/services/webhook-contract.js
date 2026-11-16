'use strict';
const { createHmac,timingSafeEqual }=require('node:crypto');
// Protocol helpers only. No endpoint, scheduler or external delivery is enabled.
function sign(body,secret,timestamp,eventId) {
  if (Buffer.byteLength(secret)<32 || !Number.isSafeInteger(timestamp) || !/^[0-9a-f-]{36}$/.test(eventId)) throw new Error('Invalid signing inputs');
  return 'v1='+createHmac('sha256',secret).update(timestamp+'.'+eventId+'.').update(body).digest('hex');
}
function verify(body,secret,{timestamp,eventId,signature},now=Math.floor(Date.now()/1000)) {
  if (!Number.isSafeInteger(timestamp) || Math.abs(now-timestamp)>300 || typeof signature!=='string' || !/^v1=[a-f0-9]{64}$/.test(signature)) return false;
  try { return timingSafeEqual(Buffer.from(signature),Buffer.from(sign(body,secret,timestamp,eventId))); } catch { return false; }
}
function retryDelay(attempt,jitter=Math.random()) {
  if (!Number.isInteger(attempt) || attempt<1 || attempt>8 || jitter<0 || jitter>1) throw new Error('Invalid retry state');
  return Math.round(Math.min(3600000,1000*2**(attempt-1)*(0.8+0.4*jitter)));
}
module.exports={ sign,verify,retryDelay };
