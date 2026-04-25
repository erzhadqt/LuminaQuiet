import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Volume2,
  AlertCircle,
  TrendingDown,
  Wifi,
  Battery,
  ArrowUpRight,
  ArrowDownRight,
  PlayCircle,
  StopCircle,
  RefreshCw,
} from 'lucide-react';
import StartSessionModal from '../Components/StartSessionModal';
import { ENDPOINTS } from '../config/runtime';

const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000];
const DEFAULT_THRESHOLDS = {
  quiet: 800,
  medium: 1500,
  high: 2500,
};

const getApiErrorMessage = (payload, fallbackMessage) => {
  if (payload?.detail) {
    return payload.detail;
  }
  if (payload?.error) {
    return payload.error;
  }
  if (payload?.errors && typeof payload.errors === 'object') {
    const flattened = Object.values(payload.errors).flat();
    if (flattened.length > 0) {
      return String(flattened[0]);
    }
  }
  return fallbackMessage;
};

const Dashboard = () => {
  const [currentNoise, setCurrentNoise] = useState(0);
  const [previousNoise, setPreviousNoise] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionLabel, setConnectionLabel] = useState('Connecting');
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  const [statusText, setStatusText] = useState('No Data');
  const [rawNoise, setRawNoise] = useState(0);
  const [deviceId, setDeviceId] = useState('N/A');
  const [sensorValues, setSensorValues] = useState([]);
  const [wifiRssi, setWifiRssi] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [activeThresholds, setActiveThresholds] = useState(DEFAULT_THRESHOLDS);
  const [sessionInfo, setSessionInfo] = useState(null);
  const [isStartSessionModalOpen, setIsStartSessionModalOpen] = useState(false);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [isStoppingSession, setIsStoppingSession] = useState(false);
  const [sessionActionError, setSessionActionError] = useState('');
  const [sessionActionNotice, setSessionActionNotice] = useState('');
  const [nowMs, setNowMs] = useState(Date.now());

  const noiseRef = useRef(0);
  const socketRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const reconnectAttemptRef = useRef(0);

  const applyThresholds = useCallback((source) => {
    if (!source || typeof source !== 'object') {
      return;
    }

    const thresholdNode = source.thresholds || {};

    setActiveThresholds((previous) => {
      const quiet = Number(source.quiet_threshold ?? thresholdNode.quiet);
      const medium = Number(source.medium_threshold ?? thresholdNode.medium);
      const high = Number(source.high_threshold ?? source.loud_threshold ?? thresholdNode.high ?? thresholdNode.loud);

      return {
        quiet: Number.isFinite(quiet) ? quiet : previous.quiet,
        medium: Number.isFinite(medium) ? medium : previous.medium,
        high: Number.isFinite(high) ? high : previous.high,
      };
    });
  }, []);

  const applyIncomingData = useCallback((payload) => {
    if (!payload || typeof payload !== 'object') {
      return;
    }

    applyThresholds(payload?.config || payload);

    const parsedAverage = Number(payload.average_level ?? 0);
    const nextAverage = Number.isFinite(parsedAverage) ? parsedAverage : 0;

    setPreviousNoise(noiseRef.current);
    noiseRef.current = nextAverage;
    setCurrentNoise(nextAverage);

    const parsedRaw = Number(payload.raw_level ?? 0);
    setRawNoise(Number.isFinite(parsedRaw) ? parsedRaw : 0);

    setStatusText(payload.to_state || payload.status || payload.state || 'Unknown');
    setDeviceId(payload.device_id || 'esp32-node');

    if (Array.isArray(payload.sensor_values)) {
      const parsedSensors = payload.sensor_values.map((value) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
      });
      setSensorValues(parsedSensors);
    }

    if (payload.wifi_rssi === null || payload.wifi_rssi === undefined) {
      setWifiRssi(null);
    } else {
      const parsedRssi = Number(payload.wifi_rssi);
      setWifiRssi(Number.isFinite(parsedRssi) ? parsedRssi : null);
    }

    setLastUpdated(payload.timestamp || new Date().toISOString());
  }, [applyThresholds]);

  const fetchLatest = useCallback(async () => {
    try {
      const response = await fetch(ENDPOINTS.currentNoise);
      if (!response.ok) {
        throw new Error(`GET latest failed with status ${response.status}`);
      }
      const data = await response.json();
      applyIncomingData(data);
    } catch (error) {
      console.error('Failed to fetch latest noise snapshot:', error);
    }
  }, [applyIncomingData]);

  const fetchSession = useCallback(async () => {
    try {
      const response = await fetch(ENDPOINTS.currentSession);
      if (response.status === 404) {
        setSessionInfo(null);
        setActiveThresholds(DEFAULT_THRESHOLDS);
        setStatusText('Idle');
        return;
      }
      if (!response.ok) {
        throw new Error(`GET session failed with status ${response.status}`);
      }

      const payload = await response.json();
      const session = payload?.session || null;
      setSessionInfo(session);
      applyThresholds(session);
    } catch (error) {
      console.error('Failed to fetch session status:', error);
    }
  }, [applyThresholds]);

  const handleStartSession = useCallback(async (formValues) => {
    setSessionActionError('');
    setSessionActionNotice('');
    setIsStartingSession(true);

    try {
      const payload = {
        duration_seconds: Math.round(formValues.durationMinutes * 60),
        thresholds: {
          quiet: Number(formValues.quiet),
          medium: Number(formValues.medium),
          high: Number(formValues.high),
        },
      };

      const response = await fetch(ENDPOINTS.startSession, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const responsePayload = await response.json();

      if (response.status === 409) {
        setSessionActionError(getApiErrorMessage(responsePayload, 'A session is already active.'));
        await fetchSession();
        return;
      }

      if (!response.ok) {
        throw new Error(getApiErrorMessage(responsePayload, 'Failed to start session.'));
      }

      const nextSession = responsePayload?.session || null;
      setSessionInfo(nextSession);
      applyThresholds(nextSession);
      setSessionActionNotice('Session started successfully. Live telemetry panel is now session-driven.');
      setIsStartSessionModalOpen(false);
      await fetchLatest();
    } catch (error) {
      setSessionActionError(error.message || 'Failed to start session.');
    } finally {
      setIsStartingSession(false);
    }
  }, [applyThresholds, fetchLatest, fetchSession]);

  const handleStopSession = useCallback(async () => {
    setSessionActionError('');
    setSessionActionNotice('');
    setIsStoppingSession(true);

    try {
      const response = await fetch(ENDPOINTS.stopSession, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      let responsePayload = null;
      try {
        responsePayload = await response.json();
      } catch {
        responsePayload = null;
      }

      if (!response.ok) {
        throw new Error(getApiErrorMessage(responsePayload, 'Failed to stop session.'));
      }

      setSessionActionNotice('Session stopped. ESP32 will return to idle mode and outputs will turn off.');
      setSessionInfo(null);
      setStatusText('Idle');
      await fetchSession();
      await fetchLatest();
    } catch (error) {
      setSessionActionError(error.message || 'Failed to stop session.');
    } finally {
      setIsStoppingSession(false);
    }
  }, [fetchLatest, fetchSession]);

  useEffect(() => {
    let shouldReconnect = true;

    const connectSocket = () => {
      if (!shouldReconnect) {
        return;
      }

      const socket = new WebSocket(ENDPOINTS.noiseSocket);
      socketRef.current = socket;

      let heartbeatTimer = null;

      socket.onopen = () => {
        setIsConnected(true);
        setConnectionLabel('WebSocket Live');
        reconnectAttemptRef.current = 0;
        setReconnectAttempt(0);

        heartbeatTimer = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ action: 'ping' }));
          }
        }, 15000);
      };

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'connection' || payload.type === 'pong') {
            return;
          }
          if (payload.type === 'config_update') {
            applyThresholds(payload?.config || payload);
            return;
          }

          if (payload.type === 'session_stopped') {
            setSessionInfo(null);
            setStatusText('Idle');
            setSessionActionNotice('Session stopped via WebSocket signal. ESP32 outputs should now be off.');
            return;
          }

          if (payload.type === 'state_change' || payload.type === 'noise_data' || payload.average_level !== undefined) {
            applyIncomingData(payload);
          }
        } catch (error) {
          console.error('Invalid WebSocket payload:', error);
        }
      };

      socket.onerror = () => {
        socket.close();
      };

      socket.onclose = () => {
        setIsConnected(false);
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
        }

        if (!shouldReconnect) {
          return;
        }

        const nextAttempt = reconnectAttemptRef.current + 1;
        reconnectAttemptRef.current = nextAttempt;
        setReconnectAttempt(nextAttempt);

        const delay = RECONNECT_DELAYS_MS[Math.min(nextAttempt - 1, RECONNECT_DELAYS_MS.length - 1)];
        setConnectionLabel(`Reconnecting (${nextAttempt})`);
        reconnectTimerRef.current = setTimeout(connectSocket, delay);
      };
    };

    fetchLatest();
    fetchSession();
    connectSocket();

    const sessionInterval = setInterval(fetchSession, 5000);
    const latestInterval = setInterval(fetchLatest, 7000);

    return () => {
      shouldReconnect = false;
      clearInterval(sessionInterval);
      clearInterval(latestInterval);
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, [applyIncomingData, applyThresholds, fetchLatest, fetchSession]);

  useEffect(() => {
    const timerId = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => {
      clearInterval(timerId);
    };
  }, []);

  const isWarning = useMemo(
    () => /high|loud|warning/i.test(statusText),
    [statusText]
  );

  const gaugeHeight = Math.min(Math.max((currentNoise / 100) * 100, 0), 100);
  const isTrendingUp = currentNoise > previousNoise;
  const formattedLastUpdate = useMemo(() => {
    if (!lastUpdated) {
      return 'No updates yet';
    }
    const parsedDate = new Date(lastUpdated);
    if (Number.isNaN(parsedDate.getTime())) {
      return 'Invalid timestamp';
    }
    return parsedDate.toLocaleTimeString();
  }, [lastUpdated]);

  const remainingSeconds = useMemo(() => {
    if (!sessionInfo?.ends_at) {
      return 0;
    }
    const end = new Date(sessionInfo.ends_at).getTime();
    return Math.max(0, Math.floor((end - nowMs) / 1000));
  }, [nowMs, sessionInfo]);

  const sessionModalInitialValues = useMemo(() => ({
    durationMinutes: 15,
    quiet: activeThresholds.quiet,
    medium: activeThresholds.medium,
    high: activeThresholds.high,
  }), [activeThresholds.high, activeThresholds.medium, activeThresholds.quiet]);


  return (
    <div className="min-h-screen bg-slate-50 p-6 text-slate-900">
      {/* Header */}
      <div className="mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight text-slate-900">
            LuminaQuiet <span className="text-blue-600">Live</span>
          </h1>
          <p className="text-slate-500 font-medium">Session-based Smart Campus Noise Regulation</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setSessionActionError('');
              setSessionActionNotice('');
              setIsStartSessionModalOpen(true);
            }}
            disabled={Boolean(sessionInfo) || isStoppingSession}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition ${
              sessionInfo || isStoppingSession
                ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-200'
            }`}
          >
            <PlayCircle size={16} />
            {sessionInfo ? 'Session Active' : 'Start Session'}
          </button>

          <button
            type="button"
            onClick={handleStopSession}
            disabled={!sessionInfo || isStoppingSession || isStartingSession}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition ${
              !sessionInfo || isStoppingSession || isStartingSession
                ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                : 'bg-red-600 text-white hover:bg-red-700 shadow-lg shadow-red-200'
            }`}
          >
            <StopCircle size={16} />
            {isStoppingSession ? 'Stopping...' : 'Stop Session'}
          </button>

          <button
            type="button"
            onClick={() => {
              fetchSession();
              fetchLatest();
            }}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            <RefreshCw size={14} /> Refresh
          </button>

          <div className="flex items-center gap-4 bg-white px-4 py-2 rounded-full shadow-sm border border-slate-200">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
            <Wifi size={16} className={isConnected ? "text-green-500" : "text-red-500"} /> 
            {isConnected ? connectionLabel : "Offline"}
          </div>
          <div className="h-4 w-px bg-slate-200" />
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
            <Battery size={16} className="text-blue-500" /> 5V Power OK
          </div>
          <div className="h-4 w-px bg-slate-200" />
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
            Session: {sessionInfo ? `Active #${sessionInfo.id}` : 'Idle'}
          </div>
          </div>
        </div>
      </div>

      {(sessionActionError || sessionActionNotice) && (
        <div className="mb-6">
          {sessionActionError && (
            <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
              {sessionActionError}
            </p>
          )}
          {!sessionActionError && sessionActionNotice && (
            <p className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-semibold text-green-700">
              {sessionActionNotice}
            </p>
          )}
        </div>
      )}

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
                  {sessionInfo
                    ? (isWarning ? 'High threshold event detected' : 'Within current session thresholds')
                    : 'Idle mode: waiting for session start'}
               </span>
             </div>
          </div>

          <div className="mt-6 grid w-full grid-cols-1 gap-3 md:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Device</p>
              <p className="mt-1 text-sm font-bold text-slate-700">{deviceId}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Status</p>
              <p className="mt-1 text-sm font-bold text-slate-700">{statusText}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Raw ADC</p>
              <p className="mt-1 text-sm font-bold text-slate-700">{rawNoise}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Wi-Fi RSSI</p>
              <p className="mt-1 text-sm font-bold text-slate-700">
                {wifiRssi === null ? 'N/A' : `${wifiRssi} dBm`}
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-blue-600 rounded-3xl p-6 text-white shadow-lg shadow-blue-200">
            <div className="flex items-center justify-between mb-4">
              <TrendingDown size={28} />
              <span className="text-xs font-bold bg-white/20 px-2 py-1 rounded">SESSION</span>
            </div>
            <p className="text-blue-100 text-sm font-medium">Session State</p>
            <h3 className="text-3xl font-bold mt-1">{sessionInfo ? `#${sessionInfo.id}` : 'IDLE'}</h3>
            <p className="text-xs mt-4 text-blue-200">
              {sessionInfo ? `Remaining: ${remainingSeconds}s` : 'Admin has not started a monitoring session.'}
            </p>
          </div>

          <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="bg-amber-100 p-2 rounded-xl text-amber-600"><AlertCircle size={20}/></div>
                  <span className="font-semibold text-slate-700">Sensor Channels</span>
                </div>
                <span className="font-bold text-slate-900">{sensorValues.length || 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="bg-slate-100 p-2 rounded-xl text-slate-600"><Volume2 size={20}/></div>
                  <span className="font-semibold text-slate-700">Previous Level</span>
                </div>
                <span className="font-bold text-slate-900">{previousNoise}dB</span>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Sensor Values</p>
                <div className="flex flex-wrap gap-2">
                  {sensorValues.length > 0 ? (
                    sensorValues.map((value, index) => (
                      <span
                        key={`sensor-${index}`}
                        className="inline-flex items-center rounded-full bg-white px-2 py-1 text-xs font-semibold text-slate-700 border border-slate-200"
                      >
                        S{index + 1}: {value}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs font-semibold text-slate-500">
                      No sensor array in latest state-change packet
                    </span>
                  )}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Active ADC Thresholds</p>
                <div className="flex flex-wrap gap-2 text-xs font-semibold">
                  <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-slate-700">Quiet: {activeThresholds.quiet}</span>
                  <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-slate-700">Medium: {activeThresholds.medium}</span>
                  <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-slate-700">High: {activeThresholds.high}</span>
                  <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-slate-700">Reconnects: {reconnectAttempt}</span>
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">Last Event Time</p>
                <p className="text-sm font-semibold text-slate-700">{formattedLastUpdate}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <StartSessionModal
        isOpen={isStartSessionModalOpen}
        isSubmitting={isStartingSession}
        onClose={() => {
          if (!isStartingSession) {
            setIsStartSessionModalOpen(false);
            setSessionActionError('');
          }
        }}
        onStartSession={handleStartSession}
        initialValues={sessionModalInitialValues}
        errorMessage={sessionActionError}
      />
    </div>
  );
};

export default Dashboard;