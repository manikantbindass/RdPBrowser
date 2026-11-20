// Read-only inventory checks. Not a compiler, dependency scanner or secret certification.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const missingDartImports = [];
const secretCandidates = [];
for (const file of files) {
  if (!/\.(dart|js|tsx?|rs|ya?ml|json|conf|sh|sql|example|cjs)$/.test(file)) continue;
  const source = readFileSync(resolve(root, file), 'utf8');
  if (file.endsWith('.dart')) {
    for (const match of source.matchAll(/(?:import|export|part)\s+['"]([^'"]+)['"]/g)) {
      if (match[1].includes(':')) continue;
      if (!existsSync(resolve(root, dirname(file), match[1]))) missingDartImports.push({
        file, line: source.slice(0, match.index).split('\n').length, import: match[1],
      });
    }
  }
  // Deliberately emit locations only; never print candidate credentials.
  const patterns = {
    privateKey: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
    githubToken: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g,
    awsAccessKey: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  };
  for (const [kind, regex] of Object.entries(patterns)) {
    for (const match of source.matchAll(regex)) secretCandidates.push({ file, kind, line: source.slice(0, match.index).split('\n').length });
  }
}
const required = [
  'backend/src/db/migrate.js', 'android/android/gradlew', 'android/android/gradlew.bat',
  'android/android/gradle/wrapper/gradle-wrapper.jar', 'android/pubspec.lock',
];
const nativeSources = files.filter(f => /^android\/android\/app\/src\/.*\.(kt|java)$/.test(f));
console.log(JSON.stringify({
  scope: 'Tracked current-tree text only; regex secret signatures are intentionally limited; no history or entropy scan.',
  missingDartImports, missingFiles: required.filter(f => !existsSync(resolve(root, f))),
  nativeSources, secretCandidates,
}, null, 2));
process.exitCode = missingDartImports.length || secretCandidates.length || !nativeSources.length
  || required.some(f => !existsSync(resolve(root, f))) ? 1 : 0;
