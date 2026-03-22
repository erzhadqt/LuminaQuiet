import React, { useState, useEffect, useRef } from 'react';
import { Volume2, AlertCircle, TrendingDown, Wifi, Battery, ArrowUpRight, ArrowDownRight } from 'lucide-react';

const Dashboard = () => {
  const [currentNoise, setCurrentNoise] = useState(0);
  const [previousNoise, setPreviousNoise] = useState(0);
  const [isWarning, setIsWarning] = useState(false);
  const [isConnected, setIsConnected] = useState(false);

  const noiseRef = useRef(0);

  useEffect(() => {
    // 1. Initial fetch just to get the last known value immediately on load
    fetch('http://localhost:8000/api/current-noise/')
      .then(res => res.json())
      .then(data => {
        if(data.average_level) {
          setCurrentNoise(data.average_level);
          noiseRef.current = data.average_level;
        }
      }).catch(err => console.log(err));

    // 2. Establish WebSocket Connection
    // Note: Use ws:// instead of http://
    const socket = new WebSocket('ws://localhost:8000/ws/noise/');

    socket.onopen = () => {
      console.log('WebSocket Connected');
      setIsConnected(true);
    };

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      // Update logic exactly as it comes in from the ESP32
      setPreviousNoise(noiseRef.current);
      noiseRef.current = data.average_level;
      
      setCurrentNoise(data.average_level);
      setIsWarning(data.average_level > 60);
    };

    socket.onclose = () => {
      console.log('WebSocket Disconnected');
      setIsConnected(false);
    };

    // Cleanup on unmount
    return () => {
      socket.close();
    };
  }, []);

  const gaugeHeight = Math.min(Math.max((currentNoise / 100) * 100, 0), 100);
  const isTrendingUp = currentNoise > previousNoise;

  return (
    // ... PASTE THE EXACT SAME JSX RETURN BLOCK FROM THE PREVIOUS MESSAGE HERE ...
    // (The UI code does not need to change, only the useEffect logic above!)
    <div className="min-h-screen bg-slate-50 p-6 text-slate-900">
      {/* Header */}
      <div className="mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight text-slate-900">
            LuminaQuiet <span className="text-blue-600">Live</span>
          </h1>
          <p className="text-slate-500 font-medium">Smart Campus Noise Regulation System</p>
        </div>
        
        <div className="flex items-center gap-4 bg-white px-4 py-2 rounded-full shadow-sm border border-slate-200">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
            <Wifi size={16} className={isConnected ? "text-green-500" : "text-red-500"} /> 
            {isConnected ? "WebSocket Live" : "Offline"}
          </div>
          <div className="h-4 w-px bg-slate-200" />
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
            <Battery size={16} className="text-blue-500" /> 5V Power OK
          </div>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 bg-white rounded-3xl p-8 shadow-sm border border-slate-100 flex flex-col justify-center items-center relative overflow-hidden">
          {isWarning && <div className="absolute inset-0 bg-red-500/5 animate-pulse" />}
          
          <h2 className="text-lg font-semibold text-slate-400 uppercase tracking-widest mb-8">
            Current Ambient Noise
          </h2>
          
          <div className="flex items-end gap-8">
            <div className={`text-9xl font-black transition-colors duration-200 flex items-start ${isWarning ? 'text-red-600' : 'text-blue-600'}`}>
              {currentNoise}
              <span className="text-4xl mt-2">dB</span>
            </div>

            <div className="h-40 w-8 bg-slate-100 rounded-full overflow-hidden relative flex flex-col justify-end">
               <div className="absolute bottom-[60%] w-full h-0.5 bg-slate-300 z-10"></div>
               <div 
                  className={`w-full transition-all duration-200 ease-out ${isWarning ? 'bg-red-500' : 'bg-blue-500'}`}
                  style={{ height: `${gaugeHeight}%` }}
               />
            </div>
          </div>

          <div className="mt-8 flex items-center gap-4">
             <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-slate-100 text-sm font-semibold text-slate-600">
               {isTrendingUp ? <ArrowUpRight size={18} className="text-amber-500"/> : <ArrowDownRight size={18} className="text-green-500"/>}
               {isTrendingUp ? 'Rising' : 'Falling'}
             </div>
             <div className="w-px h-6 bg-slate-200"></div>
             <div className="flex items-center gap-2">
               <div className={`h-3 w-3 rounded-full ${isWarning ? 'bg-red-600 animate-ping' : 'bg-green-500'}`} />
               <span className="font-bold text-slate-700">
                  {isWarning ? 'THRESHOLD EXCEEDED (>60dB)' : 'Environment Productive'}
               </span>
             </div>
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
            <p className="text-xs mt-4 text-blue-200">Aiming for 50% reduction in Quiet Zones</p>
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
    </div>
  );
};

export default Dashboard;