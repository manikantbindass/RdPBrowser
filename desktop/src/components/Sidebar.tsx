import React, { useState } from 'react';
import { Menu, LayoutGrid, Clock, PlaySquare, Library, ImagePlus, Video, Mic, HelpCircle, Power } from 'lucide-react';

interface Props {
  onNavigate: (route: string) => void;
  activeRoute: string; // "home", "history", etc.
}

const Sidebar: React.FC<Props> = ({ onNavigate, activeRoute }) => {
  const [collapsed, setCollapsed] = useState(false);

  const menuItems = [
    { id: 'home', label: 'Home', icon: <LayoutGrid size={18} />, route: 'home' },
    { id: 'history', label: 'History', icon: <Clock size={18} />, route: 'history' },
    { id: 'my-media', label: 'My Media', icon: <PlaySquare size={18} />, route: 'my-media' },
    { id: 'preset-library', label: 'Preset Library', icon: <Library size={18} />, route: 'preset-library' },
    { divider: true, id: 'div1' },
    { id: 'text-to-image', label: 'Text to Image', icon: <ImagePlus size={18} />, route: 'text-to-image' },
    { id: 'text-to-clip', label: 'Text to Clip', icon: <Video size={18} />, route: 'text-to-clip' },
    { id: 'voices', label: 'Voices', icon: <Mic size={18} />, route: 'voices' },
  ];

  const bottomItems = [
    { id: 'guide', label: 'Guide', icon: <HelpCircle size={18} />, route: 'guide' },
    { id: 'logout', label: 'Logout', icon: <Power size={18} />, route: 'logout' },
  ];

  return (
    <div className={`glass-sidebar ${collapsed ? 'collapsed' : ''}`}>
      <button className="sidebar-toggle" onClick={() => setCollapsed(!collapsed)}>
        <Menu size={20} />
      </button>

      <div className="sidebar-nav">
        {menuItems.map(item => {
          if (item.divider) return <div key={item.id} className="sidebar-divider" />;
          return (
            <button
              key={item.id}
              className={`sidebar-item ${activeRoute === item.id ? 'active' : ''}`}
              onClick={() => onNavigate(item.route!)}
              title={collapsed ? item.label : undefined}
            >
              <div className="sidebar-icon">{item.icon}</div>
              {!collapsed && <span className="sidebar-label">{item.label}</span>}
            </button>
          );
        })}
      </div>

      <div className="sidebar-bottom">
        {bottomItems.map(item => (
          <button
            key={item.id}
            className="sidebar-item"
            onClick={() => onNavigate(item.route)}
            title={collapsed ? item.label : undefined}
          >
            <div className="sidebar-icon">{item.icon}</div>
            {!collapsed && <span className="sidebar-label">{item.label}</span>}
          </button>
        ))}
      </div>
    </div>
  );
};

export default Sidebar;
