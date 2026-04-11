import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import api from '../services/api.js';
import { Check, ChevronRight, RefreshCw } from 'lucide-react';
import logoUrl from '../assets/logo.svg';

/* ─────────────── BRAND ICONS ─────────────── */
const InstagramIcon = () => (
  <svg viewBox="0 0 32 32" className="w-7 h-7">
    <defs>
      <radialGradient id="igGrad" cx="30%" cy="107%" r="150%">
        <stop offset="0%" stopColor="#fdf497" />
        <stop offset="5%" stopColor="#fdf497" />
        <stop offset="45%" stopColor="#fd5949" />
        <stop offset="60%" stopColor="#d6249f" />
        <stop offset="90%" stopColor="#285AEB" />
      </radialGradient>
    </defs>
    <rect x="2" y="2" width="28" height="28" rx="8" fill="url(#igGrad)" />
    <rect x="7" y="7" width="18" height="18" rx="5" fill="none" stroke="#fff" strokeWidth="2" />
    <circle cx="16" cy="16" r="4.5" fill="none" stroke="#fff" strokeWidth="2" />
    <circle cx="22.5" cy="9.5" r="1.3" fill="#fff" />
  </svg>
);
const FacebookIcon = () => (
  <svg viewBox="0 0 32 32" className="w-7 h-7">
    <circle cx="16" cy="16" r="15" fill="#1877F2" />
    <path
      d="M20 16.5h-3V25h-3.5v-8.5H11V13.5h2.5V11.4c0-2.4 1-3.9 3.9-3.9H20V10.5h-1.5c-1 0-1.1.4-1.1 1.1l0 1.9H20l-.5 3z"
      fill="#fff"
    />
  </svg>
);
const WhatsAppIcon = () => (
  <svg viewBox="0 0 32 32" className="w-7 h-7">
    <circle cx="16" cy="16" r="15" fill="#25D366" />
    <path
      d="M22.5 18.6c-.3-.2-1.9-.9-2.2-1-.3-.1-.5-.2-.7.2-.2.3-.8 1-1 1.2-.2.2-.4.2-.7 0-.3-.2-1.3-.5-2.5-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.7.1-.1.3-.4.5-.5.2-.2.2-.3.3-.5.1-.2 0-.4 0-.5-.1-.2-.7-1.7-1-2.3-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4-.3.3-1.1 1.1-1.1 2.7 0 1.6 1.2 3.1 1.3 3.3.2.2 2.3 3.5 5.5 4.9 3.2 1.4 3.2.9 3.8.9.6-.1 1.9-.8 2.2-1.5.3-.7.3-1.4.2-1.5-.1-.1-.3-.2-.6-.4z"
      fill="#fff"
    />
  </svg>
);
const GmailIcon = () => (
  <svg viewBox="0 0 32 32" className="w-7 h-7">
    <circle cx="16" cy="16" r="15" fill="#fff" stroke="#e5e7eb" strokeWidth="0.8" />
    <g transform="translate(7 10)">
      <path d="M0 1.2C0 .54.54 0 1.2 0H2v10H1.2C.54 10 0 9.46 0 8.8z" fill="#4285F4" />
      <path d="M18 1.2C18 .54 17.46 0 16.8 0H16v10h.8c.66 0 1.2-.54 1.2-1.2z" fill="#34A853" />
      <path d="M2 0v10h2V4l5 4 5-4v6h2V0L9 6z" fill="#EA4335" />
      <path d="M2 0l7 6 7-6h-2L9 4 4 0z" fill="#FBBC04" />
    </g>
  </svg>
);

const ICONS = {
  instagram: <InstagramIcon />,
  facebook: <FacebookIcon />,
  whatsapp: <WhatsAppIcon />,
  gmail: <GmailIcon />,
};

