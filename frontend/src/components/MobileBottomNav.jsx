import { NavLink, useLocation } from 'react-router-dom';
import { LayoutDashboard, Inbox, Users, FileText, DollarSign } from 'lucide-react';

const NAV_ITEMS = [
  { to: '/', icon: LayoutDashboard, end: true },
  { to: '/inbox', icon: Inbox, end: false, matchPrefix: '/inbox' },
  { to: '/leads', icon: Users, end: false },
  { to: '/invoices', icon: FileText, end: false, matchPrefix: '/invoices' },
  { to: '/payments', icon: DollarSign, end: false },
];

export default function MobileBottomNav() {
  const location = useLocation();

  return (
    <nav
      className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#0B1628] border-t border-white/5 px-4 py-2 flex items-center justify-around"
      style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
    >
      {NAV_ITEMS.map(({ to, icon: Icon, end, matchPrefix }) => {
        const isActive = matchPrefix
          ? location.pathname === to || location.pathname.startsWith(matchPrefix + '/') || location.pathname === matchPrefix
          : end
            ? location.pathname === to
            : location.pathname === to || location.pathname.startsWith(to + '/');
        return (
          <NavLink
            key={to}
            to={to}
            end={end}
            className="flex items-center justify-center"
            aria-label={to}
          >
            <span
              className={`flex items-center justify-center w-11 h-11 rounded-full transition ${
                isActive
                  ? 'bg-[#1787FE] text-white shadow-lg shadow-[#1787FE]/30'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <Icon size={20} />
            </span>
          </NavLink>
        );
      })}
    </nav>
  );
}
