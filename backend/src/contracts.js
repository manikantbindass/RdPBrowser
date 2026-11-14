'use strict';
const Ajv = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const httpSchema = require('../../contracts/http.schema.json');
const domainSchema = require('../../contracts/domain.schema.json');
const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);
ajv.addSchema(httpSchema); ajv.addSchema(domainSchema);
function validator(schema, name) { return ajv.getSchema(`urn:remoteshield:${schema}:v1#/$defs/${name}`); }
function validateBody(name) {
  const validate = validator('http', name);
  if (!validate) throw new Error('Unknown request contract');
  return (req, res, next) => {
    if (!validate(req.body)) return res.status(400).json({ error: 'Request validation failed', code: 'VALIDATION_ERROR',
      details: validate.errors.map(e => ({ path: e.instancePath, rule: e.keyword })) });
    next();
  };
}
module.exports = { validator, validateBody };
