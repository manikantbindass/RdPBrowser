'use strict';

const fs = require('node:fs');
const path = require('node:path');

const readFlags = fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK || 0);

function readOperatorFile(file, maxBytes) {
  // The operator supplies this location through local configuration or a mount.
  // Open once, then inspect and read the same descriptor with a hard size limit.
  if (typeof file !== 'string' || !file || file.includes('\0')) throw new Error('Invalid operator file path');
  const location = path.resolve(file);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Operator-owned path. Inspect the opened descriptor before reading.
  const descriptor = fs.openSync(location, readFlags);
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size > maxBytes) throw new Error('Invalid operator file');
    const buffer = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = fs.readSync(descriptor, buffer, length, buffer.length - length, length);
      if (read === 0) break;
      length += read;
    }
    if (length !== stat.size) throw new Error('Operator file size changed during read');
    return { text: buffer.toString('utf8', 0, length), mtimeMs: stat.mtimeMs };
  } finally {
    fs.closeSync(descriptor);
  }
}

function readDatabaseCa(file) {
  try {
    return readOperatorFile(file, 1024 * 1024).text;
  } catch {
    throw new Error('Database CA file is unavailable');
  }
}

module.exports = { readOperatorFile, readDatabaseCa };
