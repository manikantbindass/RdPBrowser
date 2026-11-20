'use strict';
const { randomUUID } = require('node:crypto');
const { query } = require('../db/db');
const { audit } = require('./audit');
async function change(req,action,target,before=null,after=null) {
  // Callers construct allowlisted state. Never pass request bodies or credentials.
  await query(`INSERT INTO governance_changes(actor_id,provisioning_credential_id,action,target,before_state,after_state,request_id)
    VALUES($1,$2,$3,$4,$5,$6,$7)`, [req.user?.sub || null, req.provisioning?.credentialId || null, action,target,before,after,req.requestId || randomUUID()]);
  await audit(req,action,target);
}
module.exports = { change };
