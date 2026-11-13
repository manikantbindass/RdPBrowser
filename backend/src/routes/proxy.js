'use strict';
const router=require('express').Router();
const { query,transaction }=require('../db/db');
const { evaluate }=require('../services/policy');
const { Joi,validate,wrap,fail }=require('../services/validation');
const geoip=require('geoip-lite');
function navigationCountry(req) {
  const country=geoip.lookup(req.vpnClientIp || req.ip)?.country || 'XX';
  if (req.app.locals.config.GEO_RESTRICTION_ENABLED && !req.app.locals.config.ALLOWED_COUNTRIES.split(',').includes(country)) fail(403,'Country not allowed');
  return country;
}
async function decision(req,res,navigate) {
  const url=navigate ? req.body.url : validate(Joi.string().uri({ scheme:['http','https'] }).max(8192).required(),req.query.url);
  const country=navigationCountry(req);
  const result=await evaluate(url);
  if (navigate) await transaction(async () => {
    // Do not persist URL credentials, query tokens or fragments in activity logs.
    const parsed=new URL(url); parsed.search=''; parsed.hash='';
    await query(`INSERT INTO ip_logs(user_id,session_id,request_ip,vpn_confirmed,url_requested,country_code,flagged,flag_reason)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[req.user.sub,req.sessionId,req.vpnClientIp || req.ip,req.app.locals.config.VPN_REQUIRED,parsed.toString(),country,!result.allowed,result.allowed ? null : result.reason]);
    await query('UPDATE sessions SET last_activity=NOW() WHERE id=$1',[req.sessionId]);
  });
  if (navigate && !result.allowed) return res.status(403).json({ error:'URL blocked by administrator',reason:result.reason });
  res.json({ ...result,...(navigate ? { serverIp:req.app.locals.config.SERVER_PUBLIC_IP } : {}) });
}
router.post('/navigate',require('../contracts').validateBody('navigateRequest'),wrap((req,res) => decision(req,res,true)));
router.get('/check',wrap((req,res) => decision(req,res,false)));
module.exports=router;
module.exports.navigationCountry=navigationCountry;
