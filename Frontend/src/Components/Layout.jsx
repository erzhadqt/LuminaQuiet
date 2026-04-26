import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Activity, BellDot, CalendarClock } from 'lucide-react';
import Sidebar from './Sidebar';

function Layout() {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-linear-to-br from-slate-200 via-slate-100 to-cyan-100/50">
      <aside
        className={`${isExpanded ? 'w-64' : 'w-20'
          } transition-all duration-300 ease-in-out bg-slate-950 shadow-2xl z-20`}
      >
        <Sidebar isExpanded={isExpanded} setIsExpanded={setIsExpanded} />
      </aside>

      <div className="flex flex-col flex-1 min-w-0">
        <header className="h-16 shrink-0 border-b border-slate-200/80 bg-white/80 px-5 backdrop-blur-md md:px-8">
          <div className="flex h-full items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-xl border border-cyan-300/40 bg-cyan-100 p-2 text-cyan-700">
                <Activity size={16} />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Control Panel</p>
                <h1 className="text-sm font-semibold text-slate-800 md:text-base">LuminaQuiet Monitoring Workspace</h1>
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-6 custom-scrollbar">
          <div className="mx-auto w-full max-w-7xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

export default Layout;