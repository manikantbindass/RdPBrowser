import React, { useState, useEffect } from 'react';
import { Search as SearchIcon, ExternalLink, Zap } from 'lucide-react';

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

interface Props {
  query: string;
  onNavigate: (url: string) => void;
}

interface LailaResult {
  title: string;
  url: string;
  snippet: string;
}

const LailaSearch: React.FC<Props> = ({ query, onNavigate }) => {
  const [results, setResults] = useState<LailaResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState(query);

  const performSearch = async (q: string) => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`http://localhost:3001/api/laila/search?q=${encodeURIComponent(q)}`);
      if (!response.ok) throw new Error('Failed to connect to Laila Core AI.');
      const data = await response.json();
      setResults(data.results || []);
    } catch (err: any) {
      setError(err.message || 'Laila Core offline or unreachable.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (query) {
      performSearch(query);
      setSearchQuery(query);
    }
  }, [query]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;

    // Independent Browser Smart Routing
    const isDomain = /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?:\/.*)?$/.test(q);
    if (isDomain || q.startsWith('http://') || q.startsWith('https://')) {
      onNavigate(q.startsWith('http') ? q : `https://${q}`);
      return;
    }

    performSearch(q);
  };

  return (
    <div className="laila-search-container animate-fade">
      {/* ── Navbar ── */}
      <div className="laila-nav" style={{ display: 'flex', alignItems: 'center' }}>
        <LailaLogo />
        <div className="laila-brand glow-text" style={{ fontSize: '2rem', backgroundImage: 'linear-gradient(135deg, #534AB7 0%, #1D9E75 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', fontWeight: 700, marginRight: '40px' }}>Laila</div>
        <form className="laila-search-bar" onSubmit={handleSearchSubmit}>
          <input 
            type="text" 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search the decentralized web..." 
            spellCheck={false}
          />
          <button type="submit"><SearchIcon size={18} /></button>
        </form>
      </div>

      {/* ── Content ── */}
      <div className="laila-content">
        {loading ? (
          <div className="laila-loading">
            <div className="spinner"></div>
            <p>Laila Core AI is analyzing billions of nodes...</p>
          </div>
        ) : error ? (
          <div className="laila-error">{error}</div>
        ) : (
          <div className="laila-results">
            <p className="laila-meta">Found {results.length} encrypted results securely delivered</p>
            {results.map((res, idx) => (
              <div key={idx} className="laila-card animate-slide-up" style={{ animationDelay: `${idx * 0.05}s` }}>
                <a 
                  href={res.url} 
                  className="laila-card-url" 
                  onClick={(e) => { e.preventDefault(); onNavigate(res.url); }}
                >
                  {res.url}
                </a>
                <a 
                  href={res.url} 
                  className="laila-card-title glow-hover"
                  onClick={(e) => { e.preventDefault(); onNavigate(res.url); }}
                >
                  {res.title}
                </a>
                <p className="laila-card-snippet">{res.snippet}</p>
              </div>
            ))}
            {results.length === 0 && <p className="laila-meta">No neural links matched your query.</p>}
          </div>
        )}
      </div>
    </div>
  );
};

export default LailaSearch;
