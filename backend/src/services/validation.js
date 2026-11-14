'use strict';
const Joi = require('joi');
function validate(schema, value) {
  const result = schema.validate(value, { abortEarly:false, convert:false });
  if (result.error) throw Object.assign(new Error('Validation failed'), { status:400, code:'VALIDATION_ERROR', publicMessage:'Request validation failed' });
  return result.value;
}
const id = Joi.string().guid({ version:['uuidv4','uuidv5','uuidv7'] });
const password = Joi.string().min(12).max(72).pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/).custom((v,h) => Buffer.byteLength(v)>72 ? h.error('any.invalid') : v);
const userRegistration = Joi.object({ username:Joi.string().alphanum().min(3).max(80).required(), email:Joi.string().email().max(255).required(), password:password.required(), deviceId:Joi.string().min(1).max(255) });
function pagination(req) {
  for (const key of ['page','limit']) if (req.query[key]!==undefined && (typeof req.query[key]!=='string' || !/^[1-9]\d*$/.test(req.query[key]))) fail(400,'Invalid pagination','VALIDATION_ERROR');
  const page = req.query.page === undefined ? 1 : Number(req.query.page);
  const limit = req.query.limit === undefined ? 50 : Number(req.query.limit);
  if (!Number.isSafeInteger(page) || page<1 || page>10000 || !Number.isSafeInteger(limit) || limit<1 || limit>100) fail(400,'Invalid pagination','VALIDATION_ERROR');
  return { page,limit,offset:(page-1)*limit };
}
const wrap = fn => (req,res,next) => Promise.resolve().then(() => fn(req,res,next)).catch(next);
function fail(status,message,code) { throw Object.assign(new Error(message),{ status,publicMessage:message,code }); }
module.exports = { Joi,validate,id,userRegistration,pagination,wrap,fail };
