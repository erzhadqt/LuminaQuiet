import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Wifi, GaugeCircle, Clock, Calendar, AlertTriangle } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { ENDPOINTS } from '../config/runtime';
import SessionNoiseEventsModal from '../Components/SessionNoiseEventsModal';

const MAX_LOG_ROWS = 150;
const REFRESH_INTERVAL_MS = 5000;

const parseSessionId = (value) => {
    const parsed = Number.parseInt(String(value ?? '').trim(), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const formatTimestamp = (timestamp) => {
    if (!timestamp) return 'N/A';
    const parsed = new Date(timestamp);
    if (Number.isNaN(parsed.getTime())) return 'Invalid time';
    return parsed.toLocaleTimeString();
};

const formatDateTime = (timestamp) => {
    if (!timestamp) return 'Not reached';
    const parsed = new Date(timestamp);
    if (Number.isNaN(parsed.getTime())) return 'Invalid time';
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

const normalizeLog = (item, index = 0) => {
    const parsedLevel = Number(item.average_level ?? item.level ?? 0);
    const level = Number.isFinite(parsedLevel) ? parsedLevel : 0;

    return {
        id: item.id || `${item.timestamp || 'ts'}-${item.session_id || 'session'}-${index}`,
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
    const [sessions, setSessions] = useState([]);
    const [isConnected, setIsConnected] = useState(false);
    const [sessionInfo, setSessionInfo] = useState(null);
    const [liveCurrentLevel, setLiveCurrentLevel] = useState(0); // Added for independent live level tracking
    const [thresholdHits, setThresholdHits] = useState({
        mediumReachedAt: null,
        highReachedAt: null,
    });
    const [onlyHighEvents, setOnlyHighEvents] = useState(true);
    const [isNoiseEventsModalOpen, setIsNoiseEventsModalOpen] = useState(false);

    const socketRef = useRef(null);
    const reconnectTimerRef = useRef(null);
    const heartbeatTimerRef = useRef(null);
    const activeSessionIdRef = useRef(null);
    const fetchIdRef = useRef(0); // Added to prevent race conditions that wipe modal data

    const requestedSessionId = useMemo(
        () => parseSessionId(searchParams.get('session_id')),
        [searchParams]
    );

    const appendTransitionLog = useCallback((payload) => {
        if (onlyHighEvents && !isHighThresholdState(payload.to_state || payload.status || payload.state)) {
            return;
        }

        const nextLog = normalizeLog(payload);

        setLogs((previousLogs) => {
            const next = [nextLog, ...previousLogs];
            return next.slice(0, MAX_LOG_ROWS);
        });

        setThresholdHits((previous) => ({
            mediumReachedAt: previous.mediumReachedAt || (isMediumThresholdState(nextLog.toState) ? nextLog.timestamp : null),
            highReachedAt: previous.highReachedAt || (isHighThresholdState(nextLog.toState) ? nextLog.timestamp : null),
        }));
    }, [onlyHighEvents]);

    // Added to fetch independent current live noise
    const fetchCurrentNoise = useCallback(async () => {
        try {
            const response = await fetch(ENDPOINTS.currentNoise);
            if (response.ok) {
                const data = await response.json();
                if (data.average_level !== undefined) {
                    setLiveCurrentLevel(Number(data.average_level));
                }
            }
        } catch (error) {
            // Silently ignore background failures
        }
    }, []);

    const fetchSessions = useCallback(async () => {
        try {
            const response = await fetch(ENDPOINTS.sessionsList);
            if (!response.ok) throw new Error(`GET sessions failed with status ${response.status}`);

            const payload = await response.json();
            const items = Array.isArray(payload?.items) ? payload.items : [];

            // Modified: Only display sessions that have finished (is_active === false)
            setSessions(items.filter(session => !session.is_active));
        } catch (error) {
            console.error('Failed to load sessions:', error);
        }
    }, []);

    const fetchSessionDetails = useCallback(async (targetSessionId) => {
        const currentFetchId = ++fetchIdRef.current; // Track this specific fetch

        // Modified: Do not auto-fetch backend default if no session is clicked
        if (!targetSessionId) {
            setLogs([]);
            setSessionInfo(null);
            setThresholdHits({ mediumReachedAt: null, highReachedAt: null });
            activeSessionIdRef.current = null;
            return;
        }

        try {
            const endpoint = new URL(ENDPOINTS.createLog);
            endpoint.searchParams.set('limit', String(MAX_LOG_ROWS));
            if (onlyHighEvents) endpoint.searchParams.set('high_only', '1');
            endpoint.searchParams.set('session_id', String(targetSessionId));

            const response = await fetch(endpoint.toString());

            // Race Condition Fix: If another fetch was started while we were waiting, discard this data
            if (currentFetchId !== fetchIdRef.current) return;

            if (response.status === 404) {
                setLogs([]);
                setSessionInfo(null);
                setThresholdHits({ mediumReachedAt: null, highReachedAt: null });
                activeSessionIdRef.current = null;
                return;
            }

            if (!response.ok) throw new Error(`GET logs failed with status ${response.status}`);

            const payload = await response.json();
            const session = payload?.session || null;
            const thresholdHitsPayload = payload?.threshold_hits || {};
            const items = Array.isArray(payload.items) ? payload.items : [];

            setSessionInfo(session);
            setThresholdHits({
                mediumReachedAt: thresholdHitsPayload.medium_reached_at || null,
                highReachedAt: thresholdHitsPayload.high_reached_at || null,
            });
            setLogs(items.map((item, index) => normalizeLog(item, index)));

            activeSessionIdRef.current = parseSessionId(session?.id);
        } catch (error) {
            if (currentFetchId === fetchIdRef.current) {
                console.error('Failed to load session log details:', error);
            }
        }
    }, [onlyHighEvents]);

    useEffect(() => {
        activeSessionIdRef.current = requestedSessionId || parseSessionId(sessionInfo?.id);
    }, [requestedSessionId, sessionInfo]);

    useEffect(() => {
        let shouldReconnect = true;

        const connectSocket = (attempt = 0) => {
            if (!shouldReconnect) return;

            const socket = new WebSocket(ENDPOINTS.noiseSocket);
            socketRef.current = socket;

            socket.onopen = () => {
                setIsConnected(true);
                if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);

                heartbeatTimerRef.current = window.setInterval(() => {
                    if (socket.readyState === WebSocket.OPEN) {
                        socket.send(JSON.stringify({ action: 'ping' }));
                    }
                }, 30000);
            };

            socket.onmessage = (event) => {
                try {
                    const payload = JSON.parse(event.data);
                    if (payload.type === 'connection' || payload.type === 'pong') return;

                    // Always update the live current level widget regardless of active session
                    if (payload.average_level !== undefined) {
                        setLiveCurrentLevel(Number(payload.average_level));
                    }

                    const activeSessionId = activeSessionIdRef.current;
                    const payloadSessionId = parseSessionId(payload.session_id);

                    if (!activeSessionId || payloadSessionId !== activeSessionId) return;

                    if (payload.type === 'state_change') {
                        appendTransitionLog(payload);
                    }
                } catch (error) {
                    console.error('Invalid log websocket payload:', error);
                }
            };

            socket.onerror = () => socket.close();

            socket.onclose = () => {
                setIsConnected(false);
                if (heartbeatTimerRef.current) {
                    clearInterval(heartbeatTimerRef.current);
                    heartbeatTimerRef.current = null;
                }
                if (!shouldReconnect) return;

                const delay = Math.min(10000, 1000 * 2 ** attempt);
                reconnectTimerRef.current = setTimeout(() => connectSocket(attempt + 1), delay);
            };
        };

        fetchCurrentNoise();
        fetchSessions();
        fetchSessionDetails(requestedSessionId);
        connectSocket();

        const refreshTimer = setInterval(() => {
            fetchCurrentNoise();
            fetchSessions();
            fetchSessionDetails(requestedSessionId);
        }, REFRESH_INTERVAL_MS);

        return () => {
            shouldReconnect = false;
            clearInterval(refreshTimer);
            if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
            if (heartbeatTimerRef.current) {
                clearInterval(heartbeatTimerRef.current);
                heartbeatTimerRef.current = null;
            }
            if (socketRef.current) socketRef.current.close();
        };
    }, [appendTransitionLog, fetchCurrentNoise, fetchSessionDetails, fetchSessions, requestedSessionId]);

    const handleSelectSession = useCallback((sessionId) => {
        setSearchParams({ session_id: String(sessionId) });
    }, [setSearchParams]);

    const peakLog = useMemo(() => {
        if (logs.length === 0) return null;
        return logs.reduce((maxLog, currentLog) => currentLog.level > maxLog.level ? currentLog : maxLog, logs[0]);
    }, [logs]);

    const activeSessionLabel = sessionInfo
        ? `Session #${sessionInfo.id}`
        : requestedSessionId
            ? `Session #${requestedSessionId}`
            : 'Idle';

    const selectedSessionId = requestedSessionId || parseSessionId(sessionInfo?.id);

    return (
        <div className="space-y-8 text-slate-900 bg-slate-50 min-h-screen p-4 md:p-8">
            <section className="relative overflow-hidden rounded-4xl border border-slate-200 bg-white p-6 shadow-sm transition-all duration-300 hover:shadow-md md:p-8">
                <div className="pointer-events-none absolute -top-20 -right-10 h-64 w-64 rounded-full bg-cyan-100/50 blur-3xl transition-opacity duration-500" />

                <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                    <div className="space-y-2">
                        <div className="flex items-center gap-2 text-cyan-700">
                            <Activity size={18} />
                            <p className="text-xs font-bold uppercase tracking-widest text-cyan-700">Session Analytics</p>
                        </div>
                        <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 md:text-4xl">Noise Transition Log</h2>
                        <p className="max-w-2xl text-sm font-medium text-slate-500 md:text-base">
                            Inspect finished session transition events and threshold breach timings with real-time updates.
                        </p>
                    </div>

                    <div className="inline-flex items-center gap-3 rounded-xl border border-slate-200 bg-white shadow-sm px-5 py-3 text-sm font-bold tracking-wide text-slate-700">
                        <div className="flex items-center gap-2">
                            <span className="relative flex h-3 w-3">
                                {isConnected && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>}
                                <span className={`relative inline-flex rounded-full h-3 w-3 ${isConnected ? 'bg-emerald-500' : 'bg-rose-500'}`}></span>
                            </span>
                            {isConnected ? 'WebSocket Live' : 'Offline'}
                        </div>
                        <div className="h-4 w-px bg-slate-200"></div>
                        <div className="text-cyan-700">{activeSessionLabel}</div>
                    </div>
                </div>
            </section>

            <section className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                {/* Live Current Level Card */}
                <div className="group flex flex-col justify-between rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:border-cyan-200 cursor-default">
                    <div className="flex items-center gap-3 text-cyan-700">
                        <div className="rounded-lg bg-cyan-50 p-2 group-hover:bg-cyan-100 transition-colors">
                            <GaugeCircle size={20} />
                        </div>
                        <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Live Current Level</p>
                    </div>
                    <div className="mt-6 flex items-end gap-2">
                        <p className="text-4xl font-extrabold text-slate-900">{liveCurrentLevel}</p>
                        <p className="mb-1 text-lg font-semibold text-slate-500">dB</p>
                    </div>
                </div>

                {/* Peak Level Card */}
                <div className="group flex flex-col justify-between rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:border-indigo-200 cursor-default">
                    <div className="flex items-center gap-3 text-indigo-700">
                        <div className="rounded-lg bg-indigo-50 p-2 group-hover:bg-indigo-100 transition-colors">
                            <Activity size={20} />
                        </div>
                        <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Peak Level</p>
                    </div>
                    <div className="mt-6 flex flex-col gap-1">
                        <div className="flex items-end gap-2">
                            <p className="text-4xl font-extrabold text-slate-900">{peakLog?.level ?? 0}</p>
                            <p className="mb-1 text-lg font-semibold text-slate-500">dB</p>
                        </div>
                        {peakLog ? (
                            <div className="mt-1 flex flex-col text-xs font-medium text-slate-500">
                                <span>Session #{peakLog.sessionId || sessionInfo?.id || 'Unknown'}</span>
                                <span className="text-slate-400">{formatDateTime(peakLog.timestamp)}</span>
                            </div>
                        ) : (
                            <p className="mt-1 text-xs font-medium text-slate-400 italic">No data recorded</p>
                        )}
                    </div>
                </div>

                {/* Session Context Card */}
                <div className="group flex flex-col justify-between rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:border-teal-200 cursor-default md:col-span-2 lg:col-span-1">
                    <div className="flex items-center gap-3 text-teal-700">
                        <div className="rounded-lg bg-teal-50 p-2 group-hover:bg-teal-100 transition-colors">
                            <Clock size={20} />
                        </div>
                        <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Session Context</p>
                    </div>
                    <div className="mt-6">
                        {sessionInfo ? (
                            <div className="space-y-1">
                                <p className="text-lg font-bold text-slate-900">Session #{sessionInfo.id}</p>
                                <p className="text-sm font-medium text-slate-500 line-clamp-1">
                                    {formatDateTime(sessionInfo.started_at)} — {formatDateTime(sessionInfo.ends_at)}
                                </p>
                            </div>
                        ) : (
                            <p className="text-sm font-medium text-slate-400 italic">
                                No session context loaded. Select a session below.
                            </p>
                        )}
                    </div>
                </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
                <div className="mb-6 flex items-center justify-between border-b border-slate-100 pb-4">
                    <div className="flex items-center gap-3">
                        <div className="rounded-lg bg-slate-100 p-2 text-slate-600">
                            <Calendar size={20} />
                        </div>
                        <h3 className="text-lg font-bold text-slate-900">Finished Admin Sessions</h3>
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
                        {sessions.length} Total
                    </span>
                </div>

                <div className="grid max-h-125 grid-cols-1 gap-4 overflow-y-auto pr-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {sessions.map((session) => {
                        const sessionId = parseSessionId(session.id);
                        const isSelected = sessionId === selectedSessionId;
                        const highHits = Number(session.high_event_count ?? 0);

                        return (
                            <button
                                key={session.id}
                                type="button"
                                onClick={() => {
                                    handleSelectSession(session.id);
                                    setIsNoiseEventsModalOpen(true);
                                }}
                                className={`group relative flex flex-col items-start rounded-2xl border p-5 text-left transition-all duration-300 ease-in-out hover:-translate-y-1 hover:shadow-lg ${isSelected
                                    ? 'border-cyan-500 bg-cyan-50/40 ring-1 ring-cyan-500'
                                    : 'border-slate-200 bg-white hover:border-cyan-300 hover:bg-slate-50'
                                    }`}
                            >
                                <div className="flex w-full items-start justify-between">
                                    <p className="text-base font-extrabold text-slate-900">Session #{session.id}</p>
                                    <span
                                        className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${session.is_active
                                            ? 'bg-emerald-100 text-emerald-700'
                                            : 'bg-slate-100 text-slate-500'
                                            }`}
                                    >
                                        {session.is_active ? 'Active' : 'Stopped'}
                                    </span>
                                </div>

                                <div className="mt-4 w-full space-y-2">
                                    <div className="flex items-center gap-2 text-sm">
                                        <AlertTriangle size={14} className={highHits > 0 ? 'text-amber-500' : 'text-slate-400'} />
                                        <span className="font-medium text-slate-600">
                                            High hits: <span className={highHits > 0 ? 'font-bold text-amber-600' : 'text-slate-500'}>{highHits}</span>
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2 text-sm">
                                        <Clock size={14} className="text-slate-400" />
                                        <span className="font-medium text-slate-500 truncate">
                                            {formatDateTime(session.started_at)}
                                        </span>
                                    </div>
                                </div>
                            </button>
                        );
                    })}

                    {sessions.length === 0 && (
                        <div className="col-span-full flex flex-col items-center justify-center rounded-3xl border-2 border-dashed border-slate-200 bg-slate-50 py-12 text-slate-500">
                            <Calendar size={32} className="mb-3 text-slate-300" />
                            <p className="text-sm font-semibold">No finished sessions found yet.</p>
                            <p className="mt-1 text-xs text-slate-400">Recorded sessions will appear here once stopped.</p>
                        </div>
                    )}
                </div>
            </section>

            <SessionNoiseEventsModal
                isOpen={isNoiseEventsModalOpen}
                onClose={() => setIsNoiseEventsModalOpen(false)}
                logs={logs}
                sessionInfo={sessionInfo}
                onlyHighEvents={onlyHighEvents}
            />
        </div>
    );
};

export default Log;