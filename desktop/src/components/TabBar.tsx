import React from 'react';

interface Tab { id: string; url: string; title: string; favicon: string; }

interface Props {
  tabs: Tab[];
  activeTabId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}

const TabBar: React.FC<Props> = ({ tabs, activeTabId, onSelect, onClose, onNew }) => (
  <div className="tab-bar">
    {tabs.map(tab => (
      <div
        key={tab.id}
        id={`rs-tab-${tab.id}`}
        className={`tab ${tab.id === activeTabId ? 'active' : ''}`}
        onClick={() => onSelect(tab.id)}
        title={tab.url}
      >
        <span className="tab-favicon">{tab.favicon}</span>
        <span className="tab-title">{tab.title}</span>
        <button
          className="tab-close"
          onClick={e => { e.stopPropagation(); onClose(tab.id); }}
          title="Close tab"
        >
          ×
        </button>
      </div>
    ))}
    <button id="rs-new-tab" className="tab-new" title="New tab" onClick={onNew}>+</button>
  </div>
);

export default TabBar;
