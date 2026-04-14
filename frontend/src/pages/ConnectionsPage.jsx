import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../services/api.js';
import { PlatformIcon } from '../components/PlatformBadge.jsx';
import { Link2, CheckCircle, Trash2, Loader2, AlertCircle } from 'lucide-react';

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
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const syncTriggeredRef = useRef(false);
  // Per-platform loading and error states
  const [connectingPlatform, setConnectingPlatform] = useState(null);
  const [platformError, setPlatformError] = useState(null); // { platformId, message }
  const [disconnecting, setDisconnecting] = useState(null); // accountId being disconnected

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
      // Step 1: Try silent direct reconnect using system token + stored WABA.
      // This bypasses the Embedded Signup dialog entirely and avoids the Meta-side
      // "phone already registered" error that shows when the number is still in a WABA.
      try {
        const reconnectRes = await api.post('/auth/whatsapp/reconnect-direct');
        if (reconnectRes.data?.available) {
          console.log('[WhatsApp] Direct reconnect succeeded, skipping Embedded Signup');
          await fetchAccounts();
          setConnectingPlatform(null);
          return;
        }
        console.log('[WhatsApp] Direct reconnect not available:', reconnectRes.data?.reason, '— launching Embedded Signup');
      } catch (err) {
        console.log('[WhatsApp] Direct reconnect failed:', err.message, '— launching Embedded Signup');
      }

      // Step 2: Fall back to Meta Embedded Signup flow
      if (typeof window.FB === 'undefined') {
        setPlatformError({
          platformId: 'whatsapp',
          message: 'Facebook SDK not loaded. Please check your Meta App ID configuration and refresh the page.',
        });
        setConnectingPlatform(null);
        return;
      }

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

      // Listen for Embedded Signup postMessage events (FINISH / CANCEL)
      const sessionInfoListener = (event) => {
        if (!event.origin.includes('facebook.com') && !event.origin.includes('fbcdn.net') && !event.origin.includes('meta.com')) return;
        let data;
        try {
          data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        } catch {
          return;
        }

        console.log('[WhatsApp] postMessage from', event.origin, ':', JSON.stringify(data).substring(0, 300));

        if (data.type === 'WA_EMBEDDED_SIGNUP') {
          if (data.event === 'FINISH' || data.event === 'FINISH_ONLY_WABA') {
            const sessionData = data.data || {};
            const authResp = data.authResponse || {};

            const code = authResp.code;
            const waba_id = sessionData.waba_id || data.waba_id;
            const phone_number_id = sessionData.phone_number_id || data.phone_number_id;

            window.__WA_EMBEDDED_DATA__ = { code, waba_id, phone_number_id };
            console.log('[WhatsApp] FINISH event captured — code:', code ? 'present' : 'absent', 'waba_id:', waba_id, 'phone_number_id:', phone_number_id);

            // ES v4: code comes from FB.login callback, not postMessage. Only call here if code present.
            if (code) {
              doExchange(code, waba_id, phone_number_id, 'postMessage-FINISH');
            }
          } else if (data.event === 'CANCEL') {
            console.log('[WhatsApp] Embedded Signup cancelled by user');
            setPlatformError({ platformId: 'whatsapp', message: 'WhatsApp signup was cancelled.' });
            setConnectingPlatform(null);
          } else {
            console.log('[WhatsApp] postMessage event:', data.event);
          }
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
          extras: {
            feature: 'whatsapp_embedded_signup',
            version: 4,
            sessionInfoVersion: 3,
            setup: {},
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
            <p className="text-gray-500 text-xs sm:text-sm">Connect your messaging platforms to AuraDesk</p>
          </div>
        </div>

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
                      {connected ? (
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
                          onClick={() => handleConnect(platform)}
                          disabled={isConnecting}
                          className={`px-6 py-2.5 ${platform.btnColor} text-white text-sm font-medium rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 w-full sm:w-auto justify-center`}
                        >
                          {isConnecting && <Loader2 size={16} className="animate-spin" />}
                          {isConnecting ? 'Connecting...' : 'Connect'}
                        </button>
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
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
