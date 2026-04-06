import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, FilePlus, FileText } from 'lucide-react';
import api from '../services/api.js';

const STATUS_STYLES = {
  Draft: 'bg-gray-100 text-gray-600',
  Sent: 'bg-violet-100 text-violet-700',
  Paid: 'bg-green-100 text-green-700',
  Overdue: 'bg-red-100 text-red-600',
};

function fmtDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtMoney(n, cur = 'USD') {
  if (n == null) return '-';
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n); }
  catch { return `$${Math.round(n)}`; }
}

export default function InvoiceListPage() {
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [hoveredId, setHoveredId] = useState(null);

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/invoices');
      setInvoices(res.data.invoices || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchInvoices(); }, [fetchInvoices]);

  const filtered = useMemo(() => {
    if (!search.trim()) return invoices;
    const q = search.toLowerCase();
    return invoices.filter((i) =>
      i.invoiceNumber.toLowerCase().includes(q) || i.clientName.toLowerCase().includes(q)
    );
  }, [invoices, search]);

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0c1a2e] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-6">
        <h1 className="text-2xl font-bold text-white">Invoices</h1>
        <div className="flex items-center gap-4">
          <div className="relative w-80">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search invoices"
              className="w-full pl-11 pr-4 py-2.5 bg-white/10 border border-white/10 rounded-full text-sm text-white placeholder-gray-400 focus:bg-white/15 outline-none"
            />
          </div>
          <button
            onClick={() => navigate('/invoices/new')}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold rounded-lg shadow-lg shadow-blue-500/20"
          >
            <FilePlus size={16} /> CREATE INVOICE
          </button>
        </div>
      </div>

      {/* Table card */}
      <div className="flex-1 mx-8 mb-8 bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          <table className="w-full">
            <thead>
              <tr className="text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50">
                <th className="text-left px-6 py-3">Invoice #</th>
                <th className="text-left px-6 py-3">Name</th>
                <th className="text-left px-6 py-3">Date</th>
                <th className="text-left px-6 py-3">Due Date</th>
                <th className="text-left px-6 py-3">Amount</th>
                <th className="text-left px-6 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(8)].map((_, i) => (
                  <tr key={i} className="border-t border-gray-100">
                    {[...Array(6)].map((_, j) => <td key={j} className="px-6 py-5"><div className="h-3 bg-gray-100 rounded animate-pulse" /></td>)}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-20 text-center text-gray-400">
                    <div className="flex flex-col items-center gap-2">
                      <FileText size={36} className="text-gray-300" />
                      <p className="text-sm font-medium">No invoices yet</p>
                      <button onClick={() => navigate('/invoices/new')} className="text-sm text-blue-500 hover:underline font-semibold mt-1">+ Create your first invoice</button>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((inv) => (
                  <tr
                    key={inv.id}
                    onMouseEnter={() => setHoveredId(inv.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    onClick={() => navigate(`/invoices/${inv.id}`)}
                    className={`border-t border-gray-100 cursor-pointer transition ${hoveredId === inv.id ? 'bg-blue-50/40' : ''}`}
                  >
                    <td className="px-6 py-5 text-sm text-gray-900 font-semibold">{inv.invoiceNumber}</td>
                    <td className="px-6 py-5 text-sm text-gray-700">{inv.clientName}</td>
                    <td className="px-6 py-5 text-sm text-gray-600">{fmtDate(inv.issueDate)}</td>
                    <td className="px-6 py-5 text-sm text-gray-600">{inv.status === 'Draft' ? '-' : fmtDate(inv.dueDate)}</td>
                    <td className="px-6 py-5 text-sm text-gray-900 font-medium">{fmtMoney(inv.total, inv.currency)}</td>
                    <td className="px-6 py-5">
                      <span className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold ${STATUS_STYLES[inv.status]}`}>
                        {inv.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100">
          <p className="text-xs text-gray-500">Showing {filtered.length} of {invoices.length}</p>
        </div>
      </div>
    </div>
  );
}
