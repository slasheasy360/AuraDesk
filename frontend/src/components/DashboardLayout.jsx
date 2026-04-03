import { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { connectSocket, disconnectSocket } from '../services/socket.js';
import { LayoutDashboard, Inbox, Users, FileText, Brain, LogOut, Menu, X, ChevronRight } from 'lucide-react';

export default function DashboardLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
    <div className="flex h-screen bg-gray-100">
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
          fixed inset-y-0 left-0 z-50 w-64 bg-sidebar text-white flex flex-col
          transform transition-transform duration-300 ease-out
          lg:relative lg:translate-x-0
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {/* Logo + close button */}
        <div className="px-5 py-5 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-primary-500 rounded-lg flex items-center justify-center text-lg font-bold">
              A
            </div>
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
                `flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition ${
                  isActive || (to === '/inbox' && location.pathname.startsWith('/inbox'))
                    ? 'bg-primary-600 text-white'
                    : 'text-gray-300 hover:bg-white/10 hover:text-white'
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
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              {companyLogo ? (
                <img src={companyLogo} alt={companyName} className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
              ) : (
                <div className="w-9 h-9 bg-primary-600 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0">
                  {companyName?.[0]?.toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{companyName}</p>
                <span className="inline-block px-2 py-0.5 text-[10px] font-bold bg-primary-500 rounded text-white mt-0.5">
                  {planLabel}
                </span>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="text-gray-400 hover:text-white transition flex-shrink-0"
              title="Logout"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile top bar */}
        <div className="lg:hidden bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-gray-600 hover:text-gray-900 transition"
          >
            <Menu size={24} />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-primary-500 rounded-md flex items-center justify-center text-sm font-bold text-white">
              A
            </div>
            <span className="font-semibold text-gray-900">AuraDesk</span>
          </div>
        </div>

        <main className="flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
