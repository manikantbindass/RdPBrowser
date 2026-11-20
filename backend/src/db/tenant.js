'use strict';
const { AsyncLocalStorage } = require('async_hooks');
const context = new AsyncLocalStorage();
const DEFAULT_ORGANIZATION = '00000000-0000-4000-8000-000000000001';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function withTenant(organizationId, fn) {
  if (!uuid.test(organizationId || '')) throw Object.assign(new Error('Invalid organization'), { status: 400 });
  return context.run({ organizationId }, fn);
}
function tenantId() {
  const id = context.getStore()?.organizationId;
  if (!id) throw new Error('Tenant context required');
  return id;
}
module.exports = { withTenant, tenantId, DEFAULT_ORGANIZATION, uuid };
