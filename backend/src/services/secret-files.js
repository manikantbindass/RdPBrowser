'use strict';
const fs = require('node:fs');
const path = require('node:path');
function secretValue(env, name) {
  const file = env[name + '_FILE'];
  if (!file) return env[name];
  if (env[name] || !path.isAbsolute(file)) throw new Error('Invalid secret source for ' + name);
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 65536) throw new Error();
    const value = fs.readFileSync(file, 'utf8').replace(/\r?\n$/, '');
    if (!value || value.includes('\n') || value.includes('\r') || value.includes('\0')) throw new Error();
    return value;
  } catch { throw new Error('Cannot read secret file for ' + name); }
}
function secretEnvironment(env, names) {
  const resolved = { ...env };
  for (const name of names) resolved[name] = secretValue(env, name);
  return resolved;
}
module.exports = { secretValue, secretEnvironment };
