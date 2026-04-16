'use strict';

const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { query } = require('../db/db');
const geoip = require('geoip-lite');

const router = express.Router();

// ─── URL Blocklist Middleware ─────────────────────────────────────────────────
async function urlBlocklistCheck(req, res, next) {
  try {
    const targetUrl = req.query.url || req.body?.url;
    if (!targetUrl) return res.status(400).json({ error: 'Target URL required' });

    // Normalize URL
    let parsedUrl;
    try { parsedUrl = new URL(targetUrl); } catch {
      return res.status(400).json({ error: 'Invalid URL' });
    }

    // Check against blocklist in DB
    const blocked = await query(
      'SELECT pattern, reason FROM blocked_urls WHERE is_active=TRUE'
    );

    for (const row of blocked.rows) {
      const pattern = row.pattern;
      // Support wildcard glob matching
      const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$', 'i');
      if (regex.test(parsedUrl.hostname) || regex.test(parsedUrl.href)) {
        await query(
          `INSERT INTO ip_logs (user_id, request_ip, vpn_confirmed, url_requested, flagged, flag_reason)
           VALUES ($1, $2, TRUE, $3, TRUE, $4)`,
          [req.user.sub, req.vpnClientIp, targetUrl, `Blocked URL: ${row.reason || pattern}`]
        );
        return res.status(403).json({ error: 'URL blocked by administrator', reason: row.reason });
      }
    }

    // Check whitelist if enabled
    const whitelist = await query('SELECT pattern FROM allowed_urls WHERE is_active=TRUE');
    if (whitelist.rows.length > 0) {
      const isAllowed = whitelist.rows.some((row) => {
        const regex = new RegExp('^' + row.pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$', 'i');
        return regex.test(parsedUrl.hostname);
      });
      if (!isAllowed) {
        return res.status(403).json({ error: 'URL not on whitelist' });
      }
    }

    req.targetUrl = targetUrl;
    req.parsedUrl = parsedUrl;
    next();
  } catch (err) {
    next(err);
  }
}

// ─── IP / Geo Logging Middleware ──────────────────────────────────────────────
async function logRequest(req, res, next) {
  try {
    const ip = req.vpnClientIp || req.ip;
    const geo = geoip.lookup(ip);
    const countryCode = geo ? geo.country : 'XX';

    // Geo-restriction check
    if (process.env.GEO_RESTRICTION_ENABLED === 'true') {
      const allowed = (process.env.ALLOWED_COUNTRIES || 'IN').split(',');
      if (!allowed.includes(countryCode)) {
        return res.status(403).json({ error: `Access denied from country: ${countryCode}` });
      }
    }

    await query(
      `INSERT INTO ip_logs (user_id, session_id, request_ip, vpn_confirmed, url_requested, user_agent, country_code)
       VALUES ($1, $2, $3, TRUE, $4, $5, $6)`,
      [req.user.sub, null, ip, req.targetUrl, req.headers['user-agent'] || '', countryCode]
    );

    // Update session last_activity
    await query(
      'UPDATE sessions SET last_activity=NOW() WHERE user_id=$1 AND is_active=TRUE',
      [req.user.sub]
    );

    next();
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/proxy/navigate — Browser navigation request ───────────────────
router.post('/navigate', urlBlocklistCheck, logRequest, async (req, res) => {
  // Return the proxy target — the actual request is made from the Tauri/Flutter WebView
  res.json({
    allowed: true,
    url: req.targetUrl,
    serverIp: process.env.SERVER_PUBLIC_IP,
  });
});

// ─── GET /api/proxy/check — Check if URL is allowed ─────────────────────────
router.get('/check', async (req, res, next) => {
  try {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).json({ error: 'URL required' });

    const blocked = await query('SELECT pattern FROM blocked_urls WHERE is_active=TRUE');
    let parsedUrl;
    try { parsedUrl = new URL(targetUrl); } catch {
      return res.status(400).json({ error: 'Invalid URL' });
    }

    const isBlocked = blocked.rows.some((row) => {
      const regex = new RegExp('^' + row.pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$', 'i');
      return regex.test(parsedUrl.hostname);
    });

    res.json({ allowed: !isBlocked, url: targetUrl });
  } catch (err) { next(err); }
});

module.exports = router;
