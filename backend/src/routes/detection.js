'use strict';
const router = require('express').Router();
const { query } = require('../db/db');
const { tenantId } = require('../db/tenant');
const { Joi, validate, id, pagination, wrap, fail } = require('../services/validation');
const { incident, review } = require('../services/incidents');
const { enabled } = require('../services/detection-signals');
const { rules } = require('../../../security/anomaly-detector/rules');
const status = Joi.string().valid('open','investigating','resolved','dismissed');
const revision = Joi.number().integer().min(1).max(2147483646).required();
router.get('/detection-rules', wrap(async (req,res) => {
  const config = req.app.locals.config;
  const active = enabled(config, tenantId());
  const run = (await query('SELECT * FROM detection_runs')).rows[0];
  const stale = !run?.last_success || Date.now() - new Date(run.last_success).getTime() > config.DETECTION_INTERVAL_MS * 3;
  res.json({ rules, enabled:active, intervalMs:config.DETECTION_INTERVAL_MS,
    health:!active ? 'disabled' : !run ? 'not_started' : run.state !== 'healthy' ? run.state : stale ? 'lagging' : 'healthy',
    lastAttempt:run?.last_attempt || null, lastSuccess:run?.last_success || null });
}));
router.get('/alerts', wrap(async (req,res) => {
  const { limit,offset,page } = pagination(req);
  const selected = validate(Joi.object({ status:status.valid('all').default('open'), severity:Joi.string().valid('low','medium','high','critical'),
    ruleId:Joi.string().valid(...rules.map(rule => rule.id)), page:Joi.any(),limit:Joi.any() }), req.query);
  const alerts = await query(`SELECT a.*,u.username FROM anomaly_alerts a LEFT JOIN users u ON u.id=a.user_id
    WHERE ($1='all' OR a.status=$1) AND ($2::text IS NULL OR a.severity=$2) AND ($3::text IS NULL OR a.rule_id=$3)
    ORDER BY a.last_seen DESC,a.id LIMIT $4 OFFSET $5`, [selected.status,selected.severity || null,selected.ruleId || null,limit,offset]);
  res.json({ alerts:alerts.rows, page,limit });
}));
router.get('/alerts/:id', wrap(async (req,res) => res.json({ alert:await incident(validate(id.required(),req.params.id)) })));
for (const kind of ['evidence','reviews']) {
  router.get('/alerts/:id/' + kind, wrap(async (req,res) => {
    const target = validate(id.required(),req.params.id);
    await incident(target);
    const { limit,offset,page } = pagination(req);
    const rows = await query(`SELECT * FROM ${kind === 'evidence' ? 'detection_evidence' : 'incident_reviews'}
      WHERE incident_id=$1 ORDER BY created_at DESC,id LIMIT $2 OFFSET $3`, [target,limit,offset]);
    res.json({ [kind]:rows.rows,page,limit });
  }));
}
router.patch('/alerts/:id/review', wrap(async (req,res) => {
  const value = validate(Joi.object({ revision,status:status.required(),disposition:Joi.string().valid('pending','confirmed','benign','insufficient_evidence').required() }),req.body);
  const closed = ['resolved','dismissed'].includes(value.status);
  if (closed === (value.disposition === 'pending')) fail(400, 'Closed alerts require a disposition; open reviews remain pending');
  res.json({ alert:await review(req,validate(id.required(),req.params.id),value) });
}));
router.post('/alerts/:id/respond', wrap(async (req,res) => {
  const value = validate(Joi.object({ revision,action:Joi.string().valid('terminate_session','lock_user').required() }),req.body);
  res.json({ alert:await review(req,validate(id.required(),req.params.id),value) });
}));
module.exports = router;
