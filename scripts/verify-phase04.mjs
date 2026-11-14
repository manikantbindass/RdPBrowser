import { spawn,spawnSync } from 'node:child_process';
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomBytes,createHash } from 'node:crypto';
import { resolve } from 'node:path';
const require=createRequire(new URL('../backend/package.json',import.meta.url));
const env=require('dotenv').parse(readFileSync(new URL('../backend/.env',import.meta.url)));
const url=new URL(env.MIGRATION_DATABASE_URL || env.DATABASE_URL); url.pathname='/remoteshield_phase02_test';
const report={ capturedAt:new Date().toISOString(),node:process.version,scope:'Local backend Phase 04; isolated schemas in dedicated test database',checks:[],inputs:{} };
const commands=[
  ['lint','npm run lint --prefix backend'],
  ['unit-openapi','npm test --prefix backend -- --runInBand --detectOpenHandles'],
  ['postgres','npm run test:integration --prefix backend'],
  ['compose','docker --context desktop-linux compose --env-file docker/.env -f docker/docker-compose.yml -f docker/compose.dev.yml config --quiet'],
  ['container-runtime',`docker --context desktop-linux run --rm --network none remoteshield-backend:phase04 node -e "console.log(process.version); const g=require('geoip-lite'); if(!g.lookup('8.8.8.8')) process.exit(1); console.log('Production GeoIP lookup loads'); require('./src/http/app'); console.log('Production HTTP modules load');"`],
];
mkdirSync('docs/audit/phase04',{ recursive:true });
for (const [id,command] of commands) {
  const result=await new Promise(resolveResult => {
    const child=spawn(command,{ shell:true,windowsHide:true,env:{ ...process.env,INTEGRATION_DATABASE_URL:url.toString(),DB_RUNTIME_PASS:randomBytes(24).toString('hex') } });
    let timedOut=false;
    const timer=setTimeout(() => {
      timedOut=true;
      if (process.platform==='win32') spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{ windowsHide:true,stdio:'ignore' });
      else child.kill('SIGTERM');
    },120000);
    let output=''; child.stdout.on('data',v => { output+=v; }); child.stderr.on('data',v => { output+=v; });
    child.on('error',() => resolveResult({ exitCode:1,output:'Command failed to start' }));
    child.on('close',exitCode => { clearTimeout(timer); resolveResult({ exitCode:timedOut ? 1 : exitCode,output,timedOut }); });
  });
  report.checks.push({ id,command,...result });
  writeFileSync('docs/audit/phase04/verification.json',JSON.stringify(report,null,2)+'\n');
  console.log(`${id}: ${result.exitCode===0 ? 'PASS' : 'FAIL'}`);
}
// Fingerprint reviewed sources; never hash or serialize ignored secret files.
for (const file of ['backend/package-lock.json','backend/src/db/migrations/002_tenants.sql','backend/src/db/db.js','backend/src/routes/auth.js','backend/src/routes/admin.js','backend/src/routes/enterprise.js','backend/integration/enterprise.integration.js','contracts/openapi.json','docker/docker-compose.yml']) {
  report.inputs[file]=createHash('sha256').update(readFileSync(resolve(file))).digest('hex');
}
writeFileSync('docs/audit/phase04/verification.json',JSON.stringify(report,null,2)+'\n');
process.exitCode=report.checks.some(c => c.exitCode!==0) ? 1 : 0;
