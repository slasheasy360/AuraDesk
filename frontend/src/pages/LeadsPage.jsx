import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Star, Trash2, MessageSquare, Search } from 'lucide-react';
import api from '../services/api.js';
import PlatformBadge from '../components/PlatformBadge.jsx';

function formatTimeShort(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function LeadsPage() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  const fetchLeads = useCallback(async () => {
    try {
      const res = await api.get('/api/conversations', { params: { filter: 'leads' } });
      setLeads(res.data.conversations || []);
    } catch (err) {
      console.error('Failed to fetch leads:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  const toggleLead = async (convId, e) => {
    e.stopPropagation();
    // Optimistic remove from list
    setLeads((prev) => prev.filter((c) => c.id !== convId));
    try {
      await api.patch(`/api/conversations/${convId}/lead`);
    } catch (err) {
      console.error('Failed to toggle lead:', err);
      fetchLeads(); // revert
    }
  };

  const filteredLeads = search
    ? leads.filter((c) => {
        const name = c.contact?.name || c.contact?.username || '';
        const msg = c.messages?.[0]?.content || '';
        const term = search.toLowerCase();
        return name.toLowerCase().includes(term) || msg.toLowerCase().includes(term);
      })
    : leads;

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0c1a2e]">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-[#0f1d33]">
        <div className="flex items-center gap-3">
          <Users size={22} className="text-primary-400" />
          <h1 className="text-xl font-bold text-white">Leads</h1>
          {leads.length > 0 && (
            <span className="text-xs bg-primary-500/20 text-primary-300 px-2 py-0.5 rounded-full font-medium">
              {leads.length}
            </span>
          )}
        </div>
        <div className="relative w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search leads"
            className="w-full pl-9 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-gray-500 focus:bg-white/10 focus:border-primary-400 outline-none transition"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="px-6 py-8 space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="flex items-center gap-4 p-4 rounded-lg bg-white/5 animate-pulse">
                <div className="w-10 h-10 rounded-full bg-white/10" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-32 bg-white/10 rounded" />
                  <div className="h-3 w-48 bg-white/5 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : filteredLeads.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 px-6">
            <Users size={48} className="mb-3 text-gray-600" />
            <p className="text-sm font-medium text-gray-400">
              {search ? 'No leads match your search' : 'No leads yet'}
            </p>
            <p className="text-xs mt-1 text-gray-600">
              {search ? 'Try a different search term' : 'Mark conversations as leads from the Smart Inbox'}
            </p>
          </div>
        ) : (
          filteredLeads.map((conv) => {
            const lastMessage = conv.messages?.[0];
            const preview = lastMessage?.content
              ? lastMessage.content.replace(/<[^>]+>/g, '').replace(/\n+/g, ' ').slice(0, 100)
              : 'No messages';
            const contactName = conv.contact?.name || conv.contact?.username || 'Unknown';
            const platform = conv.connectedAccount?.platform;

            return (
              <button
                key={conv.id}
                onClick={() => navigate(`/inbox/${conv.id}`)}
                className="w-full px-6 py-4 flex items-center gap-4 border-b border-white/5 hover:bg-white/5 transition text-left group"
              >
                {/* Avatar */}
                <div className="w-10 h-10 rounded-full bg-primary-500/20 flex items-center justify-center text-primary-400 font-semibold text-sm flex-shrink-0">
                  {contactName[0]?.toUpperCase() || '?'}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-white text-sm truncate">{contactName}</span>
                    <PlatformBadge platform={platform} size="xs" />
                  </div>
                  <p className="text-xs text-gray-500 truncate mt-0.5">{preview}</p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs text-gray-500">{formatTimeShort(conv.lastMessageAt)}</span>
                  <button
                    onClick={(e) => toggleLead(conv.id, e)}
                    className="p-1.5 text-primary-400 hover:text-red-400 hover:bg-white/10 rounded-lg transition opacity-0 group-hover:opacity-100"
                    title="Remove from Leads"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
