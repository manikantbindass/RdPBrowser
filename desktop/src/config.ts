// UI endpoints are public configuration, never a place for credentials.
const raw = import.meta.env.VITE_SERVER_URL || 'http://127.0.0.1:3001';
const parsed = new URL(raw);
if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
  throw new Error('VITE_SERVER_URL must be an HTTP(S) origin without credentials or a path');
}
export const SERVER_URL = parsed.origin;
