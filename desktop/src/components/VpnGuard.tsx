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
    <div className="vpn-guard animate-fade">
      <div className="vpn-guard-icon">🔒</div>
      <h1 className="vpn-guard-title">Secure Tunnel Required</h1>
      <p className="vpn-guard-msg">{message}</p>

      <div className="vpn-guard-steps">
        <p style={{ fontWeight: 600, marginBottom: 10, color: 'var(--text-primary)' }}>
          To connect to RemoteShield X:
        </p>
        <ol>
          <li>Open the <strong>WireGuard</strong> app on your system</li>
          <li>Activate the <strong>RemoteShield-X</strong> tunnel</li>
          <li>Wait for the status to show <em>Active</em></li>
          <li>Click <strong>Retry</strong> below</li>
        </ol>
      </div>

      <div style={{ display: 'flex', gap: 12, flexDirection: 'column', alignItems: 'center' }}>
        <button className="btn btn-primary" onClick={handleRetry} disabled={retrying}>
          {retrying ? <><div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Checking...</> : '🔄 Retry Connection'}
        </button>
        {onBypass && (
          <button className="btn btn-ghost" onClick={onBypass} style={{ fontSize: 13 }}>
            Continue without VPN (Dev Mode)
          </button>
        )}
      </div>

      <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
        RemoteShield X blocks all browser access when the VPN is disconnected.<br />
        This is required for security compliance.
      </p>
    </div>
  );
};

export default VpnGuard;
