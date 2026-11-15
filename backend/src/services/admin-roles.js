'use strict';

const { query } = require('../db/db');
const { fail } = require('./validation');

async function managedUser(actor, userId, self = false) {
  const user = (await query('SELECT id,role FROM users WHERE id=$1 FOR UPDATE', [userId])).rows[0];
  if (!user) fail(404, 'Resource not found');
  if (self && user.id === actor.sub) return user;
  if (user.id === actor.sub || user.role === 'superadmin' ||
      (user.role === 'admin' && actor.role !== 'superadmin')) {
    fail(403, 'This account requires a higher administrative role', 'ROLE_BOUNDARY');
  }
  return user;
}

module.exports = { managedUser };
