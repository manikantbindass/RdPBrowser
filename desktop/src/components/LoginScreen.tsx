import { SERVER_URL } from '../config';
import React, { useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';

interface Props {
  onLogin: (token: string, refresh?: string, owner?: string) => void;
}


const LoginScreen: React.FC<Props> = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [organizationId,setOrganizationId]=useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError('Please enter username and password');
      return;
    }
    setLoading(true);
    setError('');

    try {
      if (!isTauri()) throw new Error('Open the native desktop application to sign in.');
      if (await invoke<string>('control_plane_origin') !== SERVER_URL) throw new Error('Desktop and native control-plane origins differ. Check the application configuration.');
      const res = await fetch(`${SERVER_URL}/api/auth/login`, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password,
          ...(organizationId.trim()?{organizationId:organizationId.trim()}:{}),
          deviceOs: navigator.platform.toLowerCase().includes('win') ? 'windows'
            : navigator.platform.toLowerCase().includes('mac') ? 'macos' : 'linux',
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(typeof data.error==='string'?data.error:'Login failed');
        return;
      }

      if (typeof data.accessToken!=='string' || typeof data.refreshToken!=='string' || typeof data.user?.id!=='string') throw new Error('Invalid login response');
      onLogin(data.accessToken, data.refreshToken, `${data.user.organizationId || 'legacy'}:${data.user.id}`);
    } catch (reason) {
      setError(reason instanceof Error && reason.name!=='TypeError' ? reason.message : 'Cannot connect to the organization server.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-screen animate-fade">
      <div className="glass login-card">
        <div className="login-header">
          <span className="login-logo">🛡️</span>
          <h1 className="login-title">RemoteShield X</h1>
          <p className="login-sub">Secure Remote Work Browser</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <div>
            <label className="login-label" htmlFor="rs-username">Username</label>
            <input
              id="rs-username"
              type="text"
              className="input"
              placeholder="Enter your username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
            />
          </div>
          <div>
            <label className="login-label" htmlFor="rs-password">Password</label>
            <input
              id="rs-password"
              type="password"
              className="input"
              placeholder="Enter your password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <div><label className="login-label" htmlFor="rs-organization">Organization ID (optional)</label><input id="rs-organization" className="input" value={organizationId} onChange={e=>setOrganizationId(e.target.value)} autoComplete="organization" placeholder="Default organization when empty"/></div>

          {error && <div className="login-error">⚠️ {error}</div>}

          <button id="rs-login-btn" type="submit" className="btn btn-primary" disabled={loading} style={{ width: '100%', justifyContent: 'center', padding: '12px' }}>
            {loading
              ? <><div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Authenticating...</>
              : '🔐 Sign In Securely'
            }
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '16px' }}>
          <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Authentication uses your organization server.<br />
            VPN and device posture require separate verification.
          </p>
        </div>
      </div>
    </div>
  );
};

export default LoginScreen;
