'use strict';
const { AsyncLocalStorage }=require('node:async_hooks');
const { randomBytes }=require('node:crypto');
const context=new AsyncLocalStorage();
const spanId=()=>randomBytes(8).toString('hex');
function requestTrace(sampleRate) {
  return { traceId:randomBytes(16).toString('hex'),spanId:spanId(),sampled:randomBytes(4).readUInt32BE()/0x100000000<sampleRate };
}
async function databaseSpan(fn) {
  const parent=context.getStore();
  if (!parent) return fn();
  const started=process.hrtime.bigint();let outcome='ok';
  try { return await fn(); } catch(error) { outcome='error';throw error; }
  finally {
    const durationMs=Number(process.hrtime.bigint()-started)/1e6;
    parent.metrics.observeDatabase(durationMs,outcome);
    if (parent.sampled) parent.logger.info({event:'trace.span',name:'db.query',traceId:parent.traceId,spanId:spanId(),parentSpanId:parent.spanId,durationMs,outcome});
  }
}
module.exports={ context,requestTrace,databaseSpan };
