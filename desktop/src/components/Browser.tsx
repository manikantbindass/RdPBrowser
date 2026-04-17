import React, { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Webview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import TabBar from './TabBar';

interface Tab { id: string; url: string; title: string; favicon: string; }
interface Props { authToken: string; }

const HOME_URL = 'about:blank';

const isTauri = () =>
  typeof (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== 'undefined';

// Registry of native Webview instances keyed by tab ID
const webviewRegistry = new Map<string, Webview>();

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

  // Placeholder div — the native Webview overlays on top of this exact area
  const webviewAreaRef = useRef<HTMLDivElement>(null);
  const prevTabIdRef = useRef<string>('1');

  const activeTab = tabs.find(t => t.id === activeTabId)!;

  // ─── VPN poll ─────────────────────────────────────────────────
  useEffect(() => {
    const poll = async () => {
      try { const ok = await invoke<boolean>('check_vpn_status'); setVpnOn(ok); }
      catch { setVpnOn(false); }
    };
    poll();
    const id = setInterval(poll, 10000);
    return () => clearInterval(id);
  }, []);

  // ─── Sync URL bar ─────────────────────────────────────────────
  useEffect(() => {
    setUrlInput(activeTab?.url === HOME_URL ? '' : activeTab?.url || '');
    setBlockedMsg('');
  }, [activeTabId, activeTab?.url]);

  // ─── Theme ────────────────────────────────────────────────────
  useEffect(() => {
    document.body.classList.toggle('theme-dark', isDark);
  }, [isDark]);

  // ─── Compute pixel bounds of the webview placeholder ──────────
  const getBounds = useCallback(() => {
    if (!webviewAreaRef.current) return { x: 0, y: 0, width: 0, height: 0 };
    const r = webviewAreaRef.current.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
  }, []);

  // ─── Navigate ─────────────────────────────────────────────────
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
      // Validate with backend only when authenticated (not guest)
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
      updateTab(activeTabId, { url, title: new URL(url).hostname });
      setHistory(h => [...h.slice(0, historyIdx + 1), url]);
      setHistoryIdx(i => i + 1);

      if (isTauri()) {
        const bounds = getBounds();
        const existing = webviewRegistry.get(activeTabId);

        if (existing) {
          // Navigate existing native webview to the new URL
          await existing.navigate(url);
          await existing.setPosition({ type: 'Logical', x: bounds.x, y: bounds.y } as never);
          await existing.setSize({ type: 'Logical', width: bounds.width, height: bounds.height } as never);
        } else {
          // Create a brand-new native OS webview embedded in the main window
          const appWindow = getCurrentWindow();
          const wv = new Webview(appWindow, `tab_${activeTabId}`, {
            url,
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
          });
          webviewRegistry.set(activeTabId, wv);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setBlockedMsg(msg.replace(/[\[\]"]/g, '').trim() || 'Navigation failed');
    } finally {
      setLoading(false);
    }
  }, [activeTabId, historyIdx, getBounds, authToken]);

  // ─── Tab switching — hide old, show new native webview ────────
  useEffect(() => {
    const prev = prevTabIdRef.current;
    if (!isTauri() || prev === activeTabId) {
      prevTabIdRef.current = activeTabId;
      return;
    }

    const switchTabs = async () => {
      // Collapse the previous tab's native webview to 0 size (hide it)
      const prevWv = webviewRegistry.get(prev);
      if (prevWv) {
        try { await prevWv.setSize({ type: 'Logical', width: 0, height: 0 } as never); } catch { /* ok */ }
      }

      // Restore (show) the active tab's native webview
      const activeWv = webviewRegistry.get(activeTabId);
      const tab = tabs.find(t => t.id === activeTabId);
      if (activeWv && tab && tab.url !== HOME_URL) {
        const bounds = getBounds();
        try {
          await activeWv.setSize({ type: 'Logical', width: bounds.width, height: bounds.height } as never);
          await activeWv.setPosition({ type: 'Logical', x: bounds.x, y: bounds.y } as never);
        } catch { /* ok */ }
      }
    };

    switchTabs();
    prevTabIdRef.current = activeTabId;
  }, [activeTabId, tabs, getBounds]);

  const updateTab = (id: string, patch: Partial<Tab>) =>
    setTabs(ts => ts.map(t => t.id === id ? { ...t, ...patch } : t));

  const addTab = () => {
    const id = Date.now().toString();
    setTabs(ts => [...ts, { id, url: HOME_URL, title: 'New Tab', favicon: '🌐' }]);
    setActiveTabId(id);
  };

  const closeTab = async (id: string) => {
    if (tabs.length === 1) return;
    const wv = webviewRegistry.get(id);
    if (wv) {
      try { await wv.close(); } catch { /* ok */ }
      webviewRegistry.delete(id);
    }
    const idx = tabs.findIndex(t => t.id === id);
    const remaining = tabs.filter(t => t.id !== id);
    setTabs(remaining);
    if (activeTabId === id) setActiveTabId(remaining[Math.max(0, idx - 1)].id);
  };

  const canGoBack    = historyIdx > 0;
  const canGoForward = historyIdx < history.length - 1;

  const goBack = async () => {
    if (!canGoBack) return;
    const idx = historyIdx - 1;
    setHistoryIdx(idx);
    const url = history[idx];
    updateTab(activeTabId, { url });
    const wv = webviewRegistry.get(activeTabId);
    if (wv) { try { await wv.navigate(url); } catch { /* ok */ } }
  };

  const goForward = async () => {
    if (!canGoForward) return;
    const idx = historyIdx + 1;
    setHistoryIdx(idx);
    const url = history[idx];
    updateTab(activeTabId, { url });
    const wv = webviewRegistry.get(activeTabId);
    if (wv) { try { await wv.navigate(url); } catch { /* ok */ } }
  };

  const refresh = () => navigate(activeTab.url);

  return (
    <div className="browser-layout">
      {/* Tab Bar */}
      <div className="browser-header-row" style={{ paddingBottom: 0, borderBottom: 'none' }}>
        <TabBar tabs={tabs} activeTabId={activeTabId} onSelect={setActiveTabId} onClose={closeTab} onNew={addTab} />
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

      {/* Toolbar */}
      <div className="browser-header-row">
        <div className="browser-toolbar">
          <button id="rs-btn-back"    className="nav-btn" onClick={goBack}    disabled={!canGoBack}>◄</button>
          <button id="rs-btn-forward" className="nav-btn" onClick={goForward} disabled={!canGoForward}>►</button>
          <button id="rs-btn-refresh" className="nav-btn" onClick={refresh}   disabled={loading}>
            {loading ? <div className="spinner" style={{width:16,height:16,borderWidth:2}}/> : '↻'}
          </button>
          <button id="rs-btn-home" className="nav-btn"
            onClick={async () => {
              const wv = webviewRegistry.get(activeTabId);
              if (wv) { try { await wv.close(); } catch { /* ok */ } webviewRegistry.delete(activeTabId); }
              updateTab(activeTabId, { url: HOME_URL, title: 'New Tab' });
            }}>⌂</button>

          <div className="url-bar-container">
            <div className={`vpn-dot ${vpnOn ? 'vpn-dot-on' : 'vpn-dot-off'}`} style={{ marginRight: 8 }} />
            <input
              id="rs-url-bar"
              className="url-bar"
              type="text"
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') navigate(urlInput); }}
              placeholder="Search or enter URL — YouTube, Google, any site..."
              spellCheck={false}
            />
          </div>

          <button className="nav-btn" style={{ fontSize: 18 }} onClick={() => setHistoryOpen(!historyOpen)}>🕰️</button>
        </div>
      </div>

      {/* History Drawer */}
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

      {/* Webview area */}
      <div className="webview-container">
        <div className="animated-bg" />

        {blockedMsg ? (
          <div className="webview-blocked animate-fade glass" style={{ background: 'var(--bg-glass)', margin: 'auto', maxWidth: 500, marginTop: '10%' }}>
            <div className="webview-blocked-icon">🚫</div>
            <h2 className="webview-blocked-title">Access Blocked</h2>
            <p className="webview-blocked-msg">{blockedMsg}</p>
            <button className="btn btn-ghost" onClick={() => setBlockedMsg('')}>← Go Back</button>
          </div>
        ) : activeTab.url !== HOME_URL ? (
          // Transparent placeholder — the native Webview overlay renders here
          // In browser dev tab: fallback iframe for layout testing
          isTauri() ? (
            <div
              ref={webviewAreaRef}
              id="rs-webview-area"
              style={{ width: '100%', height: '100%', background: 'transparent' }}
            />
          ) : (
            <iframe
              id="rs-webview"
              className="webview-frame"
              src={activeTab.url}
              title={activeTab.title}
              sandbox="allow-downloads allow-scripts allow-same-origin allow-forms allow-popups"
            />
          )
        ) : (
          <div ref={webviewAreaRef} style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%', gap:20, position:'relative', zIndex:1 }}>
            <span style={{ fontSize: 64, animation: 'glow 3s infinite alternate' }}>🛡️</span>
            <h1 style={{ fontFamily: 'Outfit', fontSize: 32, fontWeight: 700 }}>RemoteShield X</h1>
            <p style={{ color: 'var(--text-muted)' }}>Secure • Encrypted • Enterprise Grade</p>
            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Type any site — YouTube, Google, Netflix — in the address bar above</p>
          </div>
        )}
      </div>

      {/* Status Bar */}
      <div className="status-bar">
        <span>{loading ? '⏳ Loading...' : activeTab.url !== HOME_URL ? `🌐 ${activeTab.url}` : 'Ready'}</span>
        <div className="badge badge-success">🟢 Secure Tunnel Active</div>
      </div>
    </div>
  );
};

export default Browser;
