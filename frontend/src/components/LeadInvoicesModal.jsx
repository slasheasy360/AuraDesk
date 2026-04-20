import { useState, useEffect, useCallback } from 'react';
import { X, FileText, Plus } from 'lucide-react';
import api from '../services/api.js';
import { getSocket } from '../services/socket.js';

const STATUS_STYLES = {
  Draft: 'bg-gray-100 text-gray-700',
  Sent: 'bg-blue-100 text-blue-700',
  Paid: 'bg-green-100 text-green-700',
  Overdue: 'bg-amber-100 text-amber-700',
  Cancelled: 'bg-red-50 text-red-500',
};

function fmtDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtMoney(n, cur = 'USD') {
  if (n == null) return '-';
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(n); }
  catch { return `$${Number(n).toFixed(2)}`; }
}

export default function LeadInvoicesModal({ lead, onClose, onOpenInvoice, onCreateInvoice }) {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchInvoices = useCallback(async () => {
    try {
      const res = await api.get('/api/invoices', { params: { leadId: lead.id } });
      const sorted = (res.data.invoices || []).sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
      );
      setInvoices(sorted);
    } catch (e) {
      console.error('Failed to fetch lead invoices:', e);
    } finally {
      setLoading(false);
    }
  }, [lead.id]);

  useEffect(() => { fetchInvoices(); }, [fetchInvoices]);

  // ── Real-time: refresh when any invoice for this lead changes ──
  useEffect(() => {
    const sock = getSocket();
    if (!sock) return;
    const onChange = (payload) => {
      const inv = payload?.invoice;
      const id = payload?.id;
      // Only react if it concerns this lead OR if we can't tell (refetch)
      if (!inv || inv.leadId === lead.id || id) fetchInvoices();
    };
    sock.on('invoice_created', onChange);
    sock.on('invoice_updated', onChange);
    sock.on('invoice_deleted', onChange);
    return () => {
      sock.off('invoice_created', onChange);
      sock.off('invoice_updated', onChange);
      sock.off('invoice_deleted', onChange);
    };
  }, [fetchInvoices, lead.id]);

  const activeInvoice = invoices.find((i) => ['Draft', 'Sent', 'Overdue'].includes(i.status));
  const hasActive = !!activeInvoice;
  const activeTooltip = activeInvoice
    ? activeInvoice.status === 'Draft'
      ? 'This lead has an unfinished draft invoice. Complete or delete it first.'
      : activeInvoice.status === 'Sent'
      ? 'This lead already has a sent invoice awaiting payment.'
      : 'This lead has an overdue invoice. Resolve it before creating a new one.'
    : '';

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4">
      <div className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Invoices · {lead.name}</h2>
            <p className="text-xs text-gray-500 mt-0.5">{invoices.length} {invoices.length === 1 ? 'invoice' : 'invoices'}</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => { onCreateInvoice(); onClose(); }}
              disabled={hasActive}
              title={hasActive ? activeTooltip : ''}
              className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg shadow shadow-blue-500/20"
            >
              <Plus size={14} /> CREATE INVOICE
            </button>
            <button onClick={onClose} className="w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-6 space-y-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-14 bg-gray-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : invoices.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <FileText size={42} className="text-gray-300 mb-3" />
              <p className="text-sm font-semibold text-gray-600">No invoices yet</p>
              <p className="text-xs text-gray-400 mt-1">Create the first invoice for this lead</p>
              <button
                onClick={() => { onCreateInvoice(); onClose(); }}
                className="mt-4 flex items-center gap-2 px-5 py-2.5 bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold rounded-lg shadow shadow-blue-500/20"
              >
                <Plus size={14} /> Create Invoice
              </button>
            </div>
          ) : (
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <th className="text-left px-6 py-3">Invoice #</th>
                  <th className="text-left px-6 py-3">Date</th>
                  <th className="text-left px-6 py-3">Due Date</th>
                  <th className="text-right px-6 py-3">Amount</th>
                  <th className="text-left px-6 py-3 pl-6">Status</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr
                    key={inv.id}
                    onClick={() => { onOpenInvoice(inv.id); onClose(); }}
                    className="border-t border-gray-100 cursor-pointer hover:bg-blue-50/40 transition"
                  >
                    <td className="px-6 py-4 text-sm text-gray-900 font-semibold">{inv.invoiceNumber}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{fmtDate(inv.issueDate)}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{inv.status === 'Draft' ? '-' : fmtDate(inv.dueDate)}</td>
                    <td className="px-6 py-4 text-sm text-gray-900 font-medium text-right">{fmtMoney(inv.total, inv.currency)}</td>
                    <td className="px-6 py-4 pl-6">
                      <span className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold ${STATUS_STYLES[inv.status]}`}>
                        {inv.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
