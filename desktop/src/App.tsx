import { useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import LoginScreen from './components/LoginScreen';
import ManagedBrowser from './components/ManagedBrowser';
import { SERVER_URL } from './config';
import './index.css';

interface Session {
  access: string;
  refresh: string;
  owner: string;
}
export default function App() {
  const [session, setSession] = useState<Session | null>(null),
    [error, setError] = useState('');
  const generation = useRef(0);
  const logout = async (message = '') => {
    const old = session;
    generation.current++;
    setSession(null);
    setError(message);
    await invoke('set_auth_token', { token: '' }).catch(() => undefined);
    if (old)
      void fetch(`${SERVER_URL}/api/v1/auth/logout`, {
        method: 'POST',
        redirect: 'error',
        headers: { Authorization: `Bearer ${old.access}` },
        signal: AbortSignal.timeout(8000),
      }).catch(() => undefined);
  };
  const login = async (access: string, refresh = '', owner = '') => {
    try {
      if (!isTauri())
        throw new Error(
          'Use the native desktop application for an authenticated session.',
        );
      await invoke('set_auth_token', { token: access });
      generation.current++;
      setSession({ access, refresh, owner });
      setError('');
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Native authentication unavailable',
      );
    }
  };
  useEffect(() => {
    if (!session) return;
    const expected = generation.current;
    let busy = false,
      stopped = false;
    const verify = async () => {
      if (busy || stopped) return;
      busy = true;
      try {
        const response = await fetch(`${SERVER_URL}/api/v1/auth/status`, {
          redirect: 'error',
          headers: { Authorization: `Bearer ${session.access}` },
          signal: AbortSignal.timeout(8000),
        });
        if (stopped || generation.current !== expected) return;
        if (response.status === 401) {
          const refresh = await fetch(`${SERVER_URL}/api/v1/auth/refresh`, {
            method: 'POST',
            redirect: 'error',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken: session.refresh }),
            signal: AbortSignal.timeout(8000),
          });
          if (!refresh.ok)
            throw new Error('Session expired or revoked. Sign in again.');
          const data = await refresh.json();
          if (
            typeof data.accessToken !== 'string' ||
            typeof data.refreshToken !== 'string'
          )
            throw new Error('Invalid refresh response');
          if (stopped || generation.current !== expected) {
            void fetch(`${SERVER_URL}/api/v1/auth/logout`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${data.accessToken}` },
              signal: AbortSignal.timeout(8000),
            }).catch(() => undefined);
            return;
          }
          await invoke('rotate_auth_token', {
            previous: session.access,
            token: data.accessToken,
          });
          if (!stopped && generation.current === expected)
            setSession({
              ...session,
              access: data.accessToken,
              refresh: data.refreshToken,
            });
        } else if (!response.ok)
          throw new Error(
            response.status === 403
              ? 'Organization access policy changed. Sign in again.'
              : 'Session verification unavailable.',
          );
      } catch (reason) {
        if (!stopped && generation.current === expected)
          void logout(
            reason instanceof Error ? reason.message : 'Session unavailable',
          );
      } finally {
        busy = false;
      }
    };
    void verify();
    const timer = setInterval(verify, 15000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [session]);
  return (
    <>
      {error && (
        <div
          role="alert"
          style={{ padding: 16, background: '#331b27', color: '#fff' }}
        >
          {error}
        </div>
      )}
      {session ? (
        <ManagedBrowser
          authToken={session.access}
          owner={session.owner}
          onSignOut={() => void logout()}
        />
      ) : (
        <LoginScreen onLogin={login} />
      )}
    </>
  );
}
