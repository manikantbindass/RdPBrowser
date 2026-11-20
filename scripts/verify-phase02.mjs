// Run the Phase 02 baseline against an already-started local stack.
// Does not provision, delete data, print secrets, or silently skip checks.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(root, 'backend/package.json'));
const dotenv = require('dotenv');
const local = dotenv.parse(readFileSync(resolve(root, 'backend/.env')));
const docker = dotenv.parse(readFileSync(resolve(root, 'docker/.env')));
const testUrl = new URL(local.DATABASE_URL); testUrl.pathname = '/remoteshield_phase02_test';
const out = resolve(root, 'docs/audit/phase02'); mkdirSync(out, { recursive: true });
const commands = [
  ['config', 'npm run config:check --prefix backend'],
  ['lint', 'npm run lint --prefix backend'],
  ['unit-contract', 'npm test --prefix backend -- --runInBand --detectOpenHandles'],
  ['postgres-integration', 'npm run test:integration --prefix backend'],
  ['desktop-frontend', 'npm run build --prefix desktop'],
  ['rust-format', 'cargo fmt --manifest-path desktop/src-tauri/Cargo.toml -- --check'],
  ['rust-tests', 'cargo test --locked --offline --manifest-path desktop/src-tauri/Cargo.toml'],
  ['rust-clippy', 'cargo clippy --locked --offline --manifest-path desktop/src-tauri/Cargo.toml --all-targets -- -D warnings'],
  ['compose', 'docker compose --env-file docker/.env -f docker/docker-compose.yml -f docker/compose.dev.yml config --quiet'],
  ['nginx', 'docker compose --env-file docker/.env -f docker/docker-compose.yml -f docker/compose.dev.yml exec -T nginx nginx -t'],
];
async function runCommand(command) {
  return new Promise(resolveCommand => {
    const child = spawn(command, { cwd: root, shell: true, windowsHide: true,
      detached: process.platform !== 'win32', env: { ...process.env, INTEGRATION_DATABASE_URL: testUrl.toString() } });
    let output = ''; let error;
    const timer = setTimeout(() => {
      error = 'Timed out after 120000ms; terminated command tree';
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
      else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
    }, 120000);
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    child.on('error', err => { error = err.message; });
    child.on('close', exitCode => { clearTimeout(timer); resolveCommand({ exitCode, error, output }); });
  });
}
const report = { capturedAt: new Date().toISOString(), head: spawnSync('git rev-parse HEAD', { cwd: root, shell: true, encoding: 'utf8' }).stdout.trim(), inputs: {}, checks: [] };
const sources = spawnSync('git ls-files -c -o --exclude-standard', { cwd: root, shell: true, encoding: 'utf8' }).stdout.split(/\r?\n/).filter(Boolean);
for (const file of sources.filter(f => /^(backend|contracts|docker|nginx|desktop\/src|scripts)\//.test(f) && !f.includes('/icons/') && !f.endsWith('.png'))) {
  report.inputs[file] = createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex');
}
for (const [id, command] of commands) {
  const result = await runCommand(command);
  report.checks.push({ id, command, ...result });
  writeFileSync(resolve(out, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`${id}: ${result.exitCode === 0 && !result.error ? 'PASS' : 'FAIL'}`);
}
const origin = `http://127.0.0.1:${docker.DEV_ADMIN_PORT || 8180}`;
for (const path of ['/health', '/ready', '/api/v1/meta', '/admin/', '/socket.io/socket.io.js']) {
  try {
    const response = await fetch(origin + path, { signal: AbortSignal.timeout(5000) });
    await response.arrayBuffer(); report.checks.push({ id: `edge:${path}`, status: response.status, exitCode: response.status === 200 ? 0 : 1 });
  } catch { report.checks.push({ id: `edge:${path}`, exitCode: 1, error: 'Local edge unavailable' }); }
}
writeFileSync(resolve(out, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
process.exitCode = report.checks.some(c => c.exitCode !== 0 || c.error) ? 1 : 0;
console.log(`Phase 02 verification: ${process.exitCode ? 'FAIL' : 'PASS'}`);
