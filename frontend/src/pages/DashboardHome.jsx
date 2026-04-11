import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useLinkAccounts } from '../context/LinkAccountsContext.jsx';
import api from '../services/api.js';
import { Users, MessageSquare, DollarSign, Clock, Plus, Link2, FileText, Zap, Sparkles, ChevronDown } from 'lucide-react';

export default function DashboardHome() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { openLinkAccounts } = useLinkAccounts();
  const [stats, setStats] = useState({ leads: 0, messages: 0, revenue: 0, pending: 0 });
  const [conversations, setConversations] = useState([]);

  useEffect(() => {
    // Fetch conversations for stats
    api.get('/api/conversations').then((res) => {
      const convs = res.data.conversations || [];
      setConversations(convs);
      setStats({
        leads: convs.length,
        messages: convs.reduce((sum, c) => sum + (c.unreadCount || 0), 0),
        revenue: 0,
        pending: 0,
      });
    }).catch(() => {});
  }, []);

  const displayName = user?.firstName || user?.name?.split(' ')[0] || 'there';

  const trialActive = user?.plan === 'trial' && user?.trialEndsAt && new Date(user.trialEndsAt) > new Date();
  const trialDays = trialActive
    ? Math.ceil((new Date(user.trialEndsAt) - new Date()) / (1000 * 60 * 60 * 24))
    : 0;

  const quickActions = [
    { label: 'Add new Lead', icon: Plus, action: () => navigate('/inbox') },
    { label: 'Link Account', icon: Link2, action: openLinkAccounts },
    { label: 'Create Invoice', icon: FileText, action: () => {} },
    { label: 'Train AI Assistant', icon: Zap, action: () => {} },
  ];

  return (
    <div className="h-full overflow-y-auto bg-[#0B1628] lg:bg-gray-50">
      <div className="p-4 sm:p-6 max-w-7xl mx-auto">
        {/* Trial Banner */}
        {trialActive && (
          <div className="mb-4 lg:mb-6 bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-yellow-800">
              Free trial: <strong>{trialDays} days remaining</strong>
            </span>
            <button
              onClick={() => navigate('/pricing')}
              className="text-sm bg-yellow-500 text-white px-4 py-1.5 rounded-lg font-medium hover:bg-yellow-600 transition"
            >
              Upgrade Now
            </button>
          </div>
        )}

        {/* Welcome */}
        <div className="flex items-center justify-between mb-5 lg:mb-8">
          <div>
            <h1 className="text-[22px] sm:text-2xl font-bold text-white lg:text-gray-900">
              Welcome {displayName}! <span className="inline-block">👋</span>
            </h1>
            <div className="hidden lg:flex items-center gap-2 mt-1">
              <select className="text-sm text-gray-500 bg-transparent border rounded px-2 py-1">
                <option>This month</option>
                <option>This week</option>
                <option>Today</option>
              </select>
            </div>
          </div>
          <button
            onClick={() => navigate('/inbox')}
            className="hidden lg:inline-flex bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-600 transition"
          >
            VIEW INBOX
          </button>
        </div>

        {/* MOBILE: stat container card with date chip */}
        <div className="lg:hidden bg-white rounded-2xl p-4 mb-4 shadow-sm">
          <div className="flex items-center mb-4">
            <button
              type="button"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-100 text-xs font-medium text-gray-700"
            >
              This month
              <ChevronDown size={14} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Total Leads', value: stats.leads, icon: Users, bg: 'bg-blue-50', text: 'text-blue-700', iconBg: 'bg-blue-500' },
              { label: 'New Messages', value: stats.messages, icon: MessageSquare, bg: 'bg-teal-50', text: 'text-teal-700', iconBg: 'bg-teal-500' },
              { label: 'Monthly Revenue', value: `$${stats.revenue.toLocaleString()}`, icon: DollarSign, bg: 'bg-[#0F3D45]', text: 'text-white', iconBg: 'bg-teal-400' },
              { label: 'Pending Invoices', value: stats.pending, icon: Clock, bg: 'bg-slate-100', text: 'text-slate-700', iconBg: 'bg-slate-500' },
            ].map((s, i) => (
              <div key={i} className={`${s.bg} ${s.text} rounded-xl p-3`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-medium opacity-80 leading-tight">{s.label}</span>
                  <div className={`w-7 h-7 ${s.iconBg} rounded-lg flex items-center justify-center flex-shrink-0`}>
                    <s.icon size={14} className="text-white" />
                  </div>
                </div>
                <div className="text-xl font-bold">{s.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* DESKTOP: stat cards */}
        <div className="hidden lg:grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Total Leads', value: stats.leads, icon: Users, color: 'bg-green-100 text-green-600', iconBg: 'bg-green-500' },
            { label: 'New Messages', value: stats.messages, icon: MessageSquare, color: 'bg-purple-100 text-purple-600', iconBg: 'bg-purple-500' },
            { label: 'Monthly Revenue', value: `$${stats.revenue.toLocaleString()}`, icon: DollarSign, color: 'bg-teal-100 text-teal-600', iconBg: 'bg-teal-500' },
            { label: 'Pending Invoices', value: stats.pending, icon: Clock, color: 'bg-orange-100 text-orange-600', iconBg: 'bg-orange-500' },
          ].map((s, i) => (
            <div key={i} className={`${s.color} rounded-xl p-4`}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium opacity-80">{s.label}</span>
                <div className={`w-8 h-8 ${s.iconBg} rounded-lg flex items-center justify-center`}>
                  <s.icon size={16} className="text-white" />
                </div>
              </div>
              <div className="text-2xl font-bold">{s.value}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">
          {/* Recent Activity */}
          <div className="lg:col-span-2 bg-white rounded-2xl lg:rounded-xl border-0 lg:border lg:border-gray-200 p-5 lg:p-6 shadow-sm">
            <h3 className="font-bold text-gray-900 mb-4 text-base lg:text-base lg:font-semibold">Recent Activity</h3>
            {conversations.length === 0 ? (
              <div className="text-center py-8 lg:py-12 text-gray-400">
                <div className="w-20 h-20 mx-auto mb-3 flex items-center justify-center">
                  <svg viewBox="0 0 80 80" className="w-full h-full">
                    <path d="M16 32 L40 22 L64 32 L64 60 L16 60 Z" fill="#E5E7EB" stroke="#9CA3AF" strokeWidth="2" strokeLinejoin="round" />
                    <path d="M16 32 L40 42 L64 32" fill="none" stroke="#9CA3AF" strokeWidth="2" strokeLinejoin="round" />
                    <path d="M40 22 L40 42" stroke="#9CA3AF" strokeWidth="2" />
                    <path d="M22 18 L24 22 M28 14 L28 18 M58 16 L56 20 M62 22 L66 22" stroke="#FCD34D" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </div>
                <p className="text-sm font-semibold text-gray-600">Looks empty</p>
                <p className="text-xs mt-1 text-gray-400 px-4">Meanwhile, you can train the AI Assistant</p>
              </div>
            ) : (
              <div className="space-y-3">
                {conversations.slice(0, 5).map((conv) => (
                  <div
                    key={conv.id}
                    onClick={() => navigate(`/inbox/${conv.id}`)}
                    className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-xs font-bold text-blue-600">
                        {(conv.contact?.name || 'U')[0].toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{conv.contact?.name || 'Unknown'}</p>
                        <p className="text-xs text-gray-400">{conv.connectedAccount?.platform || 'email'}</p>
                      </div>
                    </div>
                    {conv.unreadCount > 0 && (
                      <span className="bg-blue-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                        {conv.unreadCount}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right Column */}
          <div className="space-y-4 lg:space-y-6">
            {/* Quick Actions */}
            <div className="bg-white rounded-2xl lg:rounded-xl border-0 lg:border lg:border-gray-200 p-5 lg:p-6 shadow-sm">
              <h3 className="font-bold text-gray-900 mb-4 text-base lg:font-semibold">Quick Actions</h3>
              <div className="space-y-2 lg:space-y-2">
                {quickActions.map((a, i) => (
                  <button
                    key={i}
                    onClick={a.action}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-full lg:rounded-lg border border-gray-200 lg:border-0 hover:bg-gray-50 transition text-left"
                  >
                    <a.icon size={18} className="text-gray-500 lg:text-gray-400" />
                    <span className="text-sm font-medium text-gray-700">{a.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* AI Assistant */}
            <div
              className="rounded-2xl lg:rounded-xl border-0 lg:border lg:border-gray-200 p-5 lg:p-6 text-white lg:text-gray-900 shadow-sm"
              style={{
                background: 'linear-gradient(135deg, #6D5BD0 0%, #1787FE 100%)',
              }}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-base flex items-center gap-2 lg:font-semibold">
                  <Sparkles size={16} className="text-white lg:text-blue-500" />
                  AI Assistant
                </h3>
                <span className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider bg-white/20 lg:bg-green-100 text-white lg:text-green-700 rounded-full flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-green-300 lg:bg-green-500 rounded-full" />
                  Active
                </span>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-white/80 lg:text-gray-500">Status</span>
                  <span className="text-white lg:text-green-500 font-medium flex items-center gap-1">
                    <span className="w-2 h-2 bg-green-300 lg:bg-green-500 rounded-full" /> Active
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-white/80 lg:text-gray-500">Training Data</span>
                  <span className="text-white lg:text-gray-700 font-medium">12 FAQs</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-white/80 lg:text-gray-500">Response Rate</span>
                  <span className="text-white lg:text-gray-700 font-medium">89%</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
