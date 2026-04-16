import React, { useState } from 'react';

interface Props {
  message: string;
  onRetry: () => void;
  onBypass?: () => void;
}

const VpnGuard: React.FC<Props> = ({ message, onRetry, onBypass }) => {
  const [retrying, setRetrying] = useState(false);

  const handleRetry = async () => {
    setRetrying(true);
    await onRetry();
    setTimeout(() => setRetrying(false), 2000);
  };

  return (
    <div className="login-screen animate-fade">
      <div className="glass login-card" style={{ textAlign: 'center' }}>
        <div className="vpn-guard-icon" style={{ fontSize: '72px', filter: 'drop-shadow(0 0 15px rgba(239, 68, 68, 0.4))' }}>🔒</div>
        <h1 className="login-title" style={{ fontSize: '24px', marginBottom: '8px' }}>Secure Tunnel Required</h1>
        <p className="login-sub" style={{ color: 'var(--error)' }}>{message}</p>

        <div className="vpn-guard-steps" style={{ textAlign: 'left', background: 'rgba(0,0,0,0.2)', padding: '16px', borderRadius: '12px', fontSize: '14px', margin: '8px 0' }}>
          <p style={{ fontWeight: 600, marginBottom: 10, color: 'var(--text-primary)' }}>
            To connect to RemoteShield X:
          </p>
          <ol style={{ paddingLeft: '20px', margin: 0, gap: '8px', display: 'flex', flexDirection: 'column', color: 'var(--text-secondary)' }}>
            <li>Open the <strong>WireGuard</strong> app on your system</li>
            <li>Activate the <strong>RemoteShield-X</strong> tunnel</li>
            <li>Wait for the status to show <em style={{ color: 'var(--success)' }}>Active</em></li>
            <li>Click <strong>Retry</strong> below</li>
          </ol>
        </div>

        <div style={{ display: 'flex', gap: 12, flexDirection: 'column', alignItems: 'center', marginTop: '12px' }}>
          <button className="btn btn-primary" onClick={handleRetry} disabled={retrying} style={{ width: '100%', justifyContent: 'center', padding: '12px' }}>
            {retrying ? <><div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Checking...</> : '🔄 Retry Connection'}
          </button>
          {onBypass && (
            <button className="btn btn-ghost" onClick={onBypass} style={{ width: '100%', justifyContent: 'center', padding: '12px', fontSize: 13 }}>
              Continue without VPN (Dev Mode)
            </button>
          )}
        </div>

        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: '8px' }}>
          RemoteShield X blocks all browser access when the VPN is disconnected.<br />
          This is required for security compliance.
        </p>
      </div>
    </div>
  );
};

export default VpnGuard;
