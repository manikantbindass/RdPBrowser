import { spawn,spawnSync } from 'node:child_process';
import { readFileSync,writeFileSync,mkdirSync,existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
const output='docs/audit/phase05';mkdirSync(output,{ recursive:true });
const before=readFileSync('contracts/openapi.json','utf8');
const commands=[['lint','npm run lint --prefix backend'],['unit-contract','npm test --prefix backend -- --runInBand --detectOpenHandles'],
  ['openapi-generation','node scripts/build-openapi.cjs'],['openapi-validation','node backend/src/validate-openapi.js'],
  ['postgres-oidc',process.env.INTEGRATION_DATABASE_URL ? 'npm run test:integration --prefix backend' : 'node scripts/test-local-postgres.mjs'],
  ['secret-signatures','node scripts/scan-backend-secrets.mjs docs/audit/phase05/secret-scan.json']];
const report={ capturedAt:new Date().toISOString(),node:process.version,checks:[],inputs:{} };
for (const [id,command] of commands) {
  const result=await new Promise(done => {
    const child=spawn(command,{ shell:true,windowsHide:true,env:process.env });let stdout='',timedOut=false;
    const timer=setTimeout(() => { timedOut=true;if(process.platform==='win32') spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{ windowsHide:true,stdio:'ignore' });else child.kill('SIGTERM'); },180000);
    child.stdout.on('data',v => { stdout+=v; });child.stderr.on('data',v => { stdout+=v; });
    child.on('close',exitCode => { clearTimeout(timer);done({ exitCode:timedOut ? 1 : exitCode,timedOut,output:stdout.replace(/[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/g,'[REDACTED_JWT]') }); });
  });
  report.checks.push({ id,command,...result });writeFileSync(output+'/verification.json',JSON.stringify(report,null,2)+'\n');
  console.log(`${id}: ${result.exitCode===0 ? 'PASS' : 'FAIL'}`);
}
report.openapiReproducible=readFileSync('contracts/openapi.json','utf8')===before;
const sources=spawnSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{ encoding:'utf8' }).stdout.split('\0').filter(Boolean);
for (const file of sources.filter(f => /^(backend|contracts|docker|scripts)\//.test(f) && /\.(js|mjs|cjs|json|sql|ya?ml|example)$/.test(f))) report.inputs[file]=createHash('sha256').update(readFileSync(file)).digest('hex');
if (existsSync('.local-tests/node_modules/@embedded-postgres/windows-x64/package.json')) {
  const pg=JSON.parse(readFileSync('.local-tests/node_modules/@embedded-postgres/windows-x64/package.json','utf8'));
  report.testBinary={ package:pg.name,version:pg.version,source:'https://github.com/leinelissen/embedded-postgres',
    sha256:createHash('sha256').update(readFileSync('.local-tests/node_modules/@embedded-postgres/windows-x64/native/bin/postgres.exe')).digest('hex'),
    packageIntegrity:'sha512-aFbd5N/NfTDfhBvfXcFhl06AzZhlf/HHVBVgiT4hkKkTKeUV1UmIHc59vVVrVgS8WLPQ5DTGbrDwS4x+LtZFFQ==' };
}
writeFileSync(output+'/verification.json',JSON.stringify(report,null,2)+'\n');
process.exitCode=report.checks.some(c => c.exitCode!==0) || !report.openapiReproducible ? 1 : 0;