/* ─────────────── STEP INDICATOR ─────────────── */
function StepIndicator({ current, onStepClick, maxStep }) {
  const dots = [0, 1, 2];
  return (
    <div className="flex items-center justify-center mb-8">
      {dots.map((i) => (
        <div key={i} className="flex items-center">
          <button
            type="button"
            onClick={() => onStepClick(i)}
            disabled={i > maxStep}
            className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold border-2 transition disabled:cursor-not-allowed ${
              i < current
                ? 'bg-blue-500 border-blue-500 text-white'
                : i === current
                ? 'bg-blue-500 border-blue-500 text-white shadow-[0_0_0_4px_rgba(59,130,246,0.15)]'
                : 'bg-white border-blue-200 text-blue-300'
            }`}
          >
            {i < current ? <Check size={16} /> : i + 1}
          </button>
          {i < dots.length - 1 && (
            <div className={`w-12 h-[2px] ${i < current ? 'bg-blue-500' : 'bg-blue-200'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

/* ─────────────── PRIMARY BUTTON ─────────────── */
function PrimaryButton({ children, ...props }) {
  return (
    <button
      {...props}
      className="w-full sm:w-auto sm:min-w-[260px] bg-[#0B1E3F] hover:bg-[#13294d] text-white px-8 py-3.5 rounded-lg font-semibold text-sm tracking-wider transition disabled:opacity-50 flex items-center justify-center gap-2"
    >
      {children} <ChevronRight size={16} />
    </button>
  );
}

// Mirror of backend/src/config/plans.js — keep in sync.
const PLAN_LIMITS = {
  trial:   { maxConnections: 1, allowedPlatforms: ['facebook', 'instagram'], exclusivePlatforms: true },
  starter: { maxConnections: 1, allowedPlatforms: ['facebook', 'instagram'], exclusivePlatforms: true },
  pro:     { maxConnections: 3, allowedPlatforms: ['facebook', 'instagram', 'whatsapp', 'gmail'], exclusivePlatforms: false },
  elite:   { maxConnections: 4, allowedPlatforms: ['facebook', 'instagram', 'whatsapp', 'gmail'], exclusivePlatforms: false },
};

function getPlatformBlockReason(platformId, userPlan, activeAccounts) {
  const limits = PLAN_LIMITS[userPlan] || PLAN_LIMITS.trial;
  if (!limits.allowedPlatforms.includes(platformId)) {
    return 'Not available on your plan. Upgrade to Pro to connect.';
  }
  const activeCount = activeAccounts.filter((a) => a.status === 'active').length;
  if (limits.exclusivePlatforms && activeCount > 0) {
    const existing = activeAccounts.find((a) => a.status === 'active');
    if (existing && existing.platform !== platformId) {
      return 'You must disconnect the currently connected platform before connecting a new one.';
    }
  }
  if (activeCount >= limits.maxConnections) {
    return `You've reached your ${limits.maxConnections}-connection limit. Upgrade to connect more.`;
  }
  return null;
}

/* ─────────────── STEP 1: CONNECT PLATFORM ─────────────── */
function PlatformStep({ onNext, successPlatform, errorInfo }) {
  const { user } = useAuth();
  const [errMsg, setErrMsg] = useState(errorInfo?.platform ? errorInfo : null);
  useEffect(() => {
    if (errMsg) {
      const t = setTimeout(() => setErrMsg(null), 6000);
      return () => clearTimeout(t);
    }
  }, [errMsg]);
  const [accounts, setAccounts] = useState([]);
  const [, setLoading] = useState(true);
  const [successMsg, setSuccessMsg] = useState(successPlatform || null);
  const [connected, setConnected] = useState(() => {
    try { return JSON.parse(localStorage.getItem('connectedPlatforms')) || {}; }
    catch { return {}; }
  });
  const pollRef = useRef(null);

  useEffect(() => {
    localStorage.setItem('connectedPlatforms', JSON.stringify(connected));
  }, [connected]);

  const platforms = [
    { id: 'instagram', name: 'Instagram' },
    { id: 'facebook', name: 'Facebook' },
    { id: 'whatsapp', name: 'Whatsapp' },
    { id: 'gmail', name: 'Email' },
  ];

  const fetchAccounts = useCallback(() => {
    setLoading(true);
    return api.get('/api/accounts').then((res) => {
      const list = res.data.accounts || [];
      setAccounts(list);
      // Sync localStorage map with backend truth
      setConnected((prev) => {
        const next = { ...prev };
        ['instagram', 'facebook', 'whatsapp', 'gmail'].forEach((id) => {
          next[id] = list.some((a) => a.platform === id && a.status === 'active');
        });
        return next;
      });
      return list;
    }).catch(() => []).finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  useEffect(() => {
    if (!successPlatform) return;
    // Optimistically mark connected so UI updates immediately
    setConnected((prev) => ({ ...prev, [successPlatform]: true }));
    let attempts = 0;
    const poll = async () => {
      attempts++;
      const accts = await fetchAccounts();
      const found = accts.some((a) => a.platform === successPlatform && a.status === 'active');
      if (found || attempts >= 15) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
    const t = setTimeout(() => {
      poll();
      pollRef.current = setInterval(poll, 2000);
    }, 500);
    return () => {
      clearTimeout(t);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [successPlatform, fetchAccounts]);

  useEffect(() => {
    if (successMsg) {
      const t = setTimeout(() => setSuccessMsg(null), 4000);
      return () => clearTimeout(t);
    }
  }, [successMsg]);

  const launchWhatsAppSignup = () => {
    if (typeof window.FB === 'undefined') {
      setErrMsg({ platform: 'whatsapp', reason: 'Facebook SDK not loaded. Please refresh and try again.' });
      return;
    }
    window.__WA_EMBEDDED_DATA__ = null;

    const sessionInfoListener = (event) => {
      if (!event.origin.includes('facebook.com') && !event.origin.includes('fbcdn.net') && !event.origin.includes('meta.com')) return;
      let data;
      try { data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; } catch { return; }
      if (data.type === 'WA_EMBEDDED_SIGNUP') {
        if (data.event === 'FINISH' || data.event === 'FINISH_ONLY_WABA') {
          const sd = data.data || {};
          const authResp = data.authResponse || {};
          window.__WA_EMBEDDED_DATA__ = {
            code: authResp.code,
            waba_id: sd.waba_id || data.waba_id,
            phone_number_id: sd.phone_number_id || data.phone_number_id,
          };
        } else if (data.event === 'CANCEL') {
          setErrMsg({ platform: 'whatsapp', reason: 'WhatsApp signup was cancelled.' });
        }
      }
    };
    window.addEventListener('message', sessionInfoListener);

    window.FB.login(
      (response) => {
        window.removeEventListener('message', sessionInfoListener);
        if (!response.authResponse) {
          if (!window.__WA_EMBEDDED_DATA__) {
            setErrMsg({ platform: 'whatsapp', reason: 'WhatsApp signup was cancelled or failed.' });
          }
          return;
        }
        const code = response.authResponse.code;
        const embedded = window.__WA_EMBEDDED_DATA__ || {};
        if (code) {
          api.post('/auth/whatsapp/exchange', {
            code,
            waba_id: embedded.waba_id || null,
            phone_number_id: embedded.phone_number_id || null,
          })
            .then(() => {
              setConnected((prev) => ({ ...prev, whatsapp: true }));
              fetchAccounts();
            })
            .catch((err) => {
              console.error('WhatsApp exchange failed:', err);
              setErrMsg({ platform: 'whatsapp', reason: err.response?.data?.error || 'Failed to connect WhatsApp.' });
            });
          return;
        }
        const accessToken = response.authResponse.accessToken;
        if (accessToken) {
          const payload = { accessToken };
          if (embedded.waba_id) payload.wabaId = embedded.waba_id;
          if (embedded.phone_number_id) payload.phoneNumberId = embedded.phone_number_id;
          api.post('/auth/whatsapp/connect-with-token', payload)
            .then(() => {
              setConnected((prev) => ({ ...prev, whatsapp: true }));
              fetchAccounts();
            })
            .catch((err) => {
              console.error('WhatsApp connect failed:', err);
              setErrMsg({ platform: 'whatsapp', reason: err.response?.data?.error || 'Failed to connect WhatsApp.' });
            });
        }
      },
      {
        config_id: import.meta.env.VITE_WA_CONFIG_ID,
        response_type: 'code',
        override_default_response_type: true,
        scope: 'whatsapp_business_messaging,business_management,whatsapp_business_management',
        extras: {
          feature: 'whatsapp_embedded_signup',
          version: 2,
          setup: {},
        },
      }
    );
  };

  const handleConnect = async (platformId) => {
    // Plan-gate check before starting OAuth
    const blockReason = getPlatformBlockReason(platformId, user?.plan, accounts);
    if (blockReason) {
      setErrMsg({ platform: platformId, reason: blockReason });
      return;
    }
    if (platformId === 'whatsapp') {
      launchWhatsAppSignup();
      return;
    }
    const endpoints = {
      instagram: '/auth/instagram/start',
      facebook: '/auth/facebook/start',
      gmail: '/auth/gmail/start',
    };
    try {
      const res = await api.get(endpoints[platformId]);
      if (res.data.url) window.location.href = res.data.url;
    } catch (err) {
      console.error(`Connect ${platformId} failed:`, err);
      setErrMsg({ platform: platformId, reason: 'Failed to start authentication.' });
    }
  };

  const handleDisconnect = async (platformId) => {
    const account = accounts.find((a) => a.platform === platformId && a.status === 'active');
    // Optimistically clear UI
    setConnected((prev) => ({ ...prev, [platformId]: false }));
    if (!account) return;
    try {
      await api.delete(`/api/accounts/${account.id}`);
      fetchAccounts();
    } catch (err) {
      console.error('Disconnect failed:', err);
      // Roll back on error
      setConnected((prev) => ({ ...prev, [platformId]: true }));
    }
  };

  const isConnected = (id) =>
    connected[id] || accounts.some((a) => a.platform === id && a.status === 'active');

  return (
    <div className="text-center">
      <h2 className="text-[26px] sm:text-[28px] font-bold text-gray-800 mb-1">Connect Platform</h2>
      <p className="text-gray-400 text-[11px] tracking-[0.18em] font-semibold mb-7">SETUP YOUR ORGANISATION</p>

      {successMsg && (
        <div className="mb-4 max-w-md mx-auto bg-green-50 border border-green-200 text-green-700 px-4 py-2 rounded-lg text-sm">
          ✓ {successMsg.charAt(0).toUpperCase() + successMsg.slice(1)} connected successfully!
        </div>
      )}
      {errMsg && (
        <div className="mb-4 max-w-md mx-auto bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">
          ✕ {errMsg.platform.charAt(0).toUpperCase() + errMsg.platform.slice(1)} — {errMsg.reason || 'Connection failed.'}
        </div>
      )}

      <div className="space-y-3 max-w-md mx-auto">
        {platforms.map((p) => {
          if (isConnected(p.id)) {
            return (
              <div
                key={p.id}
                className="w-full flex items-center justify-between bg-green-50 border border-green-300 rounded-full px-5 py-3 transition-all duration-300"
              >
                <div className="flex items-center gap-3">
                  {ICONS[p.id]}
                  <span className="font-medium text-sm text-gray-800">{p.name}</span>
                </div>
                <button
                  onClick={() => handleDisconnect(p.id)}
                  className="text-xs font-semibold text-red-500 hover:text-red-600 transition"
                >
                  Disconnect
                </button>
              </div>
            );
          }
          const blockReason = getPlatformBlockReason(p.id, user?.plan, accounts);
          const isBlocked = !!blockReason;
          return (
            <div key={p.id} className="flex flex-col gap-1">
              <button
                onClick={() => handleConnect(p.id)}
                disabled={isBlocked}
                title={blockReason || undefined}
                className={`w-full flex items-center justify-between rounded-full px-5 py-3 transition-all duration-300
                  ${isBlocked
                    ? 'bg-gray-100 opacity-50 cursor-not-allowed'
                    : 'bg-[#EAF2FF] hover:bg-[#dbe8ff]'
                  }`}
              >
                <div className="flex items-center gap-3">
                  {ICONS[p.id]}
                  <span className="font-medium text-sm text-gray-800">Connect {p.name}</span>
                </div>
                <ChevronRight size={18} className="text-gray-400" />
              </button>
              {isBlocked && (
                <p className="text-xs text-gray-500 px-5">{blockReason}</p>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-8 flex justify-center">
        <PrimaryButton onClick={onNext}>CONTINUE</PrimaryButton>
      </div>
    </div>
  );
}

/* ─────────────── STEP 2: BRANDING ─────────────── */
function BrandingStep({ onNext, savedData, onSaveData }) {
  const [form, setForm] = useState(savedData || { firstName: '', lastName: '', companyName: '' });
  const [logoPreview, setLogoPreview] = useState(savedData?.companyLogo || null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);
  const { refreshUser, updateUser } = useAuth();

  useEffect(() => {
    if (!savedData?.firstName) {
      api.get('/api/onboarding/status').then((res) => {
        const d = res.data;
        if (d.firstName || d.companyName) {
          setForm({
            firstName: d.firstName || '',
            lastName: d.lastName || '',
            companyName: d.companyName || '',
            companyLogo: d.companyLogo || null,
          });
          if (d.companyLogo) setLogoPreview(d.companyLogo);
        }
      }).catch(() => {});
    }
  }, [savedData]);

  const handleLogoSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setLogoPreview(ev.target.result);
    reader.readAsDataURL(file);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('logo', file);
      const res = await api.post('/api/onboarding/upload-logo', fd, {
        headers: { 'Content-Type': undefined },
      });
      if (res.data.url) {
        // Store the permanent S3 key in the form (not the expiring presigned URL).
        // The presigned URL is only used for the live preview.
        setForm((prev) => ({ ...prev, companyLogo: res.data.s3Key || res.data.url }));
        setLogoPreview(res.data.url);
      }
    } catch (err) {
      console.error('Logo upload failed:', err);
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async () => {
    if (!form.firstName || !form.companyName) return;
    setSaving(true);
    try {
      // Branding endpoint sets onboardingCompleted = true server-side.
      await api.post('/api/onboarding/branding', form);
      onSaveData(form);
      // Do NOT call updateUser({ onboardingCompleted: true }) here — that
      // would cause the onboarding status check to redirect to '/' before
      // the success screen (step 2) is shown. The flag is set after the
      // user clicks "LET'S START" in the SuccessScreen.
      onNext();
    } catch (err) {
      console.error('Branding save failed:', err);
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full bg-[#EAF2FF] border border-transparent rounded-lg px-3 py-2.5 text-sm focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none';

  return (
    <div className="text-center">
      <h2 className="text-[26px] sm:text-[28px] font-bold text-gray-800 mb-1">Set up Branding</h2>
      <p className="text-gray-400 text-[11px] tracking-[0.18em] font-semibold mb-7">SETUP YOUR ORGANISATION</p>

      <div className="max-w-md mx-auto space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] font-semibold text-gray-500 tracking-wider mb-1.5 text-left">FIRST NAME *</label>
            <input
              type="text"
              value={form.firstName}
              onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-gray-500 tracking-wider mb-1.5 text-left">LAST NAME</label>
            <input
              type="text"
              value={form.lastName}
              onChange={(e) => setForm({ ...form, lastName: e.target.value })}
              className={inputCls}
            />
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-gray-500 tracking-wider mb-1.5 text-left">COMPANY NAME *</label>
          <input
            type="text"
            value={form.companyName}
            onChange={(e) => setForm({ ...form, companyName: e.target.value })}
            className={inputCls}
          />
        </div>

        <div className="pt-2 flex flex-col items-center">
          <label className="block text-[11px] font-semibold text-gray-500 tracking-wider mb-1.5">COMPANY LOGO</label>
          <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleLogoSelect} />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="w-20 h-20 border-2 border-blue-300 rounded-full flex items-center justify-center text-blue-400 cursor-pointer hover:bg-blue-50 overflow-hidden"
          >
            {logoPreview ? (
              <img src={logoPreview} alt="Logo" className="w-full h-full object-cover rounded-full" />
            ) : uploading ? (
              <RefreshCw size={20} className="animate-spin" />
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-7 h-7">
                <path d="M3 7h4l2-2h6l2 2h4v12H3z" />
                <circle cx="12" cy="13" r="3" />
              </svg>
            )}
          </button>
        </div>
      </div>

      <div className="mt-7 flex justify-center">
        <PrimaryButton
          onClick={handleSubmit}
          disabled={!form.firstName || !form.companyName || saving}
        >
          {saving ? 'SAVING…' : 'CONTINUE'}
        </PrimaryButton>
      </div>
    </div>
  );
}

/* ─────────────── SUCCESS SCREEN ─────────────── */
function SuccessScreen({ onFinish }) {
  return (
    <div className="text-center py-6 sm:py-10">
      <div className="relative w-32 h-32 mx-auto mb-7">
        {/* Scalloped seal */}
        <svg viewBox="0 0 120 120" className="w-full h-full">
          <defs>
            <radialGradient id="sealGrad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#3B82F6" />
              <stop offset="100%" stopColor="#1D4ED8" />
            </radialGradient>
          </defs>
          <g fill="url(#sealGrad)">
            {Array.from({ length: 16 }).map((_, i) => {
              const angle = (i * 360) / 16;
              return (
                <circle
                  key={i}
                  cx={60 + 48 * Math.cos((angle * Math.PI) / 180)}
                  cy={60 + 48 * Math.sin((angle * Math.PI) / 180)}
                  r="11"
                />
              );
            })}
          </g>
          <circle cx="60" cy="60" r="46" fill="url(#sealGrad)" />
          <circle cx="60" cy="60" r="36" fill="#fff" />
          <path
            d="M44 60 L55 71 L78 48"
            fill="none"
            stroke="#3B82F6"
            strokeWidth="6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <h2 className="text-[26px] sm:text-[30px] font-bold text-gray-800 leading-tight mb-2">
        Organisation Setup<br />Successful
      </h2>
      <p className="text-gray-400 text-[11px] tracking-[0.18em] font-semibold mb-7">
        WELCOME ABOARD! START YOUR JOURNEY WITH AURADESK.
      </p>
      <div className="flex justify-center">
        <PrimaryButton onClick={onFinish}>LET'S START</PrimaryButton>
      </div>
    </div>
  );
}

/* ─────────────── MAIN ─────────────── */
export default function OnboardingPage() {
  const [step, setStep] = useState(0); // 0=platform, 1=branding, 2=success
  const stepRef = useRef(0); // mirror of step for use inside effects without stale closure
  const [maxStep, setMaxStep] = useState(0);
  const [brandingData, setBrandingData] = useState(null);
  // Brief success banner shown when a brand-new subscriber lands here from
  // /payment/success. The actual subscription sync happens on /payment/success;
  // by the time we get here the user row is already up-to-date.
  const [showWelcome, setShowWelcome] = useState(false);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { refreshUser, updateUser } = useAuth();

  const successPlatformRef = useRef(searchParams.get('success'));
  const successPlatform = successPlatformRef.current;
  const errorRef = useRef({
    platform: searchParams.get('error'),
    reason: searchParams.get('reason'),
  });
  useEffect(() => {
    const sp = searchParams.get('success');
    const ep = searchParams.get('error');
    const welcome = searchParams.get('welcome');
    if (sp) successPlatformRef.current = sp;
    if (ep) errorRef.current = { platform: ep, reason: searchParams.get('reason') };
    if (welcome === '1') setShowWelcome(true);
    if (sp || ep || welcome) setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);
  const errorInfo = errorRef.current;

  // Auto-dismiss the welcome banner after a short window so it doesn't
  // linger over the onboarding form.
  useEffect(() => {
    if (!showWelcome) return;
    const t = setTimeout(() => setShowWelcome(false), 5000);
    return () => clearTimeout(t);
  }, [showWelcome]);

  useEffect(() => {
    if (!localStorage.getItem('token')) {
      navigate('/login');
      return;
    }
    api.get('/api/onboarding/status').then((res) => {
      // ── Hard short-circuit ──
      // The backend `onboardingCompleted` flag is the single source of
      // truth. If it's set, redirect to dashboard — UNLESS we're already
      // on the success screen (step 2), in which case let the user click
      // "LET'S START" themselves.
      if (res.data?.onboardingCompleted && stepRef.current < 2) {
        navigate('/', { replace: true });
        return;
      }

      // Pre-fill the branding form if the user has typed in it before
      // (e.g. they returned mid-flow). The wizard always starts on the
      // platform step — it's optional, so anyone can advance from it.
      if (res.data?.firstName || res.data?.companyName) {
        setBrandingData({
          firstName: res.data.firstName || '',
          lastName: res.data.lastName || '',
          companyName: res.data.companyName || '',
          brandColor: res.data.brandColor || '',
          companyLogo: res.data.companyLogo || null,
        });
      }
    }).catch((err) => {
      if (err.response?.status === 401) navigate('/login');
    });
  }, [navigate]);

  const goTo = (n) => {
    stepRef.current = n;
    setStep(n);
    setMaxStep((m) => Math.max(m, n));
  };

  // Called from the SuccessScreen "LET'S START" button. Branding has
  // already set onboardingCompleted = true server-side and updateUser()
  // has written it to React state + localStorage. The /complete call here
  // is a defensive safety net for any partial-state edge case.
  const handleFinish = async () => {
    try {
      await api.post('/api/onboarding/complete');
    } catch {
      // non-fatal — branding endpoint already flipped the flag
    }
    // Ensure the flag is in state even if branding's updateUser was somehow
    // skipped (e.g., user jumped directly to the success screen in an older
    // session). refreshUser() then does a full authoritative sync.
    updateUser({ onboardingCompleted: true });
    try {
      if (refreshUser) await refreshUser();
    } catch {
      // non-fatal — updateUser() above is the safety net
    }
    navigate('/', { replace: true });
  };

  return (
    <div className="relative min-h-screen bg-[#f4f7fb] flex flex-col items-center justify-center px-4 py-8">
      <div className="mb-6 flex items-center gap-2">
        <img src={logoUrl} alt="AuraDesk" className="h-7 w-auto" />
        <span className="text-[18px] font-bold text-blue-600">AuraDesk</span>
      </div>

      {showWelcome && (
        <div className="mb-4 max-w-2xl w-full bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm flex items-center justify-center gap-2">
          <span>Subscription active — let's finish setting up your workspace.</span>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-[0_2px_24px_rgba(15,42,99,0.06)] border border-blue-100/60 p-6 sm:p-10 md:p-12 w-full max-w-2xl">
        <StepIndicator current={step} maxStep={maxStep} onStepClick={goTo} />
        {step === 0 && <PlatformStep onNext={() => goTo(1)} successPlatform={successPlatform} errorInfo={errorInfo} />}
        {step === 1 && (
          <BrandingStep
            onNext={() => goTo(2)}
            savedData={brandingData}
            onSaveData={setBrandingData}
          />
        )}
        {step === 2 && <SuccessScreen onFinish={handleFinish} />}
      </div>

      <footer className="absolute left-6 bottom-4 text-[11px] text-gray-400">
        Copyright 2021 - 2025 AuraDesk Inc. All Rights Reserved.
      </footer>
    </div>
  );
}
