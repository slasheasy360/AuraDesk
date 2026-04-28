import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useLinkAccounts } from '../context/LinkAccountsContext.jsx';
import { getSocket } from '../services/socket.js';
import api from '../services/api.js';
import {
  Users, MessageSquare, DollarSign, Clock, Plus, Link2, FileText,
  Zap, Sparkles, ChevronDown, TrendingUp, TrendingDown,
  Inbox, Star, CheckCircle, ArrowRight, Brain,
  AlertCircle, Activity, CreditCard,
} from 'lucide-react';

// ── Helpers ────────────────────────────────────────────────────────────

function fmtCurrency(n) {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${(n || 0).toFixed(2)}`;
}

function relativeTime(date) {
  if (!date) return '';
  const diff = Date.now() - new Date(date).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good Morning';
  if (h < 17) return 'Good Afternoon';
  return 'Good Evening';
}

// ── SVG Sparkline Chart ────────────────────────────────────────────────

function SparklineChart({ data = [], color = '#1787FE', label = '' }) {
  if (!data || data.length < 2) {
    return (
      <div className="flex items-center justify-center h-20 text-gray-300 text-xs">
        No revenue data yet
      </div>
    );
  }

  const W = 600;
  const H = 72;
  const PAD_X = 2;
  const PAD_Y = 6;
  const values = data.map(d => d.amount);
  const max = Math.max(...values, 1);

  const pts = data.map((d, i) => ({
    x: PAD_X + (i / (data.length - 1)) * (W - PAD_X * 2),
    y: H - PAD_Y - ((d.amount / max) * (H - PAD_Y * 2)),
    label: d.label,
    amount: d.amount,
  }));

  // Smooth cubic bezier curve
  const linePath = pts.reduce((path, pt, i) => {
    if (i === 0) return `M ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
    const prev = pts[i - 1];
    const cpX = ((prev.x + pt.x) / 2).toFixed(1);
    return `${path} C ${cpX} ${prev.y.toFixed(1)}, ${cpX} ${pt.y.toFixed(1)}, ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
  }, '');

  const areaPath = `${linePath} L ${pts[pts.length - 1].x.toFixed(1)} ${H} L ${pts[0].x.toFixed(1)} ${H} Z`;
  const gradId = `spark-${color.replace('#', '')}`;

  // Show every nth label to avoid crowding
  const step = Math.ceil(data.length / 8);
  const labelPts = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 72 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.18" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill={`url(#${gradId})`} />
        <path d={linePath} stroke={color} strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {pts.map((pt, i) => (
          pt.amount > 0 && (
            <circle key={i} cx={pt.x} cy={pt.y} r="3" fill={color} opacity="0.7" />
          )
        ))}
      </svg>
      {/* X-axis labels */}
      <div className="flex justify-between mt-1 px-0.5">
        {labelPts.map((pt, i) => (
          <span key={i} className="text-[10px] text-gray-400">{pt.label}</span>
        ))}
      </div>
    </div>
  );
}

// ── Skeleton ───────────────────────────────────────────────────────────

function Skel({ w = 'w-16', h = 'h-5', rounded = 'rounded' }) {
  return <div className={`${w} ${h} ${rounded} bg-gray-200 animate-pulse`} />;
}

// ── Stat Card ──────────────────────────────────────────────────────────

const CARD_THEMES = {
  green:  { bg: 'bg-emerald-50',  text: 'text-emerald-700', iconBg: 'bg-emerald-500',  border: 'border-emerald-100' },
  purple: { bg: 'bg-violet-50',   text: 'text-violet-700',  iconBg: 'bg-violet-500',   border: 'border-violet-100'  },
  blue:   { bg: 'bg-sky-50',      text: 'text-sky-700',     iconBg: 'bg-sky-500',      border: 'border-sky-100'     },
  orange: { bg: 'bg-amber-50',    text: 'text-amber-700',   iconBg: 'bg-amber-500',    border: 'border-amber-100'   },
};

