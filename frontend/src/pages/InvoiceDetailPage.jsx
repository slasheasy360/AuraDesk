import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Send, Clock, Plus, Trash2, Link as LinkIcon, Check, X } from 'lucide-react';
import api from '../services/api.js';

function fmtDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtMoney(n, cur = 'USD') {
  if (n == null) return '-';
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(n); }
  catch { return `$${Number(n).toFixed(2)}`; }
}

const STATUS_STYLES = {
  Draft: 'bg-gray-100 text-gray-700 border-gray-200',
  Sent: 'bg-blue-50 text-blue-700 border-blue-200',
  Paid: 'bg-green-50 text-green-700 border-green-200',
  Overdue: 'bg-amber-50 text-amber-700 border-amber-200',
  Cancelled: 'bg-gray-50 text-gray-500 border-gray-300',
};

const inputCls = 'w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none';

export default function InvoiceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showPayment, setShowPayment] = useState(false);
  const [showSendConfirm, setShowSendConfirm] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [copied, setCopied] = useState(false);
  const [actionError, setActionError] = useState('');
  const [actioning, setActioning] = useState(false);

  // Draft editing state
  const [draft, setDraft] = useState(null);
  const [unsaved, setUnsaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const draftRef = useRef(null);
  const invoiceStatusRef = useRef(null);

  // Keep refs current for auto-save timer
  useEffect(() => { draftRef.current = draft; }, [draft]);
  useEffect(() => { invoiceStatusRef.current = invoice?.status; }, [invoice?.status]);

  const fetchInvoice = useCallback(async () => {
    try {
      const res = await api.get(`/api/invoices/${id}`);
      setInvoice(res.data.invoice);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { fetchInvoice(); }, [fetchInvoice]);

  // Initialize draft only when loading a new invoice (id change)
  useEffect(() => {
    if (!invoice) return;
    setDraft({
      clientName: invoice.clientName || '',
      clientEmail: invoice.clientEmail || '',
      clientPhone: invoice.clientPhone || '',
      billingAddress: invoice.billingAddress || '',
      issueDate: invoice.issueDate ? invoice.issueDate.slice(0, 10) : '',
      dueDate: invoice.dueDate ? invoice.dueDate.slice(0, 10) : '',
      note: invoice.note || '',
      currency: invoice.currency || 'USD',
      taxRate: invoice.taxRate ?? 0,
      items: (invoice.items || []).map((it) => ({
        description: it.description,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        position: it.position,
      })),
    });
    setUnsaved(false);
  }, [invoice?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save every 30s when unsaved changes exist on a Draft invoice
  useEffect(() => {
    if (!unsaved || !invoice || invoice.status !== 'Draft') return;
    const timer = setInterval(async () => {
      if (!draftRef.current || invoiceStatusRef.current !== 'Draft') return;
      setSaving(true);
      try {
        const res = await api.patch(`/api/invoices/${id}`, draftRef.current);
        setInvoice(res.data.invoice);
        setUnsaved(false);
      } catch (e) { console.error('Auto-save failed:', e); }
      finally { setSaving(false); }
    }, 30000);
    return () => clearInterval(timer);
  }, [unsaved, invoice?.status, id]);

  const totals = useMemo(() => {
    if (!draft) return null;
    const subtotal = draft.items.reduce((s, it) =>
      s + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0), 0
    );
    const taxAmt = +(subtotal * ((Number(draft.taxRate) || 0) / 100)).toFixed(2);
    return { subtotal: +subtotal.toFixed(2), taxAmount: taxAmt, total: +(subtotal + taxAmt).toFixed(2) };
  }, [draft]);

  const updateDraft = (key, value) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setUnsaved(true);
  };

  const updateItem = (i, key, value) => {
    setDraft((d) => ({
      ...d,
      items: d.items.map((it, idx) => idx === i ? { ...it, [key]: value } : it),
    }));
    setUnsaved(true);
  };

  const addItem = () => {
    setDraft((d) => ({ ...d, items: [...d.items, { description: '', quantity: 1, unitPrice: 0 }] }));
    setUnsaved(true);
  };

  const removeItem = (i) => {
    setDraft((d) => ({
      ...d,
      items: d.items.length > 1 ? d.items.filter((_, idx) => idx !== i) : d.items,
    }));
    setUnsaved(true);
  };

  const saveDraft = useCallback(async () => {
    if (!draftRef.current || invoiceStatusRef.current !== 'Draft' || saving) return;
    setSaving(true);
    try {
      const res = await api.patch(`/api/invoices/${id}`, draftRef.current);
      setInvoice(res.data.invoice);
      setUnsaved(false);
    } catch (e) { console.error('Save failed:', e); }
    finally { setSaving(false); }
  }, [id, saving]);

  const sendInvoice = async () => {
    setActioning(true);
    setActionError('');
    try {
      if (unsaved) {
        const res = await api.patch(`/api/invoices/${id}`, draftRef.current);
        setInvoice(res.data.invoice);
        setUnsaved(false);
      }
      const res = await api.post(`/api/invoices/${id}/send`);
      setInvoice(res.data.invoice);
      setShowSendConfirm(false);
    } catch (e) {
      setActionError(e.response?.data?.error || 'Failed to send invoice');
    } finally { setActioning(false); }
  };

  const cancelInvoice = async () => {
    setActioning(true);
    setActionError('');
    try {
      const res = await api.patch(`/api/invoices/${id}/cancel`);
      setInvoice(res.data.invoice);
      setShowCancelConfirm(false);
    } catch (e) {
      setActionError(e.response?.data?.error || 'Failed to cancel invoice');
    } finally { setActioning(false); }
  };

  const deleteDraft = async () => {
    setActioning(true);
    setActionError('');
    try {
      await api.delete(`/api/invoices/${id}`);
      navigate('/invoices');
    } catch (e) {
      setActionError(e.response?.data?.error || 'Failed to delete invoice');
      setActioning(false);
    }
  };

  const copyLink = () => {
    const link = `${window.location.origin}/i/${invoice.publicSlug}`;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) return <div className="flex-1 bg-[#0c1a2e] flex items-center justify-center text-gray-400">Loading…</div>;
  if (!invoice) return <div className="flex-1 bg-[#0c1a2e] flex items-center justify-center text-gray-400">Invoice not found</div>;

  const isDraft = invoice.status === 'Draft';
  const displayCurrency = isDraft ? (draft?.currency || 'USD') : invoice.currency;

  return (
    <div className="flex-1 h-full bg-[#0c1a2e] overflow-y-auto">
      <div className="px-8 py-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => { if (unsaved && isDraft) saveDraft(); navigate('/invoices'); }}
            className="w-9 h-9 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-white"
          >
            <ArrowLeft size={16} />
          </button>
          <div>
            <h1 className="text-xl font-bold text-white">Invoice #{invoice.invoiceNumber}</h1>
            <p className="text-xs text-gray-400 mt-0.5">
              {isDraft
                ? saving ? 'Saving…' : unsaved ? 'Unsaved changes' : 'All changes saved'
                : `Due on ${fmtDate(invoice.dueDate)}`}
            </p>
          </div>
          {isDraft ? (
            <button
              onClick={saveDraft}
              disabled={!unsaved || saving}
              className="ml-auto flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 disabled:opacity-40 rounded-lg text-sm font-semibold text-white"
            >
              {saving ? 'Saving…' : 'Save Draft'}
            </button>
          ) : (
            <button
              onClick={copyLink}
              className="ml-auto flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm font-semibold text-white"
            >
              {copied ? <Check size={14} /> : <LinkIcon size={14} />}
              {copied ? 'COPIED' : 'COPY LINK'}
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Invoice card */}
          <div className="lg:col-span-2 bg-white rounded-2xl shadow-2xl p-8">
            {/* Company info — static */}
            <div className="flex justify-between items-start mb-6">
              <div className="flex items-start gap-4">
                <div className="w-14 h-14 bg-blue-50 rounded-xl flex items-center justify-center">
                  <svg viewBox="0 0 24 24" className="w-8 h-8"><path d="M12 3 L3 20 L21 20 Z" stroke="#3b82f6" strokeWidth="2" fill="none" strokeLinejoin="round" /></svg>
                </div>
                <div>
                  <h3 className="font-bold text-gray-900">AuraDesk</h3>
                  <p className="text-xs text-gray-600">John Brandon</p>
                  <p className="text-xs text-gray-600">123 Business Street, Naples, FL</p>
                  <p className="text-xs text-gray-600">+1-555-123-4567 | <span className="text-blue-500 underline">billing@auradesk.com</span></p>
                  <p className="text-xs text-gray-600">Tax ID: 12-3456789</p>
                </div>
              </div>
              <div className="text-right">
                <span className="px-3 py-1 bg-gray-100 rounded text-xs font-mono text-gray-700">#{invoice.invoiceNumber}</span>
                <p className="text-xs text-gray-500 mt-3">Total Amount</p>
                <p className="text-lg font-bold text-gray-900">{fmtMoney(isDraft ? totals?.total : invoice.total, displayCurrency)}</p>
              </div>
            </div>

            {/* Client info */}
            <div className="border border-gray-200 rounded-lg p-5 mb-5">
              <div className="grid grid-cols-2 gap-6">
                <div className="bg-gray-50 -m-5 mr-0 p-5 rounded-l-lg">
                  <p className="text-xs text-gray-500 mb-1">Invoice No</p>
                  <p className="font-bold text-gray-900">{invoice.invoiceNumber}</p>
                  <p className="text-xs text-gray-500 mt-3 mb-1">Date Issued</p>
                  {isDraft
                    ? <input type="date" value={draft?.issueDate || ''} onChange={(e) => updateDraft('issueDate', e.target.value)} className={inputCls} />
                    : <p className="text-sm text-gray-700">{fmtDate(invoice.issueDate)}</p>}
                  <p className="text-xs text-gray-500 mt-3 mb-1">Due Date</p>
                  {isDraft
                    ? <input type="date" value={draft?.dueDate || ''} onChange={(e) => updateDraft('dueDate', e.target.value)} className={inputCls} />
                    : <p className="text-sm text-gray-700">{fmtDate(invoice.dueDate)}</p>}
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">Billing Address</p>
                  {isDraft ? (
                    <div className="space-y-2">
                      <input value={draft?.clientName || ''} onChange={(e) => updateDraft('clientName', e.target.value)} placeholder="Client name" className={inputCls} />
                      <input value={draft?.clientEmail || ''} onChange={(e) => updateDraft('clientEmail', e.target.value)} placeholder="Email" type="email" className={inputCls} />
                      <input value={draft?.clientPhone || ''} onChange={(e) => updateDraft('clientPhone', e.target.value)} placeholder="Phone" className={inputCls} />
                      <input value={draft?.billingAddress || ''} onChange={(e) => updateDraft('billingAddress', e.target.value)} placeholder="Billing address" className={inputCls} />
                    </div>
                  ) : (
                    <>
                      <p className="text-sm text-gray-900 font-semibold">{invoice.clientName}</p>
                      <p className="text-xs text-gray-600">{invoice.billingAddress}</p>
                      <p className="text-xs text-gray-600">{invoice.clientPhone}</p>
                      <p className="text-xs text-gray-600">{invoice.clientEmail}</p>
                    </>
                  )}
                  {(isDraft || invoice.note) && (
                    <>
                      <p className="text-xs text-gray-500 mt-3 mb-1">Note</p>
                      {isDraft
                        ? <textarea rows={2} value={draft?.note || ''} onChange={(e) => updateDraft('note', e.target.value)} placeholder="Optional note…" className={inputCls} />
                        : <p className="text-xs text-gray-700">{invoice.note}</p>}
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Items */}
            {isDraft ? (
              <div>
                <div className="grid grid-cols-12 gap-2 text-xs font-semibold text-gray-500 uppercase px-1 pb-2">
                  <div className="col-span-1 text-center">#</div>
                  <div className="col-span-5">Description</div>
                  <div className="col-span-2 text-right">Qty</div>
                  <div className="col-span-3 text-right">Unit Price</div>
                  <div className="col-span-1"></div>
                </div>
                {(draft?.items || []).map((it, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-center mb-2">
                    <div className="col-span-1 text-sm text-gray-400 text-center">{i + 1}</div>
                    <input value={it.description} onChange={(e) => updateItem(i, 'description', e.target.value)} className={`${inputCls} col-span-5`} placeholder="Item description" />
                    <input type="number" min="0" value={it.quantity} onChange={(e) => updateItem(i, 'quantity', e.target.value)} className={`${inputCls} col-span-2`} />
                    <input type="number" min="0" step="0.01" value={it.unitPrice} onChange={(e) => updateItem(i, 'unitPrice', e.target.value)} className={`${inputCls} col-span-3`} />
                    <button type="button" onClick={() => removeItem(i)} className="col-span-1 flex justify-center text-gray-300 hover:text-red-500"><Trash2 size={14} /></button>
                  </div>
                ))}
                <button type="button" onClick={addItem} className="flex items-center gap-2 mt-2 px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
                  <Plus size={14} /> Add item
                </button>
              </div>
            ) : (
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
                  {invoice.items.map((it, i) => (
                    <tr key={it.id} className="border-b border-gray-100">
                      <td className="px-3 py-3 text-gray-600">{i + 1}</td>
                      <td className="px-3 py-3 text-gray-900">{it.description}</td>
                      <td className="px-3 py-3 text-right text-gray-700">{it.quantity}</td>
                      <td className="px-3 py-3 text-right text-gray-700">{fmtMoney(it.unitPrice, invoice.currency)}</td>
                      <td className="px-3 py-3 text-right text-gray-900 font-medium">{fmtMoney(it.amount, invoice.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="flex justify-end mt-4">
              <div className="w-64 space-y-2 text-sm">
                <div className="flex justify-between text-gray-600">
                  <span>Subtotal</span>
                  <span>{fmtMoney(isDraft ? totals?.subtotal : invoice.subtotal, displayCurrency)}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Tax ({isDraft ? draft?.taxRate : invoice.taxRate}%)</span>
                  <span>{fmtMoney(isDraft ? totals?.taxAmount : invoice.taxAmount, displayCurrency)}</span>
                </div>
                <div className="flex justify-between font-bold text-gray-900 pt-2 border-t">
                  <span>Total Due</span>
                  <span>{fmtMoney(isDraft ? totals?.total : invoice.total, displayCurrency)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            <div className={`p-3 rounded-lg border text-center font-semibold text-sm ${STATUS_STYLES[invoice.status] || 'bg-gray-100 text-gray-700 border-gray-200'}`}>
              <Clock size={14} className="inline mr-1.5" />
              {invoice.status}
            </div>

            {(isDraft || invoice.status === 'Sent') && (
              <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
                <button
                  onClick={() => { if (isDraft) { setActionError(''); setShowSendConfirm(true); } }}
                  disabled={!isDraft}
                  className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 text-white text-sm font-semibold rounded-lg shadow ${isDraft ? 'bg-blue-500 hover:bg-blue-600' : 'bg-green-500 cursor-default'}`}
                >
                  {isDraft ? <><Send size={14} /> Send to Client</> : <><Check size={14} /> Sent to Client</>}
                </button>
                {isDraft && (
                  <button
                    onClick={() => { setActionError(''); setShowDeleteConfirm(true); }}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-white hover:bg-red-50 border border-red-200 text-red-600 text-sm font-semibold rounded-lg"
                  >
                    <Trash2 size={14} /> Delete Draft
                  </button>
                )}
              </div>
            )}

            {(invoice.status === 'Sent' || invoice.status === 'Overdue') && (
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <button
                  onClick={() => { setActionError(''); setShowCancelConfirm(true); }}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-white hover:bg-red-50 border border-red-200 text-red-600 text-sm font-semibold rounded-lg"
                >
                  <X size={14} /> Cancel Invoice
                </button>
              </div>
            )}

            {!isDraft && invoice.status !== 'Cancelled' && (
              <>
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h4 className="font-bold text-gray-900 mb-4">Summary</h4>
                  <div className="flex justify-between items-center pb-3 border-b border-gray-100">
                    <span className="text-sm text-gray-600">Total</span>
                    <span className="font-bold text-gray-900">{fmtMoney(invoice.total, invoice.currency)}</span>
                  </div>
                  <div className="mt-4 space-y-4">
                    {invoice.payments.length === 0 && (
                      <p className="text-xs text-gray-400 text-center py-2">No payments recorded</p>
                    )}
                    {invoice.payments.map((p, i) => (
                      <PaymentRow
                        key={p.id}
                        payment={p}
                        index={i}
                        currency={invoice.currency}
                        onDelete={async () => {
                          await api.delete(`/api/invoices/${id}/payments/${p.id}`);
                          fetchInvoice();
                        }}
                      />
                    ))}
                  </div>
                  {invoice.remaining > 0 && (
                    <div className="flex justify-between items-center mt-4 pt-3 border-t border-gray-100">
                      <span className="text-sm text-gray-600">Remaining Amount</span>
                      <span className="px-2 py-1 bg-amber-50 text-amber-700 rounded text-xs font-semibold">{fmtMoney(invoice.remaining, invoice.currency)}</span>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setShowPayment(true)}
                  disabled={invoice.remaining <= 0}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-white hover:bg-gray-50 disabled:opacity-50 border border-gray-200 rounded-lg text-sm font-semibold text-gray-700"
                >
                  <Plus size={14} /> Record a Payment
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {showPayment && (
        <RecordPaymentModal
          invoice={invoice}
          onClose={() => setShowPayment(false)}
          onSaved={() => { setShowPayment(false); fetchInvoice(); }}
        />
      )}

      {showSendConfirm && (
        <ConfirmModal
          title="Send Invoice to Client"
          message={`Send invoice ${invoice.invoiceNumber} to ${draft?.clientEmail || invoice.clientEmail || '(no email set)'}? The invoice will be locked for editing once sent.`}
          confirmLabel="Send Invoice"
          confirmClass="bg-blue-500 hover:bg-blue-600 text-white"
          onConfirm={sendInvoice}
          onCancel={() => { setShowSendConfirm(false); setActionError(''); }}
          loading={actioning}
          error={actionError}
        />
      )}

      {showCancelConfirm && (
        <ConfirmModal
          title="Cancel Invoice"
          message={`Are you sure you want to cancel invoice ${invoice.invoiceNumber}? This action cannot be undone.`}
          confirmLabel="Cancel Invoice"
          confirmClass="bg-red-500 hover:bg-red-600 text-white"
          onConfirm={cancelInvoice}
          onCancel={() => { setShowCancelConfirm(false); setActionError(''); }}
          loading={actioning}
          error={actionError}
        />
      )}

      {showDeleteConfirm && (
        <ConfirmModal
          title="Delete Draft"
          message="Permanently delete this draft invoice? This action cannot be undone."
          confirmLabel="Delete"
          confirmClass="bg-red-500 hover:bg-red-600 text-white"
          onConfirm={deleteDraft}
          onCancel={() => { setShowDeleteConfirm(false); setActionError(''); }}
          loading={actioning}
          error={actionError}
        />
      )}
    </div>
  );
}

function ConfirmModal({ title, message, confirmLabel, confirmClass, onConfirm, onCancel, loading, error }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white rounded-2xl p-8 shadow-2xl">
        <h2 className="text-xl font-bold text-gray-900 mb-3">{title}</h2>
        <p className="text-sm text-gray-600 mb-6">{message}</p>
        {error && <p className="text-sm text-red-500 mb-4">{error}</p>}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="flex-1 px-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-60 ${confirmClass}`}
          >
            {loading ? 'Please wait…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function PaymentRow({ payment, index, currency, onDelete }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-2 h-2 rounded-full bg-green-500 mt-1.5" />
      <div className="flex-1">
        <p className="text-sm font-semibold text-gray-900">
          {payment.type === 'Deposit' ? `Deposit No. ${String(index + 1).padStart(4, '0')}` : payment.type === 'Full' ? 'Full Payment' : 'Partial Payment'}
        </p>
        <div className="flex justify-between text-xs text-gray-600 mt-1">
          <span>Date</span><span>{new Date(payment.date).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
        </div>
        <div className="flex justify-between text-xs text-gray-600 mt-0.5">
          <span>Amount</span><span className="font-semibold">{new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(payment.amount)}</span>
        </div>
      </div>
      <button onClick={onDelete} className="text-gray-300 hover:text-red-500"><Trash2 size={12} /></button>
    </div>
  );
}

function RecordPaymentModal({ invoice, onClose, onSaved }) {
  const [amount, setAmount] = useState(invoice.remaining || '');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [type, setType] = useState('Partial');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.post(`/api/invoices/${invoice.id}/payments`, { amount: Number(amount), date, type });
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to record payment');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-md bg-white rounded-2xl p-8 shadow-2xl">
        <h2 className="text-xl font-bold mb-6">Record a Payment</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Amount</label>
            <input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)}
              className="w-full px-4 py-3 bg-white border border-gray-200 rounded-lg text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none" />
            <p className="text-xs text-gray-500 mt-1">Remaining: {new Intl.NumberFormat('en-US', { style: 'currency', currency: invoice.currency }).format(invoice.remaining)}</p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="w-full px-4 py-3 bg-white border border-gray-200 rounded-lg text-sm focus:border-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Type</label>
            <select value={type} onChange={(e) => setType(e.target.value)}
              className="w-full px-4 py-3 bg-white border border-gray-200 rounded-lg text-sm focus:border-blue-500 outline-none">
              <option value="Deposit">Deposit</option>
              <option value="Partial">Partial Payment</option>
              <option value="Full">Full Payment</option>
            </select>
          </div>
        </div>
        {error && <p className="text-sm text-red-500 mt-3">{error}</p>}
        <div className="flex gap-3 mt-6">
          <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-50">Cancel</button>
          <button type="submit" disabled={saving} className="flex-1 px-4 py-2.5 bg-blue-500 hover:bg-blue-600 disabled:opacity-60 text-white text-sm font-semibold rounded-lg">
            {saving ? 'Saving…' : 'Save Payment'}
          </button>
        </div>
      </form>
    </div>
  );
}
