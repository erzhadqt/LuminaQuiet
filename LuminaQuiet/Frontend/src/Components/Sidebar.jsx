import React from 'react';
import { NavLink } from 'react-router-dom';
import { AudioLines, LayoutDashboard, History, Settings } from 'lucide-react';

const Sidebar = ({ isExpanded }) => {
  const navItems = [
    { text: "Dashboard", link: "/admin-dashboard", icon: <LayoutDashboard size={22} /> },
    { text: "Log", link: "/admin-log", icon: <History size={22} /> },
    { text: "Admin Settings", link: "/admin-settings", icon: <Settings size={22} /> },
  ];

  return (
    <div className="h-full flex flex-col text-slate-300">
      
      <div className="h-20 flex items-center px-6 border-b border-blue-900/50">
        <div className="flex items-center gap-3">
          <AudioLines size={28} className="text-blue-400 shrink-0" />
          {isExpanded && (
            <h5 className="text-white text-xl font-bold tracking-tight">
              Lumina <span className="text-blue-500">STFU</span>
            </h5>
          )}
        </div>
      </div>

      
      <nav className="flex-1 pt-6 px-3 space-y-2">
        {navItems.map((item) => (
          <NavLink
            key={item.text}
            to={item.link}
            className={({ isActive }) => `
              flex items-center gap-4 px-3 py-3 rounded-lg transition-all duration-200
              ${isActive 
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20' 
                : 'hover:bg-blue-900/50 hover:text-white'}
            `}
          >
            <span className="shrink-0">{item.icon}</span>
            {isExpanded && (
              <span className="font-medium whitespace-nowrap overflow-hidden">
                {item.text}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      
      {isExpanded && (
        <div className="p-6 text-xs text-blue-400/50 font-mono border-t border-blue-900/50">
          IoT STATUS: ACTIVE [cite: 2]
        </div>
      )}
    </div>
  );
};

export default Sidebar;