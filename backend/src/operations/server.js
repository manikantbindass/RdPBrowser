'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const { createHash,timingSafeEqual }=require('node:crypto');
function statusFile(directory,name,maximumAge) {
  if (!directory) return {state:'unconfigured'};
  try {
    const file=path.join(directory,name),stat=fs.statSync(file);
    if (!stat.isFile() || stat.size>65536) throw new Error();
    const value=JSON.parse(fs.readFileSync(file,'utf8'));
    return {...value,state:Date.now()-stat.mtimeMs>maximumAge ? 'stale' : 'fresh'};
  } catch {return {state:'unavailable'};}
}
function startOperations({config,app,telemetry,database,logger}) {
  const expected=createHash('sha256').update(config.METRICS_TOKEN).digest();
  const files={'/dashboard':'dashboard.html','/dashboard.js':'dashboard.js','/dashboard.css':'dashboard.css'};
  const server=http.createServer({maxHeaderSize:4096},(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'");
    if (req.method!=='GET') {res.writeHead(405);return res.end();}
    if (files[req.url]) {
      res.setHeader('Content-Type',req.url.endsWith('.js') ? 'text/javascript' : req.url.endsWith('.css') ? 'text/css' : 'text/html');
      return res.end(fs.readFileSync(path.join(__dirname,'public',files[req.url])));
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
