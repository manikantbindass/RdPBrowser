import React, { useState } from 'react';

interface Props {
  onLogin: (token: string) => void;
}

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'https://YOUR_SERVER_STATIC_IP';

const LoginScreen: React.FC<Props> = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
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
      const res = await fetch(`${SERVER_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password,
          deviceOs: navigator.platform.toLowerCase().includes('win') ? 'windows'
            : navigator.platform.toLowerCase().includes('mac') ? 'macos' : 'linux',
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Login failed');
        return;
      }

      onLogin(data.accessToken);
    } catch {
      setError('Cannot connect to RemoteShield server. Is VPN active?');
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

          {error && <div className="login-error">⚠️ {error}</div>}

          <button id="rs-login-btn" type="submit" className="btn btn-primary" disabled={loading} style={{ width: '100%', justifyContent: 'center', padding: '12px' }}>
            {loading
              ? <><div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Authenticating...</>
              : '🔐 Sign In Securely'
            }
          </button>
        </form>

        <div style={{ textAlign: 'center' }}>
          <span className="badge badge-success">🟢 VPN Connected</span>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10 }}>
            All sessions are encrypted and logged.<br />
            Unauthorized access attempts are reported.
          </p>
        </div>
      </div>
    </div>
  );
};

export default LoginScreen;
