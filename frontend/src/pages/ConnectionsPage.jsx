import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../services/api.js';
import PlatformBadge from '../components/PlatformBadge.jsx';
import { Link2, CheckCircle, XCircle, Trash2, X } from 'lucide-react';

const platforms = [
  {
    id: 'gmail',
    name: 'Gmail',
    description: 'Connect your Gmail account to receive and send emails',
    color: 'border-red-200 hover:border-red-400',
    icon: '📧',
    authEndpoint: '/auth/gmail/start',
  },
  {
    id: 'facebook',
    name: 'Facebook Messenger',
    description: 'Connect a Facebook Page to receive and reply to Messenger messages',
    color: 'border-blue-200 hover:border-blue-400',
    icon: '💬',
    authEndpoint: '/auth/facebook/start',
  },
  {
    id: 'instagram',
    name: 'Instagram DMs',
    description: 'Connect an Instagram Business account to manage direct messages',
    color: 'border-pink-200 hover:border-pink-400',
    icon: '📸',
    authEndpoint: '/auth/instagram/start',
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp Business',
    description: 'Connect via access token to send and receive WhatsApp messages',
    color: 'border-green-200 hover:border-green-400',
    icon: '📱',
    authEndpoint: null, // Uses token connect
  },
];

export default function ConnectionsPage() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const syncTriggeredRef = useRef(false);
  const [searchParams] = useSearchParams();
  const successPlatform = searchParams.get('success');
  const errorPlatform = searchParams.get('error');

  // WhatsApp connect modal state
  const [showWhatsAppModal, setShowWhatsAppModal] = useState(false);
  const [waToken, setWaToken] = useState('');
  const [waConnecting, setWaConnecting] = useState(false);
  const [waError, setWaError] = useState('');

  useEffect(() => {
    fetchAccounts();
  }, []);

  useEffect(() => {
    if (loading || syncTriggeredRef.current) return;

    const gmailConnected = accounts.some((a) => a.platform === 'gmail' && a.status === 'active');
    if (!gmailConnected) return;

    // Sync right after Gmail connect callback or whenever a connected Gmail account is shown.
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
      setShowWhatsAppModal(true);
      setWaError('');
      setWaToken('');
      return;
    }

    try {
      const res = await api.get(platform.authEndpoint);
      window.location.href = res.data.url;
    } catch (err) {
      console.error('Failed to start OAuth:', err);
    }
  }

  async function handleWhatsAppConnect(e) {
    e.preventDefault();
    if (!waToken.trim()) return;

    setWaConnecting(true);
    setWaError('');

    try {
      await api.post('/auth/whatsapp/connect-with-token', {
        accessToken: waToken.trim(),
      });

      setShowWhatsAppModal(false);
      setWaToken('');
      fetchAccounts();
    } catch (err) {
      console.error('WhatsApp connect failed:', err);
      setWaError(err.response?.data?.error || 'Failed to connect WhatsApp. Check your access token.');
    } finally {
      setWaConnecting(false);
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
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-8">
          <Link2 size={28} className="text-primary-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Connected Accounts</h1>
            <p className="text-gray-500 text-sm">Connect your messaging platforms to AuraDesk</p>
          </div>
        </div>

        {/* Success/Error banners */}
        {successPlatform && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-6 flex items-center gap-2">
            <CheckCircle size={18} />
            <span className="capitalize">{successPlatform}</span> connected successfully!
          </div>
        )}
        {errorPlatform && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6 flex items-center gap-2">
            <XCircle size={18} />
            Failed to connect <span className="capitalize">{errorPlatform}</span>. Please try again.
          </div>
        )}

        {/* Platform cards */}
        <div className="grid gap-4">
          {platforms.map((platform) => {
            const connected = isConnected(platform.id);
            const account = getAccountForPlatform(platform.id);

            return (
              <div
                key={platform.id}
                className={`bg-white rounded-xl border-2 p-6 transition ${
                  connected ? 'border-green-300' : platform.color
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <span className="text-3xl">{platform.icon}</span>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-semibold text-gray-900">{platform.name}</h3>
                        {connected && (
                          <span className="bg-green-100 text-green-700 text-xs font-medium px-2 py-0.5 rounded-full">
                            Connected
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500 mt-0.5">{platform.description}</p>
                      {connected && account && (
                        <p className="text-xs text-gray-400 mt-1">
                          {account.displayName} — Connected {new Date(account.createdAt).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {connected ? (
                      <button
                        onClick={() => handleDisconnect(account.id)}
                        className="flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition"
                      >
                        <Trash2 size={16} />
                        Disconnect
                      </button>
                    ) : (
                      <button
                        onClick={() => handleConnect(platform)}
                        className="px-6 py-2.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg transition"
                      >
                        Connect
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Info box */}
        <div className="mt-8 bg-blue-50 border border-blue-200 rounded-xl p-6">
          <h3 className="font-semibold text-blue-900 mb-2">POC Testing Notes</h3>
          <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
            <li>Gmail: Works in Google's testing mode — add tester emails in Google Cloud Console</li>
            <li>Facebook: Add testers as App Testers in Meta Developer Console (Development Mode)</li>
            <li>Instagram: Requires an Instagram Business/Creator account linked to a Facebook Page</li>
            <li>WhatsApp: Paste your System User permanent access token from Meta Business Settings</li>
          </ul>
        </div>
      </div>

      {/* WhatsApp Connect Modal */}
      {showWhatsAppModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">Connect WhatsApp Business</h2>
              <button
                onClick={() => setShowWhatsAppModal(false)}
                className="text-gray-400 hover:text-gray-600 transition"
              >
                <X size={20} />
              </button>
            </div>

            <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
              <p className="text-sm text-green-800 font-medium mb-2">How to get your access token:</p>
              <ol className="text-sm text-green-700 space-y-1 list-decimal list-inside">
                <li>Go to Meta Business Settings &gt; System Users</li>
                <li>Create a System User (or select existing one)</li>
                <li>Click "Generate New Token"</li>
                <li>Select your Meta App and add permissions:
                  <span className="font-mono text-xs ml-1">whatsapp_business_management, whatsapp_business_messaging</span>
                </li>
                <li>Copy the generated token and paste below</li>
              </ol>
            </div>

            <form onSubmit={handleWhatsAppConnect}>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                System User Access Token
              </label>
              <textarea
                value={waToken}
                onChange={(e) => setWaToken(e.target.value)}
                placeholder="Paste your permanent access token here..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:border-primary-400 focus:ring-1 focus:ring-primary-400 outline-none resize-none h-24"
                autoFocus
              />

              {waError && (
                <div className="mt-2 bg-red-50 border border-red-200 text-red-600 text-sm px-3 py-2 rounded-lg">
                  {waError}
                </div>
              )}

              <div className="flex items-center justify-end gap-3 mt-4">
                <button
                  type="button"
                  onClick={() => setShowWhatsAppModal(false)}
                  className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!waToken.trim() || waConnecting}
                  className="px-6 py-2.5 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {waConnecting ? 'Connecting...' : 'Connect WhatsApp'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
