import React from 'react';
import { NavLink } from 'react-router-dom';
import { AudioLines, History, PlayCircle, ChevronLeft, ChevronRight } from 'lucide-react';

const Sidebar = ({ isExpanded, setIsExpanded }) => {
  const navItems = [
    { text: 'Session Control', caption: 'Start and monitor', link: '/start-session', icon: <PlayCircle size={20} /> },
    { text: 'Session Logs', caption: 'Historical records', link: '/admin-log', icon: <History size={20} /> },
  ];

  return (
    <div className="h-full flex flex-col text-slate-200">
      <div className="border-b border-slate-800/70 px-4 py-5">
        <div className={`flex items-center ${isExpanded ? 'justify-between' : 'justify-center'}`}>
          <div className="flex items-center gap-3">
            <div className="rounded-xl border border-cyan-300/30 bg-cyan-400/10 p-2.5">
              <AudioLines size={22} className="text-cyan-300 shrink-0" />
            </div>
            {isExpanded && (
              <div>
                <h5 className="text-sm font-bold tracking-[0.12em] text-slate-50">LUMINAQUIET</h5>
                <p className="text-[11px] font-medium text-slate-400">Noise Regulation Console</p>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setIsExpanded((previous) => !previous)}
            className="rounded-lg border border-slate-700 bg-slate-800/80 p-1.5 text-slate-300 transition hover:border-cyan-400/60 hover:text-cyan-300"
            aria-label={isExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            {isExpanded ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
          </button>
        </div>
      </div>

      <div className="px-4 pt-4 pb-2">
        <p className={`text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500 ${isExpanded ? 'block' : 'hidden'}`}>
          Navigation
        </p>
      </div>

      <nav className="flex-1 px-3 space-y-2">
        {navItems.map((item) => (
          <NavLink
            key={item.text}
            to={item.link}
            className={({ isActive }) => `
              group flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-all duration-200
              ${isActive
                ? 'border-cyan-300/40 bg-cyan-400/15 text-cyan-100 shadow-lg shadow-cyan-900/25'
                : 'border-transparent text-slate-300 hover:border-slate-700 hover:bg-slate-800/80 hover:text-slate-100'}
            `}
          >
            <span className="shrink-0 rounded-lg bg-slate-900/70 p-2 text-slate-300 transition group-hover:text-cyan-300">
              {item.icon}
            </span>
            {isExpanded && (
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{item.text}</p>
                <p className="truncate text-[11px] text-slate-400">{item.caption}</p>
              </div>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="mt-4 border-t border-slate-800/70 p-4">
        <div className={`rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2 ${isExpanded ? 'block' : 'hidden'}`}>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">System Status</p>
          <p className="mt-1 text-xs font-semibold text-emerald-300">Telemetry service connected</p>
          <p className="text-[11px] text-slate-400">Real-time feed available</p>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;