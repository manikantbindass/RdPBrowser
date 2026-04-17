import React from 'react';
import { Server, Terminal as TermIcon, Shield, Globe, Activity } from 'lucide-react';

interface Props {
  onNavigate: (url: string) => void;
  vpnOn: boolean;
  activeRegion?: string;
}

const RemoteDashboard: React.FC<Props> = ({ onNavigate, vpnOn }) => {
  return (
    <div className="dashboard-container">
      <div className="dashboard-header animate-fade-up">
        <h1 className="cyber-title"><span className="glow-text">REMOTE</span> SHIELD X</h1>
        <p className="subtitle">Enterprise Secure Routing // Global Access</p>
      </div>

      <div className="dashboard-grid">
        {/* Panel 1: IP & Network Control */}
        <div className="glass-panel animate-fade-up delay-1">
          <div className="panel-header">
            <Globe size={20} className="text-blue" />
            <h3>Network Control</h3>
          </div>
          <div className="panel-content">
            <div className="status-row">
              <span>Status:</span>
              <span className={`status-badge ${vpnOn ? 'success' : 'warning'}`}>
                {vpnOn ? 'WireGuard Tunnel Active' : 'Direct Connection'}
              </span>
            </div>
            <div className="status-row">
              <span>Outbound IP:</span>
              <span className="mono-text">10.0.0.X (Hidden)</span>
            </div>
            
            <div className="action-buttons">
              <button className={`btn-cyber ${vpnOn ? 'active' : ''}`}>VPN</button>
              <button className="btn-cyber">Proxy</button>
              <button className="btn-cyber outline">Direct</button>
            </div>
          </div>
        </div>

        {/* Panel 2: Command Center Shortcuts */}
        <div className="glass-panel animate-fade-up delay-2">
          <div className="panel-header">
            <Activity size={20} className="text-purple" />
            <h3>Quick Launch</h3>
          </div>
          <div className="quick-links">
            <button className="tile-btn" onClick={() => onNavigate('https://github.com')}>
              GitHub
            </button>
            <button className="tile-btn" onClick={() => onNavigate('https://aws.amazon.com')}>
              AWS Console
            </button>
            <button className="tile-btn" onClick={() => onNavigate('https://youtube.com')}>
              YouTube
            </button>
          </div>
        </div>

        {/* Panel 3: VPS Instances */}
        <div className="glass-panel animate-fade-up delay-3 col-span-2">
          <div className="panel-header">
            <Server size={20} className="text-green" />
            <h3>Active VPS Instances</h3>
          </div>
          <table className="cyber-table">
            <thead>
              <tr>
                <th>Instance</th>
                <th>Region</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>us-east-prod-1</td>
                <td>N. Virginia</td>
                <td><span className="dot-green"></span> Online</td>
                <td>
                  <button className="action-link" onClick={() => onNavigate('ssh://us-east-prod-1')}><TermIcon size={14}/> SSH</button>
                  <button className="action-link outline"><Shield size={14}/> RDP</button>
                </td>
              </tr>
              <tr>
                <td>eu-central-dev</td>
                <td>Frankfurt</td>
                <td><span className="dot-green"></span> Online</td>
                <td>
                  <button className="action-link" onClick={() => onNavigate('ssh://eu-central-dev')}><TermIcon size={14}/> SSH</button>
                  <button className="action-link outline"><Shield size={14}/> RDP</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default RemoteDashboard;
