import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';

function Layout() {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-slate-50">
      
      <aside 
        className={`${
          isExpanded ? 'w-64' : 'w-20'
        } transition-all duration-300 ease-in-out bg-blue-950 shadow-xl z-20`}
      >
        <Sidebar isExpanded={isExpanded} setIsExpanded={setIsExpanded} />
      </aside>

      
      <div className="flex flex-col flex-1 min-w-0">
        <header className="h-16 flex items-center justify-between px-8 bg-white border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-2 rounded-md hover:bg-slate-100 text-slate-600 transition-colors"
            >
              <span className="text-xl">☰</span>
            </button>
            <h1 className="text-sm font-medium uppercase tracking-widest text-slate-500">
              System Monitor
            </h1>
          </div>
        </header>

      
        <main className="flex-1 overflow-y-auto p-8 custom-scrollbar">
          <div className="max-w-6xl mx-auto">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

export default Layout;