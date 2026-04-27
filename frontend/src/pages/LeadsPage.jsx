import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ChevronDown, RotateCcw, MessageSquare, FileText, Plus, UserPlus, Filter, Download } from 'lucide-react';
import api from '../services/api.js';
import AddLeadModal from '../components/AddLeadModal.jsx';
import LeadInvoicesModal from '../components/LeadInvoicesModal.jsx';
import { getSocket } from '../services/socket.js';

const STATUS_OPTIONS = ['New', 'Warm', 'Won', 'Lost'];
const PLATFORM_OPTIONS = ['Instagram', 'WhatsApp', 'Gmail', 'Facebook'];
const ACTION_OPTIONS = ['Invoice Sent', 'Message Sent', 'Call Made', 'Meeting Set', 'Quote Sent'];

const STATUS_STYLES = {
  New: 'bg-violet-100 text-violet-700 border-violet-200',
  Warm: 'bg-orange-100 text-orange-700 border-orange-200',
  Won: 'bg-green-100 text-green-700 border-green-200',
  Lost: 'bg-red-100 text-red-700 border-red-200',
};

function formatDate(d) {
  if (!d) return '—';
  const date = new Date(d);
  return date.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
}

function Dropdown({ label, value, options, onChange, allowClear = true }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 font-medium"
      >
        {value || label}
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="absolute z-20 mt-2 w-44 bg-white rounded-lg shadow-lg border border-gray-200 py-1">
          {allowClear && (
            <button
              onMouseDown={(e) => { e.preventDefault(); onChange(''); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-sm text-gray-500 hover:bg-gray-50"
            >
              All
            </button>
          )}
          {options.map((opt) => (
            <button
              key={opt}
              onMouseDown={(e) => { e.preventDefault(); onChange(opt); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ value, onChange }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className={`inline-flex items-center gap-1 px-3 py-1 rounded-full border text-xs font-semibold ${STATUS_STYLES[value] || STATUS_STYLES.New}`}
      >
        {value}
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-32 bg-white rounded-lg shadow-lg border border-gray-200 py-1">
          {STATUS_OPTIONS.map((s) => (
            <button
              key={s}
              onMouseDown={(e) => { e.preventDefault(); onChange(s); setOpen(false); }}
              className="w-full text-left px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function LeadsPage() {
  const navigate = useNavigate();
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [invoicesLead, setInvoicesLead] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);
  const [filters, setFilters] = useState({ date: '', platform: '', lastAction: '', status: '' });

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filters.platform) params.platform = filters.platform;
      if (filters.status) params.status = filters.status;
      if (filters.lastAction) params.lastAction = filters.lastAction;
      if (filters.date) {
        const now = new Date();
        if (filters.date === 'Today') {
          params.dateFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        } else if (filters.date === 'Last 7 days') {
          params.dateFrom = new Date(now.getTime() - 7 * 86400000).toISOString();
        } else if (filters.date === 'Last 30 days') {
          params.dateFrom = new Date(now.getTime() - 30 * 86400000).toISOString();
        }
      }
      const res = await api.get('/api/leads', { params });
      setLeads(res.data.leads || []);
    } catch (e) {
      console.error('Fetch leads:', e);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  // ── Real-time sync: listen for lead create/update/delete from anywhere ──
  useEffect(() => {
    const sock = getSocket();
    if (!sock) return;
    const onCreated = ({ lead }) => {
      setLeads((prev) => (prev.some((l) => l.id === lead.id) ? prev : [{ ...lead, invoices: [] }, ...prev]));
    };
    const onUpdated = ({ lead }) => {
      setLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...l, ...lead } : l)));
    };
    const onDeleted = ({ id }) => {
      setLeads((prev) => prev.filter((l) => l.id !== id));
    };
    const onInvoiceChange = () => fetchLeads();
    sock.on('lead_created', onCreated);
    sock.on('lead_updated', onUpdated);
    sock.on('lead_deleted', onDeleted);
    sock.on('invoice_created', onInvoiceChange);
    sock.on('invoice_updated', onInvoiceChange);
    sock.on('invoice_deleted', onInvoiceChange);
    return () => {
      sock.off('lead_created', onCreated);
      sock.off('lead_updated', onUpdated);
      sock.off('lead_deleted', onDeleted);
      sock.off('invoice_created', onInvoiceChange);
      sock.off('invoice_updated', onInvoiceChange);
      sock.off('invoice_deleted', onInvoiceChange);
    };
  }, [fetchLeads]);

  const filtered = useMemo(() => {
    if (!search.trim()) return leads;
    const q = search.toLowerCase();
    return leads.filter((l) => l.name?.toLowerCase().includes(q) || l.email?.toLowerCase().includes(q));
  }, [leads, search]);

  const handleStatusChange = async (lead, newStatus) => {
    setLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...l, status: newStatus } : l)));
    try {
      await api.patch(`/api/leads/${lead.id}`, { status: newStatus });
    } catch (e) {
      console.error('Status update failed:', e);
      fetchLeads();
    }
  };

  const handleAdded = (newLead) => {
    setLeads((prev) => [newLead, ...prev]);
    setShowAdd(false);
  };

  const resetFilters = () => setFilters({ date: '', platform: '', lastAction: '', status: '' });

  const exportCSV = () => {
    const headers = ['#', 'Name', 'Email', 'Phone', 'Platform', 'Status', 'Last Action', 'Last Contacted', 'Created At'];
    const rows = filtered.map((lead, idx) => [
      String(idx + 1).padStart(4, '0'),
      lead.name || '',
      lead.email || '',
      lead.phone || '',
      lead.platform || '',
      lead.status || '',
      lead.lastAction || '',
      lead.lastContactedAt ? new Date(lead.lastContactedAt).toLocaleDateString('en-US') : '',
      lead.createdAt ? new Date(lead.createdAt).toLocaleDateString('en-US') : '',
    ]);

    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0c1a2e] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-6">
        <h1 className="text-2xl font-bold text-white">Leads</h1>
        <div className="flex items-center gap-4">
          <div className="relative w-80">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search leads"
              className="w-full pl-11 pr-4 py-2.5 bg-white/10 border border-white/10 rounded-full text-sm text-white placeholder-gray-400 focus:bg-white/15 focus:border-white/20 outline-none"
            />
          </div>
          <button
            onClick={exportCSV}
            disabled={filtered.length === 0}
            title="Export visible leads to CSV"
            className="flex items-center gap-2 px-4 py-2.5 bg-white/10 hover:bg-white/20 text-white text-sm font-semibold rounded-lg transition disabled:opacity-40"
          >
            <Download size={15} />
            EXPORT CSV
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold rounded-lg transition shadow-lg shadow-blue-500/20"
          >
            <UserPlus size={16} />
            ADD LEAD
          </button>
        </div>
      </div>

      {/* Card */}
      <div className="flex-1 mx-8 mb-8 bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Filter bar */}
        <div className="flex items-center gap-6 px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2 text-sm text-gray-700 font-semibold">
            <Filter size={15} /> Filter by
          </div>
          <Dropdown label="Date" value={filters.date} options={['Today', 'Last 7 days', 'Last 30 days']} onChange={(v) => setFilters((f) => ({ ...f, date: v }))} />
          <Dropdown label="Platform" value={filters.platform} options={PLATFORM_OPTIONS} onChange={(v) => setFilters((f) => ({ ...f, platform: v }))} />
          <Dropdown label="Last Action" value={filters.lastAction} options={ACTION_OPTIONS} onChange={(v) => setFilters((f) => ({ ...f, lastAction: v }))} />
          <Dropdown label="Status" value={filters.status} options={STATUS_OPTIONS} onChange={(v) => setFilters((f) => ({ ...f, status: v }))} />
          <button
            onClick={resetFilters}
            className="ml-auto flex items-center gap-1.5 text-sm text-red-500 hover:text-red-600 font-semibold"
          >
            <RotateCcw size={14} /> Reset Filter
          </button>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto">
          <table className="w-full">
            <thead>
              <tr className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                <th className="text-left px-6 py-3">ID</th>
                <th className="text-left px-6 py-3">Name</th>
                <th className="text-left px-6 py-3">Platform</th>
                <th className="text-left px-6 py-3">Last Contact</th>
                <th className="text-left px-6 py-3">Last Action</th>
                <th className="text-left px-6 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(6)].map((_, i) => (
                  <tr key={i} className="border-t border-gray-100">
                    {[...Array(6)].map((_, j) => (
                      <td key={j} className="px-6 py-5"><div className="h-3 bg-gray-100 rounded animate-pulse" /></td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-20 text-center text-gray-400">
                    <div className="flex flex-col items-center gap-2">
                      <UserPlus size={36} className="text-gray-300" />
                      <p className="text-sm font-medium">No leads yet</p>
                      <button onClick={() => setShowAdd(true)} className="text-sm text-blue-500 hover:underline font-semibold mt-1">+ Add your first lead</button>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((lead, idx) => {
                  const shortId = String(idx + 1).padStart(4, '0');
                  const isHovered = hoveredId === lead.id;
                  return (
                    <tr
                      key={lead.id}
                      onMouseEnter={() => setHoveredId(lead.id)}
                      onMouseLeave={() => setHoveredId(null)}
                      className={`border-t border-gray-100 transition ${isHovered ? 'bg-blue-50/50' : ''}`}
                    >
                      <td className="px-6 py-5 text-sm text-gray-600 font-medium">{shortId}</td>
                      <td className="px-6 py-5 text-sm text-gray-900 font-semibold">{lead.name}</td>
                      <td className="px-6 py-5 text-sm text-gray-600">{lead.platform || '—'}</td>
                      <td className="px-6 py-5 text-sm text-gray-600">{formatDate(lead.lastContactedAt)}</td>
                      <td className="px-6 py-5 text-sm text-gray-600">
                        <div className="flex items-center justify-between gap-4">
                          <span>{lead.lastAction || '—'}</span>
                          {isHovered && (
                            <div className="flex items-center gap-2">
                              {lead.conversationId && (
                                <button
                                  onClick={() => navigate(`/inbox/${lead.conversationId}`)}
                                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-md text-xs font-semibold text-gray-700 hover:bg-gray-50 shadow-sm"
                                >
                                  <MessageSquare size={12} /> OPEN CHAT
                                </button>
                              )}
                              {(() => {
                                const invoices = lead.invoices || [];
                                const activeInvoice = invoices.find((i) => ['Draft', 'Sent', 'Overdue'].includes(i.status));
                                const latest = invoices[0];
                                const canCreate = !activeInvoice;
                                return (
                                  <>
                                    <button
                                      onClick={() => setInvoicesLead(lead)}
                                      className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-md text-xs font-semibold text-gray-700 hover:bg-gray-50 shadow-sm"
                                    >
                                      <FileText size={12} /> SHOW INVOICE{invoices.length > 1 ? `S (${invoices.length})` : ''}
                                    </button>
                                    {canCreate && (
                                      <button
                                        onClick={() => navigate(`/invoices/new?leadId=${lead.id}`)}
                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-md text-xs font-semibold text-gray-700 hover:bg-gray-50 shadow-sm"
                                      >
                                        <Plus size={12} /> CREATE INVOICE
                                      </button>
                                    )}
                                  </>
                                );
                              })()}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-5">
                        <StatusBadge value={lead.status} onChange={(s) => handleStatusChange(lead, s)} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showAdd && <AddLeadModal onClose={() => setShowAdd(false)} onCreated={handleAdded} />}
      {invoicesLead && (
        <LeadInvoicesModal
          lead={invoicesLead}
          onClose={() => setInvoicesLead(null)}
          onOpenInvoice={(id) => navigate(`/invoices/${id}`)}
          onCreateInvoice={() => navigate(`/invoices/new?leadId=${invoicesLead.id}`)}
        />
      )}
    </div>
  );
}
