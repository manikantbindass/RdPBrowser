'use strict';

/**
 * RemoteShield X — App Integrity Checker
 * Hashes all critical files and compares against a known-good manifest.
 * Run on server startup and schedule via cron.
 *
 * Usage:
 *   node security/integrity-checker/check.js generate   # Generate manifest
 *   node security/integrity-checker/check.js verify     # Verify integrity
 *   node security/integrity-checker/check.js watch      # Watch + verify every 60s
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '../../');
const MANIFEST_PATH = path.join(__dirname, 'manifest.json');

// Files to protect (relative to ROOT)
const PROTECTED_FILES = [
  'backend/src/index.js',
  'backend/src/middleware/vpnCheck.js',
  'backend/src/middleware/auth.js',
  'backend/src/routes/auth.js',
  'backend/src/routes/admin.js',
  'backend/src/routes/proxy.js',
  'backend/src/db/db.js',
  'nginx/nginx.conf',
];

function hashFile(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

function generateManifest() {
  const manifest = {
    generated: new Date().toISOString(),
    files: {},
  };

  for (const rel of PROTECTED_FILES) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) {
      console.warn(`[WARN] File not found: ${rel}`);
      continue;
    }
    manifest.files[rel] = hashFile(abs);
    console.log(`[OK] Hashed: ${rel}`);
  }

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(`\n✅ Manifest written to ${MANIFEST_PATH}`);
}

function verifyIntegrity() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error('❌ No manifest found. Run: node check.js generate');
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const results = { passed: [], failed: [], missing: [] };

  for (const [rel, expectedHash] of Object.entries(manifest.files)) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) {
      results.missing.push(rel);
      console.error(`[MISSING] ${rel}`);
      continue;
    }
    const actualHash = hashFile(abs);
    if (actualHash === expectedHash) {
      results.passed.push(rel);
      console.log(`[✓] ${rel}`);
    } else {
      results.failed.push(rel);
      console.error(`[✗ TAMPERED] ${rel}`);
      console.error(`  Expected: ${expectedHash}`);
      console.error(`  Actual:   ${actualHash}`);
    }
  }

  console.log(`\n📊 Results: ${results.passed.length} passed, ${results.failed.length} failed, ${results.missing.length} missing`);

  if (results.failed.length > 0 || results.missing.length > 0) {
    console.error('\n🚨 INTEGRITY CHECK FAILED — Possible tampering detected!');
    // In production: send alert to admin, kill process, trigger incident response
    process.exit(1);
  } else {
    console.log('✅ All files intact');
  }
}

function watchMode() {
  console.log('👁️  Integrity watchdog started (checking every 60s)...');
  verifyIntegrity();
  setInterval(verifyIntegrity, 60 * 1000);
}

// ─── CLI ──────────────────────────────────────────────────────────────────────
const cmd = process.argv[2];
switch (cmd) {
  case 'generate': generateManifest(); break;
  case 'verify':   verifyIntegrity(); break;
  case 'watch':    watchMode(); break;
  default:
    console.log('Usage: node check.js [generate|verify|watch]');
    process.exit(1);
}
