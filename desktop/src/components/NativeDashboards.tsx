import React from 'react';
import { Clock, PlaySquare, Library, ImagePlus, Video, Mic, HelpCircle } from 'lucide-react';

interface BaseProps {
  onNavigate?: (url: string) => void;
  title: string;
  icon: React.ReactNode;
  children?: React.ReactNode;
}

const LailaGradientStyle = {
  background: 'linear-gradient(135deg, #534AB7 0%, #1D9E75 100%)',
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  display: 'inline-block',
  fontFamily: "'Outfit', sans-serif",
  fontWeight: 700,
  fontSize: '2rem'
};

const LailaLogo = () => (
  <svg width="40" height="40" viewBox="0 0 24 24" style={{ marginRight: 16 }}>
    <defs>
      <linearGradient id="vg1" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#534AB7"/>
        <stop offset="100%" stopColor="#1D9E75"/>
      </linearGradient>
    </defs>
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z" fill="url(#vg1)"/>
  </svg>
);

const DashboardLayout: React.FC<BaseProps> = ({ title, icon, children }) => (
  <div className="native-dashboard animate-fade">
    <div className="dash-header">
      <LailaLogo />
      <div>{icon}</div>
      <h1 style={LailaGradientStyle}>{title}</h1>
    </div>
    <div className="dash-content">
      {children}
    </div>
  </div>
);

export const HistoryDashboard = ({ history = [], onNavigate }: { history: string[], onNavigate: (url: string) => void }) => (
  <DashboardLayout title="Browsing History" icon={<Clock size={28} color="#1D9E75" strokeWidth={1.5} style={{marginRight: 10}}/>}>
    <div className="laila-card-grid">
      {history.length === 0 ? (
        <p style={{ color: 'rgba(255,255,255,0.4)' }}>No temporal activity nodes retrieved from the matrix.</p>
      ) : (
        history.map((url, i) => (
          <div key={i} className="laila-dash-card glow-hover" onClick={() => onNavigate(url)}>
            <p className="dash-url">{url}</p>
            <span className="dash-meta">Local Time Matrix</span>
          </div>
        ))
      )}
    </div>
  </DashboardLayout>
);

export const PlaceholderDashboard = ({ title, icon }: { title: string, icon: React.ReactNode }) => (
  <DashboardLayout title={title} icon={icon}>
    <div className="placeholder-module">
      <div className="spinner" style={{ borderColor: '#534AB7', borderTopColor: '#1D9E75' }}></div>
      <p style={{ color: '#AFA9EC', marginTop: 24, fontSize: '1.2rem' }}>
        Awaiting Neural Link Initialization...
      </p>
      <p style={{ color: 'rgba(255,255,255,0.4)', marginTop: 8 }}>
        The {title} module requires advanced compute provisioning.
      </p>
    </div>
  </DashboardLayout>
);
