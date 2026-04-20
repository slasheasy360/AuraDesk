import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Check, X, Trash2, AlertTriangle } from 'lucide-react';
import api from '../services/api.js';

const TAX_RATE = 7;

function emptyItem() { return { description: '', quantity: 1, unitPrice: 0 }; }

function fmtMoney(n, cur = 'USD') {
  if (n == null || isNaN(n)) return '-';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

export default function CreateInvoicePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const leadIdParam = params.get('leadId');

  const [form, setForm] = useState({
    leadId: leadIdParam || '',
    clientName: '',
    clientEmail: '',
    clientPhone: '',
    billingAddress: '',
    issueDate: '',
    dueDate: '',
    note: '',
    currency: 'USD',
  });
  const [items, setItems] = useState([emptyItem()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [previewNumber, setPreviewNumber] = useState('INV-2025-001');
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [leadWarning, setLeadWarning] = useState(null); // { message, activeInvoiceId }

  // Pre-fill from lead and check for active invoices
  useEffect(() => {
    if (!leadIdParam) return;
    api.get('/api/leads').then((res) => {
      const lead = (res.data.leads || []).find((l) => l.id === leadIdParam);
      if (lead) {
        setForm((f) => ({
          ...f,
          clientName: lead.name || '',
          clientEmail: lead.email || '',
          clientPhone: lead.phone || '',
        }));
      }
    }).catch(() => {});

    // Check for active invoices on this lead
    api.get('/api/invoices', { params: { leadId: leadIdParam } }).then((res) => {
      const active = (res.data.invoices || []).find((i) => ['Draft', 'Sent', 'Overdue'].includes(i.status));
      if (active) {
        const msg =
          active.status === 'Draft'
            ? 'This lead has an unfinished draft invoice.'
            : active.status === 'Sent'
            ? 'This lead already has a sent invoice awaiting payment.'
            : 'This lead has an overdue invoice.';
        setLeadWarning({ message: msg, activeInvoiceId: active.id });
      }
    }).catch(() => {});
  }, [leadIdParam]);

  const totals = useMemo(() => {
    const subtotal = items.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0), 0);
    const tax = subtotal * (TAX_RATE / 100);
    return { subtotal, tax, total: subtotal + tax };
  }, [items]);

  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const updateItem = (i, k, v) => setItems((arr) => arr.map((it, idx) => idx === i ? { ...it, [k]: v } : it));
  const addItem = () => setItems((arr) => [...arr, emptyItem()]);
  const removeItem = (i) => setItems((arr) => arr.length > 1 ? arr.filter((_, idx) => idx !== i) : arr);

  const submit = async () => {
    setError('');
    if (!form.clientName.trim()) { setError('Client name required'); return; }
    if (!form.issueDate || !form.dueDate) { setError('Issue date and due date required'); return; }
    if (!items.some((it) => it.description && it.unitPrice)) { setError('Add at least one item'); return; }

    setSaving(true);
    try {
      const res = await api.post('/api/invoices', {
        ...form,
        leadId: form.leadId || null,
        taxRate: TAX_RATE,
        items,
      });
      navigate(`/invoices/${res.data.invoice.id}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create invoice');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 h-full bg-gray-50 overflow-y-auto">
      <div className="max-w-[1400px] mx-auto px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Create Invoice</h1>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowDiscardConfirm(true)}
              className="px-6 py-2.5 bg-white border border-gray-200 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              DISCARD
            </button>
            <button
              onClick={submit}
              disabled={saving}
              className="flex items-center gap-2 px-6 py-2.5 bg-blue-500 hover:bg-blue-600 disabled:opacity-60 text-white text-sm font-semibold rounded-lg shadow-lg shadow-blue-500/20"
            >
              <Check size={16} />
              {saving ? 'SAVING…' : 'DONE'}
            </button>
          </div>
        </div>

        {leadWarning && (
          <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3">
            <AlertTriangle size={16} className="text-amber-600 mt-0.5 shrink-0" />
            <div className="flex-1 text-sm text-amber-800">
              <span>{leadWarning.message}</span>
              {leadWarning.activeInvoiceId && (
                <button
                  onClick={() => navigate(`/invoices/${leadWarning.activeInvoiceId}`)}
                  className="ml-2 underline font-semibold hover:text-amber-900"
                >
                  View invoice →
                </button>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* LEFT: Form */}
          <div className="space-y-5">
            <FieldLabel required>CLIENT NAME</FieldLabel>
            <input type="text" value={form.clientName} onChange={(e) => update('clientName', e.target.value)} className={inputCls} />

            <div className="grid grid-cols-2 gap-4">
              <div>
                <FieldLabel required>CLIENT EMAIL</FieldLabel>
                <input type="email" value={form.clientEmail} onChange={(e) => update('clientEmail', e.target.value)} className={inputCls} />
              </div>
              <div>
                <FieldLabel required>CLIENT PHONE</FieldLabel>
                <input type="tel" value={form.clientPhone} onChange={(e) => update('clientPhone', e.target.value)} className={inputCls} />
              </div>
            </div>

            <div>
              <FieldLabel required>BILLING ADDRESS</FieldLabel>
              <input type="text" value={form.billingAddress} onChange={(e) => update('billingAddress', e.target.value)} className={inputCls} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <FieldLabel required>DATE ISSUED</FieldLabel>
                <input type="date" value={form.issueDate} onChange={(e) => update('issueDate', e.target.value)} className={inputCls} />
              </div>
              <div>
                <FieldLabel required>DUE DATE</FieldLabel>
                <input type="date" value={form.dueDate} onChange={(e) => update('dueDate', e.target.value)} className={inputCls} />
              </div>
            </div>

            <div>
              <FieldLabel>NOTE</FieldLabel>
              <textarea rows={3} value={form.note} onChange={(e) => update('note', e.target.value)} className={inputCls} />
            </div>

            {/* Items */}
            <div className="pt-4">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Items</h3>
              <div className="space-y-3">
                <div className="grid grid-cols-12 gap-3 text-xs font-semibold text-gray-500 uppercase">
                  <div className="col-span-6">Description</div>
                  <div className="col-span-2">Qty</div>
                  <div className="col-span-3">Unit Price</div>
                  <div className="col-span-1"></div>
                </div>
                {items.map((it, i) => (
                  <div key={i} className="grid grid-cols-12 gap-3 items-center">
                    <input value={it.description} onChange={(e) => updateItem(i, 'description', e.target.value)} className={`${inputCls} col-span-6`} />
                    <input type="number" min="0" value={it.quantity} onChange={(e) => updateItem(i, 'quantity', e.target.value)} className={`${inputCls} col-span-2`} />
                    <input type="number" min="0" step="0.01" value={it.unitPrice} onChange={(e) => updateItem(i, 'unitPrice', e.target.value)} className={`${inputCls} col-span-3`} />
                    <button type="button" onClick={() => removeItem(i)} className="col-span-1 flex justify-center text-gray-400 hover:text-red-500">
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                <button type="button" onClick={addItem} className="flex items-center gap-2 px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-50">
                  <Plus size={14} /> ADD ANOTHER
                </button>
              </div>
            </div>
          </div>

          {/* RIGHT: Live Preview */}
          <div className="lg:sticky lg:top-8 lg:self-start">
            <InvoicePreview form={form} items={items} totals={totals} number={previewNumber} />
          </div>
        </div>
      </div>

      {showDiscardConfirm && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4">
          <div className="w-full max-w-md bg-white rounded-2xl p-8 shadow-2xl">
            <h2 className="text-xl font-bold text-gray-900 mb-3">Discard Invoice?</h2>
            <p className="text-sm text-gray-600 mb-6">All unsaved changes will be lost. Are you sure you want to exit?</p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowDiscardConfirm(false)}
                className="flex-1 px-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Keep Editing
              </button>
              <button
                type="button"
                onClick={() => navigate('/invoices')}
                className="flex-1 px-4 py-2.5 bg-red-500 hover:bg-red-600 text-white text-sm font-semibold rounded-lg"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inputCls = 'w-full px-4 py-3 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none';

function FieldLabel({ children, required }) {
  return (
    <label className="block text-xs font-semibold text-gray-500 tracking-wider mb-1.5">
      {children} {required && <span className="text-red-500">*</span>}
    </label>
  );
}

function InvoicePreview({ form, items, totals, number }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8">
      <div className="flex justify-between items-start mb-6">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 bg-blue-50 rounded-xl flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8"><path d="M12 3 L3 20 L21 20 Z" stroke="#3b82f6" strokeWidth="2" strokeLinejoin="round" /></svg>
          </div>
          <div>
            <h3 className="font-bold text-gray-900">AuraDesk</h3>
            <p className="text-xs text-gray-600">John Brandon</p>
            <p className="text-xs text-gray-600">123 Business Street, Naples, FL</p>
            <p className="text-xs text-gray-600">+1-555-123-4567 | <a className="text-blue-500 underline">billing@auradesk.com</a></p>
            <p className="text-xs text-gray-600">Tax ID: 12-3456789</p>
          </div>
        </div>
        <div className="text-right">
          <span className="px-3 py-1 bg-gray-100 rounded text-xs font-mono text-gray-700">#{number}</span>
          <p className="text-xs text-gray-500 mt-3">Total Amount</p>
          <p className="text-base font-bold text-gray-900">{totals.total > 0 ? fmtMoney(totals.total, form.currency) : '-'}</p>
        </div>
      </div>

      <div className="border border-gray-200 rounded-lg p-5 mb-5">
        <div className="grid grid-cols-2 gap-6">
          <div>
            <div className="bg-gray-50 -m-5 mb-3 p-5 rounded-t-lg">
              <p className="text-xs text-gray-500 mb-1">Invoice No</p>
              <p className="font-bold text-gray-900">{number}</p>
              <p className="text-xs text-gray-500 mt-3 mb-1">Date Issued</p>
              <p className="text-sm text-gray-700">{form.issueDate || '-'}</p>
              <p className="text-xs text-gray-500 mt-3 mb-1">Due Date</p>
              <p className="text-sm text-gray-700">{form.dueDate || '-'}</p>
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">Billing Address</p>
            <p className="text-sm text-gray-900 font-semibold">{form.clientName || '-'}</p>
            <p className="text-xs text-gray-600">{form.billingAddress || '-'}</p>
            <p className="text-xs text-gray-600">{form.clientPhone}</p>
            <p className="text-xs text-gray-600">{form.clientEmail}</p>
            <p className="text-xs text-gray-500 mt-3 mb-1">Note</p>
            <p className="text-xs text-gray-700">{form.note || '-'}</p>
          </div>
        </div>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-gray-500 uppercase bg-gray-50">
            <th className="text-left px-3 py-2">No.</th>
            <th className="text-left px-3 py-2">Description</th>
            <th className="text-right px-3 py-2">Quantity</th>
            <th className="text-right px-3 py-2">Unit Price</th>
            <th className="text-right px-3 py-2">Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i} className="border-b border-gray-100">
              <td className="px-3 py-2 text-gray-600">{i + 1}</td>
              <td className="px-3 py-2 text-gray-900">{it.description || '-'}</td>
              <td className="px-3 py-2 text-right text-gray-700">{it.quantity || '-'}</td>
              <td className="px-3 py-2 text-right text-gray-700">{it.unitPrice ? fmtMoney(Number(it.unitPrice), form.currency) : '-'}</td>
              <td className="px-3 py-2 text-right text-gray-900 font-medium">{(Number(it.quantity) * Number(it.unitPrice)) ? fmtMoney(Number(it.quantity) * Number(it.unitPrice), form.currency) : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex justify-end mt-4">
        <div className="w-64 space-y-2 text-sm">
          <div className="flex justify-between text-gray-600"><span>Subtotal</span><span>{fmtMoney(totals.subtotal, form.currency)}</span></div>
          <div className="flex justify-between text-gray-600"><span>Tax ({TAX_RATE}%)</span><span>{fmtMoney(totals.tax, form.currency)}</span></div>
          <div className="flex justify-between font-bold text-gray-900 pt-2 border-t border-gray-200"><span>Total Due</span><span>{fmtMoney(totals.total, form.currency)}</span></div>
        </div>
      </div>

      <div className="mt-6 pt-4 border-t border-gray-100 text-xs text-gray-600 space-y-1">
        <p className="font-semibold text-gray-900">Payment Methods:</p>
        <p>Bank Transfer: Account #123456, Routing #789101</p>
      </div>
    </div>
  );
}
