import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api.js';
import AuthLayout, { AuthInput, GradientButton } from '../components/AuthLayout.jsx';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const emailValid = EMAIL_RE.test(email.trim());
  const showEmailError = touched && email.length > 0 && !emailValid;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setTouched(true);
    setError('');
    if (!emailValid) return;

    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email: email.trim().toLowerCase() });
      // Backend always returns the same message — we never disclose whether
      // the email exists, so just confirm the request was accepted.
      setSubmitted(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not send reset link. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      rightHeader={
        <p className="text-[12px] text-brand-slate">
          Remembered it?{' '}
          <Link
            to="/login"
            className="text-brand-dark font-bold tracking-wider hover:text-brand-blue"
          >
            LOG IN
          </Link>
        </p>
      }
      mobileFooter={
        <p>
          Remembered it?{' '}
          <Link
            to="/login?from=welcome"
            className="text-white font-bold tracking-wider hover:text-brand-blue underline"
          >
            LOG IN
          </Link>
        </p>
      }
    >
      <div className="text-center mb-7">
        <h1 className="text-[28px] font-bold text-white lg:text-brand-dark mb-1">
          Forgot password?
        </h1>
        <p className="text-[13px] text-white/60 lg:text-brand-slate">
          Enter your email and we'll send you a reset link.
        </p>
      </div>

      {submitted ? (
        <div className="space-y-5">
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-4 rounded-xl text-[13px]">
            <p className="font-semibold mb-1">Check your inbox</p>
            <p className="text-green-700/90">
              If an account exists for <strong>{email}</strong>, a password reset link
              has been sent. The link expires in 10 minutes.
            </p>
          </div>
          <Link
            to="/login"
            className="block text-center text-[13px] text-brand-blue font-semibold hover:underline"
          >
            ← Back to log in
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
                label="EMAIL"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              {showEmailError && (
                <p className="mt-1.5 text-[12px] text-red-400 lg:text-red-600">
                  Please enter a valid email address.
                </p>
              )}
            </div>
            <div className="pt-2">
              <GradientButton type="submit" disabled={loading || !emailValid}>
                {loading ? 'SENDING...' : (
                  <>SEND RESET LINK <span className="text-lg leading-none">›</span></>
                )}
              </GradientButton>
            </div>
            <div className="pt-2 text-center">
              <Link
                to="/login"
                className="text-[12px] text-white/60 lg:text-brand-slate hover:text-brand-blue"
              >
                ← Back to log in
              </Link>
            </div>
          </form>
        </>
      )}
    </AuthLayout>
  );
}
