import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Calendar, AlertTriangle, Clock } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { ENDPOINTS } from '../config/runtime';
import SessionNoiseEventsModal from '../Components/SessionNoiseEventsModal';

const MAX_LOG_ROWS = 150;
const REFRESH_INTERVAL_MS = 5000;

const parseSessionId = (value) => {
    const parsed = Number.parseInt(String(value ?? '').trim(), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
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
    const [sessionInfo, setSessionInfo] = useState(null);
    const [onlyHighEvents, setOnlyHighEvents] = useState(true);
    const [isNoiseEventsModalOpen, setIsNoiseEventsModalOpen] = useState(false);

    const requestedSessionId = useMemo(
        () => parseSessionId(searchParams.get('session_id')),
        [searchParams]
    );

    const fetchSessions = useCallback(async () => {
        try {
            const response = await fetch(ENDPOINTS.sessionsList);
            if (!response.ok) {
                throw new Error(`GET sessions failed with status ${response.status}`);
            }

            const payload = await response.json();
            const items = Array.isArray(payload?.items) ? payload.items : [];
            setSessions(items);
        } catch (error) {
            console.error('Failed to load sessions:', error);
        }
    }, []);

    const fetchSessionDetails = useCallback(async (targetSessionId) => {
        try {
            const endpoint = new URL(ENDPOINTS.createLog);
            endpoint.searchParams.set('limit', String(MAX_LOG_ROWS));
            if (onlyHighEvents) {
                endpoint.searchParams.set('high_only', '1');
            }
            if (targetSessionId) {
                endpoint.searchParams.set('session_id', String(targetSessionId));
            }

            const response = await fetch(endpoint.toString());
            if (response.status === 404) {
                setLogs([]);
                setSessionInfo(null);
                return;
            }
            if (!response.ok) {
                throw new Error(`GET logs failed with status ${response.status}`);
            }

            const payload = await response.json();
            const session = payload?.session || null;
            const items = Array.isArray(payload.items) ? payload.items : [];

            setSessionInfo(session);
            setLogs(items.map((item, index) => normalizeLog(item, index)));
        } catch (error) {
            console.error('Failed to load session log details:', error);
        }
    }, [onlyHighEvents]);

    useEffect(() => {
        fetchSessions();
        fetchSessionDetails(requestedSessionId);

        const refreshTimer = setInterval(() => {
            fetchSessions();
            fetchSessionDetails(requestedSessionId);
        }, REFRESH_INTERVAL_MS);

        return () => {
            clearInterval(refreshTimer);
        };
    }, [fetchSessionDetails, fetchSessions, requestedSessionId]);

    const handleSelectSession = useCallback((sessionId) => {
        setSearchParams({ session_id: String(sessionId) });
    }, [setSearchParams]);

    const selectedSessionId = requestedSessionId || parseSessionId(sessionInfo?.id);

    return (
        <div className="space-y-8 text-slate-900 bg-slate-50 min-h-screen p-4 md:p-8">
            {/* Header Section */}
            <section className="relative overflow-hidden rounded-4xl border border-slate-200 bg-white p-6 shadow-sm transition-all duration-300 hover:shadow-md md:p-8">
                <div className="pointer-events-none absolute -top-20 -right-10 h-64 w-64 rounded-full bg-cyan-100/50 blur-3xl transition-opacity duration-500" />

                <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                    <div className="space-y-2">
                        <div className="flex items-center gap-2 text-cyan-700">
                            <Activity size={18} />
                            <p className="text-xs font-bold uppercase tracking-widest text-cyan-700">Session Analytics</p>
                        </div>
                        <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 md:text-4xl">Session Logs</h2>
                        <p className="max-w-2xl text-sm font-medium text-slate-500 md:text-base">
                            Select a session below to inspect transition events and historical logs.
                        </p>
                    </div>
                </div>
            </section>

            {/* Sessions List Section */}
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
                <div className="mb-6 flex items-center justify-between border-b border-slate-100 pb-4">
                    <div className="flex items-center gap-3">
                        <div className="rounded-lg bg-slate-100 p-2 text-slate-600">
                            <Calendar size={20} />
                        </div>
                        <h3 className="text-lg font-bold text-slate-900">All Admin Sessions</h3>
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
                                className={`group relative flex flex-col items-start rounded-2xl border p-5 text-left transition-all duration-300 ease-in-out hover:-translate-y-1 hover:shadow-lg ${
                                    isSelected
                                        ? 'border-cyan-500 bg-cyan-50/40 ring-1 ring-cyan-500'
                                        : 'border-slate-200 bg-white hover:border-cyan-300 hover:bg-slate-50'
                                }`}
                            >
                                <div className="flex w-full items-start justify-between">
                                    <p className="text-base font-extrabold text-slate-900">Session #{session.id}</p>
                                    <span
                                        className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                                            session.is_active
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
                            <p className="text-sm font-semibold">No sessions found yet.</p>
                            <p className="mt-1 text-xs text-slate-400">Recorded sessions will appear here.</p>
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