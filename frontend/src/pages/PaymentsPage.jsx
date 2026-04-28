import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api.js';
import { getSocket } from '../services/socket.js';
import {
  DollarSign,
  Clock,
  AlertCircle,
  Search,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  RefreshCw,
  TrendingUp,
} from 'lucide-react';

const PRESETS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'last_month', label: 'Last Month' },
  { key: 'all', label: 'All Time' },
];

function fmt(amount, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
    minimumFractionDigits: 2,
  }).format(amount || 0);
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function StatusBadge({ refundedAt, provider }) {
  if (refundedAt) return <span className="px-2 py-0.5 text-xs rounded-full bg-red-100 text-red-700 font-medium">Refunded</span>;
  return <span className="px-2 py-0.5 text-xs rounded-full bg-green-100 text-green-700 font-medium">Paid</span>;
}

function ProviderBadge({ provider }) {
  if (provider === 'stripe') return <span className="px-2 py-0.5 text-xs rounded-full bg-[#635BFF]/10 text-[#635BFF] font-medium">Stripe</span>;
  return <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600 font-medium">Manual</span>;
}

export default function PaymentsPage() {
  const navigate = useNavigate();

  // Revenue state
  const [preset, setPreset] = useState('month');
  const [revenue, setRevenue] = useState(null);
  const [revLoading, setRevLoading] = useState(true);

  // Payments list state
  const [payments, setPayments] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, pages: 1 });
  const [listLoading, setListLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);
  const [providerFilter, setProviderFilter] = useState('');

  const fetchRevenue = useCallback(async (p) => {
    setRevLoading(true);
    try {
      const { data } = await api.get(`/api/payments/revenue?preset=${p}`);
      setRevenue(data);
    } catch {
      setRevenue(null);
    } finally {
      setRevLoading(false);
    }
  }, []);

  const fetchPayments = useCallback(async (pg, q, prov) => {
    setListLoading(true);
    try {
      const params = new URLSearchParams({ page: pg, limit: 20 });
      if (q) params.set('search', q);
      if (prov) params.set('provider', prov);
      const { data } = await api.get(`/api/payments?${params}`);
      setPayments(data.payments || []);
      setPagination(data.pagination || { page: 1, limit: 20, total: 0, pages: 1 });
    } catch {
      setPayments([]);
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRevenue(preset);
  }, [preset, fetchRevenue]);

  useEffect(() => {
    fetchPayments(page, search, providerFilter);
  }, [page, search, providerFilter, fetchPayments]);

  // Real-time: refresh stats + prepend payment on new payment received
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handler = (data) => {
      fetchRevenue(preset);
      // Prepend optimistically
      if (data?.paymentId) {
        fetchPayments(1, search, providerFilter);
        setPage(1);
      }
    };

    socket.on('payment_received', handler);
    return () => socket.off('payment_received', handler);
  }, [preset, search, providerFilter, fetchRevenue, fetchPayments]);

  const handleSearch = (e) => {
    e.preventDefault();
    setSearch(searchInput.trim());
    setPage(1);
  };

  const statCards = revenue
    ? [
        {
          label: 'Total Collected',
          value: fmt(revenue.totalCollected),
          sub: `${revenue.paymentCount} payment${revenue.paymentCount !== 1 ? 's' : ''}`,
          icon: TrendingUp,
          color: 'text-green-600',
          bg: 'bg-green-50',
          border: 'border-green-200',
        },
        {
          label: 'Outstanding',
          value: fmt(revenue.totalOutstanding),
          sub: 'Sent / Unpaid',
          icon: Clock,
          color: 'text-blue-600',
          bg: 'bg-blue-50',
          border: 'border-blue-200',
        },
        {
          label: 'Overdue',
          value: fmt(revenue.totalOverdue),
          sub: 'Past due date',
          icon: AlertCircle,
          color: 'text-red-600',
          bg: 'bg-red-50',
          border: 'border-red-200',
        },
      ]
    : [];

  return (
    <div className="h-full overflow-y-auto bg-gray-50">
      <div className="p-4 sm:p-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Revenue Dashboard</h1>
            <p className="text-sm text-gray-500 mt-0.5">Payment history &amp; earnings overview</p>
          </div>
          <button
            onClick={() => { fetchRevenue(preset); fetchPayments(page, search, providerFilter); }}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>

        {/* Preset filter */}
        <div className="flex items-center gap-2 mb-6 flex-wrap">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPreset(p.key)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition border ${
                preset === p.key
                  ? 'bg-[#1787FE] text-white border-[#1787FE] shadow-sm'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Stat cards */}
        {revLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white rounded-2xl border border-gray-100 p-5 animate-pulse h-28" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            {statCards.map((card) => (
              <div
                key={card.label}
                className={`bg-white rounded-2xl border ${card.border} p-5 flex items-center gap-4`}
              >
                <div className={`w-12 h-12 ${card.bg} rounded-xl flex items-center justify-center flex-shrink-0`}>
                  <card.icon size={22} className={card.color} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{card.label}</p>
                  <p className="text-xl font-bold text-gray-900 mt-0.5">{card.value}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{card.sub}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Payment history table */}
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          {/* Table header / filters */}
          <div className="px-5 py-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center gap-3">
            <h2 className="font-semibold text-gray-800 flex-1">Payment History</h2>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Provider filter */}
              <select
                value={providerFilter}
                onChange={(e) => { setProviderFilter(e.target.value); setPage(1); }}
                className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-600 focus:outline-none focus:ring-2 focus:ring-[#1787FE]/20 focus:border-[#1787FE]"
              >
                <option value="">All Methods</option>
                <option value="stripe">Stripe</option>
                <option value="manual">Manual</option>
              </select>

              {/* Search */}
              <form onSubmit={handleSearch} className="flex items-center">
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder="Client or invoice #"
                    className="pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg w-44 focus:outline-none focus:ring-2 focus:ring-[#1787FE]/20 focus:border-[#1787FE]"
                  />
                </div>
                <button type="submit" className="ml-1.5 px-3 py-1.5 text-sm bg-[#1787FE] text-white rounded-lg hover:bg-[#1575e0] transition">
                  Search
                </button>
                {search && (
                  <button
                    type="button"
                    onClick={() => { setSearch(''); setSearchInput(''); setPage(1); }}
                    className="ml-1.5 px-3 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50 transition"
                  >
                    Clear
                  </button>
                )}
              </form>
            </div>
          </div>

          {/* Table */}
          {listLoading ? (
            <div className="p-8 flex justify-center">
              <div className="w-8 h-8 rounded-full border-2 border-[#1787FE] border-t-transparent animate-spin" />
            </div>
          ) : payments.length === 0 ? (
            <div className="p-12 text-center">
              <DollarSign size={40} className="mx-auto text-gray-200 mb-3" />
              <p className="text-gray-500 font-medium">No payments found</p>
              <p className="text-gray-400 text-sm mt-1">
                {search ? 'Try a different search term.' : 'Payments will appear here once invoices are paid.'}
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/50">
                      <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Invoice</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Client</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Amount</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Method</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Status</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Date</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {payments.map((p) => (
                      <tr key={p.id} className="hover:bg-gray-50/50 transition">
                        <td className="px-5 py-3.5 font-medium text-gray-800">
                          #{p.invoice?.invoiceNumber || '—'}
                        </td>
                        <td className="px-4 py-3.5 text-gray-700 max-w-[180px] truncate">
                          {p.invoice?.clientName || '—'}
                        </td>
                        <td className="px-4 py-3.5 text-right font-semibold text-gray-900">
                          {fmt(p.amount, p.currency || p.invoice?.currency)}
                        </td>
                        <td className="px-4 py-3.5">
                          <ProviderBadge provider={p.provider} />
                        </td>
                        <td className="px-4 py-3.5">
                          <StatusBadge refundedAt={p.refundedAt} provider={p.provider} />
                        </td>
                        <td className="px-4 py-3.5 text-gray-500 whitespace-nowrap">
                          {fmtDate(p.createdAt)}
                        </td>
                        <td className="px-4 py-3.5">
                          {p.invoice?.publicSlug && (
                            <button
                              onClick={() => navigate(`/invoices`)}
                              title="View invoice"
                              className="text-gray-400 hover:text-[#1787FE] transition"
                            >
                              <ExternalLink size={14} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {pagination.pages > 1 && (
                <div className="px-5 py-3.5 border-t border-gray-100 flex items-center justify-between">
                  <span className="text-sm text-gray-500">
                    {pagination.total} payment{pagination.total !== 1 ? 's' : ''} — Page {pagination.page} of {pagination.pages}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      disabled={page === 1}
                      onClick={() => setPage((p) => p - 1)}
                      className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <button
                      disabled={page >= pagination.pages}
                      onClick={() => setPage((p) => p + 1)}
                      className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
