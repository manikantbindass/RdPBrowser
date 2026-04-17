import React, { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Webview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { LogicalPosition, LogicalSize } from '@tauri-apps/api/dpi';
import TabBar from './TabBar';

interface Tab { id: string; url: string; title: string; favicon: string; }
interface Props { authToken: string; }

const HOME_URL = 'about:blank';

const isTauri = () =>
  typeof (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== 'undefined';

// ---------------------------------------------------------------------------
// Native webview registry — keyed by tab ID
// We create ONE Webview per tab. To "navigate", we close and recreate it.
// To "hide", we collapse size to 0. To "show", we restore size.
// ---------------------------------------------------------------------------
const webviewRegistry = new Map<string, Webview>();

async function destroyWebview(tabId: string) {
  const wv = webviewRegistry.get(tabId);
  if (wv) {
    try { await wv.close(); } catch { /* already closed */ }
    webviewRegistry.delete(tabId);
  }
}

async function createWebview(tabId: string, url: string, bounds: { x: number; y: number; width: number; height: number }) {
  // Destroy existing before replacing
  await destroyWebview(tabId);

  const label = `tab-${tabId}`;
  const appWindow = getCurrentWindow();

  const wv = new Webview(appWindow, label, {
    url,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  });

  webviewRegistry.set(tabId, wv);
  return wv;
}

async function hideWebview(tabId: string) {
  const wv = webviewRegistry.get(tabId);
  if (wv) {
    try {
      await wv.setSize(new LogicalSize(0, 0));
    } catch { /* ok */ }
  }
}

async function showWebview(tabId: string, bounds: { x: number; y: number; width: number; height: number }) {
  const wv = webviewRegistry.get(tabId);
  if (wv) {
    try {
      await wv.setPosition(new LogicalPosition(bounds.x, bounds.y));
      await wv.setSize(new LogicalSize(bounds.width, bounds.height));
    } catch { /* ok */ }
  }
}

// ---------------------------------------------------------------------------

const Browser: React.FC<Props> = ({ authToken }) => {
  const [tabs, setTabs] = useState<Tab[]>([
    { id: '1', url: HOME_URL, title: 'New Tab', favicon: '🌐' },
  ]);
  const [activeTabId, setActiveTabId] = useState('1');
  const [urlInput, setUrlInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [blockedMsg, setBlockedMsg] = useState('');
  const [vpnOn, setVpnOn] = useState(true);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [isDark, setIsDark] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);

  const webviewAreaRef = useRef<HTMLDivElement>(null);
  const prevTabIdRef = useRef('1');

  const activeTab = tabs.find(t => t.id === activeTabId)!;

  // ─── VPN poll ─────────────────────────────────────────────
  useEffect(() => {
    const poll = async () => {
      try { const ok = await invoke<boolean>('check_vpn_status'); setVpnOn(ok); }
      catch { setVpnOn(false); }
    };
    poll();
    const id = setInterval(poll, 10000);
    return () => clearInterval(id);
  }, []);

  // ─── Sync URL bar ─────────────────────────────────────────
  useEffect(() => {
    setUrlInput(activeTab?.url === HOME_URL ? '' : activeTab?.url || '');
    setBlockedMsg('');
  }, [activeTabId, activeTab?.url]);

  // ─── Theme ────────────────────────────────────────────────
  useEffect(() => {
    document.body.classList.toggle('theme-dark', isDark);
  }, [isDark]);

  // ─── Compute webview area bounds ──────────────────────────
  const getBounds = useCallback(() => {
    if (!webviewAreaRef.current) return { x: 0, y: 0, width: 1, height: 1 };
    const r = webviewAreaRef.current.getBoundingClientRect();
    return {
      x: Math.round(r.left),
      y: Math.round(r.top),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  }, []);

  // ─── Navigate ─────────────────────────────────────────────
  const navigate = useCallback(async (rawUrl: string) => {
    if (!rawUrl.trim()) return;
    let url = rawUrl.trim();

    if (!url.includes('.') || url.includes(' ')) {
      url = `https://www.bing.com/search?q=${encodeURIComponent(url)}`;
    } else if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url;
    }

    setLoading(true);
    setBlockedMsg('');

    try {
      // Validate with backend only for non-guest authenticated users
      if (isTauri() && authToken !== 'guest') {
        const result = await invoke<{ allowed: boolean; url: string }>('request_navigate', { url });
        if (!result.allowed) {
          setBlockedMsg('URL blocked by RemoteShield policy');
          setLoading(false);
          return;
        }
        url = result.url;
      }

      // Update React tab state
      const patch: Partial<Tab> = { url, title: new URL(url).hostname };
      setTabs(ts => ts.map(t => t.id === activeTabId ? { ...t, ...patch } : t));
      setHistory(h => [...h.slice(0, historyIdx + 1), url]);
      setHistoryIdx(i => i + 1);
      setUrlInput(url);

      // Create / replace the native webview for this tab
      if (isTauri()) {
        const bounds = getBounds();
        await createWebview(activeTabId, url, bounds);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setBlockedMsg(msg.replace(/[\[\]"]/g, '').trim() || 'Navigation failed');
    } finally {
      setLoading(false);
    }
  }, [activeTabId, historyIdx, getBounds, authToken]);

  // ─── Tab switching ────────────────────────────────────────
  useEffect(() => {
    const prev = prevTabIdRef.current;
    if (!isTauri() || prev === activeTabId) {
      prevTabIdRef.current = activeTabId;
      return;
    }

    (async () => {
      // Hide old tab's native webview
      await hideWebview(prev);

      // Show new tab's native webview (if it has a loaded URL)
      const tab = tabs.find(t => t.id === activeTabId);
      if (tab && tab.url !== HOME_URL) {
        const bounds = getBounds();
        // Small delay to let the React layout settle before reading bounds
        await new Promise(r => setTimeout(r, 50));
        await showWebview(activeTabId, getBounds());
      }
    })();

    prevTabIdRef.current = activeTabId;
  }, [activeTabId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Tab management ───────────────────────────────────────
  const addTab = () => {
    const id = Date.now().toString();
    setTabs(ts => [...ts, { id, url: HOME_URL, title: 'New Tab', favicon: '🌐' }]);
    setActiveTabId(id);
  };

  const closeTab = async (id: string) => {
    if (tabs.length === 1) return;
    if (isTauri()) await destroyWebview(id);
    const idx = tabs.findIndex(t => t.id === id);
    const remaining = tabs.filter(t => t.id !== id);
    setTabs(remaining);
    if (activeTabId === id) setActiveTabId(remaining[Math.max(0, idx - 1)].id);
  };

  // ─── History nav ──────────────────────────────────────────
  const canGoBack    = historyIdx > 0;
  const canGoForward = historyIdx < history.length - 1;

  const goBack = async () => {
    if (!canGoBack) return;
    const idx = historyIdx - 1;
    const url = history[idx];
    setHistoryIdx(idx);
    setTabs(ts => ts.map(t => t.id === activeTabId ? { ...t, url, title: new URL(url).hostname } : t));
    setUrlInput(url);
    if (isTauri()) await createWebview(activeTabId, url, getBounds());
  };

  const goForward = async () => {
    if (!canGoForward) return;
    const idx = historyIdx + 1;
    const url = history[idx];
    setHistoryIdx(idx);
    setTabs(ts => ts.map(t => t.id === activeTabId ? { ...t, url, title: new URL(url).hostname } : t));
    setUrlInput(url);
    if (isTauri()) await createWebview(activeTabId, url, getBounds());
  };

  const goHome = async () => {
    if (isTauri()) await destroyWebview(activeTabId);
    setTabs(ts => ts.map(t => t.id === activeTabId ? { ...t, url: HOME_URL, title: 'New Tab' } : t));
    setUrlInput('');
  };

  const refresh = () => navigate(activeTab.url);

  return (
    <div className="browser-layout">

      {/* ── Tab Bar ─────────────────────────────────────────── */}
      <div className="browser-header-row" style={{ paddingBottom: 0, borderBottom: 'none' }}>
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onSelect={setActiveTabId}
          onClose={closeTab}
          onNew={addTab}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingRight: 8 }}>
          <button className="nav-btn" onClick={() => setIsDark(!isDark)} title="Toggle Theme">
            {isDark ? '☀️' : '🌙'}
          </button>
          <div className="extensions-bar">
            <div className="ext-btn" title="AdBlocker Shield">🛡️</div>
            <div className="ext-btn" title="Password Manager">🔑</div>
            <div className="ext-btn" title="Wallet">💼</div>
            <div className="ext-btn puzzle" title="Extensions">🧩</div>
          </div>
        </div>
      </div>

      {/* ── Toolbar ─────────────────────────────────────────── */}
      <div className="browser-header-row">
        <div className="browser-toolbar">
          <button id="rs-btn-back"    className="nav-btn" title="Back"    onClick={goBack}    disabled={!canGoBack}>◄</button>
          <button id="rs-btn-forward" className="nav-btn" title="Forward" onClick={goForward} disabled={!canGoForward}>►</button>
          <button id="rs-btn-refresh" className="nav-btn" title="Refresh" onClick={refresh}   disabled={loading}>
            {loading ? <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> : '↻'}
          </button>
          <button id="rs-btn-home" className="nav-btn" title="Home" onClick={goHome}>⌂</button>

          <div className="url-bar-container">
            <div
              className={`vpn-dot ${vpnOn ? 'vpn-dot-on' : 'vpn-dot-off'}`}
              style={{ marginRight: 8 }}
              title={vpnOn ? 'VPN Active' : 'VPN Inactive'}
            />
            <input
              id="rs-url-bar"
              className="url-bar"
              type="text"
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') navigate(urlInput); }}
              onFocus={e => e.target.select()}
              placeholder="Search or enter URL — YouTube, Google, any site works..."
              spellCheck={false}
            />
          </div>

          <button className="nav-btn" style={{ fontSize: 18 }} title="History" onClick={() => setHistoryOpen(!historyOpen)}>
            🕰️
          </button>
        </div>
      </div>

      {/* ── History Drawer ──────────────────────────────────── */}
      <div className={`history-drawer ${historyOpen ? 'open' : ''}`}>
        <div className="history-header">
          <h2 className="history-title">Browsing History</h2>
          <button className="nav-btn" onClick={() => setHistoryOpen(false)}>✖</button>
        </div>
        <div className="history-list">
          {history.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>No history yet.</p>}
          {[...history].reverse().map((url, i) => (
            <div key={i} className="history-item" onClick={() => { navigate(url); setHistoryOpen(false); }}>
              <span className="history-item-url">{url}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Webview Area ────────────────────────────────────── */}
      <div className="webview-container">
        <div className="animated-bg" />

        {blockedMsg ? (
          <div className="webview-blocked animate-fade glass"
            style={{ background: 'var(--bg-glass)', margin: 'auto', maxWidth: 500, marginTop: '10%' }}>
            <div className="webview-blocked-icon">🚫</div>
            <h2 className="webview-blocked-title">Access Blocked</h2>
            <p className="webview-blocked-msg">{blockedMsg}</p>
            <button className="btn btn-ghost" onClick={() => setBlockedMsg('')}>← Go Back</button>
          </div>

        ) : activeTab.url !== HOME_URL ? (
          isTauri() ? (
            // Transparent placeholder — native Webview overlays exactly here
            <div
              ref={webviewAreaRef}
              id="rs-webview-area"
              style={{ width: '100%', height: '100%', background: 'transparent' }}
            />
          ) : (
            // Browser dev tab fallback: use iframe for layout testing
            <iframe
              id="rs-webview"
              className="webview-frame"
              src={activeTab.url}
              title={activeTab.title}
              sandbox="allow-downloads allow-scripts allow-same-origin allow-forms allow-popups"
            />
          )

        ) : (
          // Home screen
          <div
            ref={webviewAreaRef}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 20, position: 'relative', zIndex: 1 }}
          >
            <span style={{ fontSize: 64, animation: 'glow 3s infinite alternate' }}>🛡️</span>
            <h1 style={{ fontFamily: 'Outfit', fontSize: 32, fontWeight: 700 }}>RemoteShield X</h1>
            <p style={{ color: 'var(--text-muted)' }}>Secure • Encrypted • Enterprise Grade</p>
            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
              Type any site — YouTube, Google, Netflix — in the address bar above
            </p>
          </div>
        )}
      </div>

      {/* ── Status Bar ──────────────────────────────────────── */}
      <div className="status-bar">
        <span>
          {loading
            ? '⏳ Loading...'
            : activeTab.url !== HOME_URL
              ? `🌐 ${activeTab.url}`
              : 'Ready'}
        </span>
        <div className="badge badge-success">🟢 Secure Tunnel Active</div>
      </div>

    </div>
  );
};

export default Browser;
