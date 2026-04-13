import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import AuthLayout, { AuthInput, GradientButton, GoogleButton } from '../components/AuthLayout.jsx';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [showCPw, setShowCPw] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fromWelcome = searchParams.get('from') === 'welcome';

  // On mobile (<768px), funnel users through the welcome screen first
  // unless they explicitly clicked through from it.
  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      !window.matchMedia('(min-width: 768px)').matches &&
      !fromWelcome
    ) {
      navigate('/welcome', { replace: true });
    }
  }, [fromWelcome, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      await register(email, email.split('@')[0], password);
      // After registration the user always lands on the pricing page —
      // they must either start the free trial or pick a paid plan before
      // they can access the dashboard.
      navigate('/pricing', { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleOAuth = () => {
    window.location.href = `${API_URL}/auth/gmail`;
  };

  return (
    <AuthLayout
      rightHeader={
        <p className="text-[12px] text-brand-slate">
          Already a Member?{' '}
          <Link to="/login" className="text-brand-dark font-bold tracking-wider hover:text-brand-blue">
            LOG IN NOW
          </Link>
        </p>
      }
      mobileFooter={
        <p>
          Already a Member?{' '}
          <Link to="/login?from=welcome" className="text-white font-bold tracking-wider hover:text-brand-blue underline">
            LOG IN NOW
          </Link>
        </p>
      }
    >
      <div className="text-center mb-7">
        <h1 className="text-[28px] font-bold text-white lg:text-brand-dark mb-1">
          <span className="lg:hidden">Sign up</span>
          <span className="hidden lg:inline">Sign up to Auradesk!</span>
        </h1>
        <p className="text-[13px] italic text-white/60 lg:text-brand-slate">
          Trusted by 300+ solopreneurs to save 10+ hours a week.
        </p>
      </div>

      <GoogleButton onClick={handleGoogleOAuth} label="Sign up with Google" />

      <div className="flex items-center my-5">
        <div className="flex-1 border-t border-white/15 lg:border-gray-200" />
        <span className="px-3 text-[12px] text-white/60 lg:text-brand-slate">Or use Email</span>
        <div className="flex-1 border-t border-white/15 lg:border-gray-200" />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2.5 rounded-lg mb-4 text-[13px]">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthInput
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
          required
        />
        <AuthInput
          label="Password"
          hasToggle
          show={showPw}
          onToggle={() => setShowPw((s) => !s)}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Min. 8 characters"
          autoComplete="new-password"
          required
          minLength={8}
        />
        <AuthInput
          label="Confirm Password"
          hasToggle
          show={showCPw}
          onToggle={() => setShowCPw((s) => !s)}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="Re-enter your password"
          autoComplete="new-password"
          required
        />
        <div className="pt-2">
          <GradientButton type="submit" disabled={loading}>
            {loading ? 'CREATING...' : <>CONTINUE <span className="text-lg leading-none">›</span></>}
          </GradientButton>
        </div>
      </form>
    </AuthLayout>
  );
}
