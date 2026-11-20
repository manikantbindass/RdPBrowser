'use strict';
const parser=require('@apidevtools/swagger-parser');
parser.validate(require('../../contracts/openapi.json')).then(() => {
  console.log('OpenAPI 3.1 schema and references valid');
}).catch(error => { console.error(error.message); process.exitCode=1; });
