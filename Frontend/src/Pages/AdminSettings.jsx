import React, { useState } from 'react';
import { Settings, Bell, Database, Shield, Save, RefreshCw } from 'lucide-react';

const AdminSettings = () => {
  
  const [threshold, setThreshold] = useState(60);
  const [duration, setDuration] = useState(5);
  const [isAutoAlert, setIsAutoAlert] = useState(true);

  return (
    <div className="min-h-screen bg-slate-50 p-8 font-sans">
  
      <div className="mb-8 border-b border-slate-200 pb-6">
        <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
          <Settings className="text-blue-600" /> Administrative Control
        </h1>
        <p className="text-slate-500 mt-2">Configure LuminaQuiet IoT parameters and system thresholds.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
       
        <div className="lg:col-span-2 space-y-6">
          <section className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
            <h3 className="text-lg font-semibold text-slate-800 mb-6 flex items-center gap-2">
              <Bell size={20} className="text-amber-500" /> Detection Logic
            </h3>
            
            <div className="space-y-8">
             
              <div>
                <div className="flex justify-between mb-2">
                  <label className="text-sm font-medium text-slate-700">Noise Threshold (Decibels)</label>
                  <span className="text-blue-600 font-bold">{threshold} dB</span>
                </div>
                <input 
                  type="range" min="30" max="100" value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                  className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
                <p className="text-xs text-slate-400 mt-2">System triggers a "Warning" light if noise exceeds this level[cite: 3, 19].</p>
              </div>


              <div>
                <div className="flex justify-between mb-2">
                  <label className="text-sm font-medium text-slate-700">Violation Duration (Seconds)</label>
                  <span className="text-blue-600 font-bold">{duration}s</span>
                </div>
                <input 
                  type="number" value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
                <p className="text-xs text-slate-400 mt-2">Time noise must remain above threshold to log an event.</p>
              </div>
            </div>
          </section>

         
          <section className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
            <h3 className="text-lg font-semibold text-slate-800 mb-6 flex items-center gap-2">
              <Database size={20} className="text-blue-500" /> Backend Sync
            </h3>
            <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
              <div>
                <p className="font-medium text-slate-800">Django REST API Status</p>
                <p className="text-xs text-slate-500">Connected to PostgreSQL via WebSockets [cite: 28, 38]</p>
              </div>
              <button className="flex items-center gap-2 text-sm text-blue-600 font-semibold hover:underline">
                <RefreshCw size={14} /> Reconnect
              </button>
            </div>
          </section>
        </div>

      
        <div className="space-y-6">
          <div className="bg-slate-900 rounded-2xl p-6 text-white">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Shield size={20} className="text-green-400" /> Privacy Guard
            </h3>
            <p className="text-sm text-slate-400 leading-relaxed mb-4">
              LuminaQuiet monitors decibel levels only. Audio recording is physically disabled to ensure privacy.
            </p>
            <div className="flex items-center gap-3">
              <div className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-xs font-bold uppercase tracking-wider">Compliance Active</span>
            </div>
          </div>

          <button className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-xl shadow-lg shadow-blue-200 transition-all flex items-center justify-center gap-2">
            <Save size={20} /> Update System Node
          </button>
        </div>

      </div>
    </div>
  );
};

export default AdminSettings;