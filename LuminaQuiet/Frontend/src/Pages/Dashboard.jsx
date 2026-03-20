import React, { useState, useEffect } from 'react';
import { Volume2, AlertCircle, TrendingDown, Wifi, Battery } from 'lucide-react';

const Dashboard = () => {
   
  const [currentNoise, setCurrentNoise] = useState(45);
  const [isWarning, setIsWarning] = useState(false);

  
  useEffect(() => {
    const interval = setInterval(() => {
      const mockLevel = Math.floor(Math.random() * (75 - 35) + 35);
      setCurrentNoise(mockLevel);
      setIsWarning(mockLevel > 60); 
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 p-6 text-slate-900">
      {/* Header */}
      <div className="mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight text-slate-900">
            LuminaQuiet <span className="text-blue-600">Live</span>
          </h1>
          <p className="text-slate-500 font-medium">Smart Campus Noise Regulation System [cite: 11]</p>
        </div>
        
      
        <div className="flex items-center gap-4 bg-white px-4 py-2 rounded-full shadow-sm border border-slate-200">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
            <Wifi size={16} className="text-green-500" /> ESP32 Connected [cite: 18]
          </div>
          <div className="h-4 w-px bg-slate-200" />
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
            <Battery size={16} className="text-blue-500" /> 5V Power OK [cite: 49]
          </div>
        </div>
      </div>

 
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
       
        <div className="md:col-span-2 bg-white rounded-3xl p-8 shadow-sm border border-slate-100 flex flex-col justify-center items-center relative overflow-hidden">
          
          {isWarning && <div className="absolute inset-0 bg-red-500/5 animate-pulse" />}
          
          <h2 className="text-lg font-semibold text-slate-400 uppercase tracking-widest mb-4">Current Ambient Noise</h2>
          <div className={`text-9xl font-black transition-colors duration-500 ${isWarning ? 'text-red-600' : 'text-blue-600'}`}>
            {currentNoise}<span className="text-4xl">dB</span>
          </div>
          
          <div className="mt-8 flex items-center gap-3">
             <div className={`h-3 w-3 rounded-full ${isWarning ? 'bg-red-600 animate-ping' : 'bg-green-500'}`} />
             <span className="font-bold text-slate-700">
                {isWarning ? 'THRESHOLD EXCEEDED (>60dB)' : 'Environment Productive'} [cite: 4, 19]
             </span>
          </div>
        </div>

        
        <div className="space-y-6">
        
          <div className="bg-blue-600 rounded-3xl p-6 text-white shadow-lg shadow-blue-200">
            <div className="flex items-center justify-between mb-4">
              <TrendingDown size={28} />
              <span className="text-xs font-bold bg-white/20 px-2 py-1 rounded">GOAL</span>
            </div>
            <p className="text-blue-100 text-sm font-medium">Noise Reduction Progress</p>
            <h3 className="text-3xl font-bold mt-1">42% Toward Goal</h3>
            <p className="text-xs mt-4 text-blue-200">Aiming for 50% reduction in Quiet Zones [cite: 9, 23]</p>
          </div>

         
          <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="bg-amber-100 p-2 rounded-xl text-amber-600"><AlertCircle size={20}/></div>
                  <span className="font-semibold text-slate-700">Daily Warnings</span>
                </div>
                <span className="font-bold text-slate-900">12</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="bg-slate-100 p-2 rounded-xl text-slate-600"><Volume2 size={20}/></div>
                  <span className="font-semibold text-slate-700">Peak Level</span>
                </div>
                <span className="font-bold text-slate-900">74dB</span>
              </div>
            </div>
          </div>
        </div>

      </div>

      
      <footer className="mt-12 pt-6 border-t border-slate-200 flex flex-col md:flex-row justify-between text-slate-400 text-sm">
        <p>© 2026 LuminaQuiet IoT Project </p>
        <p>Built with Django, React, and ESP32 [cite: 38]</p>
      </footer>
    </div>
  );
};

export default Dashboard;