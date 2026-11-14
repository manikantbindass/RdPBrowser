'use strict';
const { query } = require('../db/db');
const { tenantId } = require('../db/tenant');
async function audit(req,action,target=null) {
  await query('INSERT INTO audit_log(actor_id,action,target,ip_address,request_id) VALUES($1,$2,$3,$4,$5)',
    [req.user?.sub || null,action,target,req.vpnClientIp || req.ip,req.requestId || null]);
  req.app.get('logger')?.info({ event:'audit.attempt',action,target,organizationId:tenantId(),actorId:req.user?.sub,requestId:req.requestId });
}
module.exports = { audit };
