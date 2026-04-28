import { useState, useEffect, useRef } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { LinkAccountsProvider, useLinkAccounts } from '../context/LinkAccountsContext.jsx';
import { connectSocket, disconnectSocket, getSocket } from '../services/socket.js';
import { LayoutDashboard, Inbox, Users, FileText, Brain, LogOut, X, ChevronRight, DollarSign, CheckCircle } from 'lucide-react';
import logoUrl from '../assets/logo.svg';
import MobileBottomNav from './MobileBottomNav.jsx';
import LinkAccountsSheet from './LinkAccountsSheet.jsx';

// Wraps the dashboard tree in the Link-Accounts provider so any nested
// page can pop the modal via `useLinkAccounts()` without prop-drilling.
export default function DashboardLayout() {
  return (
    <LinkAccountsProvider>
      <DashboardLayoutInner />
    </LinkAccountsProvider>
  );
}

function DashboardLayoutInner() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { open: linkAccountsOpen, closeLinkAccounts } = useLinkAccounts();
  const [paymentToast, setPaymentToast] = useState(null);
  const toastTimer = useRef(null);

  useEffect(() => {
    if (user?.id) {
      connectSocket(user.id);
    }
    return () => disconnectSocket();
  }, [user?.id]);

  // Listen for incoming payments and show a toast notification.
  // Uses a short delay so connectSocket() finishes before we attach.
  useEffect(() => {
    if (!user?.id) return;
    let socket = getSocket();

    const attach = (s) => {
      const handler = (data) => {
        const amount = new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: data.currency || 'USD',
        }).format(data.amount || 0);
        setPaymentToast({
          message: `Payment received for Invoice #${data.invoiceNumber} — ${amount}`,
          id: data.paymentId,
        });
        clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setPaymentToast(null), 6000);
      };
      s.on('payment_received', handler);
      return () => s.off('payment_received', handler);
    };

    if (socket) return attach(socket);

    // Socket not ready yet — wait one tick (connectSocket called in prior effect)
    const t = setTimeout(() => {
      socket = getSocket();
      if (socket) attach(socket);
    }, 50);
    return () => {
      clearTimeout(t);
      clearTimeout(toastTimer.current);
    };
  }, [user?.id]);

  // Close sidebar on route change (mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  // Allow nested pages (e.g. InboxPage) to toggle the mobile sidebar via custom event
  useEffect(() => {
    const handleToggle = () => setSidebarOpen((prev) => !prev);
    window.addEventListener('toggle-mobile-sidebar', handleToggle);
    return () => window.removeEventListener('toggle-mobile-sidebar', handleToggle);
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  const navItems = [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/inbox', icon: Inbox, label: 'Smart Inbox' },
    { to: '/leads', icon: Users, label: 'Leads' },
    { to: '/invoices', icon: FileText, label: 'Invoices' },
    { to: '/payments', icon: DollarSign, label: 'Payments' },
    { to: '/ai-training', icon: Brain, label: 'AI Training' },
  ];

  const companyName = user?.companyName || 'ABC Company';
  const companyLogo = user?.companyLogo;
  const planLabel = user?.plan === 'pro' ? 'PRO' : user?.plan === 'elite' ? 'ELITE' : user?.plan === 'starter' ? 'STARTER' : user?.plan === 'trial' ? 'TRIAL' : 'FREE';

  return (
    <div className="flex h-screen bg-[#0B1628]">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden transition-opacity"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 w-64 bg-[#0B1628] text-white flex flex-col
          transform transition-transform duration-300 ease-out
          lg:relative lg:translate-x-0
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {/* Logo + close button */}
        <div className="px-5 py-5 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={logoUrl} alt="AuraDesk" className="h-8 w-auto" />
            <span className="text-xl font-bold">AuraDesk</span>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden text-gray-400 hover:text-white transition"
          >
            <X size={20} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition ${
                  isActive || (to === '/inbox' && location.pathname.startsWith('/inbox'))
                    ? 'bg-[#1787FE] text-white shadow-lg shadow-[#1787FE]/20'
                    : 'text-gray-300 hover:bg-white/5 hover:text-white'
                }`
              }
            >
              <Icon size={20} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Company section */}
        <div className="px-4 py-4 border-t border-white/10">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => navigate('/settings?tab=Personal')}
              className="flex items-center gap-3 min-w-0 flex-1 text-left hover:opacity-90 transition"
              title="Profile Settings"
            >
              {companyLogo ? (
                <img src={companyLogo} alt={companyName} className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
              ) : (
                <div className="w-9 h-9 bg-primary-600 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0">
                  {companyName?.[0]?.toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{companyName}</p>
                <span className="inline-block px-2 py-0.5 text-[10px] font-bold bg-green-500 rounded text-white mt-0.5">
                  {planLabel}
                </span>
              </div>
            </button>
            <button
              onClick={handleLogout}
              className="text-gray-400 hover:text-white hover:bg-white/10 p-1.5 rounded transition flex-shrink-0"
              title="Logout"
            >
              <LogOut size={16} />
            </button>
            <button
              onClick={() => navigate('/settings?tab=Personal')}
              className="text-gray-400 hover:text-white transition flex-shrink-0"
              title="Open settings"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile top bar — logo on left, avatar on right; no hamburger (bottom nav handles navigation) */}
        <div className="lg:hidden bg-[#0B1628] border-b border-white/5 px-4 py-3 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="flex items-center gap-2 min-w-0"
            aria-label="AuraDesk home"
          >
            <img src={logoUrl} alt="AuraDesk" className="h-7 w-auto" />
            <span className="font-bold text-white text-[17px] tracking-tight">AuraDesk</span>
          </button>
          <button
            type="button"
            onClick={() => navigate('/settings?tab=Personal')}
            className="flex-shrink-0"
            title={companyName}
            aria-label="Profile"
          >
            {companyLogo ? (
              <img src={companyLogo} alt={companyName} className="w-9 h-9 rounded-full object-cover border border-white/10" />
            ) : (
              <div className="w-9 h-9 bg-[#1787FE] rounded-full flex items-center justify-center text-sm font-bold text-white border border-white/10">
                {companyName?.[0]?.toUpperCase()}
              </div>
            )}
          </button>
        </div>

        <main className="flex-1 overflow-hidden pb-20 lg:pb-0">
          <Outlet />
        </main>

        <MobileBottomNav />
      </div>

      {/* Global Link Accounts modal — single instance, opened from anywhere
          inside the dashboard via the LinkAccounts context. */}
      <LinkAccountsSheet open={linkAccountsOpen} onClose={closeLinkAccounts} />

      {/* Payment received toast */}
      {paymentToast && (
        <div className="fixed bottom-24 lg:bottom-6 right-4 z-[100] max-w-sm w-full">
          <div className="bg-white border border-green-200 shadow-lg rounded-xl px-4 py-3 flex items-start gap-3 animate-fade-in">
            <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
              <CheckCircle size={16} className="text-green-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-800">Payment Received</p>
              <p className="text-xs text-gray-500 mt-0.5 truncate">{paymentToast.message}</p>
            </div>
            <button
              onClick={() => { setPaymentToast(null); clearTimeout(toastTimer.current); navigate('/payments'); }}
              className="text-xs text-[#1787FE] font-medium hover:underline flex-shrink-0"
            >
              View
            </button>
            <button
              onClick={() => { setPaymentToast(null); clearTimeout(toastTimer.current); }}
              className="text-gray-300 hover:text-gray-500 flex-shrink-0"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
