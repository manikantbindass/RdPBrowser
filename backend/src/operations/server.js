'use strict';
const http=require('node:http');
const path=require('node:path');
const { createHash,timingSafeEqual }=require('node:crypto');
const { readOperatorFile }=require('../services/operator-files');
function statusFile(directory,name,maximumAge) {
  if (!directory) return {state:'unconfigured'};
  try {
    if (!['alerts.json','backup.json'].includes(name)) throw new Error('Unknown operations report');
    const {text,mtimeMs}=readOperatorFile(path.join(directory,name),65536);
    const value=JSON.parse(text);
    return {...value,state:Date.now()-mtimeMs>maximumAge ? 'stale' : 'fresh'};
  } catch {return {state:'unavailable'};}
}
function startOperations({config,app,telemetry,database,logger}) {
  const expected=createHash('sha256').update(config.METRICS_TOKEN).digest();
  const files=new Map([
    ['/dashboard',['dashboard.html','text/html']],
    ['/dashboard.js',['dashboard.js','text/javascript']],
    ['/dashboard.css',['dashboard.css','text/css']],
  ]);
  const server=http.createServer({maxHeaderSize:4096},(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'");
    if (req.method!=='GET') {res.writeHead(405);return res.end();}
    const asset=files.get(req.url);
    if (asset) {
      const [file,contentType]=asset;
      try {
        const {text}=readOperatorFile(path.join(__dirname,'public',file),1024*1024);
        res.setHeader('Content-Type',contentType);
        return res.end(text);
      } catch {
        res.writeHead(503);
        return res.end();
      }
    }
    const token=/^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(req.headers.authorization || '')?.[1] || '';
    if (!timingSafeEqual(createHash('sha256').update(token).digest(),expected)) {res.writeHead(401,{'WWW-Authenticate':'Bearer realm="RemoteShield operations"'});return res.end();}
    let pool;
    try {const p=database.getPool();pool={total:p.totalCount || 0,idle:p.idleCount || 0,waiting:p.waitingCount || 0};} catch {pool={total:0,idle:0,waiting:0};}
    const extra={databaseReady:!!app.locals.databaseReady,draining:!!app.locals.draining,pool,
      observer:statusFile(config.OPERATIONS_STATUS_DIRECTORY,'alerts.json',180000),backup:statusFile(config.OPERATIONS_STATUS_DIRECTORY,'backup.json',90000000)};
    if (req.url==='/metrics') {res.setHeader('Content-Type','text/plain; version=0.0.4');return res.end(telemetry.prometheus(extra));}
    if (req.url==='/status') {res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({...telemetry.status(),...extra}));}
    res.writeHead(404);res.end();
  });
  server.requestTimeout=5000;server.headersTimeout=4000;server.keepAliveTimeout=3000;server.maxConnections=64;
  const ready=new Promise((resolve,reject)=>{
    server.once('error',reject);server.listen(config.METRICS_PORT,'0.0.0.0',()=>{server.off('error',reject);resolve();});
  });
  server.on('error',()=>logger.error({event:'operations.listener_error'}));
  return {ready,address:()=>`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(resolve=>{server.closeAllConnections();server.close(()=>resolve());})};
}
module.exports={startOperations,statusFile};
