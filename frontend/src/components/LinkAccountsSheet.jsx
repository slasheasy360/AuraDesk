import { useState, useEffect, useCallback } from 'react';
import { X, ChevronRight, Check } from 'lucide-react';
import api from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';

/* ─────────────── BRAND ICONS (matching OnboardingPage) ─────────────── */
const InstagramIcon = () => (
  <svg viewBox="0 0 32 32" className="w-7 h-7">
    <defs>
      <radialGradient id="lasIgGrad" cx="30%" cy="107%" r="150%">
        <stop offset="0%" stopColor="#fdf497" />
        <stop offset="5%" stopColor="#fdf497" />
        <stop offset="45%" stopColor="#fd5949" />
        <stop offset="60%" stopColor="#d6249f" />
        <stop offset="90%" stopColor="#285AEB" />
      </radialGradient>
    </defs>
    <rect x="2" y="2" width="28" height="28" rx="8" fill="url(#lasIgGrad)" />
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

const PLATFORMS = [
  { id: 'facebook', name: 'Facebook' },
  { id: 'whatsapp', name: 'Whatsapp' },
  { id: 'gmail', name: 'Email' },
  { id: 'instagram', name: 'Instagram' },
];

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
    return 'Not available on your plan. Upgrade to connect.';
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
  return null; // can connect
}

