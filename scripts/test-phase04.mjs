// Uses ignored owner settings privately; never prints database URLs or credentials.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
const require=createRequire(new URL('../backend/package.json',import.meta.url));
const env=require('dotenv').parse(readFileSync(new URL('../backend/.env',import.meta.url)));
const url=new URL(env.MIGRATION_DATABASE_URL || env.DATABASE_URL);
url.pathname='/remoteshield_phase02_test';
const child=spawn('npm run test:integration --prefix backend',{ shell:true,windowsHide:true,stdio:'inherit',
  env:{ ...process.env,INTEGRATION_DATABASE_URL:url.toString() } });
child.on('exit',code => { process.exitCode=code ?? 1; });
