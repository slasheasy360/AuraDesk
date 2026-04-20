import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../services/api.js';
import { PlatformIcon } from '../components/PlatformBadge.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { Link2, CheckCircle, Trash2, Loader2, AlertCircle, RefreshCw, Wifi, WifiOff, Lock, X } from 'lucide-react';

/* ─── Per-platform prerequisites the user must acknowledge before connecting ─── */
const PLATFORM_REQUIREMENTS = {
  whatsapp: [
    {
      id: 'business_account',
      label: 'I have a WhatsApp Business account',
      help: 'Personal WhatsApp accounts cannot connect to the API. Download the WhatsApp Business app and set one up first.',
    },
    {
      id: 'unused_number',
      label: 'My phone number is not already connected to another account',
      help: 'Each phone number can only be linked to one WhatsApp Business API account at a time.',
    },
    {
      id: 'no_existing',
      label: 'No existing WhatsApp connection is active (or I\'ve already disconnected it)',
      help: 'Only one WhatsApp Business account can be active per workspace. Disconnect any existing one first.',
    },
  ],
  instagram: [
    {
      id: 'business_creator',
      label: 'I have an Instagram Business or Creator account',
      help: 'Personal accounts cannot receive DMs via the API. Go to Instagram → Settings → Account → Switch to Professional Account.',
    },
    {
      id: 'linked_page',
      label: 'My Instagram account is linked to a Facebook Page',
      help: 'Required by Meta. Go to Facebook → Settings → Linked Accounts → Instagram and connect your account.',
    },
  ],
  facebook: [
    {
      id: 'page_admin',
      label: 'I am an admin of the Facebook Page I want to connect',
      help: 'Only Page admins can authorize Messenger API access. Check your role at facebook.com/settings?tab=roles.',
    },
    {
      id: 'grant_permissions',
      label: 'I am ready to grant the required permissions during the sign-in flow',
      help: 'The popup will request: manage_pages, pages_messaging, and pages_read_engagement.',
    },
  ],
  gmail: [
    {
      id: 'valid_account',
      label: 'I have a valid Gmail or Google Workspace account',
      help: 'Any Google account with Gmail enabled works. Google Workspace accounts may need admin approval.',
    },
    {
      id: 'grant_access',
      label: 'I am ready to grant AuraDesk access during the Google sign-in flow',
      help: 'Google will ask you to allow AuraDesk to read and send emails on your behalf.',
    },
  ],
};

