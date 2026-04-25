import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Settings, Bell, Database, Shield, RefreshCw, Wifi } from 'lucide-react';
import { ENDPOINTS } from '../config/runtime';

const DEFAULT_FORM = {
  quiet: 800,
  medium: 1500,
  high: 2500,
  durationMinutes: 15,
};

const AdminSettings = () => {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [activeSession, setActiveSession] = useState(null);
  const [isLoadingSession, setIsLoadingSession] = useState(true);
  const [notice, setNotice] = useState(null);
  const [errorText, setErrorText] = useState('');

  const fetchCurrentSession = useCallback(async () => {
    const response = await fetch(ENDPOINTS.currentSession);

    if (response.status === 404) {
      setActiveSession(null);
      setIsLoadingSession(false);
      return;
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch session (${response.status})`);
    }

    const payload = await response.json();
    const session = payload?.session || null;
    setActiveSession(session);

    if (session) {
      setForm((previous) => ({
        ...previous,
        quiet: Number(session.quiet_threshold ?? session.thresholds?.quiet ?? previous.quiet),
        medium: Number(session.medium_threshold ?? session.thresholds?.medium ?? previous.medium),
        high: Number(session.high_threshold ?? session.thresholds?.high ?? previous.high),
      }));
    }

    setIsLoadingSession(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchCurrentSession().catch((error) => {
      console.error(error);
      setErrorText('Unable to load session state');
      setIsLoadingSession(false);
    });

    const intervalId = setInterval(() => {
      fetchCurrentSession().catch((error) => {
        console.error(error);
      });
    }, 5000);

    return () => {
      clearInterval(intervalId);
    };
  }, [fetchCurrentSession]);

  const handleFieldChange = (name) => (event) => {
    const value = Number(event.target.value);
    setNotice(null);
    setForm((previous) => ({ ...previous, [name]: Number.isFinite(value) ? value : 0 }));
  };

  const thresholdsOrdered = form.quiet < form.medium && form.medium < form.high;

  const sessionStatusLabel = useMemo(() => {
    if (isLoadingSession) {
      return 'Checking';
    }
    return activeSession ? 'Active' : 'Idle';
  }, [activeSession, isLoadingSession]);

  return (
    <div className="min-h-screen bg-slate-50 p-8 font-sans">
  
      <div className="mb-8 border-b border-slate-200 pb-6">
        <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
          <Settings className="text-blue-600" /> Administrative Control
        </h1>
        <p className="text-slate-500 mt-2">Start timed monitoring sessions with thresholds used directly by ESP32 nodes.</p>
        <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-bold uppercase tracking-wider text-slate-500">
          <Wifi size={14} className={activeSession ? 'text-green-500' : 'text-slate-400'} />
          Session {sessionStatusLabel}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
       
        <div className="lg:col-span-2 space-y-6">
          <section className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
            <h3 className="text-lg font-semibold text-slate-800 mb-6 flex items-center gap-2">
              <Bell size={20} className="text-amber-500" /> Session Setup
            </h3>
            
            <div className="space-y-8">
              <div>
                <div className="flex justify-between mb-2">
                  <label className="text-sm font-medium text-slate-700">Session Duration (Minutes)</label>
                  <span className="text-blue-600 font-bold">{form.durationMinutes} min</span>
                </div>
                <input
                  type="number"
                  min="1"
                  max="720"
                  value={form.durationMinutes}
                  onChange={handleFieldChange('durationMinutes')}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
                <p className="text-xs text-slate-400 mt-2">Set how long the monitoring session stays active.</p>
              </div>

              <div>
                <div className="flex justify-between mb-2">
                  <label className="text-sm font-medium text-slate-700">Quiet Threshold (ADC)</label>
                  <span className="text-blue-600 font-bold">{form.quiet}</span>
                </div>
                <input 
                  type="number"
                  min="0"
                  max="4095"
                  value={form.quiet}
                  onChange={handleFieldChange('quiet')}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
                <p className="text-xs text-slate-400 mt-2">Noise below this level stays in quiet mode.</p>
              </div>

              <div>
                <div className="flex justify-between mb-2">
                  <label className="text-sm font-medium text-slate-700">Medium Threshold (ADC)</label>
                  <span className="text-blue-600 font-bold">{form.medium}</span>
                </div>
                <input
                  type="number"
                  min="0"
                  max="4095"
                  value={form.medium}
                  onChange={handleFieldChange('medium')}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
                <p className="text-xs text-slate-400 mt-2">Crossing this level switches from medium-low to medium.</p>
              </div>

              <div>
                <div className="flex justify-between mb-2">
                  <label className="text-sm font-medium text-slate-700">High Threshold (ADC)</label>
                  <span className="text-blue-600 font-bold">{form.high}</span>
                </div>
                <input
                  type="number"
                  min="0"
                  max="4095"
                  value={form.high}
                  onChange={handleFieldChange('high')}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                />
                <p className="text-xs text-slate-400 mt-2">Crossing this level enters loud warning mode.</p>
              </div>
            </div>

            {!thresholdsOrdered && (
              <p className="mt-5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                Threshold order must be Quiet &lt; Medium &lt; High.
              </p>
            )}

            {errorText && (
              <p className="mt-5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorText}</p>
            )}

            {notice && !errorText && (
              <p className="mt-5 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</p>
            )}
          </section>

         
          <section className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
            <h3 className="text-lg font-semibold text-slate-800 mb-6 flex items-center gap-2">
              <Database size={20} className="text-blue-500" /> Session Status
            </h3>
            <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
              <div>
                <p className="font-medium text-slate-800">
                  {activeSession ? `Session #${activeSession.id} is active` : 'No active session'}
                </p>
                <p className="text-xs text-slate-500">
                  {activeSession
                    ? `Ends at ${new Date(activeSession.ends_at).toLocaleTimeString()} | Remaining ${activeSession.remaining_seconds}s`
                    : 'Start a session from Dashboard to allow ESP32 monitoring and event logging.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setErrorText('');
                  fetchCurrentSession().then(() => setNotice('Session state refreshed')).catch((error) => {
                    console.error(error);
                    setErrorText('Unable to refresh session state');
                  });
                }}
                className="flex items-center gap-2 text-sm text-blue-600 font-semibold hover:underline"
              >
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
              LuminaQuiet monitors threshold states only and logs transitions. Audio recording is physically disabled to ensure privacy.
            </p>
            <div className="flex items-center gap-3">
              <div className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-xs font-bold uppercase tracking-wider">Compliance Active</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              window.location.href = '/admin-dashboard';
            }}
            className="w-full font-bold py-4 rounded-xl transition-all flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-200"
          >
            Open Dashboard Session Control
          </button>
        </div>

      </div>
    </div>
  );
};

export default AdminSettings;