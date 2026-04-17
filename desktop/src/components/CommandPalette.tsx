import React, { useState, useEffect } from 'react';
import { Search, Server, Globe } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (url: string) => void;
}

const CommandPalette: React.FC<Props> = ({ isOpen, onClose, onNavigate }) => {
  const [query, setQuery] = useState('');

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSelect = (url: string) => {
    onNavigate(url);
    onClose();
  };

  return (
    <div className="cmd-palette-backdrop" onClick={onClose}>
      <div className="cmd-palette" onClick={e => e.stopPropagation()}>
        <div className="cmd-search">
          <Search size={18} className="text-muted" />
          <input
            autoFocus
            type="text"
            placeholder="Search commands, URLs, or servers..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSelect(query); }}
          />
        </div>
        <div className="cmd-results">
          <div className="cmd-group">
            <div className="cmd-group-title">Servers</div>
            <button className="cmd-item" onClick={() => handleSelect('ssh://us-east-prod-1')}>
              <Server size={14} /> Connect to us-east-prod-1
            </button>
          </div>
          <div className="cmd-group">
            <div className="cmd-group-title">Shortcuts</div>
            <button className="cmd-item" onClick={() => handleSelect('https://github.com/manikantbindass')}>
               <Globe size={14} /> Open GitHub
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CommandPalette;
