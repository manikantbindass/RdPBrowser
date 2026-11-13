import React, { useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import LoginScreen from './components/LoginScreen';
import Browser from './components/Browser';
import './index.css';

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState('');
  const login = async (value: string) => {
    try {
      if (value === 'guest') throw new Error('Enterprise browsing requires authentication.');
      if (!isTauri()) throw new Error('Open the native application to start a browsing session.');
      await invoke('set_auth_token', { token: value });
      setError(''); setToken(value);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Native session unavailable'); }
  };
  const logout = async () => {
    await invoke('set_auth_token', { token: '' }).catch(() => undefined);
    setToken(null);
  };
  return <>{error && <div role="alert">{error}</div>}{token
    ? <><button className="session-signout" onClick={logout}>Sign out</button><Browser authToken={token} /></>
    : <LoginScreen onLogin={login} />}</>;
}
