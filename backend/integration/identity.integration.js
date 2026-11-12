'use strict';
const { execFile }=require('child_process');
const path=require('path');
test('standards OIDC signatures, negative protocol cases, MFA and tenant/session lifecycle use PostgreSQL',async () => {
  const output=await new Promise((resolve,reject) => {
    execFile(process.execPath,[path.join(__dirname,'oidc-flow.cjs')],{ windowsHide:true,timeout:60000,env:process.env },(error,stdout,stderr) => {
      if (error) reject(new Error((stderr || 'OIDC integration failed').replace(/[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/g,'[REDACTED_JWT]')));
      else resolve(stdout);
    });
  });
  expect(JSON.parse(output).checks).toBeGreaterThanOrEqual(15);
},65000);
