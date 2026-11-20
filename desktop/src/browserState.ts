export interface SavedTab {
  id: string;
  url: string;
  title: string;
  entries: string[];
  index: number;
}
export interface Preferences {
  version: 1;
  theme: 'dark' | 'light';
  tabs: SavedTab[];
  bookmarks: string[];
  history: string[];
}
export function normalizedAddress(input: string): string {
  const value = input.trim();
  if (!value || value.length > 8192 || /[\u0000-\u001f\u007f]/.test(value))
    throw new Error('Enter a valid address or search');
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^https?:\/\//i.test(value))
    throw new Error('Only HTTP and HTTPS addresses are supported');
  const address = /^https?:\/\//i.test(value)
    ? value
    : !value.includes(' ') && (value.includes('.') || value === 'localhost')
      ? `https://${value}`
      : `https://www.google.com/search?q=${encodeURIComponent(value)}`;
  const url = new URL(address);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error('Credentials in addresses are not permitted');
  if (
    ['tauri.localhost', 'asset.localhost', 'ipc.localhost'].includes(
      url.hostname,
    )
  )
    throw new Error('Application-internal addresses cannot be opened');
  return url.href;
}
export function storedUrl(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > 8192) return '';
  try {
    const url = new URL(raw);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return '';
    url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    return '';
  }
}
export const emptyPreferences = (): Preferences => ({
  version: 1,
  theme: 'dark',
  tabs: [],
  bookmarks: [],
  history: [],
});
export function parsePreferences(raw: string | null): Preferences {
  try {
    if (!raw || raw.length > 500000) return emptyPreferences();
    const source = JSON.parse(raw);
    if (source.version !== 1) return emptyPreferences();
    const urls = (v: unknown) =>
      Array.isArray(v)
        ? [...new Set(v.map(storedUrl).filter(Boolean))].slice(0, 200)
        : [];
    const tabs: SavedTab[] = Array.isArray(source.tabs)
      ? source.tabs.slice(0, 20).map((t: { url?: unknown }) => {
          const url = storedUrl(t?.url);
          return {
            id: crypto.randomUUID(),
            url,
            title: url ? new URL(url).hostname : 'New tab',
            entries: url ? [url] : [],
            index: url ? 0 : -1,
          };
        })
      : [];
    return {
      version: 1,
      theme: source.theme === 'light' ? 'light' : 'dark',
      tabs,
      bookmarks: urls(source.bookmarks),
      history: urls(source.history),
    };
  } catch {
    return emptyPreferences();
  }
}
export function serializePreferences(p: Preferences): string {
  return JSON.stringify({
    version: 1,
    theme: p.theme,
    tabs: p.tabs.slice(0, 20).map((t) => ({ url: storedUrl(t.url) })),
    bookmarks: p.bookmarks.map(storedUrl).filter(Boolean).slice(0, 200),
    history: p.history.map(storedUrl).filter(Boolean).slice(0, 200),
  });
}
