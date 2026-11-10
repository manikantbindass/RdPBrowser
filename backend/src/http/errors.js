'use strict';

const { randomUUID } = require('crypto');
const statusCodes = { 400: 'BAD_REQUEST', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT', 413: 'PAYLOAD_TOO_LARGE', 429: 'RATE_LIMITED', 500: 'INTERNAL_ERROR', 503: 'UNAVAILABLE' };
function requestContext(req, res, next) {
  // Generate server-owned correlation IDs; never echo arbitrary caller input.
  req.requestId = randomUUID();
  res.setHeader('X-Request-ID', req.requestId);
  const json = res.json.bind(res);
  res.json = body => {
    if (res.statusCode >= 400 && body && typeof body.error === 'string') {
      return json({ ...body, code: body.code || statusCodes[res.statusCode] || 'REQUEST_FAILED', requestId: req.requestId });
    }
    return json(body);
  };
  next();
}
function errorHandler(logger) {
  return (err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = Number.isInteger(err.status) && err.status >= 400 && err.status <= 599 ? err.status : 500;
    logger.error({ event: 'http.failed', requestId: req.requestId, code: statusCodes[status] || 'REQUEST_FAILED', status });
    // Never disclose parser bodies, DB errors, SQL or credentials.
    res.status(status).json({ error: status >= 500 ? 'Internal server error' : (err.publicMessage || 'Request could not be processed'), code: err.code && /^[A-Z_]+$/.test(err.code) ? err.code : statusCodes[status] });
  };
}
module.exports = { requestContext, errorHandler };
