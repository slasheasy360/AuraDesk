import { useEffect, useState, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useLinkAccounts } from '../context/LinkAccountsContext.jsx';
import api from '../services/api.js';
import { redirectToStripeCheckout } from '../services/stripe.js';
import { UserPlus, X, Copy, Check, Trash2, Loader2, Zap, Upload } from 'lucide-react';

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
              {t === 'Plan' && user?.plan && user.plan !== 'expired' && (
                <span className="ml-1.5 text-[9px] px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded font-bold uppercase">
                  {user.plan === 'trial' ? 'TRIAL' : user.plan}
                </span>
              )}
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
  const [logoPreview, setLogoPreview] = useState(user?.companyLogo || null);
  const [uploading, setUploading] = useState(false);
  const [logoKey, setLogoKey] = useState(null); // pending S3 key, saved on "Save changes"
  const fileInputRef = useRef(null);

  // Keep preview in sync if user refreshes (e.g. after save)
  useEffect(() => {
    setLogoPreview(user?.companyLogo || null);
  }, [user?.companyLogo]);

  const handleLogoSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Show local preview immediately
    const reader = new FileReader();
    reader.onload = (ev) => setLogoPreview(ev.target.result);
    reader.readAsDataURL(file);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('logo', file);
      const res = await api.post('/api/onboarding/upload-logo', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (res.data.url) setLogoPreview(res.data.url);
      if (res.data.s3Key) setLogoKey(res.data.s3Key);
    } catch (err) {
      console.error('Logo upload failed:', err);
      showError('Logo upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (!canEdit) return;
    setSaving(true);
    try {
      await api.put('/api/profile/company', {
        ...form,
        ...(logoKey ? { companyLogo: logoKey } : {}),
      });
      setLogoKey(null);
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
          <button disabled={saving || uploading} onClick={save} className="px-6 py-2.5 bg-primary-600 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        ) : (
          <p className="text-xs text-gray-500">You don't have permission to edit company info.</p>
        )}
      </div>
      <div className="flex flex-col items-center gap-3">
        <div className="relative">
          {logoPreview ? (
            <img src={logoPreview} alt="Company logo" className="w-32 h-32 rounded-full object-cover border-2 border-primary-200" />
          ) : (
            <div className="w-32 h-32 rounded-full border-2 border-primary-300 flex items-center justify-center text-primary-500 text-4xl bg-blue-50">🏢</div>
          )}
          {uploading && (
            <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center">
              <Loader2 size={28} className="animate-spin text-white" />
            </div>
          )}
        </div>
        <p className="text-xs text-gray-500 uppercase font-semibold tracking-wide">Company Logo</p>
        {canEdit && (
          <>
            <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleLogoSelect} />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-primary-600 border border-primary-300 rounded-full hover:bg-primary-50 transition disabled:opacity-50"
            >
              <Upload size={13} /> Upload logo
            </button>
          </>
        )}
      </div>
      <style>{`.input{width:100%;padding:.65rem .85rem;border:1px solid #e5e7eb;border-radius:.5rem;font-size:.875rem;outline:none;background:#fff}.input:disabled{background:#f9fafb;color:#6b7280}.input:focus{border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,.1)}`}</style>
    </div>
  );
}

