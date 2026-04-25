import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Activity, Clock, ShieldCheck, Wifi } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { ENDPOINTS } from '../config/runtime';

const MAX_LOG_ROWS = 150;
const REFRESH_INTERVAL_MS = 5000;

const parseSessionId = (value) => {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const formatTimestamp = (timestamp) => {
  if (!timestamp) {
    return 'N/A';
  }
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return 'Invalid time';
  }
  return parsed.toLocaleTimeString();
};

const formatDateTime = (timestamp) => {
  if (!timestamp) {
    return 'Not reached';
  }
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return 'Invalid time';
  }
  return parsed.toLocaleString();
};

const isMediumThresholdState = (stateValue) => {
  const value = String(stateValue || '').toLowerCase();
  return value.includes('medium') && !value.includes('low');
};

const isHighThresholdState = (stateValue) => {
  const value = String(stateValue || '').toLowerCase();
  return value.includes('high') || value.includes('loud') || value.includes('warning');
};

const normalizeLog = (item) => {
  const parsedLevel = Number(item.average_level ?? item.level ?? 0);
  const level = Number.isFinite(parsedLevel) ? parsedLevel : 0;

  return {
    id: item.id || `${item.timestamp}-${Math.random()}`,
    sessionId: parseSessionId(item.session_id),
    level,
    fromState: item.from_state || item.previous_status || '--',
    toState: item.to_state || item.status || item.state || 'Unknown',
    status: item.status || item.to_state || item.state || 'Unknown',
    quietDurationMs: Math.max(0, Number(item.quiet_duration_ms ?? 0)),
    timestamp: item.timestamp || new Date().toISOString(),
  };
};

