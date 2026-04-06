import { useState } from 'react';
import { X, Check } from 'lucide-react';
import api from '../services/api.js';

const PLATFORMS = ['Instagram', 'WhatsApp', 'Gmail', 'Facebook'];
const ACTIONS = ['Invoice Sent', 'Message Sent', 'Call Made', 'Meeting Set', 'Quote Sent'];
const STATUSES = ['New', 'Warm', 'Won', 'Lost'];

export default function AddLeadModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    name: '',
    platform: '',
    lastContactedAt: '',
    lastAction: '',
    status: 'New',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setError('Name is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await api.post('/api/leads', form);
      onCreated(res.data.lead);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create lead');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl p-8 relative">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-5 right-5 w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500"
        >
          <X size={16} />
        </button>

        <h2 className="text-2xl font-bold text-gray-900 text-center mb-8">Add Lead</h2>

        <div className="space-y-5">
          <Field label="NAME">
            <input
              type="text"
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
              placeholder="Enter lead name"
              className="w-full px-4 py-3 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="PLATFORM">
              <Select value={form.platform} onChange={(v) => update('platform', v)} options={PLATFORMS} placeholder="Choose platform" />
            </Field>
            <Field label="LAST CONTACTED ON">
              <input
                type="date"
                value={form.lastContactedAt}
                onChange={(e) => update('lastContactedAt', e.target.value)}
                className="w-full px-4 py-3 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="LAST ACTION">
              <Select value={form.lastAction} onChange={(v) => update('lastAction', v)} options={ACTIONS} placeholder="Choose last action" />
            </Field>
            <Field label="STATUS">
              <Select value={form.status} onChange={(v) => update('status', v)} options={STATUSES} placeholder="Choose lead status" />
            </Field>
          </div>
        </div>

        {error && <p className="text-sm text-red-500 mt-4 text-center">{error}</p>}

        <div className="flex justify-center mt-8">
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-10 py-3 bg-blue-500 hover:bg-blue-600 disabled:opacity-60 text-white text-sm font-semibold rounded-lg shadow-lg shadow-blue-500/20 transition"
          >
            <Check size={16} />
            {saving ? 'SAVING…' : 'DONE'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-500 tracking-wider mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function Select({ value, onChange, options, placeholder }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full px-4 py-3 bg-white border border-gray-200 rounded-lg text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none appearance-none ${value ? 'text-gray-900' : 'text-gray-400'}`}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e\")",
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 0.75rem center',
        backgroundSize: '1.1em',
      }}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}
