import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import api from '../services/api.js';
import { UserPlus, X, Copy, Check, Trash2, Loader2 } from 'lucide-react';

const TABS = ['Personal', 'Company', 'Integrations', 'Plan', 'Team'];

function Toast({ msg, type, onClose }) {
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(onClose, 3000);
    return () => clearTimeout(t);
  }, [msg, onClose]);
  if (!msg) return null;
  return (
    <div className={`fixed top-6 right-6 z-[100] px-4 py-3 rounded-lg shadow-lg text-sm font-medium ${type === 'error' ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'}`}>
      {msg}
    </div>
  );
}

export default function ProfileSettingsPage() {
  const { user, refreshUser } = useAuth();
  const [params, setParams] = useSearchParams();
  const initialTab = params.get('tab') && TABS.includes(params.get('tab')) ? params.get('tab') : 'Personal';
  const [tab, setTab] = useState(initialTab);
  const [toast, setToast] = useState({ msg: '', type: 'success' });
  const [inviteOpen, setInviteOpen] = useState(false);

  const isAdmin = user?.role === 'owner' || user?.role === 'admin';
  const showSuccess = (msg) => setToast({ msg, type: 'success' });
  const showError = (msg) => setToast({ msg, type: 'error' });

  const switchTab = (t) => {
    setTab(t);
    setParams({ tab: t }, { replace: true });
  };

  return (
    <div className="h-full overflow-y-auto bg-[#f0f4ff] p-6">
      <Toast msg={toast.msg} type={toast.type} onClose={() => setToast({ msg: '', type: 'success' })} />
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Profile Settings</h1>
        {tab === 'Team' && isAdmin && (
          <button
            onClick={() => setInviteOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-lg shadow transition"
          >
            <UserPlus size={16} /> INVITE TEAM
          </button>
        )}
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-6">
        {/* Tabs */}
        <div className="flex gap-1 bg-gray-50 p-1 rounded-lg w-fit mb-6">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => switchTab(t)}
              className={`px-5 py-2 text-sm font-medium rounded-md transition ${
                tab === t ? 'bg-primary-600 text-white shadow' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {t}
              {t === 'Plan' && <span className="ml-1.5 text-[9px] px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded font-bold">PRO</span>}
            </button>
          ))}
        </div>

        {tab === 'Personal' && <PersonalTab user={user} refreshUser={refreshUser} showSuccess={showSuccess} showError={showError} />}
        {tab === 'Company' && <CompanyTab user={user} refreshUser={refreshUser} showSuccess={showSuccess} showError={showError} canEdit={isAdmin} />}
        {tab === 'Integrations' && <IntegrationsTab showError={showError} />}
        {tab === 'Plan' && <PlanTab user={user} />}
        {tab === 'Team' && <TeamTab user={user} isAdmin={isAdmin} showSuccess={showSuccess} showError={showError} />}
      </div>

      {inviteOpen && (
        <InviteModal
          onClose={() => setInviteOpen(false)}
          showSuccess={showSuccess}
          showError={showError}
        />
      )}
    </div>
  );
}

/* ─────────────── PERSONAL ─────────────── */
function PersonalTab({ user, refreshUser, showSuccess, showError }) {
  const [form, setForm] = useState({
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
    email: user?.email || '',
  });
  const [saving, setSaving] = useState(false);
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '' });
  const [pwOpen, setPwOpen] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/api/profile/personal', form);
      await refreshUser();
      showSuccess('Profile updated');
    } catch (e) {
      showError(e.response?.data?.error || 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  const savePw = async () => {
    setPwSaving(true);
    try {
      await api.put('/api/profile/password', pwForm);
      showSuccess('Password updated');
      setPwForm({ currentPassword: '', newPassword: '' });
      setPwOpen(false);
    } catch (e) {
      showError(e.response?.data?.error || 'Failed');
    } finally {
      setPwSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 max-w-5xl">
      <div className="lg:col-span-2 space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <Field label="FIRST NAME *">
            <input className="input" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
          </Field>
          <Field label="LAST NAME">
            <input className="input" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
          </Field>
        </div>
        <Field label="EMAIL">
          <input type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <div>
          <button
            onClick={() => setPwOpen(!pwOpen)}
            className="text-xs font-semibold text-gray-600 tracking-wide uppercase hover:text-primary-600"
          >
            Password ✎
          </button>
          {pwOpen && (
            <div className="mt-3 space-y-3 p-4 bg-gray-50 rounded-lg">
              <input type="password" placeholder="Current password" className="input" value={pwForm.currentPassword} onChange={(e) => setPwForm({ ...pwForm, currentPassword: e.target.value })} />
              <input type="password" placeholder="New password (min 6)" className="input" value={pwForm.newPassword} onChange={(e) => setPwForm({ ...pwForm, newPassword: e.target.value })} />
              <button disabled={pwSaving} onClick={savePw} className="px-4 py-2 bg-primary-600 text-white text-sm rounded-lg disabled:opacity-50">
                {pwSaving ? 'Saving…' : 'Update password'}
              </button>
            </div>
          )}
        </div>
        <button disabled={saving} onClick={save} className="px-6 py-2.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-lg shadow disabled:opacity-50">
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
      <div className="flex flex-col items-center">
        <div className="w-32 h-32 rounded-full bg-gradient-to-br from-orange-300 to-pink-300 flex items-center justify-center text-4xl font-bold text-white">
          {(user?.firstName || user?.name || 'A')[0]}
        </div>
        <p className="mt-3 text-xs text-gray-500 uppercase font-semibold tracking-wide">Profile image</p>
      </div>
      <style>{`.input{width:100%;padding:.65rem .85rem;border:1px solid #e5e7eb;border-radius:.5rem;font-size:.875rem;outline:none;background:#fff}.input:focus{border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,.1)}`}</style>
    </div>
  );
}

/* ─────────────── COMPANY ─────────────── */
function CompanyTab({ user, refreshUser, showSuccess, showError, canEdit }) {
  const [form, setForm] = useState({
    companyName: user?.companyName || '',
    brandColor: user?.brandColor || '#3b82f6',
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!canEdit) return;
    setSaving(true);
    try {
      await api.put('/api/profile/company', form);
      await refreshUser();
      showSuccess('Company updated');
    } catch (e) {
      showError(e.response?.data?.error || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 max-w-5xl">
      <div className="lg:col-span-2 space-y-5">
        <Field label="COMPANY NAME *">
          <input className="input" disabled={!canEdit} value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} />
        </Field>
        <Field label="BRAND COLOR">
          <input type="color" className="h-10 w-20 rounded border border-gray-200" disabled={!canEdit} value={form.brandColor} onChange={(e) => setForm({ ...form, brandColor: e.target.value })} />
        </Field>
        {canEdit ? (
          <button disabled={saving} onClick={save} className="px-6 py-2.5 bg-primary-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        ) : (
          <p className="text-xs text-gray-500">You don't have permission to edit company info.</p>
        )}
      </div>
      <div className="flex flex-col items-center">
        {user?.companyLogo ? (
          <img src={user.companyLogo} alt="logo" className="w-32 h-32 rounded-full object-cover" />
        ) : (
          <div className="w-32 h-32 rounded-full border-2 border-primary-300 flex items-center justify-center text-primary-500 text-4xl">🏢</div>
        )}
        <p className="mt-3 text-xs text-gray-500 uppercase font-semibold">Company logo</p>
      </div>
      <style>{`.input{width:100%;padding:.65rem .85rem;border:1px solid #e5e7eb;border-radius:.5rem;font-size:.875rem;outline:none;background:#fff}.input:disabled{background:#f9fafb;color:#6b7280}.input:focus{border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,.1)}`}</style>
    </div>
  );
}

/* ─────────────── INTEGRATIONS ─────────────── */
function IntegrationsTab({ showError }) {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/accounts')
      .then((r) => setAccounts(r.data.accounts || r.data || []))
      .catch(() => showError('Failed to load integrations'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-10"><Loader2 className="animate-spin text-primary-500" /></div>;

  const platforms = [
    { key: 'instagram', label: 'Instagram' },
    { key: 'facebook', label: 'Facebook' },
    { key: 'whatsapp', label: 'WhatsApp' },
    { key: 'gmail', label: 'Email (Gmail)' },
  ];

  return (
    <div className="max-w-4xl">
      <h3 className="text-sm font-semibold text-gray-700 mb-4 pb-2 border-b">Social Links</h3>
      <div className="grid sm:grid-cols-2 gap-3">
        {platforms.map((p) => {
          const acc = accounts.find((a) => a.platform === p.key && a.status === 'active');
          return (
            <div key={p.key} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100">
              <span className="text-sm font-medium text-gray-700">{p.label}</span>
              {acc ? (
                <span className="flex items-center gap-1 text-xs text-emerald-600 font-semibold"><Check size={14} /> Connected</span>
              ) : (
                <a href="/connections" className="text-xs text-primary-600 font-semibold hover:underline">Connect →</a>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────── PLAN ─────────────── */
function PlanTab({ user }) {
  const planMap = { trial: 'Trial', starter: 'Starter', pro: 'Pro', elite: 'Elite', expired: 'Expired' };
  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-3 pb-2 border-b">Subscription</h3>
        <div className="bg-gray-50 rounded-xl p-5 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase text-gray-500 font-semibold mb-1">Plan</p>
            <p className="text-lg font-bold text-gray-900">{planMap[user?.plan] || user?.plan}</p>
            <p className="text-xs text-gray-500 mt-1">
              Status: <span className="font-semibold">{user?.subscriptionStatus}</span>
            </p>
            {user?.currentPeriodEnd && (
              <p className="text-xs text-gray-500 mt-1">Next payment: {new Date(user.currentPeriodEnd).toLocaleDateString()}</p>
            )}
            {user?.trialEndsAt && user?.plan === 'trial' && (
              <p className="text-xs text-gray-500 mt-1">Trial ends: {new Date(user.trialEndsAt).toLocaleDateString()}</p>
            )}
          </div>
          <a href="/pricing" className="px-5 py-2.5 bg-primary-600 text-white text-sm font-semibold rounded-lg shadow">
            Switch plan →
          </a>
        </div>
      </div>
    </div>
  );
}

/* ─────────────── TEAM ─────────────── */
function TeamTab({ user, isAdmin, showSuccess, showError }) {
  const [data, setData] = useState({ members: [], pending: [] });
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.get('/api/team/members')
      .then((r) => setData(r.data))
      .catch(() => showError('Failed to load team'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const removeMember = async (id) => {
    if (!confirm('Remove this member?')) return;
    try {
      await api.delete(`/api/team/members/${id}`);
      showSuccess('Member removed');
      load();
    } catch (e) {
      showError(e.response?.data?.error || 'Failed');
    }
  };

  const revokeInvite = async (id) => {
    try {
      await api.delete(`/api/team/invite/${id}`);
      showSuccess('Invite revoked');
      load();
    } catch (e) {
      showError('Failed');
    }
  };

  if (loading) return <div className="flex justify-center py-10"><Loader2 className="animate-spin text-primary-500" /></div>;

  return (
    <div className="max-w-5xl space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {data.members.map((m) => (
          <div key={m.id} className="bg-gray-50 rounded-xl p-5 flex flex-col items-center text-center border border-gray-100">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary-300 to-primary-500 flex items-center justify-center text-2xl font-bold text-white mb-3">
              {m.name?.[0]?.toUpperCase()}
            </div>
            <p className="font-semibold text-gray-900 truncate w-full">{m.name}</p>
            <p className="text-xs text-gray-500 capitalize">{m.role}</p>
            <p className="text-xs text-gray-400 mt-1 truncate w-full">{m.email}</p>
            {isAdmin && !m.isOwner && m.id !== user?.id && (
              <button onClick={() => removeMember(m.id)} className="mt-3 text-xs text-red-500 hover:text-red-700 flex items-center gap-1">
                <Trash2 size={12} /> Remove
              </button>
            )}
          </div>
        ))}
      </div>

      {data.pending.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Pending Invites</h3>
          <div className="space-y-2">
            {data.pending.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between bg-amber-50 border border-amber-100 rounded-lg px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-gray-900">{inv.email}</p>
                  <p className="text-xs text-gray-500">Pending • expires {new Date(inv.expiresAt).toLocaleDateString()}</p>
                </div>
                {isAdmin && (
                  <button onClick={() => revokeInvite(inv.id)} className="text-xs text-red-500 hover:text-red-700">Revoke</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────── INVITE MODAL ─────────────── */
function InviteModal({ onClose, showSuccess, showError }) {
  const [email, setEmail] = useState('');
  const [link, setLink] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const send = async () => {
    if (!EMAIL_RE.test(email)) return showError('Enter a valid email address');
    setLoading(true);
    try {
      const r = await api.post('/api/team/invite', { email });
      setLink(r.data.inviteLink);
      if (r.data.emailSent) showSuccess(`Invite emailed to ${email}`);
      else showSuccess('Invite created — copy the link below (email not configured)');
    } catch (e) {
      showError(e.response?.data?.error || 'Failed to send invite');
    } finally {
      setLoading(false);
    }
  };

  const copyLink = async () => {
    if (!link) {
      // Generate first
      if (!EMAIL_RE.test(email)) return showError('Enter a valid email first');
      await send();
      return;
    }
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-7 relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-700">
          <X size={18} />
        </button>
        <h2 className="text-lg font-bold text-gray-900 text-center mb-5">Invite to Team</h2>
        <Field label="SEND INVITE TO">
          <input
            type="email"
            placeholder="Enter email address"
            className="w-full px-3.5 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-primary-500"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        {link && (
          <div className="mt-3 px-3 py-2 bg-gray-50 rounded-lg text-xs text-gray-600 break-all">{link}</div>
        )}
        <div className="flex gap-3 mt-5">
          <button
            onClick={copyLink}
            disabled={loading}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 border border-gray-200 text-sm font-semibold rounded-lg hover:bg-gray-50"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied!' : 'Copy Invite Link'}
          </button>
          <button
            onClick={send}
            disabled={loading}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Send Invite
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1.5">{label}</label>
      {children}
    </div>
  );
}
