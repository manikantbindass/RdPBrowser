import { useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { SERVER_URL } from '../config';
import {
  normalizedAddress,
  parsePreferences,
  serializePreferences,
  storedUrl,
  type SavedTab,
} from '../browserState';
import './managed.css';
import { signatureDer, base64url } from '../deviceProof';

interface Props {
  authToken: string;
  owner: string;
  onSignOut: () => void;
}
export default function ManagedBrowser({ authToken, owner, onSignOut }: Props) {
  const key = `rsx.browser.v1.${owner}`;
  const initial = useRef(
    (() => {
      try {
        return parsePreferences(localStorage.getItem(key));
      } catch {
        return parsePreferences(null);
      }
    })(),
  ).current;
  const fresh = (): SavedTab => ({
    id: crypto.randomUUID(),
    url: '',
    title: 'New tab',
    entries: [],
    index: -1,
  });
  const [tabs, setTabs] = useState<SavedTab[]>(() =>
    initial.tabs.length ? initial.tabs : [fresh()],
  );
  const [active, setActive] = useState(() => tabs[0].id),
    [address, setAddress] = useState(''),
    [theme, setTheme] = useState(initial.theme);
  const [history, setHistory] = useState(initial.history),
    [bookmarks, setBookmarks] = useState(initial.bookmarks);
  const [panel, setPanel] = useState(''),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [notice, setNotice] = useState('');
  const [devices, setDevices] = useState<
    Array<{ id: string; name: string; status: string; trust_state: string }>
  >([]);
  const [downloadUrl, setDownloadUrl] = useState(''),
    [updateVersion, setUpdateVersion] = useState(''),
    [busy, setBusy] = useState(false);
  const [sourceGate, setSourceGate] = useState('unknown');
  const privateKeys = useRef(new Map<string, CryptoKey>());
  const viewport = useRef<HTMLDivElement>(null),
    input = useRef<HTMLInputElement>(null),
    alive = useRef(true),
    generation = useRef(0),
    current = useRef({ tabs, active, panel });
  current.current = { tabs, active, panel };
  const tab = tabs.find((t) => t.id === active) || tabs[0];
  const api = async (path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(`${SERVER_URL}/api/v1${path}`, {
      method,
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok)
      throw new Error(
        response.status === 403
          ? 'Organization policy denied this action'
          : response.status === 401
            ? 'Session expired or revoked'
            : 'Control plane unavailable',
      );
    return response.json();
  };
  const navigate = async (raw: string, id = active, position?: number) => {
    const serial = ++generation.current;
    try {
      const url = normalizedAddress(raw);
      if (!isTauri())
        throw new Error('Native content is unavailable in preview');
      setPanel('');
      setError('');
      setLoading(true);
      const rect = viewport.current?.getBoundingClientRect();
      if (!rect) throw new Error('Viewport not ready');
      await invoke('open_content', {
        tab: id,
        url,
        bounds: {
          x: window.screenX + rect.left,
          y: window.screenY + rect.top,
          width: rect.width,
          height: rect.height,
        },
      });
      if (!alive.current || serial !== generation.current) {
        await invoke('close_content_tab', { tab: id });
        return;
      }
      await invoke('content_visibility', {
        active: current.current.active === id ? id : null,
      });
      setTabs((items) =>
        items.map((t) =>
          t.id === id
            ? {
                ...t,
                url,
                title: new URL(url).hostname,
                entries:
                  position === undefined
                    ? [...t.entries.slice(0, t.index + 1), url].slice(-100)
                    : t.entries,
                index:
                  position === undefined ? Math.min(t.index + 1, 99) : position,
              }
            : t,
        ),
      );
      setAddress(url);
      setHistory((items) =>
        [storedUrl(url), ...items.filter((v) => v !== storedUrl(url))].slice(
          0,
          200,
        ),
      );
    } catch (reason) {
      if (alive.current) {
        void invoke('close_content_tab', { tab: id }).catch(() => undefined);
        setError(
          typeof reason === 'string'
            ? reason
            : reason instanceof Error
              ? reason.message
              : 'Navigation failed',
        );
        setLoading(false);
      }
    }
  };
  useEffect(() => {
    try {
      localStorage.setItem(
        key,
        serializePreferences({ version: 1, theme, tabs, history, bookmarks }),
      );
    } catch {
      setNotice('Local browsing state could not be saved.');
    }
  }, [tabs, history, bookmarks, theme, key]);
  useEffect(() => {
    setAddress(tab.url);
  }, [active, tab.url]);
  useEffect(() => {
    setError('');
    setLoading(false);
  }, [active]);
  useEffect(() => {
    void invoke('content_visibility', { active: panel ? null : active }).catch(
      () => {},
    );
  }, [active, panel]);
  useEffect(() => {
    alive.current = true;
    const listeners = [
      listen<{ tab: string; url: string }>('browser-popup', (event) => {
        if (current.current.active === event.payload.tab) {
          setNotice(
            'A site requested a new window. Use the address bar to open its address after review.',
          );
          setAddress(event.payload.url);
          void invoke('content_visibility', { active: null }).catch(
            () => undefined,
          );
          input.current?.focus();
        }
      }),
      listen<{ tab: string; loading: boolean; url: string }>(
        'browser-page',
        (event) => {
          if (event.payload.tab === current.current.active)
            setLoading(event.payload.loading);
          if (!event.payload.loading) {
            const url = event.payload.url;
            setTabs((items) =>
              items.map((t) =>
                t.id === event.payload.tab && t.url !== url
                  ? {
                      ...t,
                      url,
                      title: new URL(url).hostname,
                      entries: [...t.entries.slice(0, t.index + 1), url].slice(
                        -100,
                      ),
                      index: Math.min(t.index + 1, 99),
                    }
                  : t,
              ),
            );
            if (event.payload.tab === current.current.active) setAddress(url);
            setHistory((items) =>
              [storedUrl(url), ...items.filter((u) => u !== storedUrl(url))]
                .filter(Boolean)
                .slice(0, 200),
            );
          }
        },
      ),
      listen<{ url: string }>('browser-download-blocked', (event) => {
        setDownloadUrl(event.payload.url);
        setNotice(
          'WebView download blocked. You can explicitly save a direct HTTPS plain-text response, up to 5 MiB.',
        );
        void invoke('content_visibility', { active: null });
        setPanel('downloads');
      }),
      listen<{ message: string }>('browser-policy', (event) => {
        setLoading(false);
        setError(event.payload.message);
        setPanel('');
        void invoke('close_content_tab', { tab: null });
      }),
      listen<{ tab: string; action: string }>('browser-shortcut', (event) => {
        if (event.payload.tab !== current.current.active) return;
        if (event.payload.action === 'address') {
          input.current?.focus();
          input.current?.select();
        }
        if (event.payload.action === 'new') addTab();
        if (event.payload.action === 'close') closeTab(event.payload.tab);
        if (['previous', 'next'].includes(event.payload.action)) {
          const s = current.current,
            index = s.tabs.findIndex((t) => t.id === s.active);
          setActive(
            s.tabs[
              (index +
                (event.payload.action === 'previous' ? -1 : 1) +
                s.tabs.length) %
                s.tabs.length
            ].id,
          );
        }
      }),
    ];
    return () => {
      alive.current = false;
      generation.current++;
      listeners.forEach((p) => void p.then((f) => f()));
      void invoke('close_content_tab', { tab: null });
    };
  }, []);
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => {
      setError(
        'The page did not finish loading. Retry or choose another address.',
      );
      setLoading(false);
      void invoke('close_content_tab', { tab: active });
    }, 30000);
    return () => clearTimeout(timer);
  }, [loading, active]);
  useEffect(() => {
    const shortcuts = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === 'l') {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
      if (e.key === 't') {
        e.preventDefault();
        addTab();
      }
      if (e.key === 'w') {
        e.preventDefault();
        closeTab(current.current.active);
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const state = current.current,
          index = state.tabs.findIndex((t) => t.id === state.active);
        setActive(
          state.tabs[
            (index + (e.shiftKey ? -1 : 1) + state.tabs.length) %
              state.tabs.length
          ].id,
        );
      }
    };
    window.addEventListener('keydown', shortcuts);
    return () => window.removeEventListener('keydown', shortcuts);
  }, []);
  const addTab = () => {
    if (current.current.tabs.length >= 20) {
      setNotice('Maximum 20 tabs');
      return;
    }
    const t = fresh();
    setTabs((items) => [...items, t]);
    setActive(t.id);
  };
  const closeTab = (id: string) => {
    void invoke('close_content_tab', { tab: id });
    setTabs((items) => {
      const rest = items.filter((t) => t.id !== id);
      if (!rest.length) rest.push(fresh());
      if (current.current.active === id) setActive(rest[0].id);
      return rest;
    });
  };
  const deviceStatus = async () => {
    try {
      const result = await api('/auth/status');
      if (result.device)
        setDevices([
          { ...result.device, trust_state: result.device.trustState },
        ]);
      setPanel('devices');
    } catch (e) {
      setError(String(e));
    }
  };
  const prove = async (id: string) => {
    try {
      const key = privateKeys.current.get(id);
      if (!key)
        throw new Error(
          'This session does not hold that device key. Register a new session-only key.',
        );
      const challenge = await api(`/devices/${id}/challenge`, 'POST', {});
      const raw = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        key,
        new TextEncoder().encode(challenge.message),
      );
      await api(`/devices/${id}/proof`, 'POST', {
        challengeId: challenge.challengeId,
        nonce: challenge.nonce,
        signature: base64url(signatureDer(raw)),
      });
      await deviceStatus();
      setNotice(
        'Key possession verified. Administrator posture approval is independent and must still be valid.',
      );
    } catch (e) {
      setNotice(String(e));
    }
  };
  const enroll = async () => {
    try {
      const device = (
        await api('/devices', 'POST', {
          externalId: crypto.randomUUID(),
          name: 'Desktop session key',
          platform: navigator.platform.toLowerCase().includes('win')
            ? 'windows'
            : navigator.platform.toLowerCase().includes('mac')
              ? 'macos'
              : 'linux',
        })
      ).device;
      const keys = await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['sign', 'verify'],
      );
      const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
      await api(`/devices/${device.id}/key`, 'POST', {
        publicKey: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
      });
      privateKeys.current.set(device.id, keys.privateKey);
      setDevices([device]);
      await prove(device.id);
      setPanel('devices');
    } catch (e) {
      setNotice(String(e));
    }
  };
  const networkStatus = async () => {
    try {
      const result = await api('/auth/status');
      setSourceGate(result.sourceGate);
      const wireguard = await invoke<string>('wireguard_status').catch(error=>`WireGuard check failed: ${String(error)}`);
      setNotice(
        (result.sourceGate === 'accepted'
          ? 'The server accepted this request through its configured source-address gate. Website routes and DNS remain unverified.'
          : 'The server source-address gate is disabled. Website routes and DNS remain unverified.') + ' ' +
        (wireguard === 'recent_peer_handshake' ? 'Expected WireGuard peer has a recent handshake.' : wireguard === 'not_configured' ? 'Local WireGuard probe is unconfigured.' : wireguard),
      );
    } catch (e) {
      setSourceGate('unknown');
      setNotice(String(e));
    }
    setPanel('network');
  };
  const checkUpdates = async () => {
    setPanel('updates');
    setUpdateVersion('');
    setNotice('Checking published releases…');
    try {
      const result = await invoke<{
        available: boolean;
        version?: string;
        message: string;
        installationEnabled: boolean;
      }>('check_updates');
      if (result.available && result.installationEnabled && result.version)
        setUpdateVersion(result.version);
      setNotice(
        `${result.available ? 'New release ' + result.version + ' is available. ' : ''}${result.message}`,
      );
    } catch (e) {
      setNotice(String(e));
    }
  };
  const saveDownload = async () => {
    setBusy(true);
    try {
      const path = await invoke<string>('save_text_download', {
        address: downloadUrl,
      });
      setNotice(`Saved to ${path}`);
    } catch (e) {
      setNotice(String(e));
    } finally {
      setBusy(false);
    }
  };
  const installUpdate = async () => {
    setBusy(true);
    try {
      await invoke('install_update', { version: updateVersion });
    } catch (e) {
      setNotice(String(e));
      setUpdateVersion('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`managed ${theme}`}>
      <header>
        <div>
          <strong>
            RemoteShield <span>X</span>
          </strong>
          <small>Organization browser</small>
        </div>
        <div className="actions">
          <button
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          >
            Appearance
          </button>
          <button onClick={deviceStatus}>Devices</button>
          <button onClick={checkUpdates}>Updates</button>
          <button onClick={onSignOut}>Sign out</button>
        </div>
      </header>
      <nav className="tabs" aria-label="Browser tabs">
        {tabs.map((t) => (
          <div className={t.id === active ? 'selected' : ''} key={t.id}>
            <button
              aria-current={t.id === active ? 'page' : undefined}
              onClick={() => setActive(t.id)}
            >
              {t.title}
            </button>
            <button
              aria-label={`Close ${t.title}`}
              onClick={() => closeTab(t.id)}
            >
              ×
            </button>
          </div>
        ))}
        <button aria-label="New tab" onClick={addTab}>
          ＋
        </button>
      </nav>
      <form
        className="address"
        onSubmit={(e) => {
          e.preventDefault();
          void navigate(address);
        }}
      >
        <button
          type="button"
          aria-label="Back"
          disabled={tab.index <= 0}
          onClick={() =>
            navigate(tab.entries[tab.index - 1], active, tab.index - 1)
          }
        >
          ←
        </button>
        <button
          type="button"
          aria-label="Forward"
          disabled={tab.index >= tab.entries.length - 1}
          onClick={() =>
            navigate(tab.entries[tab.index + 1], active, tab.index + 1)
          }
        >
          →
        </button>
        <button
          type="button"
          aria-label="Reload"
          disabled={!tab.url}
          onClick={() => navigate(tab.url, active, tab.index)}
        >
          ↻
        </button>
        <input
          ref={input}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          aria-label="Address or search"
          placeholder="Enter an address or search · Ctrl/⌘ L"
        />
        <button>Go</button>
        <button
          type="button"
          aria-label="Bookmark current page"
          disabled={!tab.url}
          onClick={() =>
            setBookmarks((v) =>
              v.includes(storedUrl(tab.url))
                ? v.filter((u) => u !== storedUrl(tab.url))
                : [storedUrl(tab.url), ...v].slice(0, 200),
            )
          }
        >
          {bookmarks.includes(storedUrl(tab.url)) ? '★' : '☆'}
        </button>
      </form>
      <div className="tools">
        <button
          onClick={() => {
            setNotice('');
            setPanel((p) => (p === 'history' ? '' : 'history'));
          }}
        >
          History
        </button>
        <button
          onClick={() => {
            setNotice('');
            setPanel((p) => (p === 'bookmarks' ? '' : 'bookmarks'));
          }}
        >
          Bookmarks
        </button>
        <button
          onClick={() => {
            setDownloadUrl('');
            setNotice(
              'Save direct HTTPS plain text to the application download folder.',
            );
            setPanel('downloads');
          }}
        >
          Downloads
        </button>
        <button
          onClick={() => {
            setHistory([]);
            setBookmarks([]);
            setNotice(
              'History and bookmarks cleared. Close tabs to remove their restored addresses.',
            );
            setPanel('history');
          }}
        >
          Clear saved browsing data
        </button>
        <button onClick={networkStatus}>
          {sourceGate === 'accepted'
            ? 'Network gate accepted'
            : 'Network status'}
        </button>
      </div>
      <main ref={viewport} aria-busy={loading}>
        {panel ? (
          <section>
            <h1>{panel[0].toUpperCase() + panel.slice(1)}</h1>
            <button onClick={() => setPanel('')}>Close panel</button>
            {notice && <p role="status">{notice}</p>}
            {['history', 'bookmarks'].includes(panel) &&
              (panel === 'history' ? history : bookmarks).map((url) => (
                <button
                  className="entry"
                  key={url}
                  onClick={() => navigate(url)}
                >
                  {url}
                </button>
              ))}
            {panel === 'devices' && (
              <>
                <p>
                  Device keys stay in this running session. Administrator
                  posture approval is separate.
                </p>
                <button onClick={enroll}>
                  Register session-only device key
                </button>
                {devices.map((d) => (
                  <div key={d.id}>
                    <p>
                      {d.name} · {d.trust_state} · {d.status}
                    </p>
                    <button onClick={() => prove(d.id)}>
                      Renew possession proof
                    </button>
                  </div>
                ))}
              </>
            )}
            {panel === 'downloads' && (
              <form
                className="address"
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveDownload();
                }}
              >
                <input
                  type="url"
                  aria-label="HTTPS download address"
                  required
                  value={downloadUrl}
                  onChange={(e) => setDownloadUrl(e.target.value)}
                />
                <button disabled={busy}>Save text file</button>
              </form>
            )}
            {panel === 'updates' && updateVersion && (
              <button disabled={busy} onClick={installUpdate}>
                Verify and install {updateVersion}
              </button>
            )}
          </section>
        ) : error ? (
          <section role="alert">
            <p className="eyebrow">Navigation unavailable</p>
            <h1>Your page was not opened</h1>
            <p>{error}</p>
            <button onClick={() => navigate(address)}>Retry</button>
          </section>
        ) : !tab.url ? (
          <section>
            <p className="eyebrow">RemoteShield workspace</p>
            <h1>A focused place to work.</h1>
            <p>
              Every address is checked against your organization policy.
              Restored addresses require explicit reopening.
            </p>
            {initial.tabs.some((t) => t.url) && (
              <button
                onClick={() =>
                  navigate(tab.url || initial.tabs.find((t) => t.url)!.url)
                }
              >
                Open restored page
              </button>
            )}
            <p className="muted">
              VPN routing, device trust and operating-system security require
              independent verification.
            </p>
          </section>
        ) : (
          <section className="load-status" role="status">
            {loading ? (
              'Loading page…'
            ) : (
              <>
                <p>Native content window</p>
                <button onClick={() => navigate(tab.url, active, tab.index)}>
                  Reopen page
                </button>
              </>
            )}
          </section>
        )}
      </main>
      <footer>
        <span role="status">
          {loading
            ? 'Loading…'
            : error
              ? 'Navigation blocked'
              : !panel && notice
                ? notice
                : 'Policy checked on navigation'}
        </span>
        <span>Remote content has no application IPC permissions</span>
      </footer>
    </div>
  );
}
