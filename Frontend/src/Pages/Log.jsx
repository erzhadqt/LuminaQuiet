import React, { useState } from 'react';
import { AlertTriangle, Activity, Clock, ShieldCheck } from 'lucide-react';

const Log = () => {
 
  const [logs] = useState([
    { id: 1, time: '10:15:22 AM', level: 45, status: 'Normal' },
    { id: 2, time: '10:18:05 AM', level: 72, status: 'Warning' },
    { id: 3, time: '10:22:40 AM', level: 58, status: 'Normal' },
    { id: 4, time: '10:30:12 AM', level: 65, status: 'Warning' },
  ]);

  const violations = logs.filter(l => l.level > 60).length;

  return (
    <div className="min-h-screen bg-slate-50 p-8 font-sans">

      <div className="mb-8 flex flex-col md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">LuminaQuiet Dashboard</h1>
          <p className="text-slate-500">Real-time IoT Noise Monitoring & Analytics [cite: 2, 6]</p>
        </div>
        <div className="mt-4 flex gap-3">
          <button className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition">
            Export Report
          </button>
        </div>
      </div>

      
      <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-3">
        <div className="flex items-center rounded-xl bg-white p-6 shadow-sm border border-slate-100">
          <div className="mr-4 rounded-full bg-blue-100 p-3 text-blue-600">
            <Activity size={24} />
          </div>
          <div>
            <p className="text-sm text-slate-500">Current Level</p>
            <p className="text-2xl font-bold text-slate-900">48 dB</p>
          </div>
        </div>

        <div className="flex items-center rounded-xl bg-white p-6 shadow-sm border border-slate-100">
          <div className="mr-4 rounded-full bg-amber-100 p-3 text-amber-600">
            <Clock size={24} />
          </div>
          <div>
            <p className="text-sm text-slate-500">System Uptime</p>
            <p className="text-2xl font-bold text-slate-900">99.8%</p>
          </div>
        </div>

        <div className="flex items-center rounded-xl bg-white p-6 shadow-sm border border-red-100">
          <div className="mr-4 rounded-full bg-red-100 p-3 text-red-600">
            <AlertTriangle size={24} />
          </div>
          <div>
            <p className="text-sm text-slate-500">Violations (60dB) </p>
            <p className="text-2xl font-bold text-red-600">{violations}</p>
          </div>
        </div>
      </div>

  
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-slate-50/50 px-6 py-4">
          <h3 className="font-semibold text-slate-800">Historical Noise Events</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-xs font-medium uppercase text-slate-500">
              <tr>
                <th className="px-6 py-4 text-center">Timestamp</th>
                <th className="px-6 py-4 text-center">Intensity</th>
                <th className="px-6 py-4 text-center">Status</th>
                <th className="px-6 py-4 text-center">Automated Response [cite: 4, 31]</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50/80 transition">
                  <td className="whitespace-nowrap px-6 py-4 text-slate-600 text-center">{log.time}</td>
                  <td className="px-6 py-4 font-medium text-slate-900 text-center">{log.level} dB</td>
                  <td className="px-6 py-4 text-center">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      log.level > 60 
                        ? 'bg-red-100 text-red-700' 
                        : 'bg-green-100 text-green-700'
                    }`}>
                      {log.level > 60 ? 'Warning' : 'Normal'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-slate-500 text-center">
                    {log.level > 60 ? (
                      <span className="flex items-center justify-center gap-1 text-red-600 font-medium">
                        <AlertTriangle size={14} /> Visual Alert Triggered 
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-1 text-slate-400">
                        <ShieldCheck size={14} /> Monitoring Active [cite: 10]
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Log;