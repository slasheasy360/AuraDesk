import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api from '../services/api.js';
import AuthLayout, { AuthInput, GradientButton } from '../components/AuthLayout.jsx';

/* ─────────────── Password rules ─────────────── */
// Mirror of the server-side rules in backend/src/routes/auth.js.
// Returning a boolean per rule lets us render the live checklist + strength bar.

function hasSequentialDigits(pw) {
  for (let i = 0; i <= pw.length - 3; i++) {
    const a = pw.charCodeAt(i);
    const b = pw.charCodeAt(i + 1);
    const c = pw.charCodeAt(i + 2);
    const isDigit = (code) => code >= 48 && code <= 57;
    if (isDigit(a) && isDigit(b) && isDigit(c) && b === a + 1 && c === b + 1) {
      return true;
    }
  }
  return false;
}

function evaluatePassword(pw) {
  const rules = {
    length:    pw.length >= 8,
    upper:     /[A-Z]/.test(pw),
    lower:     /[a-z]/.test(pw),
    number:    /[0-9]/.test(pw),
    special:   /[^A-Za-z0-9]/.test(pw),
    noSequential: pw.length > 0 && !hasSequentialDigits(pw),
  };
  const passed = Object.values(rules).filter(Boolean).length;
  const allValid = passed === 6;

  // Strength label is keyed off the rule pass-count.
  // 0–2: Weak, 3–4: Medium, 5–6: Strong (with all 6 = Strong).
  let strength = 'Weak';
  let strengthColor = '#ef4444';   // red-500
  let strengthPct = 0;
  if (passed === 0) {
    strength = '';
    strengthPct = 0;
  } else if (passed <= 2) {
    strength = 'Weak';
    strengthColor = '#ef4444';
    strengthPct = 33;
  } else if (passed <= 4) {
    strength = 'Medium';
    strengthColor = '#f59e0b';     // amber-500
    strengthPct = 66;
  } else {
    strength = 'Strong';
    strengthColor = '#10b981';     // emerald-500
    strengthPct = 100;
  }

  return { rules, passed, allValid, strength, strengthColor, strengthPct };
}

/* ─────────────── Inline rule checklist ─────────────── */
function RuleItem({ ok, label }) {
  return (
    <li
      className={`flex items-center gap-2 text-[12px] transition-colors ${
        ok ? 'text-emerald-500' : 'text-white/55 lg:text-gray-500'
      }`}
    >
      <span
        className={`inline-flex items-center justify-center w-4 h-4 rounded-full border transition ${
          ok
            ? 'bg-emerald-500 border-emerald-500 text-white'
            : 'border-white/30 lg:border-gray-300'
        }`}
      >
        {ok ? (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : null}
      </span>
      <span>{label}</span>
    </li>
  );
}

/* ─────────────── Page ─────────────── */
export default function ResetPasswordPage() {
  const { token } = useParams();
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [showCPw, setShowCPw] = useState(false);
  const [touched, setTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const evaluation = useMemo(() => evaluatePassword(password), [password]);
  const passwordsMatch = confirm.length > 0 && password === confirm;
  const canSubmit = evaluation.allValid && passwordsMatch && !loading && !success;

  // Auto-redirect to login a few seconds after a successful reset.
  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => navigate('/login', { replace: true }), 2500);
    return () => clearTimeout(t);
  }, [success, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setTouched(true);
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

              {/* Animated strength underline bar */}
              <div className="mt-2 h-[3px] w-full rounded-full bg-white/10 lg:bg-gray-200 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500 ease-out"
                  style={{
                    width: `${evaluation.strengthPct}%`,
                    backgroundColor: evaluation.strengthColor,
                  }}
                />
              </div>
              {evaluation.strength && (
                <div className="mt-1.5 flex items-center justify-between text-[11px]">
                  <span className="text-white/55 lg:text-gray-500">Password strength</span>
                  <span
                    className="font-semibold tracking-wide"
                    style={{ color: evaluation.strengthColor }}
                  >
                    {evaluation.strength}
                  </span>
                </div>
              )}
            </div>

            {/* Live rule checklist */}
            <ul className="grid grid-cols-1 gap-1.5 px-1">
              <RuleItem ok={evaluation.rules.length}       label="At least 8 characters" />
              <RuleItem ok={evaluation.rules.upper}        label="One uppercase letter (A–Z)" />
              <RuleItem ok={evaluation.rules.lower}        label="One lowercase letter (a–z)" />
              <RuleItem ok={evaluation.rules.number}       label="One number (0–9)" />
              <RuleItem ok={evaluation.rules.special}      label="One special character" />
              <RuleItem ok={evaluation.rules.noSequential} label="No sequential numbers (e.g. 123, 456)" />
            </ul>

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
              {touched && confirm.length > 0 && !passwordsMatch && (
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