function StatCard({ label, value, icon: Icon, theme = 'blue', trend, sub, loading, onClick }) {
  const t = CARD_THEMES[theme];
  return (
    <button
      onClick={onClick}
      className={`${t.bg} ${t.border} border rounded-2xl p-4 sm:p-5 text-left w-full transition-all hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 group`}
    >
      <div className="flex items-start justify-between mb-3">
        <span className={`text-xs font-semibold uppercase tracking-wide ${t.text} opacity-80`}>{label}</span>
        <div className={`w-9 h-9 ${t.iconBg} rounded-xl flex items-center justify-center shadow-sm flex-shrink-0`}>
          <Icon size={17} className="text-white" />
        </div>
      </div>
      {loading ? (
        <>
          <Skel w="w-20" h="h-7" rounded="rounded-lg" />
          <Skel w="w-24" h="h-3.5" rounded="rounded" />
        </>
      ) : (
        <>
          <div className={`text-2xl font-bold ${t.text} mb-1`}>{value}</div>
          <div className="flex items-center gap-2">
            {sub && <span className="text-xs text-gray-500">{sub}</span>}
            {trend !== null && trend !== undefined && (
              <span className={`flex items-center gap-0.5 text-[11px] font-semibold ${trend >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                {trend >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                {Math.abs(trend)}%
              </span>
            )}
          </div>
        </>
      )}
    </button>
  );
}

// ── Activity Item ──────────────────────────────────────────────────────

const ACTIVITY_CONFIG = {
  lead:         { Icon: Users,        bg: 'bg-blue-100',   icon: 'text-blue-600'   },
  payment:      { Icon: DollarSign,   bg: 'bg-green-100',  icon: 'text-green-600'  },
  invoice:      { Icon: FileText,     bg: 'bg-purple-100', icon: 'text-purple-600' },
  invoice_paid: { Icon: CheckCircle,  bg: 'bg-green-100',  icon: 'text-green-600'  },
  conversation: { Icon: MessageSquare,bg: 'bg-teal-100',   icon: 'text-teal-600'   },
};

function ActivityItem({ item, onClick }) {
  const cfg = ACTIVITY_CONFIG[item.type] || ACTIVITY_CONFIG.conversation;
  return (
    <button
      onClick={() => onClick(item.link)}
      className="w-full flex items-start gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-50 transition text-left group"
    >
      <div className={`w-8 h-8 ${cfg.bg} rounded-full flex items-center justify-center flex-shrink-0 mt-0.5`}>
        <cfg.Icon size={15} className={cfg.icon} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 group-hover:text-[#1787FE] transition">{item.title}</p>
        <p className="text-xs text-gray-400 truncate mt-0.5">{item.description}</p>
      </div>
      <span className="text-[11px] text-gray-400 whitespace-nowrap mt-0.5 flex-shrink-0">
        {relativeTime(item.createdAt)}
      </span>
    </button>
  );
}

// ── Main Component ─────────────────────────────────────────────────────

const PRESETS = [
  { key: 'today', label: 'Today' },
  { key: 'week',  label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'year',  label: 'This Year' },
];

export default function DashboardHome() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { openLinkAccounts } = useLinkAccounts();

  const [preset, setPreset] = useState('month');
  const [mobilePresetOpen, setMobilePresetOpen] = useState(false);
  const [dashData, setDashData] = useState(null);
  const [loading, setLoading] = useState(true);
  const refreshTimer = useRef(null);

  const fetchDashboard = useCallback(async (p) => {
    setLoading(true);
    try {
      const { data } = await api.get(`/api/dashboard?preset=${p}`);
      setDashData(data);
    } catch {
      setDashData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard(preset);
  }, [preset, fetchDashboard]);

  // Real-time refresh when relevant events fire
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const refresh = () => {
      clearTimeout(refreshTimer.current);
      // Debounce: wait 500ms before refresh to batch rapid events
      refreshTimer.current = setTimeout(() => fetchDashboard(preset), 500);
    };

    socket.on('payment_received', refresh);
    socket.on('invoice_updated', refresh);
    socket.on('lead_created', refresh);
    return () => {
      socket.off('payment_received', refresh);
      socket.off('invoice_updated', refresh);
      socket.off('lead_created', refresh);
      clearTimeout(refreshTimer.current);
    };
  }, [preset, fetchDashboard]);

  const displayName = user?.firstName || user?.name?.split(' ')[0] || 'there';
  const trialActive = user?.plan === 'trial' && user?.trialEndsAt && new Date(user.trialEndsAt) > new Date();
  const trialDays = trialActive
    ? Math.ceil((new Date(user.trialEndsAt) - new Date()) / (1000 * 60 * 60 * 24))
    : 0;

  const stats      = dashData?.stats      || {};
  const inbox      = dashData?.inbox      || {};
  const activity   = dashData?.activity   || [];
  const revTrend   = dashData?.revenueTrend || [];
  const aiStats    = dashData?.aiStats    || {};
  const presetLabel = PRESETS.find(p => p.key === preset)?.label || 'This Month';

  const quickActions = [
    { label: 'Add new Lead',       icon: Plus,    action: () => navigate('/inbox') },
    { label: 'Link Account',       icon: Link2,   action: openLinkAccounts },
    { label: 'Create Invoice',     icon: FileText, action: () => navigate('/invoices/new') },
    { label: 'Train AI Assistant', icon: Zap,     action: () => navigate('/ai-training') },
  ];

  return (
    <div className="h-full overflow-y-auto bg-[#0B1628] lg:bg-gray-50">
      <div className="p-4 sm:p-5 lg:p-6 max-w-7xl mx-auto">

        {/* ── Trial Banner ──────────────────────────────────────────── */}
        {trialActive && (
          <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle size={16} className="text-amber-600 flex-shrink-0" />
              <span className="text-sm text-amber-800">
                Free trial: <strong>{trialDays} day{trialDays !== 1 ? 's' : ''} remaining</strong>
              </span>
            </div>
            <button
              onClick={() => navigate('/pricing')}
              className="text-xs font-semibold bg-amber-500 text-white px-3 py-1.5 rounded-lg hover:bg-amber-600 transition"
            >
              Upgrade Now
            </button>
          </div>
        )}

        {/* ── Header ────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between mb-5 lg:mb-6">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white lg:text-gray-900">
              {getGreeting()}, {displayName}! <span>👋</span>
            </h1>
            <p className="text-sm text-white/60 lg:text-gray-400 mt-0.5">
              Here's what's happening with your business
            </p>
          </div>
          {/* Desktop controls */}
          <div className="hidden lg:flex items-center gap-2">
            {PRESETS.map(p => (
              <button
                key={p.key}
                onClick={() => setPreset(p.key)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                  preset === p.key
                    ? 'bg-[#1787FE] text-white shadow-sm'
                    : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300'
                }`}
              >
                {p.label}
              </button>
            ))}
            <button
              onClick={() => navigate('/inbox')}
              className="ml-2 bg-[#1787FE] text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-[#1575e0] transition shadow-sm"
            >
              View Inbox
            </button>
          </div>
        </div>

        {/* ── MOBILE: Date chip + stat grid ─────────────────────────── */}
        <div className="lg:hidden bg-white/5 backdrop-blur rounded-2xl p-4 mb-4 border border-white/10">
          <div className="flex items-center justify-between mb-4">
            <div className="relative">
              <button
                onClick={() => setMobilePresetOpen(p => !p)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 text-white text-xs font-semibold"
              >
                {presetLabel}
                <ChevronDown size={13} className={`transition-transform ${mobilePresetOpen ? 'rotate-180' : ''}`} />
              </button>
              {mobilePresetOpen && (
                <div className="absolute top-9 left-0 z-10 bg-[#1a2a45] rounded-xl shadow-xl border border-white/10 overflow-hidden w-36">
                  {PRESETS.map(p => (
                    <button
                      key={p.key}
                      onClick={() => { setPreset(p.key); setMobilePresetOpen(false); }}
                      className={`w-full px-4 py-2.5 text-left text-sm font-medium transition ${
                        preset === p.key ? 'bg-[#1787FE] text-white' : 'text-white/80 hover:bg-white/10'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={() => navigate('/inbox')}
              className="text-xs font-semibold text-[#1787FE] hover:text-[#5aaeff] transition flex items-center gap-1"
            >
              View Inbox <ArrowRight size={12} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="bg-white/5 rounded-xl p-3 h-20 animate-pulse" />
              ))
            ) : (
              [
                { label: 'Total Leads',      value: stats.totalLeads || 0,      icon: Users,         bg: 'bg-blue-500' },
                { label: 'Unread Messages',  value: inbox.unread || 0,          icon: MessageSquare, bg: 'bg-violet-500' },
                { label: 'Revenue',          value: fmtCurrency(stats.revenue), icon: DollarSign,    bg: 'bg-teal-500' },
                { label: 'Pending Invoices', value: stats.pendingInvoices || 0, icon: Clock,         bg: 'bg-amber-500' },
              ].map((s, i) => (
                <div key={i} className="bg-white/5 border border-white/10 rounded-xl p-3 text-white">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-medium text-white/70">{s.label}</span>
                    <div className={`w-7 h-7 ${s.bg} rounded-lg flex items-center justify-center`}>
                      <s.icon size={13} className="text-white" />
                    </div>
                  </div>
                  <div className="text-xl font-bold">{s.value}</div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── DESKTOP: Stat Cards ────────────────────────────────────── */}
        <div className="hidden lg:grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
          <StatCard
            label="Total Leads"
            value={stats.totalLeads ?? 0}
            icon={Users}
            theme="green"
            trend={stats.newLeadsTrendPct}
            sub={`${stats.newLeads ?? 0} new this period`}
            loading={loading}
            onClick={() => navigate('/leads')}
          />
          <StatCard
            label="Unread Messages"
            value={inbox.unread ?? 0}
            icon={MessageSquare}
            theme="purple"
            sub={`${inbox.active ?? 0} active threads`}
            loading={loading}
            onClick={() => navigate('/inbox')}
          />
          <StatCard
            label="Revenue"
            value={loading ? '—' : fmtCurrency(stats.revenue)}
            icon={DollarSign}
            theme="blue"
            trend={stats.revenueTrendPct}
            sub={presetLabel}
            loading={loading}
            onClick={() => navigate('/payments')}
          />
          <StatCard
            label="Pending Invoices"
            value={stats.pendingInvoices ?? 0}
            icon={Clock}
            theme="orange"
            sub={loading ? '' : `${fmtCurrency(stats.pendingAmount)} outstanding`}
            loading={loading}
            onClick={() => navigate('/invoices')}
          />
        </div>

        {/* ── Main Content Grid ──────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-5">

          {/* Left Column (2/3) */}
          <div className="lg:col-span-2 space-y-4 lg:space-y-5">

            {/* Recent Activity */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity size={16} className="text-[#1787FE]" />
                  <h3 className="font-semibold text-gray-800">Recent Activity</h3>
                </div>
                {activity.length > 0 && (
                  <span className="text-xs text-gray-400">{activity.length} events</span>
                )}
              </div>

              {loading ? (
                <div className="p-4 space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 px-3 py-2.5">
                      <Skel w="w-8" h="h-8" rounded="rounded-full" />
                      <div className="flex-1 space-y-1.5">
                        <Skel w="w-32" h="h-3.5" />
                        <Skel w="w-48" h="h-3" />
                      </div>
                      <Skel w="w-12" h="h-3" />
                    </div>
                  ))}
                </div>
              ) : activity.length === 0 ? (
                <div className="text-center py-12 px-6">
                  <div className="w-16 h-16 mx-auto mb-3 bg-gray-50 rounded-full flex items-center justify-center">
                    <Activity size={28} className="text-gray-300" />
                  </div>
                  <p className="text-sm font-semibold text-gray-600">No activity yet</p>
                  <p className="text-xs text-gray-400 mt-1">
                    Activity will appear here as you add leads, send invoices, and receive payments.
                  </p>
                  <button
                    onClick={() => navigate('/ai-training')}
                    className="mt-4 text-xs text-[#1787FE] font-medium hover:underline"
                  >
                    Train your AI Assistant →
                  </button>
                </div>
              ) : (
                <div className="p-2">
                  {activity.map(item => (
                    <ActivityItem key={item.id} item={item} onClick={navigate} />
                  ))}
                </div>
              )}
            </div>

            {/* Revenue Trend Chart */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <TrendingUp size={16} className="text-[#1787FE]" />
                  <h3 className="font-semibold text-gray-800">Revenue Trend</h3>
                </div>
                <div className="text-right">
                  {loading ? (
                    <Skel w="w-20" h="h-5" rounded="rounded" />
                  ) : (
                    <span className="text-lg font-bold text-gray-900">{fmtCurrency(stats.revenue)}</span>
                  )}
                  <p className="text-xs text-gray-400">{presetLabel}</p>
                </div>
              </div>
              {loading ? (
                <div className="h-24 bg-gray-100 rounded-xl animate-pulse" />
              ) : (
                <SparklineChart data={revTrend} color="#1787FE" />
              )}
            </div>
          </div>

          {/* Right Column (1/3) */}
          <div className="space-y-4 lg:space-y-5">

            {/* Quick Actions */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h3 className="font-semibold text-gray-800 mb-3">Quick Actions</h3>
              <div className="space-y-1.5">
                {quickActions.map((a, i) => (
                  <button
                    key={i}
                    onClick={a.action}
                    className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl border border-gray-100 hover:border-[#1787FE]/30 hover:bg-blue-50/50 transition text-left group"
                  >
                    <div className="w-7 h-7 bg-gray-100 group-hover:bg-[#1787FE]/10 rounded-lg flex items-center justify-center transition">
                      <a.icon size={15} className="text-gray-500 group-hover:text-[#1787FE] transition" />
                    </div>
                    <span className="text-sm font-medium text-gray-700 group-hover:text-[#1787FE] transition">
                      {a.label}
                    </span>
                    <ArrowRight size={13} className="ml-auto text-gray-300 group-hover:text-[#1787FE] transition" />
                  </button>
                ))}
              </div>
            </div>

            {/* Inbox Snapshot */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Inbox size={16} className="text-violet-500" />
                  <h3 className="font-semibold text-gray-800">Inbox</h3>
                </div>
                <button
                  onClick={() => navigate('/inbox')}
                  className="text-xs text-[#1787FE] font-medium hover:underline flex items-center gap-1"
                >
                  View all <ArrowRight size={11} />
                </button>
              </div>
              {loading ? (
                <div className="space-y-2.5">
                  {[1,2,3,4].map(i => (
                    <div key={i} className="flex justify-between">
                      <Skel w="w-24" h="h-3.5" />
                      <Skel w="w-8" h="h-3.5" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-2.5">
                  {[
                    { label: 'Unread',    value: inbox.unread  || 0, color: 'text-violet-600 font-bold', icon: MessageSquare },
                    { label: 'Active',    value: inbox.active  || 0, color: 'text-gray-700',             icon: Activity },
                    { label: 'Starred',   value: inbox.starred || 0, color: 'text-amber-600',            icon: Star },
                    { label: 'Total',     value: inbox.total   || 0, color: 'text-gray-500',             icon: Inbox },
                  ].map(row => (
                    <div key={row.label} className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        <row.icon size={13} className="text-gray-400" />
                        {row.label}
                      </div>
                      <span className={`text-sm ${row.color}`}>{row.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* AI Assistant */}
            <div
              className="rounded-2xl border border-gray-100 shadow-sm p-5 text-white relative overflow-hidden"
              style={{ background: 'linear-gradient(135deg, #6D5BD0 0%, #1787FE 100%)' }}
            >
              {/* Background decoration */}
              <div className="absolute -top-6 -right-6 w-24 h-24 bg-white/5 rounded-full" />
              <div className="absolute -bottom-4 -left-4 w-16 h-16 bg-white/5 rounded-full" />

              <div className="relative">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Brain size={16} className="text-white" />
                    <h3 className="font-semibold text-white">AI Assistant</h3>
                  </div>
                  <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide rounded-full flex items-center gap-1 ${
                    aiStats.isActive ? 'bg-green-400/20 text-green-200' : 'bg-white/20 text-white/70'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${aiStats.isActive ? 'bg-green-300' : 'bg-white/50'}`} />
                    {aiStats.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>

                {loading ? (
                  <div className="space-y-2.5">
                    {[1,2,3].map(i => <div key={i} className="h-3.5 bg-white/20 rounded animate-pulse" />)}
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {[
                      { label: 'FAQs',         value: `${aiStats.faqCount || 0}` },
                      { label: 'Training Files', value: `${aiStats.fileCount || 0}` },
                      { label: 'Total Items',   value: `${aiStats.totalItems || 0}` },
                    ].map(row => (
                      <div key={row.label} className="flex justify-between text-sm">
                        <span className="text-white/70">{row.label}</span>
                        <span className="text-white font-semibold">{row.value}</span>
                      </div>
                    ))}
                  </div>
                )}

                <button
                  onClick={() => navigate('/ai-training')}
                  className="mt-4 w-full bg-white/15 hover:bg-white/25 transition text-white text-xs font-semibold py-2 rounded-xl flex items-center justify-center gap-1.5"
                >
                  <Sparkles size={13} />
                  Manage AI Training
                </button>
              </div>
            </div>

            {/* Payment Snapshot */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <CreditCard size={16} className="text-green-500" />
                  <h3 className="font-semibold text-gray-800">Payments</h3>
                </div>
                <button
                  onClick={() => navigate('/payments')}
                  className="text-xs text-[#1787FE] font-medium hover:underline flex items-center gap-1"
                >
                  View all <ArrowRight size={11} />
                </button>
              </div>
              {loading ? (
                <div className="space-y-2.5">
                  {[1,2,3].map(i => (
                    <div key={i} className="flex justify-between">
                      <Skel w="w-24" h="h-3.5" />
                      <Skel w="w-14" h="h-3.5" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-2.5">
                  {[
                    { label: 'Collected',    value: fmtCurrency(stats.revenue),        color: 'text-green-600 font-bold' },
                    { label: 'Outstanding',  value: fmtCurrency(stats.pendingAmount),   color: 'text-amber-600' },
                    { label: `Pending (${stats.pendingInvoices || 0})`, value: `${stats.pendingInvoices || 0} invoices`, color: 'text-gray-500' },
                  ].map(row => (
                    <div key={row.label} className="flex items-center justify-between">
                      <span className="text-sm text-gray-500">{row.label}</span>
                      <span className={`text-sm ${row.color}`}>{row.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
