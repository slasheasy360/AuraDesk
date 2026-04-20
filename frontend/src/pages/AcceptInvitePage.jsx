import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Loader2 } from 'lucide-react';

export default function AcceptInvitePage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const [state, setState] = useState({ loading: true, invite: null, error: '' });
  const [form, setForm] = useState({ firstName: '', lastName: '', password: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/api/team/invite/${token}`)
      .then((r) => setState({ loading: false, invite: r.data, error: '' }))
      .catch((e) => setState({ loading: false, invite: null, error: e.response?.data?.error || 'Invalid invite' }));
  }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.password.length < 6) return setError('Password must be at least 6 characters');
    setSubmitting(true);
    try {
      const r = await api.post('/api/team/accept', { token, ...form });
      localStorage.setItem('token', r.data.token);
      api.defaults.headers.common['Authorization'] = `Bearer ${r.data.token}`;
      await refreshUser();
      navigate('/inbox', { replace: true });
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to accept invite');
    } finally {
      setSubmitting(false);
    }
  };

  if (state.loading) {
    return <div className="flex h-screen items-center justify-center bg-[#f0f4ff]"><Loader2 className="animate-spin text-primary-500" size={28} /></div>;
  }

  if (state.error) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#f0f4ff] px-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center">
          <h1 className="text-xl font-bold text-gray-900 mb-2">Invite unavailable</h1>
          <p className="text-sm text-gray-600 mb-5">{state.error}</p>
          <button onClick={() => navigate('/login')} className="px-5 py-2.5 bg-primary-600 text-white text-sm font-semibold rounded-lg">Go to login</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen items-center justify-center bg-[#f0f4ff] px-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Join {state.invite.companyName}</h1>
        <p className="text-sm text-gray-600 mb-6">You've been invited as <span className="font-semibold capitalize">{state.invite.role}</span>. Set a password to activate your account.</p>
        <form onSubmit={submit} className="space-y-4">
          <input className="input" disabled value={state.invite.email} />
          <div className="grid grid-cols-2 gap-3">
            <input className="input" placeholder="First name" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
            <input className="input" placeholder="Last name" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
          </div>
          <input type="password" className="input" placeholder="Password (min 6)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          {error && <p className="text-xs text-red-500">{error}</p>}
          <button disabled={submitting} className="w-full py-2.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
            {submitting ? 'Creating account…' : 'Accept invite & continue'}
          </button>
        </form>
        <style>{`.input{width:100%;padding:.65rem .85rem;border:1px solid #e5e7eb;border-radius:.5rem;font-size:.875rem;outline:none;background:#fff}.input:disabled{background:#f9fafb;color:#6b7280}.input:focus{border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,.1)}`}</style>
      </div>
    </div>
  );
}