/* ─────────────── INTEGRATIONS ─────────────── */
function IntegrationsTab({ showError }) {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const { openLinkAccounts } = useLinkAccounts();

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
                <button
                  type="button"
                  onClick={openLinkAccounts}
                  className="text-xs text-primary-600 font-semibold hover:underline"
                >
                  Connect →
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────── PLAN / BILLING ─────────────── */
const PLAN_LABELS = { trial: 'Trial', starter: 'Starter', pro: 'Pro', elite: 'Elite', expired: 'Expired' };
const PLAN_PRICES = {
  starter: { monthly: 29,  yearly: 290,  features: '1 social inbox · 30 AI replies/mo · Basic dashboard' },
  pro:     { monthly: 79,  yearly: 790,  features: '3 inboxes · Unlimited AI replies · Analytics · Priority support' },
  elite:   { monthly: 149, yearly: 1490, features: 'Unlimited inboxes · Multi-language · Unlimited team members · Premium support' },
};
// Mirrors PLAN_RANK in backend/src/utils/stripe.js
const PLAN_RANK = { trial: 0, starter: 1, pro: 2, elite: 3 };
const STATUS_PILLS = {
  trialing:  { label: 'Trialing',  bg: 'bg-blue-100',    text: 'text-blue-700' },
  active:    { label: 'Active',    bg: 'bg-emerald-100', text: 'text-emerald-700' },
  past_due:  { label: 'Past due',  bg: 'bg-amber-100',   text: 'text-amber-700' },
  canceled:  { label: 'Canceled',  bg: 'bg-gray-200',    text: 'text-gray-700' },
  expired:   { label: 'Expired',   bg: 'bg-red-100',     text: 'text-red-700' },
};

function fmtDate(dateLike) {
  if (!dateLike) return '—';
  try {
    return new Date(dateLike).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  } catch {
    return '—';
  }
}

function PlanTab({ user }) {
  const { refreshUser } = useAuth();
  const navigate = useNavigate();
  // Seed status from the AuthContext user so the UI renders immediately
  // even before /subscription/status responds (or if it fails).
  const [status, setStatus] = useState(() => user ? {
    plan: user.plan,
    subscriptionStatus: user.subscriptionStatus,
    isSubscribed: user.isSubscribed,
    trialEndsAt: user.trialEndsAt,
    currentPeriodStart: user.currentPeriodStart,
    currentPeriodEnd: user.currentPeriodEnd,
    cancelAtPeriodEnd: user.cancelAtPeriodEnd,
    gracePeriodEndsAt: user.gracePeriodEndsAt,
    billingCycle: user.billingCycle,
    trialActive: user.plan === 'trial' && user.trialEndsAt && new Date(user.trialEndsAt) > new Date(),
    trialDaysLeft: user.plan === 'trial' && user.trialEndsAt
      ? Math.max(0, Math.ceil((new Date(user.trialEndsAt) - new Date()) / (1000 * 60 * 60 * 24)))
      : 0,
  } : null);
  const [loading, setLoading] = useState(true);
  const [actionPending, setActionPending] = useState(null); // 'cancel' | 'resume' | planId
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cycle, setCycle] = useState(user?.billingCycle || 'monthly');

  const loadStatus = () => {
    setLoading(true);
    setError('');
    api.get('/api/subscription/status')
      .then((r) => {
        setStatus(r.data);
        if (r.data.billingCycle) setCycle(r.data.billingCycle);
      })
      .catch((err) => {
        console.error('[PlanTab] /subscription/status failed:', err.response?.status, err.message);
        // Don't blank out the UI — keep the seeded status from the user prop.
        // Only show an error banner if we have no data at all to display.
        if (!status) {
          setError('Could not load full subscription details. Showing cached data.');
        }
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadStatus(); /* eslint-disable-next-line */ }, []);

  const planLabel = PLAN_LABELS[status?.plan] || status?.plan || '—';
  const statusPill = STATUS_PILLS[status?.subscriptionStatus] || { label: status?.subscriptionStatus, bg: 'bg-gray-100', text: 'text-gray-700' };
  const hasStripeSub = !!status?.subscriptionId;
  const isPaidPlan = ['starter', 'pro', 'elite'].includes(status?.plan);

  const handleCancel = async () => {
    setError(''); setSuccess(''); setActionPending('cancel');
    try {
      const r = await api.post('/api/subscription/cancel');
      setSuccess(`Subscription will end on ${fmtDate(r.data.accessUntil)}. You can resume anytime before then.`);
      await loadStatus();
      if (refreshUser) await refreshUser();
    } catch (e) {
      setError(e.response?.data?.error || 'Could not cancel subscription');
    } finally {
      setActionPending(null);
      setConfirmOpen(false);
    }
  };

  const handleResume = async () => {
    setError(''); setSuccess(''); setActionPending('resume');
    try {
      await api.post('/api/subscription/resume');
      setSuccess('Subscription resumed. Your billing will continue as normal.');
      await loadStatus();
      if (refreshUser) await refreshUser();
    } catch (e) {
      setError(e.response?.data?.error || 'Could not resume subscription');
    } finally {
      setActionPending(null);
    }
  };

  const handleUpgrade = async (planId) => {
    setError(''); setSuccess(''); setActionPending(planId);
    try {
      const r = await api.post('/api/subscription/upgrade-plan', { plan: planId, cycle });
      if (r.data.requiresCheckout && r.data.checkoutUrl) {
        window.location.href = r.data.checkoutUrl;
        return;
      }
      setSuccess(`Upgraded to ${PLAN_LABELS[planId]} (${cycle})! Changes take effect immediately.`);
      await loadStatus();
      if (refreshUser) await refreshUser();
    } catch (e) {
      setError(e.response?.data?.error || 'Upgrade failed. Please try again.');
    } finally {
      setActionPending(null);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-10"><Loader2 className="animate-spin text-primary-500" /></div>;
  }

  return (
    <div className="max-w-4xl space-y-6">
      {/* Banner: error / success */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}
      {success && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded-lg text-sm">{success}</div>
      )}

      {/* Trial countdown banner */}
      {status?.trialActive && (
        <div className="bg-blue-50 border border-blue-200 text-blue-700 px-4 py-3 rounded-lg text-sm flex items-center justify-between gap-4">
          <div>
            <strong>Trial active.</strong> {status.trialDaysLeft} day{status.trialDaysLeft === 1 ? '' : 's'} remaining
            {status.trialEndsAt ? ` — converts on ${fmtDate(status.trialEndsAt)}.` : '.'}
          </div>
        </div>
      )}

      {/* Grace period banner */}
      {status?.inGracePeriod && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-lg text-sm">
          <strong>Payment failed.</strong> You have {status.graceDaysLeft} day{status.graceDaysLeft === 1 ? '' : 's'} of grace remaining
          (until {fmtDate(status.gracePeriodEndsAt)}). Please update your payment method to keep your account active.
        </div>
      )}

      {/* Cancellation pending banner */}
      {status?.cancelAtPeriodEnd && hasStripeSub && (
        <div className="bg-gray-100 border border-gray-200 text-gray-800 px-4 py-3 rounded-lg text-sm flex items-center justify-between gap-4">
          <div>
            Your subscription is scheduled to end on <strong>{fmtDate(status.currentPeriodEnd)}</strong>.
          </div>
          <button
            onClick={handleResume}
            disabled={actionPending === 'resume'}
            className="px-4 py-1.5 bg-primary-600 hover:bg-primary-700 text-white text-xs font-semibold rounded-lg disabled:opacity-50"
          >
            {actionPending === 'resume' ? 'Resuming…' : 'Resume'}
          </button>
        </div>
      )}

      {/* Current plan card */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-3 pb-2 border-b">Current subscription</h3>
        <div className="bg-white border border-gray-200 rounded-xl p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold mb-1">Plan</p>
            <p className="text-xl font-bold text-gray-900">{planLabel}</p>
            {status?.billingCycle && isPaidPlan && (
              <p className="text-xs text-gray-500 mt-0.5 capitalize">{status.billingCycle}</p>
            )}
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold mb-1">Status</p>
            <span className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-bold ${statusPill.bg} ${statusPill.text}`}>
              {statusPill.label}
            </span>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold mb-1">Started</p>
            <p className="text-sm text-gray-900">{fmtDate(status?.currentPeriodStart)}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold mb-1">
              {status?.cancelAtPeriodEnd ? 'Access until' : 'Next billing'}
            </p>
            <p className="text-sm text-gray-900">{fmtDate(status?.currentPeriodEnd)}</p>
          </div>
        </div>
      </div>

      {/* Plans overview */}
      <div>
        <div className="flex items-center justify-between mb-3 pb-2 border-b">
          <h3 className="text-sm font-semibold text-gray-700">Plans</h3>
          <div className="inline-flex bg-gray-100 rounded-full p-0.5 text-[11px] font-bold">
            <button
              onClick={() => setCycle('monthly')}
              className={`px-3 py-1 rounded-full transition ${cycle === 'monthly' ? 'bg-primary-600 text-white' : 'text-gray-600'}`}
            >
              MONTHLY
            </button>
            <button
              onClick={() => setCycle('yearly')}
              className={`px-3 py-1 rounded-full transition ${cycle === 'yearly' ? 'bg-primary-600 text-white' : 'text-gray-600'}`}
            >
              YEARLY
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {Object.entries(PLAN_PRICES).map(([planId, info]) => {
            const isCurrent = status?.plan === planId && status?.billingCycle === cycle && !status?.cancelAtPeriodEnd;
            const price = info[cycle];
            const period = cycle === 'monthly' ? 'mo' : 'yr';
            const currentRank = PLAN_RANK[status?.plan] ?? 0;
            const isUpgrade = PLAN_RANK[planId] > currentRank ||
              (planId === status?.plan && cycle === 'yearly' && status?.billingCycle === 'monthly' && !status?.cancelAtPeriodEnd);
            const isPending = actionPending === planId;

            return (
              <div
                key={planId}
                className={`rounded-xl border p-5 flex flex-col ${
                  isCurrent ? 'border-primary-500 bg-primary-50/40 ring-1 ring-primary-200' : 'border-gray-200 bg-white'
                }`}
              >
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div>
                    <p className="text-lg font-bold text-gray-900">{PLAN_LABELS[planId]}</p>
                    <p className="text-2xl font-extrabold text-gray-900 mt-1">
                      ${price}<span className="text-sm font-medium text-gray-500">/{period}</span>
                    </p>
                  </div>
                  {isCurrent && (
                    <span className="inline-block px-2 py-0.5 text-[10px] font-bold tracking-wider rounded-full bg-primary-600 text-white">
                      CURRENT
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 leading-relaxed flex-1">{info.features}</p>
                {isUpgrade && (
                  <button
                    onClick={() => handleUpgrade(planId)}
                    disabled={!!actionPending}
                    className="mt-4 w-full flex items-center justify-center gap-1.5 px-4 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition"
                  >
                    {isPending ? (
                      <><Loader2 size={13} className="animate-spin" /> Upgrading…</>
                    ) : (
                      <><Zap size={13} /> Upgrade to {PLAN_LABELS[planId]}</>
                    )}
                  </button>
                )}
                {isCurrent && (
                  <p className="mt-4 text-center text-[11px] text-primary-600 font-semibold">Your current plan</p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Cancel section */}
      {hasStripeSub && !status?.cancelAtPeriodEnd && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-3 pb-2 border-b">Cancel subscription</h3>
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 flex items-center justify-between gap-4">
            <p className="text-xs text-gray-600">
              You'll keep access until <strong>{fmtDate(status?.currentPeriodEnd)}</strong>. You can resume anytime before then.
            </p>
            <button
              onClick={() => setConfirmOpen(true)}
              disabled={actionPending === 'cancel'}
              className="px-4 py-2 border border-red-300 text-red-600 hover:bg-red-50 text-xs font-semibold rounded-lg disabled:opacity-50"
            >
              Cancel subscription
            </button>
          </div>
        </div>
      )}

      {/* Confirmation modal for cancel */}
      {confirmOpen && (
        <div className="fixed inset-0 bg-black/40 z-[100] flex items-center justify-center px-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Cancel subscription?</h3>
            <p className="text-sm text-gray-600 mb-5">
              You'll keep full access until <strong>{fmtDate(status?.currentPeriodEnd)}</strong>.
              After that your account will lose access to paid features. You can resume the subscription
              at any time before that date.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmOpen(false)}
                className="px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100 rounded-lg"
              >
                Keep subscription
              </button>
              <button
                onClick={handleCancel}
                disabled={actionPending === 'cancel'}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50"
              >
                {actionPending === 'cancel' ? 'Canceling…' : 'Confirm cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
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
