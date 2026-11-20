'use strict';
const { execFileSync }=require('child_process');
const path=require('path');
const document=require('../../../contracts/openapi.json');
test('OpenAPI validates with resolved references and uniquely identifies all operations',() => {
  // Use Node's native ESM interoperability, outside Jest 29's CommonJS loader.
  expect(execFileSync(process.execPath,[path.join(__dirname,'../validate-openapi.js')],{ encoding:'utf8',timeout:15000,windowsHide:true })).toContain('valid');
  const ids=[];
  for (const operations of Object.values(document.paths)) for (const operation of Object.values(operations)) ids.push(operation.operationId);
  expect(new Set(ids).size).toBe(ids.length);
});
