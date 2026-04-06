import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Send, Clock, Plus, Trash2, Link as LinkIcon, Check } from 'lucide-react';
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
  Sent: 'bg-violet-50 text-violet-700 border-violet-200',
  Paid: 'bg-green-50 text-green-700 border-green-200',
  Overdue: 'bg-orange-50 text-orange-700 border-orange-200',
};

export default function InvoiceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showPayment, setShowPayment] = useState(false);
  const [copied, setCopied] = useState(false);

  const fetchInvoice = useCallback(async () => {
    try {
      const res = await api.get(`/api/invoices/${id}`);
      setInvoice(res.data.invoice);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { fetchInvoice(); }, [fetchInvoice]);

  const markSent = async () => {
    await api.patch(`/api/invoices/${id}/status`, { status: 'Sent' });
    fetchInvoice();
  };

  const copyLink = () => {
    const link = `${window.location.origin}/i/${invoice.publicSlug}`;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) return <div className="flex-1 bg-[#0c1a2e] flex items-center justify-center text-gray-400">Loading…</div>;
  if (!invoice) return <div className="flex-1 bg-[#0c1a2e] flex items-center justify-center text-gray-400">Invoice not found</div>;

  return (
    <div className="flex-1 h-full bg-[#0c1a2e] overflow-y-auto">
      <div className="px-8 py-6">
        <div className="flex items-center gap-3 mb-4">
          <button onClick={() => navigate('/invoices')} className="w-9 h-9 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-white">
            <ArrowLeft size={16} />
          </button>
          <div>
            <h1 className="text-xl font-bold text-white">Invoice #{invoice.invoiceNumber}</h1>
            <p className="text-xs text-gray-400 mt-0.5">Due on {fmtDate(invoice.dueDate)}</p>
          </div>
          <button onClick={copyLink} className="ml-auto flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm font-semibold text-white">
            {copied ? <Check size={14} /> : <LinkIcon size={14} />}
            {copied ? 'COPIED' : 'COPY LINK'}
          </button>
          <button className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-50" onClick={() => setShowPayment(true)}>
            Record a Payment
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Invoice card */}
          <div className="lg:col-span-2 bg-white rounded-2xl shadow-2xl p-8">
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
                <p className="text-lg font-bold text-gray-900">{fmtMoney(invoice.total, invoice.currency)}</p>
              </div>
            </div>

            <div className="border border-gray-200 rounded-lg p-5 mb-5">
              <div className="grid grid-cols-2 gap-6">
                <div className="bg-gray-50 -m-5 mr-0 p-5 rounded-l-lg">
                  <p className="text-xs text-gray-500 mb-1">Invoice No</p>
                  <p className="font-bold text-gray-900">{invoice.invoiceNumber}</p>
                  <p className="text-xs text-gray-500 mt-3 mb-1">Date Issued</p>
                  <p className="text-sm text-gray-700">{fmtDate(invoice.issueDate)}</p>
                  <p className="text-xs text-gray-500 mt-3 mb-1">Due Date</p>
                  <p className="text-sm text-gray-700">{fmtDate(invoice.dueDate)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">Billing Address</p>
                  <p className="text-sm text-gray-900 font-semibold">{invoice.clientName}</p>
                  <p className="text-xs text-gray-600">{invoice.billingAddress}</p>
                  <p className="text-xs text-gray-600">{invoice.clientPhone}</p>
                  <p className="text-xs text-gray-600">{invoice.clientEmail}</p>
                  {invoice.note && (<>
                    <p className="text-xs text-gray-500 mt-3 mb-1">Note</p>
                    <p className="text-xs text-gray-700">{invoice.note}</p>
                  </>)}
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

            <div className="flex justify-end mt-4">
              <div className="w-64 space-y-2 text-sm">
                <div className="flex justify-between text-gray-600"><span>Subtotal</span><span>{fmtMoney(invoice.subtotal, invoice.currency)}</span></div>
                <div className="flex justify-between text-gray-600"><span>Tax ({invoice.taxRate}%)</span><span>{fmtMoney(invoice.taxAmount, invoice.currency)}</span></div>
                <div className="flex justify-between font-bold text-gray-900 pt-2 border-t"><span>Total Due</span><span>{fmtMoney(invoice.total, invoice.currency)}</span></div>
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            <div className={`p-3 rounded-lg border text-center font-semibold text-sm ${STATUS_STYLES[invoice.status]}`}>
              <Clock size={14} className="inline mr-1.5" />
              {invoice.status}
            </div>

            {invoice.status === 'Draft' && (
              <div className="bg-white rounded-xl border border-gray-200 p-5 text-center">
                <p className="text-sm font-semibold text-gray-700 mb-3">Invoice not yet sent!</p>
                <button onClick={markSent} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold rounded-lg shadow">
                  <Send size={14} /> Send Invoice
                </button>
              </div>
            )}

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
                  <PaymentRow key={p.id} payment={p} index={i} currency={invoice.currency} onDelete={async () => {
                    await api.delete(`/api/invoices/${id}/payments/${p.id}`);
                    fetchInvoice();
                  }} />
                ))}
              </div>

              {invoice.remaining > 0 && (
                <div className="flex justify-between items-center mt-4 pt-3 border-t border-gray-100">
                  <span className="text-sm text-gray-600">Remaining Amount</span>
                  <span className="px-2 py-1 bg-orange-50 text-orange-700 rounded text-xs font-semibold">{fmtMoney(invoice.remaining, invoice.currency)}</span>
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
    </div>
  );
}

function PaymentRow({ payment, index, currency, onDelete }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-2 h-2 rounded-full bg-green-500 mt-1.5" />
      <div className="flex-1">
        <p className="text-sm font-semibold text-gray-900">{payment.type === 'Deposit' ? `Deposit No. ${String(index + 1).padStart(4, '0')}` : payment.type === 'Full' ? 'Full Payment' : 'Partial Payment'}</p>
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