const Log = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const [logs, setLogs] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [sessionInfo, setSessionInfo] = useState(null);
  const [thresholdHits, setThresholdHits] = useState({
    mediumReachedAt: null,
    highReachedAt: null,
  });
  const [sessionInput, setSessionInput] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [errorText, setErrorText] = useState('');

  const socketRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const activeSessionIdRef = useRef(null);

  const requestedSessionId = useMemo(
    () => parseSessionId(searchParams.get('session_id')),
    [searchParams]
  );

  const appendTransitionLog = useCallback((payload) => {
    const nextLog = normalizeLog(payload);

    setLogs((previousLogs) => {
      const next = [nextLog, ...previousLogs];
      return next.slice(0, MAX_LOG_ROWS);
    });

    setThresholdHits((previous) => ({
      mediumReachedAt:
        previous.mediumReachedAt || (isMediumThresholdState(nextLog.toState) ? nextLog.timestamp : null),
      highReachedAt:
        previous.highReachedAt || (isHighThresholdState(nextLog.toState) ? nextLog.timestamp : null),
    }));
  }, []);

  const fetchSessionDetails = useCallback(async (targetSessionId) => {
    setIsLoading(true);
    setErrorText('');

    try {
      const endpoint = new URL(ENDPOINTS.createLog);
      endpoint.searchParams.set('limit', String(MAX_LOG_ROWS));
      if (targetSessionId) {
        endpoint.searchParams.set('session_id', String(targetSessionId));
      }

      const response = await fetch(endpoint.toString());
      if (response.status === 404) {
        setLogs([]);
        setSessionInfo(null);
        setThresholdHits({ mediumReachedAt: null, highReachedAt: null });
        activeSessionIdRef.current = null;
        setErrorText(targetSessionId ? `Session #${targetSessionId} was not found.` : 'No active session right now.');
        return;
      }
      if (!response.ok) {
        throw new Error(`GET logs failed with status ${response.status}`);
      }

      const payload = await response.json();
      const session = payload?.session || null;
      const thresholdHitsPayload = payload?.threshold_hits || {};
      const items = Array.isArray(payload.items) ? payload.items : [];

      setSessionInfo(session);
      setThresholdHits({
        mediumReachedAt: thresholdHitsPayload.medium_reached_at || null,
        highReachedAt: thresholdHitsPayload.high_reached_at || null,
      });
      setLogs(items.map((item) => normalizeLog(item)));

      const activeSessionId = parseSessionId(session?.id);
      activeSessionIdRef.current = activeSessionId;
      setSessionInput(targetSessionId ? String(targetSessionId) : activeSessionId ? String(activeSessionId) : '');
    } catch (error) {
      console.error('Failed to load session log details:', error);
      setErrorText(error.message || 'Failed to load session logs.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    activeSessionIdRef.current = requestedSessionId || parseSessionId(sessionInfo?.id);
  }, [requestedSessionId, sessionInfo]);

  useEffect(() => {
    let shouldReconnect = true;

    const connectSocket = (attempt = 0) => {
      if (!shouldReconnect) {
        return;
      }

      const socket = new WebSocket(ENDPOINTS.noiseSocket);
      socketRef.current = socket;

      socket.onopen = () => {
        setIsConnected(true);
      };

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'connection' || payload.type === 'pong') {
            return;
          }

          const activeSessionId = activeSessionIdRef.current;
          const payloadSessionId = parseSessionId(payload.session_id);
          if (!activeSessionId || payloadSessionId !== activeSessionId) {
            return;
          }

          if (payload.type === 'state_change') {
            appendTransitionLog(payload);
          }
        } catch (error) {
          console.error('Invalid log websocket payload:', error);
        }
      };

      socket.onerror = () => {
        socket.close();
      };

      socket.onclose = () => {
        setIsConnected(false);
        if (!shouldReconnect) {
          return;
        }

        const delay = Math.min(10000, 1000 * 2 ** attempt);
        reconnectTimerRef.current = setTimeout(() => connectSocket(attempt + 1), delay);
      };
    };

    fetchSessionDetails(requestedSessionId);
    connectSocket();

    const refreshTimer = setInterval(() => {
      fetchSessionDetails(requestedSessionId);
    }, REFRESH_INTERVAL_MS);

    return () => {
      shouldReconnect = false;
      clearInterval(refreshTimer);
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, [appendTransitionLog, fetchSessionDetails, requestedSessionId]);

  const handleLoadSession = useCallback((event) => {
    event.preventDefault();
    const nextSessionId = parseSessionId(sessionInput);
    if (!nextSessionId) {
      setErrorText('Enter a valid positive Session ID.');
      return;
    }

    setSearchParams({ session_id: String(nextSessionId) });
  }, [sessionInput, setSearchParams]);

  const handleLoadActiveSession = useCallback(() => {
    setSearchParams({});
  }, [setSearchParams]);

  const isWarningLog = useCallback(
    (log) => /high|loud|warning/i.test(log.toState || log.status || '') || log.level > 60,
    []
  );
  const violations = logs.filter((log) => isWarningLog(log)).length;
  const currentLevel = logs[0]?.level ?? 0;
  const peakLevel = useMemo(() => {
    if (logs.length === 0) {
      return 0;
    }
    return Math.max(...logs.map((log) => log.level));
  }, [logs]);
  const lastUpdated = logs[0]?.timestamp;
  const activeSessionLabel = sessionInfo ? `Session #${sessionInfo.id}` : requestedSessionId ? `Session #${requestedSessionId}` : 'Idle';
  const mediumReachedAt = thresholdHits.mediumReachedAt;
  const highReachedAt = thresholdHits.highReachedAt;

  return (
    <div className="min-h-screen bg-slate-50 p-8 font-sans">

      <div className="mb-8 flex flex-col md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">LuminaQuiet Session Log</h1>
          <p className="text-slate-500">Session-only transition history with medium/high threshold reach time.</p>
        </div>
        <div className="mt-4 flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-bold uppercase tracking-wider text-slate-500">
          <Wifi size={14} className={isConnected ? 'text-green-500' : 'text-red-500'} />
          {isConnected ? 'WebSocket Live' : 'Offline'} | {activeSessionLabel}
        </div>
      </div>

      <form onSubmit={handleLoadSession} className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="w-full md:max-w-xs">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">Session ID</label>
            <input
              type="number"
              min="1"
              step="1"
              value={sessionInput}
              onChange={(event) => setSessionInput(event.target.value)}
              placeholder="Enter session id"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Load Session
          </button>
          <button
            type="button"
            onClick={handleLoadActiveSession}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Use Active Session
          </button>
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            {isLoading ? 'Refreshing session data...' : 'Session scope locked'}
          </span>
        </div>

        {errorText && (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
            {errorText}
          </p>
        )}
      </form>

      <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-5">
        <div className="flex items-center rounded-xl bg-white p-6 shadow-sm border border-slate-100">
          <div className="mr-4 rounded-full bg-blue-100 p-3 text-blue-600">
            <Activity size={24} />
          </div>
          <div>
            <p className="text-sm text-slate-500">Current Level</p>
            <p className="text-2xl font-bold text-slate-900">{currentLevel} dB</p>
          </div>
        </div>

        <div className="flex items-center rounded-xl bg-white p-6 shadow-sm border border-slate-100">
          <div className="mr-4 rounded-full bg-amber-100 p-3 text-amber-600">
            <Clock size={24} />
          </div>
          <div>
            <p className="text-sm text-slate-500">Last Updated</p>
            <p className="text-2xl font-bold text-slate-900">{formatTimestamp(lastUpdated)}</p>
          </div>
        </div>

        <div className="flex items-center rounded-xl bg-white p-6 shadow-sm border border-red-100">
          <div className="mr-4 rounded-full bg-red-100 p-3 text-red-600">
            <AlertTriangle size={24} />
          </div>
          <div>
            <p className="text-sm text-slate-500">Violations (Warning State)</p>
            <p className="text-2xl font-bold text-red-600">{violations}</p>
          </div>
        </div>

        <div className="flex items-center rounded-xl bg-white p-6 shadow-sm border border-slate-100">
          <div className="mr-4 rounded-full bg-indigo-100 p-3 text-indigo-600">
            <Clock size={24} />
          </div>
          <div>
            <p className="text-sm text-slate-500">Medium Threshold Reached</p>
            <p className="text-sm font-bold text-slate-900">{formatDateTime(mediumReachedAt)}</p>
          </div>
        </div>

        <div className="flex items-center rounded-xl bg-white p-6 shadow-sm border border-slate-100">
          <div className="mr-4 rounded-full bg-rose-100 p-3 text-rose-600">
            <AlertTriangle size={24} />
          </div>
          <div>
            <p className="text-sm text-slate-500">High Threshold Reached</p>
            <p className="text-sm font-bold text-slate-900">{formatDateTime(highReachedAt)}</p>
          </div>
        </div>
      </div>

      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-sm text-slate-500">Peak Level</p>
        <p className="text-2xl font-bold text-slate-900">{peakLevel} dB</p>
        <p className="mt-2 text-xs text-slate-500">
          {sessionInfo
            ? `Session ${sessionInfo.id}: ${formatDateTime(sessionInfo.started_at)} - ${formatDateTime(sessionInfo.ends_at)}`
            : 'No session context loaded. Provide a Session ID or switch to active session.'}
        </p>
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
                <th className="px-6 py-4 text-center">Transition</th>
                <th className="px-6 py-4 text-center">Quiet Duration</th>
                <th className="px-6 py-4 text-center">Automated Response</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50/80 transition">
                  <td className="whitespace-nowrap px-6 py-4 text-slate-600 text-center">{formatTimestamp(log.timestamp)}</td>
                  <td className="px-6 py-4 font-medium text-slate-900 text-center">{log.level} dB</td>
                  <td className="px-6 py-4 text-center text-slate-700 font-semibold">
                    {log.fromState} {'->'} {log.toState}
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      isWarningLog(log)
                        ? 'bg-red-100 text-red-700' 
                        : 'bg-green-100 text-green-700'
                    }`}>
                      {log.quietDurationMs} ms
                    </span>
                  </td>
                  <td className="px-6 py-4 text-slate-500 text-center">
                    {isWarningLog(log) ? (
                      <span className="flex items-center justify-center gap-1 text-red-600 font-medium">
                        <AlertTriangle size={14} /> Threshold Breach Logged
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-1 text-slate-400">
                        <ShieldCheck size={14} /> Quiet/Normal State Logged
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-slate-500">
                    No transition logs for this session yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Log;