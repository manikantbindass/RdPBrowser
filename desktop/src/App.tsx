import React, { useEffect, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import VpnGuard from './components/VpnGuard';
import LoginScreen from './components/LoginScreen';
import Browser from './components/Browser';
import './index.css';

export type AppView = 'login' | 'browser';

interface VpnEvent { connected: boolean; message: string; }

const App: React.FC = () => {
  const [view, setView] = useState<AppView>('login');
  const [vpnConnected, setVpnConnected] = useState<boolean | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [vpnMessage, setVpnMessage] = useState('Checking VPN...');

  const [bypassVpn, setBypassVpn] = useState(false);

  // ─── Initial VPN check ──────────────────────────────────────
  const pollVpn = useCallback(async () => {
    if (bypassVpn) return;
    try {
      const connected = await invoke<boolean>('check_vpn_status');
      setVpnConnected(connected);
      if (!connected) setVpnMessage('VPN disconnected — browser blocked for security');
    } catch {
      setVpnConnected(false);
      setVpnMessage('Cannot reach RemoteShield server');
    }
  }, [bypassVpn]);

  useEffect(() => {
    pollVpn();
    // Listen to Rust VPN watchdog events
    const unlisten = listen<VpnEvent>('vpn_status', (e) => {
      if (!bypassVpn) {
        setVpnConnected(e.payload.connected);
        setVpnMessage(e.payload.message);
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [pollVpn, bypassVpn]);

  // ─── Login success handler ───────────────────────────────────
  const handleLogin = async (token: string) => {
    await invoke('set_auth_token', { token });
    setAuthToken(token);
    setView('browser');
  };

  // ─── Loading state ───────────────────────────────────────────
  if (vpnConnected === null) {
    return (
      <div className="splash">
        <div className="splash-logo">🛡️</div>
        <p className="splash-text">Verifying secure connection...</p>
        <div className="spinner" />
      </div>
    );
  }

  if (!vpnConnected && !bypassVpn) {
    return (
      <VpnGuard 
        message={vpnMessage} 
        onRetry={pollVpn} 
        onBypass={() => {
          setBypassVpn(true);
          setVpnConnected(true);
        }} 
      />
    );
  }

  // ─── Not authenticated ───────────────────────────────────────
  if (view === 'login' || !authToken) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  // ─── Main browser view ───────────────────────────────────────
  return <Browser authToken={authToken} />;
};

export default App;
