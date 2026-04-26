import React from 'react';
import { X, Activity, AlertTriangle, ShieldCheck, Clock } from 'lucide-react';

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
        return 'N/A';
    }
    const parsed = new Date(timestamp);
    if (Number.isNaN(parsed.getTime())) {
        return 'Invalid date/time';
    }
    return parsed.toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
    });
};

const isWarningLog = (log) => /high|loud|warning/i.test(log.toState || log.status || '') || log.average_level > 60;

const SessionNoiseEventsModal = ({
    isOpen,
    onClose,
    logs,
    sessionInfo,
    onlyHighEvents,
}) => {
    if (!isOpen) {
        return null;
    }

    const violations = logs.filter((log) => isWarningLog(log)).length;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 py-6 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-label="Session noise events"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                    onClose();
                }
            }}
        >
            <div className="flex w-full max-w-6xl max-h-[90vh] overflow-hidden flex-col rounded-3xl border border-slate-200 bg-white shadow-2xl">
                <div className="border-b border-slate-100 bg-linear-to-r from-cyan-50 to-slate-50 px-6 py-5 md:px-7 shrink-0">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <h3 className="flex items-center gap-2 text-lg font-bold text-slate-900 md:text-xl">
                                <Activity size={20} className="text-cyan-700" />
                                Historical Noise Events
                            </h3>
                            <div className="mt-2 space-y-1">
                                {sessionInfo ? (
                                    <>
                                        <p className="text-sm font-medium text-slate-700">
                                            Session #{sessionInfo.id} <span className="text-slate-400 font-normal mx-1">•</span> {violations} threshold breach event{violations !== 1 ? 's' : ''}
                                            {onlyHighEvents && <span className="text-slate-500 italic font-normal ml-1">(High hits only)</span>}
                                        </p>
                                        <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                                            <Clock size={14} className="text-slate-400" />
                                            Created: {formatDateTime(sessionInfo.started_at)}
                                        </p>
                                    </>
                                ) : (
                                    <p className="text-sm text-slate-600">No session selected</p>
                                )}
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
                            aria-label="Close modal"
                        >
                            <X size={20} />
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6">
                    {logs.length === 0 ? (
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-6 py-12 text-center">
                            <p className="text-sm text-slate-500">No noise events recorded for this session yet.</p>
                        </div>
                    ) : (
                        <>
                            <div className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 p-5">
                                <div className="flex items-center justify-between gap-4">
                                    <div>
                                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-rose-700">Threshold Breach Events</p>
                                        <p className="mt-1 text-sm text-rose-600">Total warning events during this session</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-4xl font-bold text-rose-600">{violations}</p>
                                        <p className="mt-1 text-xs font-semibold text-rose-700">event{violations !== 1 ? 's' : ''}</p>
                                    </div>
                                </div>
                            </div>

                            <div className="overflow-x-auto rounded-xl border border-slate-200">
                                <table className="w-full text-left text-sm">
                                    <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-[0.08em] text-slate-600">
                                        <tr>
                                            <th className="px-4 py-4 text-center">Timestamp</th>
                                            <th className="px-4 py-4 text-center">Intensity</th>
                                            <th className="px-4 py-4 text-center">Response</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 bg-white">
                                        {logs.map((log) => (
                                            <tr key={log.id} className="transition hover:bg-cyan-50/40">
                                                <td className="whitespace-nowrap px-4 py-4 text-center font-medium text-slate-600">
                                                    {formatTimestamp(log.timestamp)}
                                                </td>
                                                <td className="px-4 py-4 text-center font-semibold text-slate-900">
                                                    {log.average_level} dB
                                                </td>
                                                <td className="px-4 py-4 text-center">
                                                    {isWarningLog(log) ? (
                                                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600">
                                                            <AlertTriangle size={14} />
                                                            Threshold Breach
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500">
                                                            <ShieldCheck size={14} />
                                                            Normal State
                                                        </span>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}
                </div>

                <div className="border-t border-slate-100 bg-slate-50/50 px-6 py-4 text-right shrink-0">
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SessionNoiseEventsModal;