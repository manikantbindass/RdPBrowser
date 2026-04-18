import React, { useState, useEffect } from 'react';
import { Search as SearchIcon, ExternalLink, Zap } from 'lucide-react';

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
    if (searchQuery.trim()) performSearch(searchQuery);
  };

  return (
    <div className="laila-search-container animate-fade">
      {/* ── Navbar ── */}
      <div className="laila-nav">
        <div className="laila-brand glow-text">Laila</div>
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
