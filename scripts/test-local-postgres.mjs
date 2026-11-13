// Disposable loopback PostgreSQL fallback. Does not touch Docker or an existing database.
import { execFileSync,spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync,mkdtempSync,writeFileSync,unlinkSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { randomBytes } from 'node:crypto';
import net from 'node:net';
const require=createRequire(new URL('../backend/package.json',import.meta.url));
const { Pool }=require('pg');
const bin=process.env.PG_BIN || resolve('.local-tests/node_modules/@embedded-postgres/windows-x64/native/bin');
mkdirSync('.local-tests',{ recursive:true });mkdirSync('docs/audit/phase05',{ recursive:true });
const directory=mkdtempSync(resolve('.local-tests/phase05-'));
const data=join(directory,'data'),secret=join(directory,'password');
const password=randomBytes(32).toString('hex');writeFileSync(secret,password,{ mode:0o600 });
const exe=name => join(bin,name+(process.platform==='win32' ? '.exe' : ''));
const port=await new Promise((done,reject) => { const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',() => { const p=s.address().port;s.close(() => done(p)); }); });
let started=false;
try {
  execFileSync(exe('initdb'),['-D',data,'-U','testowner','--auth=scram-sha-256','--pwfile',secret,'--encoding=UTF8','--locale=C'],{ windowsHide:true,stdio:'pipe',timeout:60000 });
  unlinkSync(secret);
  execFileSync(exe('pg_ctl'),['-D',data,'-l',join(directory,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','-t','30','start'],{ windowsHide:true,stdio:'ignore',timeout:40000 });started=true;
  const url=`postgresql://testowner:${password}@127.0.0.1:${port}/postgres`;
  const owner=new Pool({ connectionString:url,connectionTimeoutMillis:5000 });
  await owner.query('CREATE DATABASE remoteshield_phase05_test');await owner.end();
  const databaseUrl=new URL(url);databaseUrl.pathname='/remoteshield_phase05_test';
  const setup=new Pool({ connectionString:databaseUrl.toString() });
  await setup.query('CREATE EXTENSION "uuid-ossp" WITH SCHEMA public;CREATE EXTENSION pgcrypto WITH SCHEMA public');await setup.end();
  const fixture=process.argv.includes('--desktop-fixture');
  const command=fixture?'node backend/integration/desktop-fixture.cjs':process.argv.includes('--protocol-only') ? 'node backend/integration/oidc-flow.cjs' : 'npm run test:integration --prefix backend';
  const result=await new Promise(done => {
    const child=spawn(command,{ shell:true,windowsHide:true,env:{ ...process.env,INTEGRATION_DATABASE_URL:databaseUrl.toString() } });
    let output='';const timer=setTimeout(() => { if(process.platform==='win32') execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{ windowsHide:true,stdio:'ignore' }); else child.kill('SIGTERM'); },fixture?1200000:180000);
    child.stdout.on('data',v => { output+=v; });child.stderr.on('data',v => { output+=v; });
    child.on('close',exitCode => { clearTimeout(timer);done({ exitCode,output:output.replace(/[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/g,'[REDACTED_JWT]').replaceAll(password,'[REDACTED]') }); });
  });
  const report={ capturedAt:new Date().toISOString(),node:process.version,postgres:execFileSync(exe('postgres'),['--version'],{ encoding:'utf8',windowsHide:true }).trim(),
    scope:'Disposable password-authenticated loopback cluster; isolated schemas and restricted runtime roles',command,...result };
  const destination=process.env.VERIFICATION_OUTPUT || (fixture?'.local-tests/desktop-fixture-results.json':'docs/audit/phase05/local-postgres.json');
  writeFileSync(destination,JSON.stringify(report,null,2)+'\n');
  console.log(result.output);process.exitCode=result.exitCode ?? 1;
} finally {
  if (started) execFileSync(exe('pg_ctl'),['-D',data,'-m','fast','-w','-t','30','stop'],{ windowsHide:true,stdio:'ignore',timeout:40000 });
  // Keep only ignored, stopped test artifacts for diagnostics; no recursive deletion.
}
