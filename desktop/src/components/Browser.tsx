import React, { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import TabBar from './TabBar';

interface Tab { id: string; url: string; title: string; favicon: string; }
interface Props { authToken: string; }

const HOME_URL = 'about:blank';
const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'https://YOUR_SERVER_STATIC_IP';

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
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const activeTab = tabs.find(t => t.id === activeTabId)!;

  // Poll VPN every 10s
  useEffect(() => {
    const poll = async () => {
      try {
        const ok = await invoke<boolean>('check_vpn_status');
        setVpnOn(ok);
      } catch { setVpnOn(false); }
    };
    poll();
    const id = setInterval(poll, 10000);
    return () => clearInterval(id);
  }, []);

  // Sync URL bar with active tab
  useEffect(() => {
    setUrlInput(activeTab?.url === HOME_URL ? '' : activeTab?.url || '');
    setBlockedMsg('');
  }, [activeTabId, activeTab?.url]);

  const navigate = async (rawUrl: string) => {
    if (!rawUrl.trim()) return;
    let url = rawUrl.trim();
    
    // If it doesn't look like a URL (missing dot or space present), treat it as a Google Search
    if (!url.includes('.') || url.includes(' ')) {
      url = `https://www.bing.com/search?q=${encodeURIComponent(url)}`;
    } else if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url;
    }

    setLoading(true);
    setBlockedMsg('');

    // Check if running inside Tauri native window or plain browser tab
    const isTauri = typeof (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== 'undefined';

    if (isTauri) {
      try {
        const result = await invoke<{ allowed: boolean; url: string }>('request_navigate', { url });
        if (result.allowed) {
          updateTab(activeTabId, { url: result.url, title: new URL(result.url).hostname });
          setHistory(h => [...h.slice(0, historyIdx + 1), result.url]);
          setHistoryIdx(i => i + 1);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setBlockedMsg(msg.replace(/[\[\]"]/g, '').trim() || 'URL blocked by RemoteShield policy');
      } finally {
        setLoading(false);
      }
    } else {
      // Browser dev tab — navigate directly without Tauri IPC
      updateTab(activeTabId, { url, title: new URL(url).hostname });
      setHistory(h => [...h.slice(0, historyIdx + 1), url]);
      setHistoryIdx(i => i + 1);
      setLoading(false);
    }
  };

  const updateTab = (id: string, patch: Partial<Tab>) => {
    setTabs(ts => ts.map(t => t.id === id ? { ...t, ...patch } : t));
  };

  const addTab = () => {
    const id = Date.now().toString();
    setTabs(ts => [...ts, { id, url: HOME_URL, title: 'New Tab', favicon: '🌐' }]);
    setActiveTabId(id);
  };

  const closeTab = (id: string) => {
    if (tabs.length === 1) return;
    const idx = tabs.findIndex(t => t.id === id);
    const remaining = tabs.filter(t => t.id !== id);
    setTabs(remaining);
    if (activeTabId === id) {
      setActiveTabId(remaining[Math.max(0, idx - 1)].id);
    }
  };

  const handleUrlKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') navigate(urlInput);
  };

  const canGoBack    = historyIdx > 0;
  const canGoForward = historyIdx < history.length - 1;

  const goBack = () => {
    if (!canGoBack) return;
    const newIdx = historyIdx - 1;
    setHistoryIdx(newIdx);
    updateTab(activeTabId, { url: history[newIdx] });
  };

  const goForward = () => {
    if (!canGoForward) return;
    const newIdx = historyIdx + 1;
    setHistoryIdx(newIdx);
    updateTab(activeTabId, { url: history[newIdx] });
  };

  const refresh = () => navigate(activeTab.url);

  const [isDark, setIsDark] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Sync theme
  useEffect(() => {
    document.body.classList.toggle('theme-dark', isDark);
  }, [isDark]);

  return (
    <div className="browser-layout">
      {/* Tab Bar Row */}
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

      {/* Toolbar Row */}
      <div className="browser-header-row">
        <div className="browser-toolbar">
          <button id="rs-btn-back"    className="nav-btn" title="Back"    onClick={goBack}    disabled={!canGoBack}>◄</button>
          <button id="rs-btn-forward" className="nav-btn" title="Forward" onClick={goForward} disabled={!canGoForward}>►</button>
          <button id="rs-btn-refresh" className="nav-btn" title="Refresh" onClick={refresh}   disabled={loading}>
            {loading ? <div className="spinner" style={{width: 16, height: 16, borderWidth: 2}}/> : '↻'}
          </button>
          <button id="rs-btn-home" className="nav-btn" title="Home"
            onClick={() => updateTab(activeTabId, { url: HOME_URL, title: 'New Tab' })}>⌂</button>

          <div className="url-bar-container">
            <div className={`vpn-dot ${vpnOn ? 'vpn-dot-on' : 'vpn-dot-off'}`} style={{ marginRight: 8 }} title={vpnOn ? 'VPN Active' : 'VPN Inactive'} />
            <input
              id="rs-url-bar"
              className="url-bar"
              type="text"
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              onKeyDown={handleUrlKeyDown}
              placeholder="Enter URL to browse securely..."
              spellCheck={false}
            />
          </div>

          <button className="nav-btn" style={{ fontSize: 18 }} title="History" onClick={() => setHistoryOpen(!historyOpen)}>
            🕰️
          </button>
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
            <div key={i} className="history-item" onClick={() => {
               navigate(url);
               setHistoryOpen(false);
            }}>
              <span className="history-item-url">{url}</span>
            </div>
          ))}
        </div>
      </div>

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
          <iframe
            ref={iframeRef}
            id="rs-webview"
            className="webview-frame"
            src={activeTab.url}
            title={activeTab.title}
            sandbox="allow-downloads allow-scripts allow-same-origin allow-forms allow-popups"
            onLoad={() => {
              try {
                const doc = iframeRef.current?.contentDocument;
                if (doc?.title) updateTab(activeTabId, { title: doc.title });
              } catch { /* cross-origin */ }
            }}
          />
        ) : (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%', gap:20, position: 'relative', zIndex: 1 }}>
            <span style={{ fontSize: 64, animation: 'glow 3s infinite alternate' }}>🛡️</span>
            <h1 style={{ fontFamily: 'Outfit', fontSize: 32, fontWeight: 700 }}>RemoteShield X</h1>
            <p style={{ color: 'var(--text-muted)' }}>Secure • Encrypted • Enterprise Grade</p>
          </div>
        )}
      </div>

      {/* Status Bar */}
      <div className="status-bar">
        <span>{loading ? '⏳ Resolving...' : activeTab.url !== HOME_URL ? `🌐 ${activeTab.url}` : 'Ready'}</span>
        <div className="badge badge-success">🟢 Secure Tunnel Active</div>
      </div>
    </div>
  );
};

export default Browser;
