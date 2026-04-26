import React, { useEffect, useMemo, useState } from 'react';
import { Timer, X, SlidersHorizontal } from 'lucide-react';

const DEFAULT_VALUES = {
    durationMinutes: 15,
    quiet: 800,
    medium: 1500,
    high: 2500,
};

const DURATION_RECOMMENDATIONS = [
    { label: '1 hour', minutes: 60 },
    { label: '1 hour 30 minutes', minutes: 90 },
    { label: '2 hours', minutes: 120 },
    { label: '3 hours', minutes: 180 },
];

// Helper to convert minutes to a readable hour/minute string
const formatDurationPreview = (totalMinutes) => {
    if (!totalMinutes || totalMinutes <= 0) return '0m';
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h`;
    return `${minutes}m`;
};

const StartSessionModal = ({
    isOpen,
    isSubmitting,
    onClose,
    onStartSession,
    initialValues,
    errorMessage,
}) => {
    const [form, setForm] = useState(DEFAULT_VALUES);
    const [localError, setLocalError] = useState('');

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        // Reset form state when opening to prevent stale values.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setForm({
            durationMinutes: Number(initialValues?.durationMinutes ?? DEFAULT_VALUES.durationMinutes),
            quiet: Number(initialValues?.quiet ?? DEFAULT_VALUES.quiet),
            medium: Number(initialValues?.medium ?? DEFAULT_VALUES.medium),
            high: Number(initialValues?.high ?? DEFAULT_VALUES.high),
        });
        setLocalError('');
    }, [initialValues, isOpen]);

    const thresholdsOrdered = useMemo(
        () => form.quiet < form.medium && form.medium < form.high,
        [form.high, form.medium, form.quiet]
    );

    const withinAdcRange = useMemo(
        () => form.quiet >= 0 && form.high <= 4095,
        [form.high, form.quiet]
    );

    if (!isOpen) {
        return null;
    }

    const canSubmit = !isSubmitting && form.durationMinutes > 0 && thresholdsOrdered && withinAdcRange;

    const handleFieldChange = (name) => (event) => {
        const numericValue = Number(event.target.value);
        setForm((previous) => ({
            ...previous,
            [name]: Number.isFinite(numericValue) ? numericValue : 0,
        }));
        setLocalError('');
    };

    const handleSubmit = async (event) => {
        event.preventDefault();

        if (form.durationMinutes <= 0) {
            setLocalError('Session duration must be greater than 0 minutes.');
            return;
        }
        if (!thresholdsOrdered) {
            setLocalError('Threshold order must be Quiet < Medium < High.');
            return;
        }
        if (!withinAdcRange) {
            setLocalError('Thresholds must stay within 0 ADC to 4095 ADC.');
            return;
        }

        await onStartSession(form);
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 py-6 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-label="Start session"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget && !isSubmitting) {
                    onClose();
                }
            }}
        >
            <div className="w-full max-w-2xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
                <div className="border-b border-slate-100 bg-linear-to-r from-cyan-50 to-slate-50 px-6 py-5 md:px-7">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <h3 className="flex items-center gap-2 text-lg font-bold text-slate-900 md:text-xl">
                                <Timer size={18} className="text-cyan-700" />
                                Start Monitoring Session
                            </h3>
                            <p className="mt-1 text-sm text-slate-600">
                                Define duration and threshold ranges before the system starts automated monitoring.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={isSubmitting}
                            className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                            aria-label="Close modal"
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>

                <form className="space-y-5 px-6 py-5 md:px-7 md:py-6" onSubmit={handleSubmit}>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">

                        {/* Live Preview Header Added Here */}
                        <div className="mb-2 flex items-center justify-between">
                            <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                                Session Duration (Minutes)
                            </label>
                            <span className="rounded-md border border-cyan-200 bg-cyan-100 px-2 py-0.5 text-xs font-bold text-cyan-800 shadow-xs">
                                ≈ {formatDurationPreview(form.durationMinutes)}
                            </span>
                        </div>

                        <input
                            type="number"
                            min="1"
                            max="720"
                            value={form.durationMinutes}
                            onChange={handleFieldChange('durationMinutes')}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-800 outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-200"
                            required
                        />

                        <div className="mt-3">
                            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Recommendations</p>
                            <div className="flex flex-wrap gap-2">
                                {DURATION_RECOMMENDATIONS.map((option) => {
                                    const isSelected = form.durationMinutes === option.minutes;

                                    return (
                                        <button
                                            key={option.minutes}
                                            type="button"
                                            disabled={isSubmitting}
                                            onClick={() => {
                                                setForm((previous) => ({
                                                    ...previous,
                                                    durationMinutes: option.minutes,
                                                }));
                                                setLocalError('');
                                            }}
                                            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${isSelected
                                                ? 'border-cyan-300 bg-cyan-100 text-cyan-800'
                                                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-100'
                                                } disabled:cursor-not-allowed disabled:opacity-50`}
                                        >
                                            {option.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                        <div className="mb-3 flex items-center gap-2">
                            <SlidersHorizontal size={16} className="text-cyan-700" />
                            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Threshold Configuration (ADC)</p>
                        </div>

                        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                            <div>
                                <label className="mb-1 block text-sm font-semibold text-slate-700">Quiet (ADC)</label>
                                <input
                                    type="number"
                                    min="0"
                                    max="4095"
                                    value={form.quiet}
                                    onChange={handleFieldChange('quiet')}
                                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-200"
                                    required
                                />
                            </div>

                            <div>
                                <label className="mb-1 block text-sm font-semibold text-slate-700">Medium (ADC)</label>
                                <input
                                    type="number"
                                    min="0"
                                    max="4095"
                                    value={form.medium}
                                    onChange={handleFieldChange('medium')}
                                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-200"
                                    required
                                />
                            </div>

                            <div>
                                <label className="mb-1 block text-sm font-semibold text-slate-700">High (ADC)</label>
                                <input
                                    type="number"
                                    min="0"
                                    max="4095"
                                    value={form.high}
                                    onChange={handleFieldChange('high')}
                                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-200"
                                    required
                                />
                            </div>
                        </div>
                    </div>

                    {!thresholdsOrdered && (
                        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">
                            Threshold order must be Quiet {'<'} Medium {'<'} High.
                        </p>
                    )}

                    {!withinAdcRange && (
                        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">
                            Thresholds must stay between 0 ADC and 4095 ADC.
                        </p>
                    )}

                    {(localError || errorMessage) && (
                        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">
                            {localError || errorMessage}
                        </p>
                    )}

                    <div className="flex items-center justify-end gap-3 pt-1">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={isSubmitting}
                            className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={!canSubmit}
                            className={`rounded-xl px-4 py-2 text-sm font-semibold text-white transition ${canSubmit ? 'bg-cyan-600 hover:bg-cyan-700' : 'cursor-not-allowed bg-slate-300'
                                }`}
                        >
                            {isSubmitting ? 'Starting Session...' : 'Start Session'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default StartSessionModal;