'use strict';
const path = require('node:path');
const { readOperatorFile } = require('./operator-files');
function secretValue(env, name) {
  const lookup = key => Object.hasOwn(env, key) ? Reflect.get(env, key) : undefined;
  const file = lookup(name + '_FILE');
  const direct = lookup(name);
  if (!file) return direct;
  if (direct || typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('Invalid secret source for ' + name);
  try {
    const value = readOperatorFile(file, 65536).text.replace(/\r?\n$/, '');
    if (!value || value.includes('\n') || value.includes('\r') || value.includes('\0')) throw new Error();
    return value;
  } catch { throw new Error('Cannot read secret file for ' + name); }
}
function secretEnvironment(env, names) {
  return { ...env, ...Object.fromEntries(names.map(name => [name, secretValue(env, name)])) };
}
module.exports = { secretValue, secretEnvironment };
