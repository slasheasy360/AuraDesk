import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api from '../services/api.js';
import AuthLayout, { AuthInput, GradientButton } from '../components/AuthLayout.jsx';
import PasswordStrengthChecker from '../components/PasswordStrengthChecker.jsx';
import { evaluatePassword } from '../utils/passwordValidation.js';

/* ─────────────── Page ─────────────── */
export default function ResetPasswordPage() {
  const { token } = useParams();
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [showCPw, setShowCPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [mismatchVisible, setMismatchVisible] = useState(false);

  const evaluation = useMemo(() => evaluatePassword(password), [password]);
  const passwordsMatch = confirm.length > 0 && password === confirm;
  const canSubmit = evaluation.allValid && passwordsMatch && !loading && !success;

  // Auto-redirect to login after a successful reset.
  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => navigate('/login', { replace: true }), 2500);
    return () => clearTimeout(t);
  }, [success, navigate]);

  // Auto-clear banner error after 5 s
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(''), 5000);
    return () => clearTimeout(t);
  }, [error]);

  // Show inline mismatch hint and auto-hide after 5 s
  useEffect(() => {
    if (confirm.length === 0) { setMismatchVisible(false); return; }
    if (!passwordsMatch) {
      setMismatchVisible(true);
      const t = setTimeout(() => setMismatchVisible(false), 5000);
      return () => clearTimeout(t);
    }
    setMismatchVisible(false);
  }, [confirm, passwordsMatch]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!canSubmit) return;

    setLoading(true);
    try {
      await api.post('/auth/reset-password', { token, password });
      setSuccess(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not reset password. The link may have expired.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      rightHeader={
        <p className="text-[12px] text-brand-slate">
          Remembered it?{' '}
          <Link to="/login" className="text-brand-dark font-bold tracking-wider hover:text-brand-blue">
            LOG IN
          </Link>
        </p>
      }
      mobileFooter={
        <p>
          Remembered it?{' '}
          <Link to="/login?from=welcome" className="text-white font-bold tracking-wider hover:text-brand-blue underline">
            LOG IN
          </Link>
        </p>
      }
    >
      <div className="text-center mb-6">
        <h1 className="text-[28px] font-bold text-white lg:text-brand-dark mb-1">
          {success ? 'Password reset!' : 'Reset your password'}
        </h1>
        <p className="text-[13px] text-white/60 lg:text-brand-slate">
          {success
            ? 'Redirecting you to log in…'
            : 'Choose a strong new password to secure your account.'}
        </p>
      </div>

      {success ? (
        <div className="space-y-5">
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-4 rounded-xl text-[13px] text-center">
            <p className="font-semibold mb-1">Your password has been updated.</p>
            <p className="text-green-700/90">You can now log in with your new password.</p>
          </div>
          <Link
            to="/login"
            className="block w-full text-center py-3.5 rounded-xl text-white text-[14px] font-semibold tracking-wider uppercase shadow-lg shadow-brand-blue/30"
            style={{ background: 'linear-gradient(90deg, #2A6FD4 0%, #1787FE 100%)' }}
          >
            GO TO LOG IN
          </Link>
        </div>
      ) : (
        <>
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2.5 rounded-lg mb-4 text-[13px]">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div>
              <AuthInput
                label="NEW PASSWORD"
                hasToggle
                show={showPw}
                onToggle={() => setShowPw((s) => !s)}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />

              <PasswordStrengthChecker evaluation={evaluation} dark />
            </div>

            <div>
              <AuthInput
                label="CONFIRM PASSWORD"
                hasToggle
                show={showCPw}
                onToggle={() => setShowCPw((s) => !s)}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
              {mismatchVisible && (
                <p className="mt-1.5 text-[12px] text-red-400 lg:text-red-600">
                  Passwords do not match.
                </p>
              )}
            </div>

            <div className="pt-2">
              <GradientButton type="submit" disabled={!canSubmit}>
                {loading ? 'RESETTING...' : (
                  <>RESET PASSWORD <span className="text-lg leading-none">›</span></>
                )}
              </GradientButton>
            </div>
          </form>
        </>
      )}
    </AuthLayout>
  );
}
