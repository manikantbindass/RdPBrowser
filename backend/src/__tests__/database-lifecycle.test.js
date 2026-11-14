'use strict';
jest.mock('pg',() => ({ Pool:jest.fn() }));
const { Pool }=require('pg');
const database=require('../db/db');
const { withTenant,DEFAULT_ORGANIZATION }=require('../db/tenant');
test('late async identity work cannot reopen a shutdown pool; explicit configure permits a new lifecycle',async () => {
  const instance={ on:jest.fn(),end:jest.fn().mockResolvedValue() };
  Pool.mockImplementation(() => instance);
  const config={ DATABASE_URL:'postgresql://test:fixture@localhost/test',DB_SSL_MODE:'disable' };
  database.configure(config,{ error() {} });database.getPool();
  await database.close();
  expect(() => database.getPool()).toThrow('Database is closed');
  await expect(withTenant(DEFAULT_ORGANIZATION,() => database.query('SELECT 1'))).rejects.toThrow('Database is closed');
  expect(Pool).toHaveBeenCalledTimes(1);
  database.configure(config,{ error() {} });database.getPool();
  expect(Pool).toHaveBeenCalledTimes(2);await database.close();
});
