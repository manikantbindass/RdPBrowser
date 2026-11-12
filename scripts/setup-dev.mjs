// Creates local-only configuration once; never overwrites existing credentials.
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = ['backend/.env', 'docker/.env', 'desktop/.env.local'];
if (files.some(file => existsSync(resolve(root, file)))) throw new Error('Local config already exists; keep it and follow docs/LOCAL_DEVELOPMENT.md instead of overwriting credentials');
const password = randomBytes(24).toString('hex');
const runtimePassword = randomBytes(24).toString('hex');
const secret = randomBytes(32).toString('hex');
const refresh = randomBytes(32).toString('hex');
const shared = `JWT_SECRET=${secret}\nJWT_REFRESH_SECRET=${refresh}\nVPN_REQUIRED=false\nDEVICE_BINDING_ENABLED=false\nANOMALY_DETECTION_ENABLED=false\nSSH_ENABLED=false\n`;
const content = [
  `NODE_ENV=development\nHOST=127.0.0.1\nPORT=3001\nDATABASE_URL=postgresql://remoteshield_app:${runtimePassword}@127.0.0.1:5432/remoteshield_db\nMIGRATION_DATABASE_URL=postgresql://remoteshield:${password}@127.0.0.1:5432/remoteshield_db\nDB_RUNTIME_PASSWORD=${runtimePassword}\nDB_SSL_MODE=disable\n${shared}`,
  `NODE_ENV=development\nDB_PASS=${password}\nDB_RUNTIME_PASS=${runtimePassword}\nDB_SSL_MODE=disable\nDB_NETWORK_TRUSTED=true\nDOMAIN=localhost\nSERVER_PUBLIC_IP=127.0.0.1\nCORS_ORIGINS=http://127.0.0.1:8180,http://localhost:5173,http://127.0.0.1:5173,tauri://localhost,http://tauri.localhost,https://tauri.localhost\n${shared}`,
  'VITE_SERVER_URL=http://127.0.0.1:3001\n',
];
files.forEach((file, index) => { mkdirSync(dirname(resolve(root, file)), { recursive: true }); writeFileSync(resolve(root, file), content[index], { flag: 'wx', mode: 0o600 }); });
console.log('Created local backend, Docker and desktop configuration. Secrets were not printed.');