/* ─── Connect Requirements Modal ─── */
function ConnectModal({ platform, onClose, onConfirm }) {
  const reqs = PLATFORM_REQUIREMENTS[platform.id] || [];
  const [checked, setChecked] = useState(new Set());
  const total = reqs.length;
  const done = reqs.filter((r) => checked.has(r.id)).length;
  const allDone = done === total;

  const toggle = (id) => {
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Close on backdrop click or Escape key
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden animate-in">
        {/* Modal header */}
        <div className={`px-6 py-5 flex items-center justify-between border-b border-gray-100`}>
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl ${platform.bgColor} ${platform.iconColor} flex items-center justify-center flex-shrink-0`}>
              <PlatformIcon platform={platform.id} size={18} />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900">Connect {platform.name}</h2>
              <p className="text-xs text-gray-500">Confirm the requirements below before continuing</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition p-1 rounded-lg hover:bg-gray-100">
            <X size={18} />
          </button>
        </div>

        {/* Checklist body */}
        <div className="px-6 py-5 space-y-3">
          {/* Progress indicator */}
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Requirements</span>
            <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full transition-colors ${
              allDone ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
            }`}>
              {done}/{total} completed
            </span>
          </div>

          {/* Progress bar */}
          <div className="h-1 w-full rounded-full bg-gray-100 overflow-hidden mb-3">
            <div
              className="h-full rounded-full transition-all duration-400 ease-out"
              style={{
                width: `${total > 0 ? (done / total) * 100 : 0}%`,
                backgroundColor: allDone ? '#10b981' : '#f59e0b',
              }}
            />
          </div>

          {/* Checklist items */}
          <ul className="space-y-2.5">
            {reqs.map((req) => {
              const isChecked = checked.has(req.id);
              return (
                <li key={req.id}>
                  <button
                    type="button"
                    onClick={() => toggle(req.id)}
                    className={`w-full flex items-start gap-3 p-3 rounded-xl border-2 text-left transition-all duration-200 ${
                      isChecked
                        ? 'border-green-200 bg-green-50'
                        : 'border-gray-100 bg-gray-50 hover:border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    {/* Checkbox */}
                    <span className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all duration-200 ${
                      isChecked ? 'bg-green-500 border-green-500' : 'bg-white border-gray-300'
                    }`}>
                      {isChecked && (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium leading-snug ${isChecked ? 'text-green-700' : 'text-gray-700'}`}>
                        {req.label}
                      </p>
                      {req.help && !isChecked && (
                        <p className="text-xs text-gray-400 mt-0.5 leading-snug">{req.help}</p>
                      )}
                    </div>
                    {isChecked && (
                      <CheckCircle size={16} className="text-green-500 flex-shrink-0 mt-0.5" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Footer actions */}
        <div className="px-6 pb-5 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 transition"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!allDone}
            className={`flex-1 py-2.5 text-sm font-semibold text-white rounded-xl transition-all duration-200 ${
              allDone
                ? `${platform.btnColor} shadow-lg`
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            {allDone ? 'Continue →' : `${done}/${total} completed`}
          </button>
        </div>
      </div>
    </div>
  );
}

const platforms = [
  {
    id: 'gmail',
    name: 'Gmail',
    description: 'Connect your Gmail account to receive and send emails',
    color: 'border-red-200 hover:border-red-400',
    bgColor: 'bg-red-50',
    iconColor: 'text-red-500',
    btnColor: 'bg-red-600 hover:bg-red-700',
    authEndpoint: '/auth/gmail/start',
  },
  {
    id: 'facebook',
    name: 'Facebook Messenger',
    description: 'Connect a Facebook Page to receive and reply to Messenger messages',
    color: 'border-blue-200 hover:border-blue-400',
    bgColor: 'bg-blue-50',
    iconColor: 'text-blue-500',
    btnColor: 'bg-blue-600 hover:bg-blue-700',
    authEndpoint: '/auth/facebook/start',
  },
  {
    id: 'instagram',
    name: 'Instagram DMs',
    description: 'Connect an Instagram Business account to manage direct messages',
    color: 'border-pink-200 hover:border-pink-400',
    bgColor: 'bg-pink-50',
    iconColor: 'text-pink-500',
    btnColor: 'bg-pink-600 hover:bg-pink-700',
    authEndpoint: '/auth/instagram/start',
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp Business',
    description: 'Connect your WhatsApp Business Account via Meta Embedded Signup',
    color: 'border-green-200 hover:border-green-400',
    bgColor: 'bg-green-50',
    iconColor: 'text-green-500',
    btnColor: 'bg-green-600 hover:bg-green-700',
    authEndpoint: null, // Uses Meta Embedded Signup SDK instead of OAuth redirect
  },
];

export default function ConnectionsPage() {
  const { user } = useAuth();
  // Only admins and owners can connect or disconnect platforms.
  // Members have read-only visibility.
  const isAdmin = user?.role === 'admin' || user?.role === 'owner';

  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const syncTriggeredRef = useRef(false);
  // Modal shown before connecting: null | platform object
  const [connectModal, setConnectModal] = useState(null);
  // Per-platform loading and error states
  const [connectingPlatform, setConnectingPlatform] = useState(null);
  const [platformError, setPlatformError] = useState(null); // { platformId, message }
  const [disconnecting, setDisconnecting] = useState(null); // accountId being disconnected
  const [waStatus, setWaStatus] = useState(null); // WhatsApp webhook status
  const [waStatusLoading, setWaStatusLoading] = useState(false);
  const [resubscribing, setResubscribing] = useState(false);
  const [waAutoPoll, setWaAutoPoll] = useState(false); // live-tail webhook events
  const [expandedEventIdx, setExpandedEventIdx] = useState(null);

  // Auto-dismiss per-platform error after 5s
  useEffect(() => {
    if (platformError) {
      const timer = setTimeout(() => setPlatformError(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [platformError]);

  useEffect(() => {
    fetchAccounts();
  }, []);

  useEffect(() => {
    if (loading || syncTriggeredRef.current) return;

    const gmailConnected = accounts.some((a) => a.platform === 'gmail' && a.status === 'active');
    if (!gmailConnected) return;

    syncTriggeredRef.current = true;
    api
      .get('/api/messages/gmail/sync')
      .then(() => {
        window.dispatchEvent(new Event('auradesk:refresh-inbox'));
      })
      .catch((err) => {
        console.error('Failed to sync Gmail messages:', err);
      });
  }, [accounts, loading]);

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await api.get('/api/accounts');
      setAccounts(res.data.accounts);
    } catch (err) {
      console.error('Failed to fetch accounts:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchWaStatus = useCallback(async () => {
    setWaStatusLoading(true);
    try {
      const res = await api.get('/auth/whatsapp/status');
      setWaStatus(res.data);
    } catch (err) {
      console.error('Failed to fetch WhatsApp status:', err);
    } finally {
      setWaStatusLoading(false);
    }
  }, []);

  // Auto-fetch WhatsApp status when accounts load and WhatsApp is connected
  useEffect(() => {
    if (!loading && accounts.some((a) => a.platform === 'whatsapp' && a.status === 'active')) {
      fetchWaStatus();
    }
  }, [loading, accounts, fetchWaStatus]);

  // Auto-poll webhook status every 3 seconds when live-tail is enabled
  useEffect(() => {
    if (!waAutoPoll) return;
    const timer = setInterval(() => { fetchWaStatus(); }, 3000);
    return () => clearInterval(timer);
  }, [waAutoPoll, fetchWaStatus]);

  const handleWaResubscribe = useCallback(async () => {
    setResubscribing(true);
    try {
      await api.post('/auth/whatsapp/resubscribe');
      await fetchWaStatus();
    } catch (err) {
      console.error('Resubscribe failed:', err);
    } finally {
      setResubscribing(false);
    }
  }, [fetchWaStatus]);

  const openAuthPopup = useCallback(async (platformId) => {
    const endpoint = platforms.find((p) => p.id === platformId)?.authEndpoint;
    if (!endpoint) throw new Error('Missing OAuth endpoint');

    const res = await api.get(endpoint, { params: { popup: 1 } });
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

  async function handleConnect(platform) {
    setPlatformError(null);
    setConnectingPlatform(platform.id);

    if (platform.id === 'whatsapp') {
      console.group('%c[WhatsApp] ── Connect flow started ──', 'color:#25D366;font-weight:bold');
      console.log('FB SDK available:', typeof window.FB !== 'undefined');
      console.log('Config ID (VITE_WA_CONFIG_ID):', import.meta.env.VITE_WA_CONFIG_ID || '⚠️ NOT SET');
      console.log('Meta App ID (VITE_META_APP_ID):', import.meta.env.VITE_META_APP_ID || '⚠️ NOT SET');
      console.groupEnd();

      // Step 0: Try connect-env — uses server env vars (WHATSAPP_WABA_ID + WHATSAPP_PHONE_NUMBER_ID +
      // WHATSAPP_SYSTEM_USER_TOKEN). Fastest path — no OAuth or popup needed.
      console.log('[WhatsApp] Step 0 — trying connect-env (server env vars)...');
      try {
        const envRes = await api.post('/auth/whatsapp/connect-env');
        console.log('%c[WhatsApp] ✓ connect-env succeeded — no Embedded Signup needed', 'color:#25D366;font-weight:bold', envRes.data);
        await fetchAccounts();
        setConnectingPlatform(null);
        return;
      } catch (err) {
        const msg = err.response?.data?.error || err.message;
        console.warn('[WhatsApp] connect-env not available:', msg, '→ falling back to reconnect-direct');
      }

      // Step 1: Try silent direct reconnect using system token + stored WABA.
      console.log('[WhatsApp] Step 1 — attempting direct reconnect (system token + stored WABA)...');
      try {
        const reconnectRes = await api.post('/auth/whatsapp/reconnect-direct');
        console.log('[WhatsApp] Direct reconnect response:', reconnectRes.data);
        if (reconnectRes.data?.available) {
          console.log('%c[WhatsApp] ✓ Direct reconnect succeeded — no Embedded Signup needed', 'color:#25D366;font-weight:bold');
          await fetchAccounts();
          setConnectingPlatform(null);
          return;
        }
        console.warn('[WhatsApp] Direct reconnect not available:', reconnectRes.data?.reason, '→ falling back to Embedded Signup');
      } catch (err) {
        console.warn('[WhatsApp] Direct reconnect request failed:', err.message, '→ falling back to Embedded Signup');
      }

      // Step 2: Open Meta-hosted Embedded Signup URL in a popup (preferred).
      // This is the exact URL that Meta generates in its Embedded Signup Builder and
      // reliably shows the full 5-step flow with Coexistence / existing-WABA options.
      const appId = import.meta.env.VITE_META_APP_ID;
      const configId = import.meta.env.VITE_WA_CONFIG_ID;

      if (appId && configId) {
        const extrasJson = JSON.stringify({
          featureType: 'whatsapp_business_app_onboarding',
          sessionInfoVersion: '3',
          version: 'v4',
        });
        const onboardUrl = `https://business.facebook.com/messaging/whatsapp/onboard/?app_id=${appId}&config_id=${configId}&extras=${encodeURIComponent(extrasJson)}`;
        console.log('[WhatsApp] Step 2 — opening Meta-hosted URL:', onboardUrl);

        const popup = window.open(
          onboardUrl,
          'wa_embedded_signup',
          'width=720,height=840,menubar=0,toolbar=0,location=1,status=0,scrollbars=1,resizable=1'
        );

        if (popup) {
          let finalized = false;

          const handlePopupMsg = (event) => {
            const originOk =
              event.origin.endsWith('.facebook.com') ||
              event.origin === 'https://business.facebook.com' ||
              event.origin === 'https://www.facebook.com';
            if (!originOk) return;

            let data;
            try {
              data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
            } catch { return; }
            if (!data || data.type !== 'WA_EMBEDDED_SIGNUP') return;

            console.log('[WhatsApp Popup] postMessage ←', event.origin, ':', data);

            if (data.event === 'FINISH' || data.event === 'FINISH_ONLY_WABA') {
              const sd = data.data || {};
              const ar = data.authResponse || {};
              const code = ar.code || sd.code || data.code || null;
              const waba_id = sd.waba_id || data.waba_id || null;
              const phone_number_id = sd.phone_number_id || data.phone_number_id || null;

              console.log('[WhatsApp Popup] ✓ FINISH — code:', code ? 'present' : 'absent', '| waba_id:', waba_id, '| phone:', phone_number_id);

              if (finalized) return;
              finalized = true;
              try { popup.close(); } catch {}

              // If Meta gave us a code, go through /exchange (it'll do token exchange + save).
              // Otherwise use /finalize-signup which connects via WHATSAPP_SYSTEM_USER_TOKEN.
              const endpoint = code ? '/auth/whatsapp/exchange' : '/auth/whatsapp/finalize-signup';
              const payload = code ? { code, waba_id, phone_number_id } : { waba_id, phone_number_id };
              console.log('[WhatsApp Popup] Calling backend:', endpoint, 'with', Object.keys(payload).join(', '));

              api.post(endpoint, payload)
                .then((res) => {
                  console.log('[WhatsApp Popup] ✓ Backend success:', res.data);
                  return fetchAccounts();
                })
                .then(() => setConnectingPlatform(null))
                .catch((err) => {
                  console.error('[WhatsApp Popup] ✗ Backend failed:', err.response?.data || err.message);
                  setPlatformError({
                    platformId: 'whatsapp',
                    message: err.response?.data?.error || 'Failed to connect WhatsApp.',
                  });
                  setConnectingPlatform(null);
                });
            } else if (data.event === 'CANCEL') {
              console.log('[WhatsApp Popup] User cancelled');
              setPlatformError({ platformId: 'whatsapp', message: 'WhatsApp signup was cancelled.' });
              setConnectingPlatform(null);
            } else {
              console.log('[WhatsApp Popup] event:', data.event, data.data);
            }
          };

          window.addEventListener('message', handlePopupMsg);

          const pollId = setInterval(() => {
            if (popup.closed) {
              clearInterval(pollId);
              window.removeEventListener('message', handlePopupMsg);
              if (!finalized) {
                console.log('[WhatsApp Popup] Closed without completion');
                setConnectingPlatform(null);
              }
            }
          }, 500);

          return;
        }

        console.warn('[WhatsApp] Popup blocked — falling back to FB.login');
      } else {
        console.warn('[WhatsApp] Missing VITE_META_APP_ID or VITE_WA_CONFIG_ID — falling back to FB.login');
      }

      // Step 3: FB.login fallback (if popup is blocked or env vars missing)
      console.log('[WhatsApp] Step 3 — falling back to FB.login dialog');
      if (typeof window.FB === 'undefined') {
        console.error('[WhatsApp] ✗ window.FB is undefined — Facebook SDK not loaded');
        setPlatformError({
          platformId: 'whatsapp',
          message: 'Facebook SDK not loaded. Please allow popups or refresh the page.',
        });
        setConnectingPlatform(null);
        return;
      }
      console.log('[WhatsApp] FB SDK version:', window.FB?.version || 'unknown');

      // Reset embedded data before launching the flow
      window.__WA_EMBEDDED_DATA__ = null;

      // Guard against double exchange calls: both the postMessage FINISH event AND the
      // FB.login callback can fire with a code. Only the first one should call exchange.
      let exchangeStarted = false;

      function doExchange(code, waba_id, phone_number_id, source) {
        if (exchangeStarted) {
          console.warn('[WhatsApp] Exchange already started (from ' + source + ') — skipping duplicate call');
          return;
        }
        exchangeStarted = true;
        console.log('[WhatsApp] Starting exchange from:', source, { code: code ? code.substring(0, 20) + '...' : 'missing', waba_id, phone_number_id });
        api.post('/auth/whatsapp/exchange', { code, waba_id, phone_number_id })
          .then(function (res) {
            console.log('[WhatsApp] ✓ Exchange success:', res.data);
            return fetchAccounts();
          })
          .then(function () { setConnectingPlatform(null); })
          .catch(function (err) {
            console.error('[WhatsApp] ✗ Exchange failed:', err.response?.data || err.message);
            setPlatformError({
              platformId: 'whatsapp',
              message: err.response?.data?.error || 'Failed to connect WhatsApp.',
            });
            setConnectingPlatform(null);
          });
      }

      // Listen for Embedded Signup postMessage events (FINISH / CANCEL).
      // Origin can be www.facebook.com (FB.login dialog) OR business.facebook.com (Meta-hosted URL).
      const VALID_ORIGINS = [
        'https://www.facebook.com',
        'https://business.facebook.com',
        'https://m.facebook.com',
        'https://web.facebook.com',
      ];
      const sessionInfoListener = (event) => {
        const originOk =
          VALID_ORIGINS.includes(event.origin) ||
          event.origin.endsWith('.facebook.com') ||
          event.origin.endsWith('.fbcdn.net') ||
          event.origin.endsWith('.meta.com');
        if (!originOk) return;

        let data;
        try {
          data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        } catch {
          return;
        }
        if (!data || typeof data !== 'object') return;

        console.log('[WhatsApp] postMessage ← %s | raw:', event.origin, data);

        if (data.type !== 'WA_EMBEDDED_SIGNUP') return;

        if (data.event === 'FINISH' || data.event === 'FINISH_ONLY_WABA') {
          // sessionInfoVersion 3 may place fields at different positions — extract defensively.
          const sessionData = data.data || {};
          const authResp = data.authResponse || {};
          const code = authResp.code || sessionData.code || data.code || null;
          const waba_id = sessionData.waba_id || data.waba_id || authResp.waba_id || null;
          const phone_number_id = sessionData.phone_number_id || data.phone_number_id || authResp.phone_number_id || null;
          const business_id = sessionData.business_id || data.business_id || null;

          window.__WA_EMBEDDED_DATA__ = { code, waba_id, phone_number_id, business_id };
          console.log('[WhatsApp] ✓ FINISH captured — code:', code ? code.substring(0, 12) + '...' : 'absent', '| waba_id:', waba_id, '| phone_number_id:', phone_number_id, '| business_id:', business_id);

          if (code) {
            doExchange(code, waba_id, phone_number_id, 'postMessage-FINISH');
          } else {
            console.log('[WhatsApp] No code in postMessage — waiting for FB.login callback to provide it');
          }
        } else if (data.event === 'CANCEL') {
          console.log('[WhatsApp] Embedded Signup cancelled by user at step:', data.data?.current_step || 'unknown');
          setPlatformError({ platformId: 'whatsapp', message: 'WhatsApp signup was cancelled.' });
          setConnectingPlatform(null);
        } else {
          console.log('[WhatsApp] postMessage event (non-terminal):', data.event, data.data);
        }
      };
      window.addEventListener('message', sessionInfoListener);

      console.log('[WhatsApp] Launching FB.login with config_id:', import.meta.env.VITE_WA_CONFIG_ID, 'ES version: 4, sessionInfoVersion: 3');

      window.FB.login(
        function (response) {
          window.removeEventListener('message', sessionInfoListener);
          console.log('[WhatsApp] FB.login callback — authResponse:', response.authResponse ? 'present' : 'null', '| grantedScopes:', response.authResponse?.grantedScopes);

          if (!response.authResponse) {
            if (!window.__WA_EMBEDDED_DATA__) {
              console.warn('[WhatsApp] No authResponse and no postMessage data — user likely cancelled');
              setPlatformError({ platformId: 'whatsapp', message: 'WhatsApp signup was cancelled or failed. Please try again.' });
              setConnectingPlatform(null);
            } else {
              console.log('[WhatsApp] No authResponse but postMessage data exists — exchange likely already started');
            }
            return;
          }

          const code = response.authResponse.code;
          const embeddedData = window.__WA_EMBEDDED_DATA__ || {};

          if (code) {
            doExchange(code, embeddedData.waba_id || null, embeddedData.phone_number_id || null, 'FB.login-code');
            return;
          }

          // Fallback: access token (rare, for non-code flows)
          const accessToken = response.authResponse.accessToken;
          if (accessToken) {
            console.log('[WhatsApp] Falling back to accessToken flow (no code in authResponse)');
            const payload = { accessToken };
            if (embeddedData.waba_id) payload.wabaId = embeddedData.waba_id;
            if (embeddedData.phone_number_id) payload.phoneNumberId = embeddedData.phone_number_id;

            api.post('/auth/whatsapp/connect-with-token', payload)
              .then(function (res) { console.log('[WhatsApp] ✓ connect-with-token success:', res.data); return fetchAccounts(); })
              .then(function () { setConnectingPlatform(null); })
              .catch(function (err) {
                console.error('[WhatsApp] ✗ connect-with-token failed:', err.response?.data || err.message);
                setPlatformError({ platformId: 'whatsapp', message: err.response?.data?.error || 'Failed to connect WhatsApp.' });
                setConnectingPlatform(null);
              });
            return;
          }

          console.error('[WhatsApp] No code or accessToken in FB.login response — cannot connect');
          setPlatformError({ platformId: 'whatsapp', message: 'No authorization code received. Please try again.' });
          setConnectingPlatform(null);
        },
        {
          config_id: import.meta.env.VITE_WA_CONFIG_ID,
          response_type: 'code',
          override_default_response_type: true,
          scope: 'whatsapp_business_messaging,business_management,whatsapp_business_management',
          // Match the exact extras format that Meta's hosted URL uses — this unlocks the
          // full 5-step Embedded Signup flow with Coexistence/QR scan and existing-WABA
          // selection. Keys and value types must match exactly (strings, not numbers).
          extras: {
            feature: 'whatsapp_embedded_signup',
            featureType: 'whatsapp_business_app_onboarding',
            version: 'v4',
            sessionInfoVersion: '3',
          },
        }
      );
      return;
    }

    try {
      await openAuthPopup(platform.id);
      await fetchAccounts();
      setConnectingPlatform(null);
    } catch (err) {
      console.error(`Connect ${platform.id} failed:`, err);
      setPlatformError({
        platformId: platform.id,
        message: err.message || 'Failed to connect account.',
      });
      setConnectingPlatform(null);
    }
  }

  async function handleDisconnect(accountId, platformName) {
    if (!confirm(`Are you sure you want to disconnect ${platformName}?`)) return;
    setDisconnecting(accountId);
    try {
      await api.delete(`/api/accounts/${accountId}`);
      setAccounts((prev) => prev.filter((a) => a.id !== accountId));
    } catch (err) {
      console.error('Failed to disconnect:', err);
    } finally {
      setDisconnecting(null);
    }
  }

  function isConnected(platformId) {
    return accounts.some((a) => a.platform === platformId && a.status === 'active');
  }

  function getAccountForPlatform(platformId) {
    return accounts.find((a) => a.platform === platformId && a.status === 'active');
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="flex items-center gap-3 mb-6 sm:mb-8">
          <Link2 size={28} className="text-primary-600 hidden sm:block" />
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Connected Accounts</h1>
            <p className="text-gray-500 text-xs sm:text-sm">Messaging platforms connected to your workspace</p>
          </div>
        </div>

        {/* Read-only notice for team members */}
        {!isAdmin && (
          <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-5">
            <Lock size={15} className="flex-shrink-0" />
            <span>You can view connected platforms but only admins can connect or disconnect them.</span>
          </div>
        )}

        {/* Loading skeleton */}
        {loading ? (
          <div className="grid gap-3 sm:gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-white rounded-xl border-2 border-gray-100 p-4 sm:p-6 animate-pulse">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-gray-200" />
                  <div className="flex-1">
                    <div className="h-4 bg-gray-200 rounded w-32 mb-2" />
                    <div className="h-3 bg-gray-100 rounded w-56" />
                  </div>
                  <div className="h-9 bg-gray-200 rounded-lg w-24" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid gap-3 sm:gap-4">
            {platforms.map((platform) => {
              const connected = isConnected(platform.id);
              const account = getAccountForPlatform(platform.id);
              const isConnecting = connectingPlatform === platform.id;
              const isDisconnecting = disconnecting === account?.id;
              const error = platformError?.platformId === platform.id ? platformError.message : null;

              return (
                <div
                  key={platform.id}
                  className={`bg-white rounded-xl border-2 p-4 sm:p-6 transition-all duration-200 ${
                    connected ? 'border-green-300 shadow-sm' : platform.color
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3 sm:gap-4">
                      <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl ${platform.bgColor} ${platform.iconColor} flex items-center justify-center flex-shrink-0`}>
                        <PlatformIcon platform={platform.id} size={22} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-base sm:text-lg font-semibold text-gray-900">{platform.name}</h3>
                          {connected ? (
                            <span className="inline-flex items-center gap-1 bg-green-100 text-green-700 text-xs font-medium px-2 py-0.5 rounded-full">
                              <CheckCircle size={12} />
                              Connected
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 bg-gray-100 text-gray-500 text-xs font-medium px-2 py-0.5 rounded-full">
                              Not Connected
                            </span>
                          )}
                        </div>
                        <p className="text-xs sm:text-sm text-gray-500 mt-0.5">{platform.description}</p>
                        {connected && account && (
                          <p className="text-xs text-gray-400 mt-1">
                            {account.displayName} — Connected {new Date(account.createdAt).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center sm:flex-shrink-0">
                      {isAdmin ? (
                        /* Admin / owner: full connect + disconnect controls */
                        connected ? (
                          <button
                            onClick={() => handleDisconnect(account.id, platform.name)}
                            disabled={isDisconnecting}
                            className="flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 border border-red-200 rounded-lg transition w-full sm:w-auto justify-center disabled:opacity-50"
                          >
                            {isDisconnecting ? (
                              <Loader2 size={16} className="animate-spin" />
                            ) : (
                              <Trash2 size={16} />
                            )}
                            {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
                          </button>
                        ) : (
                          <button
                            onClick={() => setConnectModal(platform)}
                            disabled={isConnecting}
                            className={`px-6 py-2.5 ${platform.btnColor} text-white text-sm font-medium rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 w-full sm:w-auto justify-center`}
                          >
                            {isConnecting && <Loader2 size={16} className="animate-spin" />}
                            {isConnecting ? 'Connecting...' : 'Connect'}
                          </button>
                        )
                      ) : (
                        /* Team member: read-only — no connect/disconnect allowed */
                        <span className="flex items-center gap-1.5 text-xs text-gray-400 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">
                          <Lock size={13} />
                          Admin only
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Per-platform error */}
                  {error && (
                    <div className="mt-3 flex items-center gap-2 text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">
                      <AlertCircle size={14} className="flex-shrink-0" />
                      {error}
                    </div>
                  )}

                  {/* WhatsApp webhook status panel */}
                  {platform.id === 'whatsapp' && connected && (
                    <div className="mt-4 border-t border-gray-100 pt-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Webhook Status</span>
                        <button
                          onClick={fetchWaStatus}
                          disabled={waStatusLoading}
                          className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 disabled:opacity-50"
                        >
                          <RefreshCw size={12} className={waStatusLoading ? 'animate-spin' : ''} />
                          Refresh
                        </button>
                      </div>

                      {waStatusLoading && !waStatus ? (
                        <div className="text-xs text-gray-400">Checking webhook status...</div>
                      ) : waStatus?.connected ? (
                        <div className="space-y-2">
                          {/* Receiving events indicator */}
                          <div className="flex items-center gap-2">
                            {waStatus.recentEventsCount > 0 ? (
                              <>
                                <Wifi size={14} className="text-green-500 flex-shrink-0" />
                                <span className="text-xs text-green-700 font-medium">
                                  Webhooks arriving — {waStatus.recentEventsCount} recent event{waStatus.recentEventsCount !== 1 ? 's' : ''}
                                  {waStatus.lastEventAt && ` (last: ${new Date(waStatus.lastEventAt).toLocaleTimeString()})`}
                                </span>
                              </>
                            ) : (
                              <>
                                <WifiOff size={14} className="text-amber-500 flex-shrink-0" />
                                <span className="text-xs text-amber-700 font-medium">
                                  No webhook events received yet — configure Meta webhook URL below
                                </span>
                              </>
                            )}
                          </div>

                          {/* Subscription status */}
                          {waStatus.subscriptionStatus && !waStatus.subscriptionStatus.error ? (
                            <div className="text-xs text-gray-500">
                              Subscription: <span className="text-green-600 font-medium">active</span>
                            </div>
                          ) : waStatus.subscriptionStatus?.error ? (
                            <div className="text-xs text-red-500">
                              Subscription error: {waStatus.subscriptionStatus.error}
                            </div>
                          ) : null}

                          {/* Webhook URL config */}
                          <div className="bg-gray-50 rounded-lg p-3 space-y-1.5">
                            <p className="text-xs font-medium text-gray-600">Meta Developer Portal → App → Webhooks → WhatsApp:</p>
                            <div>
                              <span className="text-xs text-gray-500">Callback URL: </span>
                              <code className="text-xs bg-white border border-gray-200 px-1.5 py-0.5 rounded text-gray-800 select-all">
                                {waStatus.webhookUrl}
                              </code>
                            </div>
                            <div>
                              <span className="text-xs text-gray-500">Verify Token: </span>
                              <code className="text-xs bg-white border border-gray-200 px-1.5 py-0.5 rounded text-gray-800 select-all">
                                {waStatus.verifyToken}
                              </code>
                            </div>
                            <p className="text-xs text-gray-400">Subscribe to: <strong>messages</strong></p>
                          </div>

                          {/* Re-subscribe button */}
                          <button
                            onClick={handleWaResubscribe}
                            disabled={resubscribing}
                            className="flex items-center gap-1.5 text-xs text-green-700 hover:text-green-800 bg-green-50 hover:bg-green-100 border border-green-200 px-3 py-1.5 rounded-lg transition disabled:opacity-50"
                          >
                            <RefreshCw size={12} className={resubscribing ? 'animate-spin' : ''} />
                            {resubscribing ? 'Re-subscribing...' : 'Re-subscribe Webhook'}
                          </button>

                          {/* Live webhook event tail — your window into what Meta is actually sending */}
                          <div className="mt-2">
                            <div className="flex items-center justify-between mb-1.5">
                              <div className="text-xs font-medium text-gray-600">
                                Recent webhook events
                                {waStatus.eventsSummary?.length > 0 && ` (${waStatus.eventsSummary.length})`}
                              </div>
                              <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={waAutoPoll}
                                  onChange={(ev) => setWaAutoPoll(ev.target.checked)}
                                  className="w-3 h-3"
                                />
                                Live tail (3s)
                              </label>
                            </div>

                            {!waStatus.eventsSummary || waStatus.eventsSummary.length === 0 ? (
                              <div className="text-xs bg-red-50 border border-red-200 rounded-lg p-3 text-red-700">
                                <div className="font-semibold mb-1">No webhook events recorded yet.</div>
                                <div className="text-red-600">
                                  Meta isn't sending anything to this server. Check:
                                  <ul className="list-disc ml-4 mt-1 space-y-0.5">
                                    <li>Is <code className="bg-red-100 px-1 rounded">{waStatus.webhookUrl}</code> reachable from the public internet?</li>
                                    <li>In Meta portal → App → WhatsApp → Configuration, is the URL verified (green checkmark)?</li>
                                    <li>Is the <strong>messages</strong> field subscribed?</li>
                                    <li>Did you click <strong>Re-subscribe Webhook</strong> above?</li>
                                  </ul>
                                </div>
                              </div>
                            ) : (
                              <>
                                <div className="space-y-1 max-h-80 overflow-y-auto bg-gray-50 rounded-lg p-2 border border-gray-200">
                                  {waStatus.eventsSummary.map((e, idx) => {
                                    const isForThisWaba = e.wabaId === waStatus.account.wabaId;
                                    const isEcho = e.field === 'smb_message_echoes';
                                    const isExpanded = expandedEventIdx === idx;
                                    return (
                                      <div key={idx} className={`text-xs font-mono rounded border ${isForThisWaba ? 'bg-white border-gray-200' : 'bg-amber-50 border-amber-200'}`}>
                                        <div
                                          className="p-1.5 cursor-pointer hover:bg-gray-50"
                                          onClick={() => setExpandedEventIdx(isExpanded ? null : idx)}
                                        >
                                          <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-gray-400">{new Date(e.receivedAt).toLocaleTimeString()}</span>
                                            <span className={`px-1.5 py-0.5 rounded ${isEcho ? 'bg-blue-100 text-blue-700' : e.field === 'messages' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                                              {e.field || 'unknown'}
                                            </span>
                                            {!isForThisWaba && (
                                              <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800" title={`Event WABA: ${e.wabaId}, yours: ${waStatus.account.wabaId}`}>
                                                ≠ your WABA
                                              </span>
                                            )}
                                            <span className="text-gray-300 ml-auto">{isExpanded ? '▼' : '▶'}</span>
                                          </div>
                                          {e.messageSummary && (
                                            <div className="mt-0.5 text-gray-600">
                                              {e.messageSummary.type} · from <strong>{e.messageSummary.from || '?'}</strong> → to <strong>{e.messageSummary.to || e.messageSummary.recipient_id || '?'}</strong>
                                              {e.messageSummary.text && <div className="text-gray-500 italic">"{e.messageSummary.text}"</div>}
                                            </div>
                                          )}
                                          {e.hasStatuses && (
                                            <div className="mt-0.5 text-gray-400">
                                              status: {e.statusSummary?.status} · recipient: {e.statusSummary?.recipient_id}
                                            </div>
                                          )}
                                        </div>
                                        {isExpanded && (
                                          <pre className="bg-gray-900 text-green-300 text-[10px] p-2 overflow-x-auto rounded-b max-h-64">
                                            {JSON.stringify(e.rawPayload, null, 2)}
                                          </pre>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                                {waStatus.totalRecentEventsCount > waStatus.recentEventsCount && (
                                  <div className="text-xs text-amber-600 mt-1">
                                    ⚠ Some events arrived with a different WABA ID — Meta may be sending to the wrong app. (Amber rows above.)
                                  </div>
                                )}
                                <div className="text-xs text-gray-400 mt-1">Click any row to expand full JSON payload.</div>
                              </>
                            )}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Connect requirements modal */}
      {connectModal && (
        <ConnectModal
          platform={connectModal}
          onClose={() => setConnectModal(null)}
          onConfirm={() => {
            const platform = connectModal;
            setConnectModal(null);
            handleConnect(platform);
          }}
        />
      )}
    </div>
  );
}
