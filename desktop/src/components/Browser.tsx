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
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

    setLoading(true);
    setBlockedMsg('');

    try {
      const result = await invoke<{ allowed: boolean; url: string }>('request_navigate', { url });
      if (result.allowed) {
        updateTab(activeTabId, { url: result.url, title: new URL(result.url).hostname });
        setHistory(h => [...h.slice(0, historyIdx + 1), result.url]);
        setHistoryIdx(i => i + 1);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setBlockedMsg(msg || 'URL blocked by RemoteShield policy');
    } finally {
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

  return (
    <div className="browser-layout">
      {/* Tab Bar */}
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelect={setActiveTabId}
        onClose={closeTab}
        onNew={addTab}
      />

      {/* Toolbar */}
      <div className="browser-toolbar">
        <button id="rs-btn-back"    className="nav-btn" title="Back"    onClick={goBack}    disabled={!canGoBack}>‹</button>
        <button id="rs-btn-forward" className="nav-btn" title="Forward" onClick={goForward} disabled={!canGoForward}>›</button>
        <button id="rs-btn-refresh" className="nav-btn" title="Refresh" onClick={refresh}   disabled={loading}>
          {loading ? '⏳' : '↻'}
        </button>
        <button id="rs-btn-home" className="nav-btn" title="Home"
          onClick={() => updateTab(activeTabId, { url: HOME_URL, title: 'New Tab' })}>⌂</button>

        <input
          id="rs-url-bar"
          className="url-bar"
          type="text"
          value={urlInput}
          onChange={e => setUrlInput(e.target.value)}
          onKeyDown={handleUrlKeyDown}
          placeholder="Enter URL — all traffic routes through RemoteShield VPN"
          spellCheck={false}
        />

        <button id="rs-btn-go" className="btn btn-primary" onClick={() => navigate(urlInput)} disabled={loading} style={{ padding: '6px 14px', fontSize: 12 }}>
          Go
        </button>

        <div className={`vpn-indicator ${vpnOn ? 'vpn-on' : 'vpn-off'}`}>
          <span className={`vpn-dot ${vpnOn ? 'vpn-dot-on' : 'vpn-dot-off'}`} />
          {vpnOn ? 'VPN ON' : 'VPN OFF'}
        </div>
      </div>

      {/* WebView Area */}
      <div className="webview-container">
        {!vpnOn ? (
          <div className="webview-blocked animate-fade">
            <div className="webview-blocked-icon">🔒</div>
            <h2 className="webview-blocked-title">VPN Disconnected</h2>
            <p className="webview-blocked-msg">
              Browser access is suspended while the VPN tunnel is down.<br />
              Reconnect WireGuard to resume browsing.
            </p>
          </div>
        ) : blockedMsg ? (
          <div className="webview-blocked animate-fade">
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
            sandbox="allow-scripts allow-same-origin allow-forms"
            onLoad={() => {
              try {
                const doc = iframeRef.current?.contentDocument;
                if (doc?.title) updateTab(activeTabId, { title: doc.title });
              } catch { /* cross-origin */ }
            }}
          />
        ) : (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%', gap:16 }}>
            <span style={{ fontSize: 48 }}>🛡️</span>
            <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
              Enter a URL above to browse securely via RemoteShield X
            </p>
          </div>
        )}
      </div>

      {/* Status Bar */}
      <div className="status-bar">
        <span>{loading ? '⏳ Loading...' : activeTab.url !== HOME_URL ? `🔐 ${activeTab.url}` : 'Ready'}</span>
        <span>{vpnOn ? '🟢 Tunnel Active' : '🔴 Tunnel Inactive'} · {new Date().toLocaleTimeString()}</span>
      </div>
    </div>
  );
};

export default Browser;
