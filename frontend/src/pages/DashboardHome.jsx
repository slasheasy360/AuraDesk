import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import api from '../services/api.js';
import { Users, MessageSquare, DollarSign, Clock, Plus, Link2, FileText, Zap } from 'lucide-react';

export default function DashboardHome() {
  const { user } = useAuth();
  const navigate = useNavigate();
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
    { label: 'Link Account', icon: Link2, action: () => navigate('/connections') },
    { label: 'Create Invoice', icon: FileText, action: () => {} },
    { label: 'Train AI Assistant', icon: Zap, action: () => {} },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Trial Banner */}
      {trialActive && (
        <div className="mb-6 bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 flex items-center justify-between">
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
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Welcome {displayName}!</h1>
          <div className="flex items-center gap-2 mt-1">
            <select className="text-sm text-gray-500 bg-transparent border rounded px-2 py-1">
              <option>This month</option>
              <option>This week</option>
              <option>Today</option>
            </select>
          </div>
        </div>
        <button
          onClick={() => navigate('/inbox')}
          className="bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-600 transition"
        >
          VIEW INBOX
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Activity */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-900 mb-4">Recent Activity</h3>
          {conversations.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <div className="w-16 h-16 mx-auto mb-3 bg-gray-100 rounded-lg flex items-center justify-center">
                <MessageSquare size={24} className="text-gray-300" />
              </div>
              <p className="text-sm">Looks empty</p>
              <p className="text-xs mt-1">Your activity will start to show here in no time</p>
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
        <div className="space-y-6">
          {/* Quick Actions */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="font-semibold text-gray-900 mb-4">Quick Actions</h3>
            <div className="space-y-2">
              {quickActions.map((a, i) => (
                <button
                  key={i}
                  onClick={a.action}
                  className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 transition text-left"
                >
                  <a.icon size={18} className="text-gray-400" />
                  <span className="text-sm text-gray-700">{a.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* AI Assistant */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h3 className="font-semibold text-gray-900 mb-4">AI Assistant</h3>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Status</span>
                <span className="text-green-500 font-medium flex items-center gap-1">
                  <span className="w-2 h-2 bg-green-500 rounded-full" /> Active
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Training Data</span>
                <span className="text-gray-700">0 FAQs</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Response Rate</span>
                <span className="text-gray-700">--</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
