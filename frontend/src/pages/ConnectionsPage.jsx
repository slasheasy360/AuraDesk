import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../services/api.js';
import { PlatformIcon } from '../components/PlatformBadge.jsx';
import { Link2, CheckCircle, XCircle, Trash2, Loader2, AlertCircle } from 'lucide-react';

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
  const [searchParams] = useSearchParams();
  const successPlatform = searchParams.get('success');
  const errorPlatform = searchParams.get('error');

  // Per-platform loading and error states
  const [connectingPlatform, setConnectingPlatform] = useState(null);
  const [platformError, setPlatformError] = useState(null); // { platformId, message }
  const [disconnecting, setDisconnecting] = useState(null); // accountId being disconnected

  // Auto-dismiss success/error banners after 5s
  const [showBanner, setShowBanner] = useState(true);
  useEffect(() => {
    if (successPlatform || errorPlatform) {
      const timer = setTimeout(() => setShowBanner(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [successPlatform, errorPlatform]);

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
  }, [accounts, loading, successPlatform]);

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

  async function handleConnect(platform) {
    setPlatformError(null);
    setConnectingPlatform(platform.id);

    if (platform.id === 'whatsapp') {
      // Launch Meta Embedded Signup flow
      if (typeof window.FB === 'undefined') {
        setPlatformError({
          platformId: 'whatsapp',
          message: 'Facebook SDK not loaded. Please check your Meta App ID configuration and refresh the page.',
        });
        setConnectingPlatform(null);
        return;
      }

      window.FB.login(
        async (response) => {
          try {
            if (!response.authResponse) {
              setPlatformError({
                platformId: 'whatsapp',
                message: 'WhatsApp signup was cancelled or failed. Please try again.',
              });
              setConnectingPlatform(null);
              return;
            }

            const accessToken = response.authResponse.accessToken;

            // Send the user access token to backend — it will auto-discover WABA and phone number
            await api.post('/auth/whatsapp/connect-with-token', { accessToken });
            await fetchAccounts();
          } catch (err) {
            console.error('WhatsApp connect failed:', err);
            setPlatformError({
              platformId: 'whatsapp',
              message: err.response?.data?.error || 'Failed to connect WhatsApp.',
            });
          } finally {
            setConnectingPlatform(null);
          }
        },
        {
          scope: 'whatsapp_business_messaging,whatsapp_business_management',
          extras: {
            feature: 'whatsapp_embedded_signup',
            setup: {},
          },
        }
      );
      return;
    }

    try {
      const res = await api.get(platform.authEndpoint);
      window.location.href = res.data.url;
    } catch (err) {
      console.error('Failed to start OAuth:', err);
      setPlatformError({
        platformId: platform.id,
        message: err.response?.data?.error || `Failed to start ${platform.name} connection.`,
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

        {/* Success/Error banners from OAuth redirect */}
        {showBanner && successPlatform && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-4 sm:mb-6 flex items-center gap-2 text-sm animate-in fade-in">
            <CheckCircle size={18} className="flex-shrink-0" />
            <span><span className="capitalize font-medium">{successPlatform}</span> connected successfully!</span>
          </div>
        )}
        {showBanner && errorPlatform && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 sm:mb-6 flex items-center gap-2 text-sm">
            <XCircle size={18} className="flex-shrink-0" />
            Failed to connect <span className="capitalize font-medium">{errorPlatform}</span>. Please try again.
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
