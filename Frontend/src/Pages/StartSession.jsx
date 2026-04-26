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
    Radar,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import StartSessionModal from '../Components/StartSessionModal';
import SessionCompletedModal from '../Components/SessionCompletedModal';
import { ENDPOINTS } from '../config/runtime';

const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000];
const DEFAULT_THRESHOLDS_DB = {
    quiet: 55,
    medium: 68,
    high: 80,
};

const DEFAULT_THRESHOLDS_RAW = {
    quiet: 800,
    medium: 1500,
    high: 2500,
};

const DISPLAY_ADC_MIN = 0;
const DISPLAY_ADC_MAX = 4095;

const clampAdcPercent = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return 0;
    }
    const percent = ((numeric - DISPLAY_ADC_MIN) / (DISPLAY_ADC_MAX - DISPLAY_ADC_MIN)) * 100;
    return Math.min(Math.max(percent, 0), 100);
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

const formatDuration = (seconds) => {
    if (!Number.isFinite(seconds) || seconds <= 0) {
        return '00:00';
    }
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

const StartSession = () => {
    const navigate = useNavigate();

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
    const [activeThresholdsDb, setActiveThresholdsDb] = useState(DEFAULT_THRESHOLDS_DB);
    const [activeThresholdsRaw, setActiveThresholdsRaw] = useState(DEFAULT_THRESHOLDS_RAW);
    const [sessionInfo, setSessionInfo] = useState(null);
    const [lastCompletedSession, setLastCompletedSession] = useState(null);
    const [isStartSessionModalOpen, setIsStartSessionModalOpen] = useState(false);
    const [isSessionCompletedModalOpen, setIsSessionCompletedModalOpen] = useState(false);
    const [isStartingSession, setIsStartingSession] = useState(false);
    const [isStoppingSession, setIsStoppingSession] = useState(false);
    const [sessionActionError, setSessionActionError] = useState('');
    const [sessionActionNotice, setSessionActionNotice] = useState('');
    const [nowMs, setNowMs] = useState(Date.now());

    const noiseRef = useRef(0);
    const socketRef = useRef(null);
    const reconnectTimerRef = useRef(null);
    const reconnectAttemptRef = useRef(0);
    const sessionActiveRef = useRef(false);

    // --- ADDED: Auto-clear notifications after 3 seconds ---
    useEffect(() => {
        if (sessionActionNotice) {
            const timer = setTimeout(() => {
                setSessionActionNotice('');
            }, 3000);

            // Cleanup function clears the timeout if the component unmounts 
            // or if a new notice is set before the 3 seconds are up
            return () => clearTimeout(timer);
        }
    }, [sessionActionNotice]);
    // -------------------------------------------------------

    const resetTelemetryToIdle = useCallback(() => {
        noiseRef.current = 0;
        setCurrentNoise(0);
        setPreviousNoise(0);
        setRawNoise(0);
        setDeviceId('N/A');
        setSensorValues([]);
        setWifiRssi(null);
        setLastUpdated(null);
        setStatusText('OFF');
    }, []);

    const applyThresholds = useCallback((source) => {
        if (!source || typeof source !== 'object') {
            return;
        }

        const thresholdDbNode = source.thresholds_db || {};
        const thresholdNode = source.thresholds || {};

        setActiveThresholdsDb((previous) => {
            const quiet = Number(
                source.quiet_threshold_db
                ?? thresholdDbNode.quiet
                ?? source.quiet_threshold
                ?? thresholdNode.quiet
            );
            const medium = Number(
                source.medium_threshold_db
                ?? thresholdDbNode.medium
                ?? source.medium_threshold
                ?? thresholdNode.medium
            );
            const high = Number(
                source.high_threshold_db
                ?? thresholdDbNode.high
                ?? source.loud_threshold_db
                ?? source.high_threshold
                ?? source.loud_threshold
                ?? thresholdNode.high
                ?? thresholdNode.loud
            );

            return {
                quiet: Number.isFinite(quiet) ? quiet : previous.quiet,
                medium: Number.isFinite(medium) ? medium : previous.medium,
                high: Number.isFinite(high) ? high : previous.high,
            };
        });

        setActiveThresholdsRaw((previous) => {
            const quiet = Number(
                source.quiet_threshold
                ?? thresholdNode.quiet
                ?? source.quiet_threshold_db
                ?? thresholdDbNode.quiet
            );
            const medium = Number(
                source.medium_threshold
                ?? thresholdNode.medium
                ?? source.medium_threshold_db
                ?? thresholdDbNode.medium
            );
            const high = Number(
                source.high_threshold
                ?? source.loud_threshold
                ?? thresholdNode.high
                ?? thresholdNode.loud
                ?? source.high_threshold_db
                ?? source.loud_threshold_db
                ?? thresholdDbNode.high
            );

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
    }, []);

    const fetchLatest = useCallback(async () => {
        try {
            const response = await fetch(ENDPOINTS.currentNoise);
            if (!response.ok) {
                throw new Error(`GET latest failed with status ${response.status}`);
            }
            const data = await response.json();
            if (!sessionActiveRef.current) {
                return;
            }
            applyIncomingData(data);
        } catch (error) {
            console.error('Failed to fetch latest noise snapshot:', error);
        }
    }, [applyIncomingData]);

    const fetchSession = useCallback(async () => {
        try {
            const response = await fetch(ENDPOINTS.currentSession);
            if (response.status === 404) {
                const hadActiveSession = sessionActiveRef.current;
                const completedSessionSnapshot = hadActiveSession
                    ? {
                        id: sessionInfo?.id ?? null,
                        endedAt: new Date().toISOString(),
                    }
                    : null;
                setSessionInfo(null);
                setActiveThresholdsDb(DEFAULT_THRESHOLDS_DB);
                setActiveThresholdsRaw(DEFAULT_THRESHOLDS_RAW);
                resetTelemetryToIdle();
                if (hadActiveSession && !isStoppingSession) {
                    setLastCompletedSession(completedSessionSnapshot);
                    setSessionActionError('');
                    setSessionActionNotice('');
                    setIsSessionCompletedModalOpen(true);
                }
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
    }, [applyThresholds, isStoppingSession, resetTelemetryToIdle]);

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
            setSessionActionNotice('Session started successfully. Live telemetry is now tied to this schedule.');
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

            setSessionActionNotice('Session stopped. Hardware outputs should now return to idle mode.');
            setSessionInfo(null);
            resetTelemetryToIdle();
            await fetchSession();
            await fetchLatest();
        } catch (error) {
            setSessionActionError(error.message || 'Failed to stop session.');
        } finally {
            setIsStoppingSession(false);
        }
    }, [fetchLatest, fetchSession, resetTelemetryToIdle]);

    useEffect(() => {
        sessionActiveRef.current = Boolean(sessionInfo);
    }, [sessionInfo]);

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
                        if (!sessionActiveRef.current) {
                            applyThresholds(payload?.config || payload);
                        }
                        return;
                    }

                    if (payload.type === 'session_stopped') {
                        const hadActiveSession = sessionActiveRef.current;
                        const completedSessionSnapshot = hadActiveSession
                            ? {
                                id: payload?.session_id ?? sessionInfo?.id ?? null,
                                endedAt: payload?.timestamp || new Date().toISOString(),
                            }
                            : null;
                        setSessionInfo(null);
                        resetTelemetryToIdle();
                        if (hadActiveSession && !isStoppingSession) {
                            setLastCompletedSession(completedSessionSnapshot);
                            setSessionActionError('');
                            setSessionActionNotice('');
                            setIsSessionCompletedModalOpen(true);
                        } else {
                            setSessionActionNotice('Session stopped via WebSocket signal.');
                        }
                        return;
                    }

                    if (payload.type === 'state_change' || payload.type === 'noise_data' || payload.average_level !== undefined) {
                        if (!sessionActiveRef.current) {
                            return;
                        }
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
    }, [applyIncomingData, applyThresholds, fetchLatest, fetchSession, isStoppingSession, resetTelemetryToIdle, sessionInfo?.id]);

    useEffect(() => {
        const timerId = setInterval(() => {
            setNowMs(Date.now());
        }, 1000);

        return () => {
            clearInterval(timerId);
        };
    }, []);

    const isSystemTurnedOff = !sessionInfo;

    const displayCurrentNoise = isSystemTurnedOff ? 0 : currentNoise;
    const displayPreviousNoise = isSystemTurnedOff ? 0 : previousNoise;
    const displayRawNoise = isSystemTurnedOff ? 0 : rawNoise;
    const displayDeviceId = isSystemTurnedOff ? 'N/A' : deviceId;
    const displayStatusText = isSystemTurnedOff ? 'OFF' : statusText;
    const displaySensorValues = isSystemTurnedOff ? [] : sensorValues;
    const displayWifiRssi = isSystemTurnedOff || wifiRssi === null ? 'N/A' : `${wifiRssi} dBm`;

    const isWarning = useMemo(
        () => {
            if (isSystemTurnedOff) return false;

            // ARCHITECTURE FIX: Trust the hardware state machine.
            // The ESP32 handles physical hysteresis. If the ESP32 says it is "High",
            // the UI must respect it, even if the current fluctuating raw ADC dips slightly.
            const isHardwareLoud = displayStatusText === 'High' || displayStatusText === 'STATE_LOUD';

            return displayCurrentNoise >= activeThresholdsRaw.high || isHardwareLoud;
        },
        [activeThresholdsRaw.high, displayCurrentNoise, isSystemTurnedOff, displayStatusText]
    );

    const gaugeHeight = clampAdcPercent(displayCurrentNoise);
    const highThresholdMarkerPosition = clampAdcPercent(activeThresholdsRaw.high);
    const highThresholdLabelPosition = Math.min(Math.max(highThresholdMarkerPosition, 6), 94);
    const isTrendingUp = displayCurrentNoise > displayPreviousNoise;

    const formattedLastUpdate = useMemo(() => {
        if (isSystemTurnedOff) {
            return 'N/A';
        }
        if (!lastUpdated) {
            return 'No updates yet';
        }
        const parsedDate = new Date(lastUpdated);
        if (Number.isNaN(parsedDate.getTime())) {
            return 'Invalid timestamp';
        }
        return parsedDate.toLocaleTimeString();
    }, [isSystemTurnedOff, lastUpdated]);

    const remainingSeconds = useMemo(() => {
        if (!sessionInfo?.ends_at) {
            return 0;
        }
        const end = new Date(sessionInfo.ends_at).getTime();
        return Math.max(0, Math.floor((end - nowMs) / 1000));
    }, [nowMs, sessionInfo]);

    const sessionModalInitialValues = useMemo(() => ({
        durationMinutes: 15,
        quiet: activeThresholdsRaw.quiet,
        medium: activeThresholdsRaw.medium,
        high: activeThresholdsRaw.high,
    }), [activeThresholdsRaw.high, activeThresholdsRaw.medium, activeThresholdsRaw.quiet]);

    return (
        <div className="space-y-6 text-slate-900">
            <section className="relative overflow-hidden rounded-3xl border border-slate-200/70 bg-white p-5 shadow-sm md:p-7">
                <div className="pointer-events-none absolute -top-20 right-0 h-56 w-56 rounded-full bg-cyan-100 blur-3xl" />

                <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-cyan-700">Session Operations</p>
                        <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">Start and Control a Monitoring Session</h2>
                        <p className="mt-2 max-w-2xl text-sm text-slate-600 md:text-base">
                            Configure runtime thresholds, monitor live telemetry, and keep session state clear for operators.
                        </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        {/* UNIFIED START/STOP BUTTON */}
                        <button
                            type="button"
                            onClick={() => {
                                if (sessionInfo) {
                                    handleStopSession();
                                } else {
                                    setSessionActionError('');
                                    setSessionActionNotice('');
                                    setIsStartSessionModalOpen(true);
                                }
                            }}
                            disabled={isStoppingSession || isStartingSession}
                            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${isStoppingSession || isStartingSession
                                ? 'cursor-not-allowed bg-slate-200 text-slate-500'
                                : sessionInfo
                                    ? 'bg-rose-600 text-white shadow-lg shadow-rose-200 hover:bg-rose-700'
                                    : 'bg-cyan-600 text-white shadow-lg shadow-cyan-200 hover:bg-cyan-700'
                                }`}
                        >
                            {sessionInfo ? <StopCircle size={16} /> : <PlayCircle size={16} />}
                            {sessionInfo
                                ? (isStoppingSession ? 'Stopping...' : 'Stop Session')
                                : 'Start Session'}
                        </button>

                        <button
                            type="button"
                            onClick={() => {
                                fetchSession();
                                fetchLatest();
                            }}
                            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                        >
                            <RefreshCw size={15} /> Refresh
                        </button>
                    </div>
                </div>

                <div className="relative z-10 mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
                        <Wifi size={14} className={isConnected ? 'text-emerald-500' : 'text-rose-500'} />
                        {isConnected ? connectionLabel : 'Offline'}
                    </div>
                    <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
                        <Battery size={14} className="text-cyan-700" />
                        5V Power Stable
                    </div>
                    <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
                        <Radar size={14} className="text-cyan-700" />
                        Session: {sessionInfo ? `#${sessionInfo.id}` : 'Idle'}
                    </div>
                </div>
            </section>

            {(sessionActionError || sessionActionNotice) && (
                <section>
                    {sessionActionError && (
                        <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                            {sessionActionError}
                        </p>
                    )}
                    {!sessionActionError && sessionActionNotice && (
                        <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
                            {sessionActionNotice}
                        </p>
                    )}
                </section>
            )}

            {isSystemTurnedOff && (
                <section>
                    <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                        The system is turned off at the moment. Start a session to activate the ESP32 telemetry and use live monitoring.
                    </p>
                </section>
            )}

            <section className="grid grid-cols-1 gap-6 xl:grid-cols-12">
                <div className="xl:col-span-8">
                    <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
                        <div className="absolute -left-16 -top-16 h-36 w-36 rounded-full bg-cyan-100/60 blur-2xl" />
                        {isWarning && <div className="absolute inset-0 bg-rose-500/5" />}

                        <div className="relative z-10">
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Current Ambient Noise</p>

                            <div className="mt-4 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
                                <div className="flex items-end gap-3">
                                    <h3 className={`text-7xl font-black leading-none md:text-8xl ${isWarning ? 'text-rose-600' : 'text-cyan-700'}`}>
                                        {displayCurrentNoise}
                                    </h3>
                                    <span className="pb-3 text-xl font-semibold text-slate-500">ADC</span>
                                </div>

                                <div className="flex items-end gap-4">
                                    <div className="relative">
                                        <div className="relative h-44 w-10 overflow-hidden rounded-full border border-slate-200 bg-slate-100">
                                            <div
                                                className="absolute inset-x-0 h-px bg-slate-400"
                                                style={{ bottom: `${highThresholdMarkerPosition}%` }}
                                                title={`High threshold: ${activeThresholdsRaw.high} ADC`}
                                            />
                                            <div
                                                className={`absolute bottom-0 w-full transition-all duration-200 ${isWarning ? 'bg-rose-500' : 'bg-cyan-600'}`}
                                                style={{ height: `${gaugeHeight}%` }}
                                            />
                                        </div>
                                        <div
                                            className="pointer-events-none absolute left-full ml-2 -translate-y-1/2 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 shadow-sm"
                                            style={{ bottom: `${highThresholdLabelPosition}%` }}
                                        >
                                            High {activeThresholdsRaw.high} ADC
                                        </div>
                                    </div>
                                    <div className="space-y-2 text-sm text-slate-600">
                                        <p className="font-semibold">Live gauge</p>
                                        <p className="max-w-32 text-xs">Visual trend of incoming average raw ADC level.</p>
                                    </div>
                                </div>
                            </div>

                            <div className="mt-6 flex flex-wrap items-center gap-3">
                                <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700">
                                    {isTrendingUp ? <ArrowUpRight size={16} className="text-amber-500" /> : <ArrowDownRight size={16} className="text-emerald-500" />}
                                    {isSystemTurnedOff ? 'No active telemetry' : (isTrendingUp ? 'Rising trend' : 'Cooling trend')}
                                </span>
                                <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold ${isWarning ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                    <span className={`h-2.5 w-2.5 rounded-full ${isWarning ? 'bg-rose-500' : 'bg-emerald-500'}`} />
                                    {sessionInfo
                                        ? (isWarning ? 'Above high threshold' : 'Within configured thresholds')
                                        : 'Idle mode, waiting for session'}
                                </span>
                            </div>

                            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Device</p>
                                    <p className="mt-1 text-sm font-bold text-slate-800">{displayDeviceId}</p>
                                </div>
                                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Current State</p>
                                    <p className="mt-1 text-sm font-bold text-slate-800">{displayStatusText}</p>
                                </div>
                                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Raw ADC</p>
                                    <p className="mt-1 text-sm font-bold text-slate-800">{displayRawNoise}</p>
                                </div>
                                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Wi-Fi RSSI</p>
                                    <p className="mt-1 text-sm font-bold text-slate-800">{displayWifiRssi}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="space-y-4 xl:col-span-4">
                    <div className="rounded-3xl border border-cyan-200/70 bg-linear-to-br from-cyan-700 to-cyan-900 p-5 text-white shadow-lg shadow-cyan-900/30">
                        <div className="flex items-center justify-between">
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-100">Session State</p>
                            <TrendingDown size={18} className="text-cyan-100" />
                        </div>
                        <p className="mt-3 text-3xl font-bold">{sessionInfo ? `#${sessionInfo.id}` : 'IDLE'}</p>
                        <p className="mt-2 text-sm text-cyan-100">
                            {sessionInfo ? `Remaining time: ${formatDuration(remainingSeconds)}` : 'No active session. Start one to apply thresholds.'}
                        </p>
                    </div>

                    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Active Thresholds (Raw ADC)</p>
                        <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-slate-700">Quiet: {activeThresholdsRaw.quiet} ADC</span>
                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-slate-700">Medium: {activeThresholdsRaw.medium} ADC</span>
                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-slate-700">High: {activeThresholdsRaw.high} ADC</span>
                        </div>

                        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Sensor Channels</p>
                            <p className="mt-1 text-sm font-bold text-slate-800">{displaySensorValues.length || 0} channels in latest packet</p>
                        </div>

                        <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                            <div className="mb-2 flex items-center gap-2">
                                <Volume2 size={15} className="text-slate-500" />
                                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Sensor Values</p>
                            </div>
                            <div className="flex max-h-28 flex-wrap gap-2 overflow-y-auto pr-1">
                                {displaySensorValues.length > 0 ? (
                                    displaySensorValues.map((value, index) => (
                                        <span
                                            key={`sensor-${index}`}
                                            className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700"
                                        >
                                            S{index + 1}: {value}
                                        </span>
                                    ))
                                ) : (
                                    <span className="text-xs font-medium text-slate-500">No sensor array in latest packet.</span>
                                )}
                            </div>
                        </div>

                        <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                            <div className="flex items-center gap-2">
                                <AlertCircle size={15} className="text-slate-500" />
                                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Event Timing</p>
                            </div>
                            <p className="mt-1 text-sm font-semibold text-slate-700">Last packet: {formattedLastUpdate}</p>
                            <p className="text-sm font-semibold text-slate-700">Previous level: {displayPreviousNoise} ADC</p>
                        </div>
                    </div>
                </div>
            </section>

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

            <SessionCompletedModal
                isOpen={isSessionCompletedModalOpen}
                onClose={() => setIsSessionCompletedModalOpen(false)}
                onViewLogs={() => {
                    setIsSessionCompletedModalOpen(false);
                    navigate('/admin-log');
                }}
                sessionId={lastCompletedSession?.id}
                endedAt={lastCompletedSession?.endedAt}
            />
        </div>
    );
};

export default StartSession;