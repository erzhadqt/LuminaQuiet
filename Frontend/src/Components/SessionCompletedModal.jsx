import React from 'react';
import { CheckCircle2, FileText } from 'lucide-react';

const SessionCompletedModal = ({ isOpen, onClose, onViewLogs, sessionId, endedAt }) => {
    if (!isOpen) {
        return null;
    }

    const completedAtLabel = endedAt
        ? new Date(endedAt).toLocaleString()
        : 'Just now';

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 py-6 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-label="Session completed"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                    onClose();
                }
            }}
        >
            <div className="w-full max-w-md overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
                <div className="border-b border-slate-100 bg-linear-to-r from-emerald-50 to-cyan-50 px-6 py-5">
                    <div className="flex items-center gap-2 text-emerald-700">
                        <CheckCircle2 size={20} />
                        <h3 className="text-lg font-bold text-slate-900">Session Completed</h3>
                    </div>
                </div>

                <div className="space-y-5 px-6 py-6">
                    <p className="text-sm text-slate-700">
                        The session is completed and the scheduled time has run out.
                    </p>
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                        {sessionId ? `Session #${sessionId}` : 'Session'} ended at {completedAtLabel}
                    </p>

                    <div className="flex flex-wrap items-center justify-end gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
                        >
                            Done
                        </button>
                        <button
                            type="button"
                            onClick={onViewLogs}
                            className="inline-flex items-center gap-2 rounded-xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-700"
                        >
                            <FileText size={15} />
                            View Logs
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SessionCompletedModal;
