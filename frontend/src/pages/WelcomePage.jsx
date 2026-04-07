import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import logoUrl from '../assets/logo.svg';
import laptopUrl from '../assets/laptop.png';

function useIsDesktop(minWidth = 768) {
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(`(min-width: ${minWidth}px)`).matches;
  });

  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${minWidth}px)`);
    const handler = (e) => setIsDesktop(e.matches);
    // Newer + older API compatibility
    if (mql.addEventListener) mql.addEventListener('change', handler);
    else mql.addListener(handler);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', handler);
      else mql.removeListener(handler);
    };
  }, [minWidth]);

  return isDesktop;
}

export default function WelcomePage() {
  const isDesktop = useIsDesktop(768);

  // Desktop / tablet: don't show the welcome screen — go straight to login.
  if (isDesktop) return <Navigate to="/login" replace />;

  return (
    <div
      className="relative min-h-screen w-full flex flex-col items-center font-sans text-white px-6 pt-14 pb-10 overflow-hidden"
      style={{ background: 'linear-gradient(180deg, #000716 0%, #000716 35%, #001138 60%, #001138 100%)' }}
    >
      {/* Top wash — solid #000716 fading into the laptop scene */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[55%] z-0"
        style={{
          background:
            'linear-gradient(to bottom, #000716 0%, #000716 50%, rgba(0,7,22,0) 100%)',
        }}
      />

      {/* Logo */}
      <Link to="/" className="relative z-10 flex items-center gap-2.5">
        <img src={logoUrl} alt="AuraDesk" className="h-10 w-auto" />
        <span className="text-[26px] font-bold tracking-tight">AuraDesk</span>
      </Link>

      {/* Heading */}
      <div className="relative z-10 text-center mt-10">
        <h1 className="text-[26px] sm:text-[30px] leading-[1.15] font-bold tracking-tight whitespace-nowrap">
          Run Your Business <span className="text-brand-blue">Smarter</span>
        </h1>
        <p className="text-[16px] font-medium text-white/85 mt-2">
          All From One Dashboard
        </p>
      </div>

      {/* Laptop image — phone view uses laptop.png (dashboard already baked in) */}
      <div className="relative z-10 w-[167%] -mx-[33.5%] max-w-none mt-8 pointer-events-none select-none">
        <div
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              'radial-gradient(ellipse 70% 55% at 50% 65%, rgba(23,135,254,0.32) 0%, transparent 70%)',
            filter: 'blur(18px)',
          }}
        />
        <img
          src={laptopUrl}
          alt="AuraDesk dashboard preview"
          className="block w-full h-auto"
          style={{ filter: 'drop-shadow(0 30px 40px rgba(0,0,0,0.55))' }}
        />
      </div>

      {/* CTAs */}
      <div className="relative z-10 w-full max-w-[420px] mt-2 flex flex-col gap-2.5">
        <Link
          to="/login?from=welcome"
          className="block w-full text-center py-[18px] rounded-xl text-white text-[14px] font-bold tracking-[0.12em] uppercase shadow-lg shadow-brand-blue/30 transition active:scale-[0.99]"
          style={{ background: 'linear-gradient(90deg, #2A6FD4 0%, #1787FE 100%)' }}
        >
          LOG IN
        </Link>
        <Link
          to="/register?from=welcome"
          className="block w-full text-center py-[18px] rounded-xl bg-white text-brand-dark text-[14px] font-bold tracking-[0.12em] uppercase transition active:scale-[0.99]"
        >
          SIGN UP
        </Link>
      </div>

    </div>
  );
}
