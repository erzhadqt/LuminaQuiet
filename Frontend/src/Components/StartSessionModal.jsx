import React, { useEffect, useMemo, useState } from 'react';
import { Timer, X } from 'lucide-react';

const DEFAULT_VALUES = {
  durationMinutes: 15,
  quiet: 800,
  medium: 1500,
  high: 2500,
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

    // Reset modal form state when opened with fresh defaults.
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

  if (!isOpen) {
    return null;
  }

  const canSubmit = !isSubmitting && form.durationMinutes > 0 && thresholdsOrdered;

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
      setLocalError('Duration must be greater than 0 minutes.');
      return;
    }
    if (!thresholdsOrdered) {
      setLocalError('Threshold order must be Quiet < Medium < High.');
      return;
    }

    await onStartSession(form);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Start session"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSubmitting) {
          onClose();
        }
      }}
    >
      <div className="w-full max-w-xl rounded-2xl bg-white shadow-2xl border border-slate-200">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Timer size={18} className="text-blue-600" /> Start Session
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        <form className="space-y-4 px-6 py-5" onSubmit={handleSubmit}>
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-700">How long will the session be? (minutes)</label>
            <input
              type="number"
              min="1"
              max="720"
              value={form.durationMinutes}
              onChange={handleFieldChange('durationMinutes')}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-700">Quiet Threshold</label>
              <input
                type="number"
                min="0"
                max="4095"
                value={form.quiet}
                onChange={handleFieldChange('quiet')}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-700">Medium Threshold</label>
              <input
                type="number"
                min="0"
                max="4095"
                value={form.medium}
                onChange={handleFieldChange('medium')}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-700">High Threshold</label>
              <input
                type="number"
                min="0"
                max="4095"
                value={form.high}
                onChange={handleFieldChange('high')}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
          </div>

          {!thresholdsOrdered && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              Threshold order must be Quiet {'<'} Medium {'<'} High.
            </p>
          )}

          {(localError || errorMessage) && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {localError || errorMessage}
            </p>
          )}

          <div className="pt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className={`rounded-lg px-4 py-2 text-sm font-semibold text-white ${
                canSubmit ? 'bg-blue-600 hover:bg-blue-700' : 'bg-slate-300 cursor-not-allowed'
              }`}
            >
              {isSubmitting ? 'Starting...' : 'Start Session'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default StartSessionModal;