export default function LinkAccountsSheet({ open, onClose }) {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState([]);
  const [connectingPlatform, setConnectingPlatform] = useState(null);
  const [connected, setConnected] = useState(() => {
    try { return JSON.parse(localStorage.getItem('connectedPlatforms')) || {}; }
    catch { return {}; }
  });
  const [errMsg, setErrMsg] = useState(null);

  useEffect(() => {
    localStorage.setItem('connectedPlatforms', JSON.stringify(connected));
  }, [connected]);

  const fetchAccounts = useCallback(() => {
    return api.get('/api/accounts').then((res) => {
      const list = res.data.accounts || [];
      setAccounts(list);
      setConnected((prev) => {
        const next = { ...prev };
        ['instagram', 'facebook', 'whatsapp', 'gmail'].forEach((id) => {
          next[id] = list.some((a) => a.platform === id && a.status === 'active');
        });
        return next;
      });
      return list;
    }).catch(() => []);
  }, []);

  const openAuthPopup = useCallback(async (platformId) => {
    const endpoints = {
      instagram: '/auth/instagram/start',
      facebook: '/auth/facebook/start',
      gmail: '/auth/gmail/start',
    };
    const res = await api.get(endpoints[platformId], { params: { popup: 1 } });
    const url = res.data?.url;
    if (!url) throw new Error('Missing OAuth URL');

    const popup = window.open(
      url,
      `auradesk-${platformId}-connect`,
      'width=520,height=700,menubar=0,toolbar=0,location=0,status=0,scrollbars=1'
    );

    if (!popup) throw new Error('Popup blocked. Please allow popups and try again.');

    const apiOrigin = new URL(api.defaults.baseURL || window.location.origin).origin;

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error('Connection timed out. Please try again.'));
      }, 2 * 60 * 1000);

      const pollId = setInterval(() => {
        if (popup.closed) {
          cleanup();
          reject(new Error('Connection window was closed.'));
        }
      }, 600);

      const onMessage = (event) => {
        if (![window.location.origin, apiOrigin].includes(event.origin)) return;
        const data = event.data;
        if (!data || data.type !== 'auradesk:connect') return;
        if (data.platform !== platformId) return;
        cleanup();
        if (data.status === 'success') resolve(data);
        else reject(new Error(data.reason || 'Connection failed.'));
      };

      const cleanup = () => {
        clearTimeout(timeoutId);
        clearInterval(pollId);
        window.removeEventListener('message', onMessage);
        try { popup.close(); } catch {}
      };

      window.addEventListener('message', onMessage);
    });
  }, []);

  useEffect(() => {
    if (open) fetchAccounts();
  }, [open, fetchAccounts]);

  useEffect(() => {
    if (errMsg) {
      const t = setTimeout(() => setErrMsg(null), 5000);
      return () => clearTimeout(t);
    }
  }, [errMsg]);

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
          version: 4,
          featureType: 'whatsapp_business_app_onboarding',
          setup: {},
        },
      }
    );
  };

  const handleConnect = async (platformId) => {
    if (platformId === 'whatsapp') {
      launchWhatsAppSignup();
      return;
    }
    try {
      setConnectingPlatform(platformId);
      await openAuthPopup(platformId);
      setConnected((prev) => ({ ...prev, [platformId]: true }));
      fetchAccounts();
    } catch (err) {
      console.error(`Connect ${platformId} failed:`, err);
      setErrMsg({ platform: platformId, reason: err.message || 'Failed to start authentication.' });
    } finally {
      setConnectingPlatform(null);
    }
  };

  const handleDisconnect = async (platformId) => {
    const account = accounts.find((a) => a.platform === platformId && a.status === 'active');
    setConnected((prev) => ({ ...prev, [platformId]: false }));
    if (!account) return;
    try {
      await api.delete(`/api/accounts/${account.id}`);
      fetchAccounts();
    } catch (err) {
      console.error('Disconnect failed:', err);
      setConnected((prev) => ({ ...prev, [platformId]: true }));
    }
  };

  const isConnected = (id) =>
    connected[id] || accounts.some((a) => a.platform === id && a.status === 'active');

  const accountFor = (id) => accounts.find((a) => a.platform === id && a.status === 'active');

  // ── ESC-to-close + body scroll lock while modal is open ──
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const companyName = user?.companyName || 'abc_company';
  const companyLogo = user?.companyLogo;

  return (
    // Responsive shell:
    //   • Mobile (<lg): backdrop + bottom sheet (drag-handle, slides up)
    //   • Desktop (lg+): backdrop + centered modal card
    // The same component handles both — outside-click and ESC close it
    // either way, and body scroll is locked while it's open.
    <div
      className="fixed inset-0 z-[60] flex flex-col lg:items-center lg:justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="link-accounts-title"
    >
      {/* Backdrop — also closes the modal on click */}
      <button
        type="button"
        aria-label="Close link accounts"
        onClick={onClose}
        className="absolute inset-0 bg-black/50"
      />

      {/* Sheet / modal card */}
      <div
        className="
          relative mt-auto lg:mt-0
          bg-white shadow-2xl flex flex-col
          rounded-t-3xl lg:rounded-2xl
          max-h-[88vh] lg:max-h-[80vh]
          w-full lg:w-[440px] lg:max-w-[92vw]
          animate-slide-up lg:animate-none
        "
      >
        {/* Mobile drag handle (hidden on desktop) */}
        <div className="pt-3 pb-1 flex justify-center lg:hidden">
          <div className="w-10 h-1 rounded-full bg-gray-300" />
        </div>

        <div className="px-5 pt-2 pb-3 lg:pt-5 lg:pb-4 flex items-center justify-between">
          <div className="w-8" />
          <h2
            id="link-accounts-title"
            className="text-base lg:text-lg font-bold text-gray-900"
          >
            Link Accounts
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100"
          >
            <X size={18} />
          </button>
        </div>

        {errMsg && (
          <div className="mx-5 mb-3 bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-xs">
            {errMsg.platform.charAt(0).toUpperCase() + errMsg.platform.slice(1)} — {errMsg.reason || 'Connection failed.'}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 pb-6 lg:pb-7 space-y-3">
          {PLATFORMS.map((p) => {
            if (isConnected(p.id)) {
              const acct = accountFor(p.id);
              return (
                <div
                  key={p.id}
                  className="w-full flex items-center justify-between bg-green-50 border border-green-200 rounded-full px-4 py-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {ICONS[p.id]}
                    <span className="font-medium text-sm text-gray-800 truncate">{p.name}</span>
                    <Check size={16} className="text-green-600 flex-shrink-0" />
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {companyLogo ? (
                      <img src={companyLogo} alt="" className="w-6 h-6 rounded-full object-cover" />
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-[#1787FE] text-white text-[10px] font-bold flex items-center justify-center">
                        {(acct?.displayName || companyName)?.[0]?.toUpperCase() || 'A'}
                      </div>
                    )}
                    <span className="text-xs text-gray-700 max-w-[80px] truncate">
                      {acct?.displayName || companyName}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDisconnect(p.id)}
                      className="text-xs font-semibold text-red-500 hover:text-red-600 ml-1"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              );
            }
            const isConnecting = connectingPlatform === p.id;
            const blockReason = getPlatformBlockReason(p.id, user?.plan, accounts);
            const isBlocked = !!blockReason;
            return (
              <div key={p.id} className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={() => !isBlocked && handleConnect(p.id)}
                  disabled={isConnecting || isBlocked}
                  title={blockReason || undefined}
                  className={`w-full flex items-center justify-between rounded-full px-4 py-3 transition
                    ${isBlocked
                      ? 'bg-gray-100 opacity-50 cursor-not-allowed'
                      : 'bg-[#EAF2FF] hover:bg-[#dbe8ff] disabled:opacity-70 disabled:cursor-not-allowed'
                    }`}
                >
                  <div className="flex items-center gap-3">
                    {ICONS[p.id]}
                    <span className="font-medium text-sm text-gray-800">
                      {isConnecting ? 'Connecting...' : `Connect ${p.name}`}
                    </span>
                  </div>
                  {isConnecting ? (
                    <span className="inline-flex h-4 w-4 items-center justify-center">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
                    </span>
                  ) : (
                    <ChevronRight size={18} className="text-gray-400" />
                  )}
                </button>
                {isBlocked && (
                  <p className="text-xs text-gray-500 px-4">{blockReason}</p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
