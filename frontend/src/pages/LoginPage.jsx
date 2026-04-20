import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import AuthLayout, { AuthInput, GradientButton, GoogleButton } from '../components/AuthLayout.jsx';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const oauthError = searchParams.get('error');
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
    setLoading(true);
    try {
      const u = await login(email, password);
      // Route the user based on their subscription / onboarding state.
      // Both flags are pulled from the backend on every login — never
      // trust frontend cache.
      const hasActivePlan =
        (u?.plan === 'trial' && u?.trialEndsAt && new Date(u.trialEndsAt) > new Date()) ||
        ['starter', 'pro', 'elite'].includes(u?.plan);
      if (!hasActivePlan) {
        navigate('/pricing', { replace: true });
      } else if (!u?.onboardingCompleted) {
        navigate('/onboarding', { replace: true });
      } else {
        navigate('/inbox', { replace: true });
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed');
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
          New here?{' '}
          <Link to="/register" className="text-brand-dark font-bold tracking-wider hover:text-brand-blue">
            SIGN UP NOW
          </Link>
        </p>
      }
      mobileFooter={
        <p>
          Not a member yet?{' '}
          <Link to="/register?from=welcome" className="text-white font-bold tracking-wider hover:text-brand-blue underline">
            JOIN NOW
          </Link>
        </p>
      }
    >
      <div className="text-center mb-7">
        <h1 className="text-[28px] font-bold text-white lg:text-brand-dark mb-1">
          <span className="lg:hidden">Log in</span>
          <span className="hidden lg:inline">Welcome back!</span>
        </h1>
        <p className="text-[13px] italic text-white/60 lg:text-brand-slate">
          <span className="lg:hidden">Trusted by 300+ solopreneurs to save 10+ hours a week.</span>
          <span className="hidden lg:inline">Log in to your AuraDesk account</span>
        </p>
      </div>

      <GoogleButton onClick={handleGoogleOAuth} label="Log in with Google" />

      <div className="flex items-center my-5">
        <div className="flex-1 border-t border-white/15 lg:border-gray-200" />
        <span className="px-3 text-[12px] text-white/60 lg:text-brand-slate">Or use Email</span>
        <div className="flex-1 border-t border-white/15 lg:border-gray-200" />
      </div>

      {(error || oauthError) && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2.5 rounded-lg mb-4 text-[13px]">
          {error || `OAuth login failed: ${oauthError}`}
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
          placeholder="Enter your password"
          autoComplete="current-password"
          required
        />
        <div className="flex justify-end -mt-1">
          <Link
            to="/forgot-password"
            className="text-[12px] font-semibold text-white/70 lg:text-brand-slate hover:text-brand-blue transition"
          >
            Forgot password?
          </Link>
        </div>
        <div className="pt-2">
          <GradientButton type="submit" disabled={loading}>
            {loading ? 'LOGGING IN...' : <>CONTINUE <span className="text-lg leading-none">›</span></>}
          </GradientButton>
        </div>
      </form>
    </AuthLayout>
  );
}
