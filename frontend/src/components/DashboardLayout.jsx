import { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { LinkAccountsProvider, useLinkAccounts } from '../context/LinkAccountsContext.jsx';
import { connectSocket, disconnectSocket } from '../services/socket.js';
import { LayoutDashboard, Inbox, Users, FileText, Brain, LogOut, Menu, X, ChevronRight } from 'lucide-react';
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

  useEffect(() => {
    if (user?.id) {
      connectSocket(user.id);
    }
    return () => disconnectSocket();
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
    navigate('/login');
  };

  const navItems = [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/inbox', icon: Inbox, label: 'Smart Inbox' },
    { to: '/leads', icon: Users, label: 'Leads' },
    { to: '/invoices', icon: FileText, label: 'Invoices' },
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
        {/* Mobile top bar — logo + wordmark on left, hamburger + company avatar on right */}
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
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSidebarOpen(true)}
              className="text-gray-300 hover:text-white transition p-1.5"
              aria-label="Open menu"
            >
              <Menu size={22} />
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
        </div>

        <main className="flex-1 overflow-hidden pb-16 lg:pb-0">
          <Outlet />
        </main>

        <MobileBottomNav />
      </div>

      {/* Global Link Accounts modal — single instance, opened from anywhere
          inside the dashboard via the LinkAccounts context. */}
      <LinkAccountsSheet open={linkAccountsOpen} onClose={closeLinkAccounts} />
    </div>
  );
}
