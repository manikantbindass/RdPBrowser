'use strict';
const { createRuntime } = require('../runtime');
const { loadConfig } = require('../config');
const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://test:local@127.0.0.1/test', JWT_SECRET: 'a'.repeat(64), JWT_REFRESH_SECRET: 'b'.repeat(64), VPN_REQUIRED: 'false' });
it('refuses to listen when database/schema initialization fails and closes resources', async () => {
  const database = { configure: jest.fn(), initDB: jest.fn().mockRejectedValue(new Error('Database unavailable')), close: jest.fn().mockResolvedValue() };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const runtime = createRuntime({ config, logger, database });
  await expect(runtime.start()).rejects.toThrow('Database unavailable');
  expect(runtime.server.listening).toBe(false);
  expect(database.close).toHaveBeenCalledTimes(1);
  expect(logger.error).toHaveBeenCalledWith({ event: 'server.start_failed', code: 'STARTUP_FAILED' });
});
