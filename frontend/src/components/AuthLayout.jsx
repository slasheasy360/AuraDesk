import { Link } from 'react-router-dom';
import logoUrl from '../assets/logo.svg';
import LaptopWithDashboard from './LaptopWithDashboard.jsx';

export default function AuthLayout({ children, rightHeader, mobileFooter }) {
  return (
    <div
      className="h-screen w-full overflow-hidden font-sans flex items-stretch"
      style={{ background: 'linear-gradient(to bottom, #011138 0%, #000414 100%)' }}
    >
      {/* LEFT PANEL — bleeds to viewport edges, no rounding */}
      <div
        className="hidden lg:flex lg:w-[45%] relative overflow-hidden flex-col px-12 pt-12 pb-0 text-white"
        style={{ background: '#000716' }}
      >
        {/* Top wash — solid #000716 fading into the laptop scene */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-[60%] z-[1]"
          style={{
            background:
              'linear-gradient(to bottom, #000716 0%, #000716 50%, rgba(0,7,22,0) 100%)',
          }}
        />
        <div className="relative z-10">
          <Link to="/" className="flex items-center gap-2.5">
            <img src={logoUrl} alt="AuraDesk" className="h-9 w-auto" />
            <span className="text-[22px] font-bold tracking-tight text-white">AuraDesk</span>
          </Link>
        </div>

        <div className="relative z-10 max-w-lg mt-10">
          <h1 className="text-[26px] xl:text-[34px] 2xl:text-[38px] leading-[1.1] font-bold tracking-tight mb-5">
            Run Your Business <span className="text-brand-blue">Smarter</span>
          </h1>
          <p className="text-[16px] font-semibold text-white mb-2">
            All From One Dashboard
          </p>
          <p className="text-[14px] text-white/60 leading-relaxed max-w-sm">
            AI-driven messaging, invoicing, client communication, and
            insightful reporting, designed just for solopreneurs.
          </p>
        </div>

        {/* LAYER: Laptop scene — absolutely centered at bottom of panel */}
        <div className="absolute left-1/2 -translate-x-1/2 bottom-[-40px] w-[115%] pointer-events-none select-none z-[5]">
          {/* Radial glow behind laptop */}
          <div
            className="pointer-events-none absolute inset-0 -z-10"
            style={{
              background:
                'radial-gradient(ellipse 70% 55% at 50% 65%, rgba(23,135,254,0.28) 0%, transparent 70%)',
              filter: 'blur(20px)',
            }}
          />
          <LaptopWithDashboard />
        </div>
      </div>

      {/* RIGHT PANEL — standalone rounded card on desktop, full-screen dark on mobile */}
      <div className="flex-1 lg:w-[62%] lg:my-7 lg:mr-7 lg:-ml-10 bg-transparent lg:bg-[#F8F9FB] flex flex-col relative z-10 lg:rounded-[24px] overflow-hidden lg:shadow-[0_30px_80px_rgba(0,0,0,0.5)]">
        {/* MOBILE: centered logo at top */}
        <div className="lg:hidden flex justify-center pt-12 pb-2">
          <Link to="/" className="flex items-center gap-2.5">
            <img src={logoUrl} alt="AuraDesk" className="h-9 w-auto" />
            <span className="text-[22px] font-bold tracking-tight text-white">AuraDesk</span>
          </Link>
        </div>

        {/* DESKTOP: top-right header link */}
        <div className="hidden lg:flex justify-end items-center px-8 lg:px-12 pt-8">
          {rightHeader}
        </div>

        {/* Form area */}
        <div className="flex-1 flex items-center justify-center px-6 sm:px-10 py-6">
          <div className="w-full max-w-[420px]">{children}</div>
        </div>

        {/* MOBILE: bottom switch link */}
        <div className="lg:hidden flex justify-center pb-[180px] text-[13px] text-white/70">
          {mobileFooter}
        </div>

        {/* DESKTOP: footer */}
        <div className="hidden lg:flex justify-start items-center px-8 lg:px-12 pb-6 text-[12px] text-brand-slate">
          <p>Copyright 2021 - 2025 AuraDesk Inc. All rights Reserved</p>
        </div>
      </div>
    </div>
  );
}

export function AuthInput({ label, type = 'text', value, onChange, required, minLength, hasToggle, show, onToggle }) {
  return (
    <div className="relative bg-[#0a1a2e]/40 lg:bg-white border border-white/10 lg:border-[#E5E7EB] rounded-xl px-4 pt-2.5 pb-2 h-[58px] focus-within:border-brand-blue focus-within:ring-2 focus-within:ring-brand-blue/20 transition">
      <label className="block text-[10px] font-semibold tracking-wider text-white/60 lg:text-brand-slate uppercase">
        {label}
      </label>
      <input
        type={hasToggle ? (show ? 'text' : 'password') : type}
        value={value}
        onChange={onChange}
        required={required}
        minLength={minLength}
        className="w-full bg-transparent outline-none text-[14px] text-white lg:text-brand-dark pr-7"
      />
      {hasToggle && (
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-4 top-1/2 -translate-y-1/2 text-white/60 lg:text-brand-slate hover:text-brand-blue"
          tabIndex={-1}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
      )}
    </div>
  );
}

export function GradientButton({ children, ...props }) {
  return (
    <button
      {...props}
      className="w-full py-3.5 rounded-xl text-white text-[14px] font-semibold tracking-wider uppercase shadow-lg shadow-brand-blue/30 transition hover:opacity-95 active:scale-[0.99] disabled:opacity-50 flex items-center justify-center gap-2"
      style={{
        background: 'linear-gradient(90deg, #2A6FD4 0%, #1787FE 100%)',
      }}
    >
      {children}
    </button>
  );
}

export function GoogleButton({ onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center justify-center gap-3 py-3 rounded-xl bg-[#E8F0FE] hover:bg-[#dbe7fc] text-brand-dark text-[14px] font-semibold transition"
    >
      <svg className="w-5 h-5" viewBox="0 0 24 24">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
      </svg>
      {label}
    </button>
  );
}
