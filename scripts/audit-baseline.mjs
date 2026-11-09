// Bounded local baseline. Does not install packages, provision hosts, or alter policy.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const label = process.argv[2] || 'local';
if (!/^[a-z0-9-]+$/.test(label)) throw new Error('Use a simple lowercase report label');
const directory = resolve(root, 'docs/audit/phase01');
mkdirSync(directory, { recursive: true });
async function execute(command, cwd = '.', timeout = 45000) {
  // Commands are fixed below, never interpolated from user input.
  return new Promise((done) => {
    const child = spawn(command, {
      cwd: resolve(root, cwd), shell: true, windowsHide: true,
      detached: process.platform !== 'win32',
    });
    let output = '';
    let error;
    const timer = setTimeout(() => {
      error = `Timed out after ${timeout}ms; terminated command process tree`;
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
      } else {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
      }
    }, timeout);
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    child.on('error', err => { error = err.message; });
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      done({ command, cwd, exitCode, signal, error, output });
    });
  });
}
const versions = await execute('node --version && npm --version && cargo --version && rustc --version');
const bashSyntax = process.platform === 'win32' && existsSync('C:/Program Files/Git/bin/bash.exe')
  ? '"C:/Program Files/Git/bin/bash.exe" -n vpn-server/setup.sh'
  : 'bash -n vpn-server/setup.sh';
const checks = [
  ['source-inventory', 'node scripts/audit-source.mjs'],
  ['backend-lint', 'npm run lint', 'backend'],
  ['backend-tests', 'npm test -- --runInBand --detectOpenHandles', 'backend'],
  ['desktop-build', 'npm run build', 'desktop'],
  ['desktop-native-debug', 'npm run tauri -- build --debug --no-bundle --ci -- --locked --offline', 'desktop', 120000],
  ['rust-tests', 'cargo test --locked --offline --manifest-path desktop/src-tauri/Cargo.toml', '.', 120000],
  ['rust-format', 'cargo fmt --manifest-path desktop/src-tauri/Cargo.toml -- --check'],
  ['rust-clippy', 'cargo clippy --locked --offline --manifest-path desktop/src-tauri/Cargo.toml --all-targets -- -D warnings', '.', 120000],
  ['compose-config', 'docker compose -f docker/docker-compose.yml config --quiet'],
  ['docker-engine', 'docker info --format "{{.ServerVersion}}"'],
  ['flutter-version', 'flutter --version'],
  ['flutter-analyze', 'flutter analyze', 'android'],
  ['flutter-tests', 'flutter test', 'android'],
  ['flutter-build', 'flutter build apk --release --obfuscate --split-debug-info=build/debug-info --split-per-abi', 'android', 120000],
  ['shell-syntax', bashSyntax],
  ['backend-dependencies', 'npm ls --depth=0', 'backend'],
  ['desktop-dependencies', 'npm ls --depth=0', 'desktop'],
  ['rust-audit-tool', 'cargo audit --version'],
  ['actionlint-tool', 'actionlint -version'],
  ['secret-scanner-tool', 'gitleaks version'],
];
const report = {
  capturedAt: new Date().toISOString(), label, platform: process.platform,
  head: (await execute('git rev-parse HEAD')).output.trim(),
  gitStatus: (await execute('git status --short')).output.trim(), versions,
  inputs: {}, checks: [],
};
for (const file of ['backend/package.json', 'backend/package-lock.json', 'backend/src/index.js', 'backend/src/routes/admin.js', 'backend/src/__tests__/app.test.js', 'backend/src/__tests__/admin.test.js', 'desktop/package.json', 'desktop/package-lock.json', 'desktop/src-tauri/Cargo.toml', 'desktop/src-tauri/Cargo.lock', 'android/pubspec.yaml', 'scripts/audit-baseline.mjs', 'scripts/audit-source.mjs']) {
  try { report.inputs[file] = createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex'); }
  catch { report.inputs[file] = 'MISSING'; }
}
for (const [id, command, cwd, timeout] of checks) {
  const start = Date.now();
  const result = await execute(command, cwd, timeout);
  report.checks.push({ id, durationMs: Date.now() - start, ...result });
  // Persist incrementally so a slow or interrupted check does not erase results.
  writeFileSync(resolve(directory, `${label}.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(`${id}: ${result.error ? 'ERROR/TIMEOUT' : result.exitCode === 0 ? 'PASS' : 'FAIL/UNAVAILABLE'} (${result.exitCode})`);
}
console.log(`Report: docs/audit/phase01/${label}.json`);
process.exitCode = report.checks.some(c => c.exitCode !== 0 || c.error) ? 1 : 0;
