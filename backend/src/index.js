'use strict';
const { loadEnvironment, loadConfig } = require('./config');
const { createLogger } = require('./logging');
const database = require('./db/db');
const { createRuntime } = require('./runtime');
loadEnvironment();
const config = loadConfig();
const runtime = createRuntime({ config, logger: createLogger(config), database });
if (require.main === module) {
  runtime.start().catch(() => { process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => runtime.stop().catch(() => { process.exitCode = 1; }));
}
module.exports = runtime;
