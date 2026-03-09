import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../services/api.js';
import { PlatformIcon } from '../components/PlatformBadge.jsx';
import { Link2, CheckCircle, XCircle, Trash2, Loader2 } from 'lucide-react';

const platforms = [
  {
    id: 'gmail',
    name: 'Gmail',
    description: 'Connect your Gmail account to receive and send emails',
    color: 'border-red-200 hover:border-red-400',
    bgColor: 'bg-red-50',
    iconColor: 'text-red-500',
    authEndpoint: '/auth/gmail/start',
  },
  {
    id: 'facebook',
    name: 'Facebook Messenger',
    description: 'Connect a Facebook Page to receive and reply to Messenger messages',
    color: 'border-blue-200 hover:border-blue-400',
    bgColor: 'bg-blue-50',
    iconColor: 'text-blue-500',
    authEndpoint: '/auth/facebook/start',
  },
  {
    id: 'instagram',
    name: 'Instagram DMs',
    description: 'Connect an Instagram Business account to manage direct messages',
    color: 'border-pink-200 hover:border-pink-400',
    bgColor: 'bg-pink-50',
    iconColor: 'text-pink-500',
    authEndpoint: '/auth/instagram/start',
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp Business',
    description: 'Connect via server credentials to send and receive WhatsApp messages',
    color: 'border-green-200 hover:border-green-400',
    bgColor: 'bg-green-50',
    iconColor: 'text-green-500',
    authEndpoint: null,
  },
];

export default function ConnectionsPage() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const syncTriggeredRef = useRef(false);
  const [searchParams] = useSearchParams();
  const successPlatform = searchParams.get('success');
  const errorPlatform = searchParams.get('error');

  const [waConnecting, setWaConnecting] = useState(false);
  const [waError, setWaError] = useState('');

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

  async function fetchAccounts() {
    try {
      const res = await api.get('/api/accounts');
      setAccounts(res.data.accounts);
    } catch (err) {
      console.error('Failed to fetch accounts:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleConnect(platform) {
    if (platform.id === 'whatsapp') {
      setWaConnecting(true);
      setWaError('');
      try {
        await api.post('/auth/whatsapp/connect-env');
        fetchAccounts();
      } catch (err) {
        console.error('WhatsApp connect failed:', err);
        setWaError(err.response?.data?.error || 'Failed to connect WhatsApp.');
      } finally {
        setWaConnecting(false);
      }
      return;
    }

    try {
      const res = await api.get(platform.authEndpoint);
      window.location.href = res.data.url;
    } catch (err) {
      console.error('Failed to start OAuth:', err);
    }
  }

  async function handleDisconnect(accountId) {
    if (!confirm('Are you sure you want to disconnect this account?')) return;
    try {
      await api.delete(`/api/accounts/${accountId}`);
      setAccounts((prev) => prev.filter((a) => a.id !== accountId));
    } catch (err) {
      console.error('Failed to disconnect:', err);
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

        {/* Success/Error banners */}
        {successPlatform && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-4 sm:mb-6 flex items-center gap-2 text-sm">
            <CheckCircle size={18} />
            <span className="capitalize">{successPlatform}</span> connected successfully!
          </div>
        )}
        {errorPlatform && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 sm:mb-6 flex items-center gap-2 text-sm">
            <XCircle size={18} />
            Failed to connect <span className="capitalize">{errorPlatform}</span>. Please try again.
          </div>
        )}
        {waError && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 sm:mb-6 flex items-center gap-2 text-sm">
            <XCircle size={18} />
            {waError}
          </div>
        )}

        {/* Platform cards */}
        <div className="grid gap-3 sm:gap-4">
          {platforms.map((platform) => {
            const connected = isConnected(platform.id);
            const account = getAccountForPlatform(platform.id);
            const isWaLoading = platform.id === 'whatsapp' && waConnecting;

            return (
              <div
                key={platform.id}
                className={`bg-white rounded-xl border-2 p-4 sm:p-6 transition ${
                  connected ? 'border-green-300' : platform.color
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
                        {connected && (
                          <span className="bg-green-100 text-green-700 text-xs font-medium px-2 py-0.5 rounded-full">
                            Connected
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
                        onClick={() => handleDisconnect(account.id)}
                        className="flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition w-full sm:w-auto justify-center"
                      >
                        <Trash2 size={16} />
                        Disconnect
                      </button>
                    ) : (
                      <button
                        onClick={() => handleConnect(platform)}
                        disabled={isWaLoading}
                        className="px-6 py-2.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 w-full sm:w-auto justify-center"
                      >
                        {isWaLoading && <Loader2 size={16} className="animate-spin" />}
                        {isWaLoading ? 'Connecting...' : 'Connect'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Info box */}
        <div className="mt-6 sm:mt-8 bg-blue-50 border border-blue-200 rounded-xl p-4 sm:p-6">
          <h3 className="font-semibold text-blue-900 mb-2 text-sm sm:text-base">POC Testing Notes</h3>
          <ul className="text-xs sm:text-sm text-blue-800 space-y-1 list-disc list-inside">
            <li>Gmail: Works in Google's testing mode — add tester emails in Google Cloud Console</li>
            <li>Facebook: Add testers as App Testers in Meta Developer Console (Development Mode)</li>
            <li>Instagram: Requires an Instagram Business/Creator account linked to a Facebook Page</li>
            <li>WhatsApp: Uses server-configured credentials (WABA ID + System User Token)</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
