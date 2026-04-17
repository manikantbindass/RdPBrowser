import React, { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { PhysicalPosition, LogicalSize } from '@tauri-apps/api/dpi';
import TabBar from './TabBar';
import ParticleBackground from './ParticleBackground';
import RemoteDashboard from './RemoteDashboard';
import Terminal from './Terminal';
import CommandPalette from './CommandPalette';
import Sidebar from './Sidebar';

interface Tab { id: string; url: string; title: string; favicon: string; }
interface Props { authToken: string; }

const HOME_URL = '';

const isTauri = () =>
  typeof (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== 'undefined';

// ──────────────────────────────────────────────────────────────────────────────
// Native tab window registry
// Each tab gets its own WebviewWindow (no X-Frame-Options, real Chrome engine).
// We hide inactive tabs by moving them off-screen (-9999,-9999) and restore
// the active one using screen coords derived from the visible placeholder div.
// ──────────────────────────────────────────────────────────────────────────────
const tabWindows = new Map<string, WebviewWindow>();

/** Convert a getBoundingClientRect result to absolute screen coordinates */
function toScreenCoords(rect: DOMRect) {
  return {
    x: Math.round(window.screenX + rect.left),
    y: Math.round(window.screenY + rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

async function spawnTabWindow(tabId: string, baseLabel: string, url: string, rect: DOMRect) {
  const { x, y, width, height } = toScreenCoords(rect);
  const label = `${baseLabel}-${Date.now()}`;

  // Close any existing window for this tab so we can recreate it with a new URL
  await closeTabWindow(tabId);

  const wv = new WebviewWindow(label, {
    url,
    x,
    y,
    width,
    height,
    decorations: false,
    resizable: false,
    alwaysOnTop: false,
    skipTaskbar: true,
    visible: true,
    shadow: false,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  return new Promise<WebviewWindow>((resolve, reject) => {
    wv.once('tauri://created', () => { tabWindows.set(tabId, wv); resolve(wv); });
    wv.once('tauri://error', (e) => reject(new Error(String(e.payload))));
  });
}

async function hideTabWindow(tabId: string) {
  const wv = tabWindows.get(tabId);
  if (wv) {
    try { await wv.hide(); } catch { /* ok */ }
  }
}

async function showTabWindow(tabId: string, rect: DOMRect) {
  const wv = tabWindows.get(tabId);
  if (!wv) return;
  try {
    const { x, y, width, height } = toScreenCoords(rect);
    await wv.setPosition(new PhysicalPosition(x, y));
    await wv.setSize(new LogicalSize(width, height));
    await wv.show();
  } catch { /* ok */ }
}

async function closeTabWindow(tabId: string) {
  const wv = tabWindows.get(tabId);
  if (wv) {
    try { await wv.close(); } catch { /* ok */ }
    tabWindows.delete(tabId);
  }
}

// ──────────────────────────────────────────────────────────────────────────────

const Browser: React.FC<Props> = ({ authToken }) => {
  const [tabs, setTabs] = useState<Tab[]>([{ id: '1', url: HOME_URL, title: 'New Tab', favicon: '🌐' }]);
  const [activeTabId, setActiveTabId] = useState('1');
  const [urlInput, setUrlInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [vpnOn, setVpnOn] = useState(true);
  const [historyStack, setHistoryStack] = useState<Record<string, string[]>>({});
  const [historyIdx, setHistoryIdx] = useState<Record<string, number>>({});
  const [isDark, setIsDark] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [allHistory, setAllHistory] = useState<string[]>([]);

  const placeholderRef = useRef<HTMLDivElement>(null);
  const prevTabRef = useRef('1');

  const activeTab = tabs.find(t => t.id === activeTabId)!;
  const tabHistory = historyStack[activeTabId] ?? [];
  const tabHistIdx = historyIdx[activeTabId] ?? -1;
  const canBack = tabHistIdx > 0;
  const canForward = tabHistIdx < tabHistory.length - 1;

  // ─── VPN Poll ─────────────────────────────────────────────────
  useEffect(() => {
    const poll = async () => {
      try { setVpnOn(await invoke<boolean>('check_vpn_status')); }
      catch { setVpnOn(false); }
    };
    poll();
    const t = setInterval(poll, 15000);
    return () => clearInterval(t);
  }, []);

  // ─── Theme ────────────────────────────────────────────────────
  useEffect(() => {
    document.body.classList.toggle('theme-dark', isDark);
  }, [isDark]);

  // ─── URL bar sync ─────────────────────────────────────────────
  useEffect(() => {
    setUrlInput(activeTab?.url || '');
    setError('');
  }, [activeTabId, activeTab?.url]);

  // ─── Keyboard Shortcuts ───────────────────────────────────────
  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setCmdOpen(true);
      }
    };
    window.addEventListener('keydown', handleGlobalKey);
    return () => window.removeEventListener('keydown', handleGlobalKey);
  }, []);

  // ─── Get placeholder bounds ───────────────────────────────────
  const getRect = useCallback((): DOMRect | null => {
    return placeholderRef.current?.getBoundingClientRect() ?? null;
  }, []);

  // ─── Navigate ─────────────────────────────────────────────────
  const navigate = useCallback(async (rawUrl: string) => {
    if (!rawUrl.trim()) return;
    let url = rawUrl.trim();

    if (url.startsWith('ssh://')) {
      // Keep as is
    } else if (!url.includes('.') || url.includes(' ')) {
      url = `https://www.google.com/search?q=${encodeURIComponent(url)}`;
    } else if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url;
    }

    setLoading(true);
    setError('');

    try {
      // Guest bypass: no backend validation
      if (isTauri() && authToken !== 'guest') {
        const res = await invoke<{ allowed: boolean; url: string }>('request_navigate', { url }).catch(() => ({ allowed: true, url }));
        if (!res.allowed) { setError('URL blocked by RemoteShield policy'); setLoading(false); return; }
        url = res.url;
      }

      // Update React tab state
      const hostname = (() => { try { return new URL(url).hostname; } catch { return url; } })();
      setTabs(ts => ts.map(t => t.id === activeTabId ? { ...t, url, title: hostname, favicon: '🌐' } : t));
      setUrlInput(url);
      setAllHistory(h => [url, ...h.filter(u => u !== url)].slice(0, 50));

      // Push to per-tab history
      setHistoryStack(hs => {
        const prev = hs[activeTabId] ?? [];
        const idx = historyIdx[activeTabId] ?? -1;
        return { ...hs, [activeTabId]: [...prev.slice(0, idx + 1), url] };
      });
      setHistoryIdx(hi => ({ ...hi, [activeTabId]: (hi[activeTabId] ?? -1) + 1 }));

      // Launch native WebviewWindow for this tab (skip if SSH)
      if (isTauri() && !url.startsWith('ssh://')) {
        // Small tick so React can re-render the placeholder div first
        await new Promise(r => setTimeout(r, 30));
        const rect = getRect();
        if (!rect) { setError('Layout not ready — try again'); setLoading(false); return; }
        await spawnTabWindow(activeTabId, `tab-${activeTabId}`, url, rect);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [activeTabId, authToken, historyIdx, getRect]);

  // ─── Tab switching: hide old, show new ────────────────────────
  useEffect(() => {
    const prev = prevTabRef.current;
    if (!isTauri() || prev === activeTabId) { prevTabRef.current = activeTabId; return; }

    (async () => {
      await hideTabWindow(prev);
      const tab = tabs.find(t => t.id === activeTabId);
      if (tab && tab.url) {
        await new Promise(r => setTimeout(r, 40)); // let layout settle
        const rect = getRect();
        if (rect) await showTabWindow(activeTabId, rect);
      }
    })();

    prevTabRef.current = activeTabId;
  }, [activeTabId]); // eslint-disable-line

  // ─── History back / forward ───────────────────────────────────
  const goBack = async () => {
    if (!canBack) return;
    const idx = tabHistIdx - 1;
    const url = tabHistory[idx];
    setHistoryIdx(hi => ({ ...hi, [activeTabId]: idx }));
    setTabs(ts => ts.map(t => t.id === activeTabId ? { ...t, url } : t));
    if (isTauri()) {
      const rect = getRect();
      if (rect) await spawnTabWindow(activeTabId, `tab-${activeTabId}`, url, rect);
    }
  };

  const goForward = async () => {
    if (!canForward) return;
    const idx = tabHistIdx + 1;
    const url = tabHistory[idx];
    setHistoryIdx(hi => ({ ...hi, [activeTabId]: idx }));
    setTabs(ts => ts.map(t => t.id === activeTabId ? { ...t, url } : t));
    if (isTauri()) {
      const rect = getRect();
      if (rect) await spawnTabWindow(activeTabId, `tab-${activeTabId}`, url, rect);
    }
  };

  const goHome = async () => {
    if (isTauri()) await closeTabWindow(activeTabId);
    setTabs(ts => ts.map(t => t.id === activeTabId ? { ...t, url: HOME_URL, title: 'New Tab' } : t));
    setUrlInput('');
  };

  const refresh = () => navigate(activeTab.url);

  const addTab = () => {
    const id = Date.now().toString();
    setTabs(ts => [...ts, { id, url: HOME_URL, title: 'New Tab', favicon: '🌐' }]);
    setActiveTabId(id);
  };

  const closeTab = async (id: string) => {
    if (tabs.length === 1) return;
    if (isTauri()) await closeTabWindow(id);
    const idx = tabs.findIndex(t => t.id === id);
    const rest = tabs.filter(t => t.id !== id);
    setTabs(rest);
    if (activeTabId === id) setActiveTabId(rest[Math.max(0, idx - 1)].id);
  };

  return (
    <div className="app-container">
      <ParticleBackground />
      <Sidebar activeRoute="home" onNavigate={() => {}} />

      <div className="browser-layout" style={{ background: 'transparent' }}>
        {/* ── Floating Unified Navbar ── */}
      <div className="floating-nav-container">
        {/* ── Tab Bar ── */}
        <div className="browser-header-row" style={{ paddingBottom: 0, borderBottom: 'none', background: 'transparent' }}>
          <TabBar tabs={tabs} activeTabId={activeTabId} onSelect={setActiveTabId} onClose={closeTab} onNew={addTab} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingRight: 8 }}>
            <button className="nav-btn" onClick={() => setIsDark(d => !d)} title="Toggle Theme">
              {isDark ? '☀️' : '🌙'}
            </button>
            <div className="extensions-bar">
              <div className="ext-btn" title="Ad Shield">🛡️</div>
              <div className="ext-btn" title="Passwords">🔑</div>
              <div className="ext-btn puzzle" title="Extensions">🧩</div>
            </div>
          </div>
        </div>

        {/* ── Toolbar ── */}
        <div className="browser-header-row" style={{ background: 'transparent', borderBottom: 'none', paddingTop: 0 }}>
          <div className="browser-toolbar">
            <button id="rs-btn-back"    className="nav-btn" onClick={goBack}    disabled={!canBack}>◄</button>
            <button id="rs-btn-forward" className="nav-btn" onClick={goForward} disabled={!canForward}>►</button>
            <button id="rs-btn-refresh" className="nav-btn" onClick={refresh}   disabled={loading || !activeTab.url}>
              {loading ? <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> : '↻'}
            </button>
            <button id="rs-btn-home"    className="nav-btn" onClick={goHome}    title="Home">⌂</button>

            <div className="url-bar-container">
              <div className={`vpn-dot ${vpnOn ? 'vpn-dot-on' : 'vpn-dot-off'}`} style={{ marginRight: 8 }} title={vpnOn ? 'VPN Connected' : 'VPN Off'} />
              <span style={{ fontSize: 12, marginRight: 6, opacity: 0.7 }}>🔒</span>
              <input
                id="rs-url-bar"
                className="url-bar"
                type="text"
                value={urlInput}
                onChange={e => setUrlInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') navigate(urlInput); }}
                onFocus={e => e.target.select()}
                placeholder="Search or type a URL — google.com, youtube.com, any site..."
                spellCheck={false}
              />
              <button className="nav-btn" style={{ marginLeft: 4 }} onClick={() => navigate(urlInput)} title="Go">→</button>
            </div>

            <button className="nav-btn" style={{ fontSize: 16 }} onClick={() => setHistoryOpen(h => !h)} title="History">🕰️</button>
          </div>
        </div>
      </div>

      {/* ── History Drawer ── */}
      <div className={`history-drawer ${historyOpen ? 'open' : ''}`}>
        <div className="history-header">
          <h2 className="history-title">Browsing History</h2>
          <button className="nav-btn" onClick={() => setHistoryOpen(false)}>✖</button>
        </div>
        <div className="history-list">
          {allHistory.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>No history yet.</p>}
          {allHistory.map((url, i) => (
            <div key={i} className="history-item" onClick={() => { navigate(url); setHistoryOpen(false); }}>
              <span className="history-item-url">{url}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Webview Area ── */}
      <div className="webview-container" ref={placeholderRef}>
        <div className="animated-bg" />

        {error ? (
          <div className="webview-blocked animate-fade" style={{ margin: 'auto', maxWidth: 480, marginTop: '8%', textAlign: 'center', padding: 32, background: 'var(--bg-glass)', borderRadius: 16 }}>
            <div style={{ fontSize: 48 }}>🚫</div>
            <h2 style={{ marginTop: 12 }}>Access Blocked</h2>
            <p style={{ color: 'var(--text-muted)', marginTop: 8 }}>{error}</p>
            <button className="btn btn-ghost" style={{ marginTop: 16 }} onClick={() => setError('')}>← Go Back</button>
          </div>

        ) : activeTab.url.startsWith('ssh://') ? (
          <Terminal url={activeTab.url} />

        ) : activeTab.url ? (
          isTauri() ? (
            // Transparent placeholder — WebviewWindow overlays here via screen coords
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, opacity: loading ? 1 : 0, pointerEvents: 'none' }}>
              {loading && <><div className="spinner" style={{ width: 40, height: 40 }} /><p style={{ color: 'var(--text-muted)' }}>Opening {activeTab.title}...</p></>}
            </div>
          ) : (
            // Dev browser fallback: iframe (X-Frame-Options will block Google/YouTube — expected)
            <iframe
              id="rs-webview"
              className="webview-frame"
              src={activeTab.url}
              title={activeTab.title}
              sandbox="allow-downloads allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
            />
          )

        ) : (
          // Dashboard Screen
          <RemoteDashboard onNavigate={navigate} vpnOn={vpnOn} />
        )}
      </div>

      {/* ── Status Bar ── */}
      <div className="status-bar">
        <span style={{ fontSize: 12 }}>
          {loading ? `⏳ Opening ${activeTab.title}...` : activeTab.url ? `🌐 ${activeTab.url}` : 'Ready — type a URL above or click a quick link'}
        </span>
        <div className="badge badge-success">🟢 RemoteShield Active</div>
      </div>

      <CommandPalette isOpen={cmdOpen} onClose={() => setCmdOpen(false)} onNavigate={navigate} />

    </div>
  </div>
);
};

export default Browser;
