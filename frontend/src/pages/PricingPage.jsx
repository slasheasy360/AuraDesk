import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import api from '../services/api.js';
import { redirectToStripeCheckout } from '../services/stripe.js';
import { ChevronLeft, ChevronRight, HelpCircle } from 'lucide-react';

/* ─────────────── PLAN DATA ─────────────── */
const PLANS = [
  {
    id: 'starter',
    name: 'Starter',
    monthly: 29,
    yearly: 290,
    // Stack/back-card colour for the 3D effect
    stackColor: '#1787FE',
    // CTA button colour
    btnColor: '#1787FE',
    btnHover: '#0f6fd8',
    features: [
      '1 social inbox (IG, FB, TikTok, etc.)',
      'AI-generated replies (max 30/month)',
      'Manual invoice creation',
      'Lead capture & tracking',
      'Performance dashboard (basic)',
      'Email & DM support',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    monthly: 79,
    yearly: 790,
    popular: true,
    stackColor: '#0B1E3F',
    btnColor: '#0B1E3F',
    btnHover: '#13294d',
    features: [
      '3 social inboxes',
      'Unlimited AI replies',
      'Branded invoice templates',
      'Follow-up automation (limited rules)',
      'Smart lead management',
      'Analytics dashboard (detailed)',
      'Email, DM & WhatsApp integration',
      'Priority support',
    ],
  },
  {
    id: 'elite',
    name: 'Elite',
    monthly: 149,
    yearly: 1490,
    stackColor: '#031428',
    btnColor: '#031428',
    btnHover: '#0a2240',
    features: [
      'Unlimited inboxes + platforms',
      'Multi-language AI replies',
      'Recurring invoices',
      'Custom follow-up rules',
      'Financial & performance reports',
      'Team access (up to 3 users)',
      'Early access to new features',
      'Premium support',
    ],
  },
];

/* ─────────────── PLAN CARD ─────────────── */
function PlanCard({ plan, cycle, loading, disabled, onChoose }) {
  const price = cycle === 'monthly' ? plan.monthly : plan.yearly;
  const period = cycle === 'monthly' ? 'month' : 'year';

  return (
    <div className="relative pr-3 pb-3">
      {/* Stack/back card — slightly offset to give a 3D layered look */}
      <div
        aria-hidden="true"
        className="absolute top-3 right-0 bottom-0 left-3 rounded-2xl"
        style={{ backgroundColor: plan.stackColor }}
      />

      {/* Front white card */}
      <div className="relative bg-white rounded-2xl shadow-sm border border-gray-100 flex flex-col overflow-hidden">
        <div className="p-7 pb-5 flex-1 flex flex-col">
          <div className="mb-5">
            <div className="flex items-baseline gap-1">
              <span className="text-[40px] leading-none font-bold text-[#0B1E3F]">${price}</span>
              <span className="text-gray-400 text-sm">/{period}</span>
            </div>
            <h3 className="mt-2 text-[22px] font-bold text-[#0B1E3F]">{plan.name}</h3>
          </div>

          <div className="border-t border-gray-200 mb-5" />

          <ul className="space-y-3 flex-1">
            {plan.features.map((f, i) => (
              <li key={i} className="text-[13px] text-gray-500 leading-snug">
                {f}
              </li>
            ))}
          </ul>
        </div>

        {/* CTA — full-width bar at the bottom of the white card */}
        <button
          type="button"
          onClick={() => onChoose(plan.id)}
          disabled={loading || disabled}
          className="w-full px-7 py-4 text-white text-[12px] font-bold tracking-[0.18em] flex items-center justify-between transition disabled:opacity-60 disabled:cursor-not-allowed"
          style={{
            backgroundColor: plan.btnColor,
          }}
          onMouseEnter={(e) => {
            if (!loading && !disabled) e.currentTarget.style.backgroundColor = plan.btnHover;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = plan.btnColor;
          }}
        >
          <span>{loading ? 'REDIRECTING…' : 'CHOOSE PLAN'}</span>
          <ChevronRight size={16} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}

/* ─────────────── BILLING CYCLE TOGGLE ─────────────── */
function CycleToggle({ cycle, onChange }) {
  return (
    <div className="inline-flex bg-white border border-gray-200 rounded-full p-1 shadow-sm">
      <button
        type="button"
        onClick={() => onChange('monthly')}
        className={`px-5 py-1.5 rounded-full text-[11px] font-bold tracking-[0.15em] transition ${
          cycle === 'monthly' ? 'bg-[#0B1E3F] text-white shadow' : 'text-gray-500 hover:text-gray-700'
        }`}
      >
        MONTHLY
      </button>
      <button
        type="button"
        onClick={() => onChange('yearly')}
        className={`px-5 py-1.5 rounded-full text-[11px] font-bold tracking-[0.15em] transition ${
          cycle === 'yearly' ? 'bg-[#0B1E3F] text-white shadow' : 'text-gray-500 hover:text-gray-700'
        }`}
      >
        YEARLY
      </button>
    </div>
  );
}

/* ─────────────── TRIAL BANNER ─────────────── */
function TrialBanner({ onTryNow, loading }) {
  return (
    <div
      className="rounded-2xl px-6 sm:px-8 py-5 sm:py-6 mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
      style={{
        background: 'linear-gradient(90deg, #cfe1ff 0%, #e3ecff 60%, #eef3ff 100%)',
        border: '1px solid #c7d8f8',
      }}
    >
      <div>
        <h2 className="text-[22px] sm:text-[26px] font-extrabold text-[#0B1E3F] leading-tight">
          14 Day Free Trial Available!
        </h2>
        <p className="mt-1 text-[11px] tracking-[0.18em] font-semibold text-[#1f3559]/70">
          NO CREDIT CARD REQUIRED
        </p>
      </div>
      <button
        type="button"
        onClick={onTryNow}
        disabled={loading}
        className="self-start sm:self-auto px-6 py-2.5 rounded-full text-white text-[12px] font-bold tracking-[0.18em] shadow-md transition hover:shadow-lg active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
        style={{
          background: 'linear-gradient(90deg, #2A6FD4 0%, #1787FE 100%)',
        }}
      >
        {loading ? 'STARTING…' : 'TRY NOW!'}
      </button>
    </div>
  );
}

/* ─────────────── MAIN PAGE ─────────────── */
export default function PricingPage() {
  const [cycle, setCycle] = useState('monthly');
  const [loading, setLoading] = useState(null); // plan id while redirecting
  const [trialLoading, setTrialLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [paymentCompleted, setPaymentCompleted] = useState(false);
  const { user, refreshUser, logout } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Restore payment success flag (prevents duplicate payments / re-charging)
  useEffect(() => {
    try {
      if (localStorage.getItem('paymentStatus') === 'success') {
        setPaymentCompleted(true);
      }
    } catch {}
  }, []);

  // Handle ?payment=cancel callback from Stripe
  useEffect(() => {
    const payment = searchParams.get('payment');
    if (payment === 'cancel') {
      setErrorMsg('Payment was cancelled. You can try again or pick a different plan.');
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // ── Eligibility / state derivations ──
  // User can start the free trial only if they're brand-new (plan === 'trial' but
  // trialEndsAt is null, meaning the trial has never been started).
  const trialEligible = !!user && user.plan === 'trial' && !user.trialEndsAt;
  const trialActive =
    !!user && user.plan === 'trial' && user.trialEndsAt && new Date(user.trialEndsAt) > new Date();
  const trialExpired = !!user && (user.plan === 'expired' ||
    (user.plan === 'trial' && user.trialEndsAt && new Date(user.trialEndsAt) <= new Date()));

  const alreadyPaid =
    paymentCompleted ||
    (user && user.subscriptionStatus === 'active' && ['starter', 'pro', 'elite'].includes(user.plan));

  const subtitle = trialExpired
    ? 'Your 14-day free trial has exhausted. Subscribe to continue growing your business!'
    : 'Subscribe to continue growing your business!';

  const heading = trialEligible ? 'Or choose a plan' : 'Choose a plan to continue';

  // ── Handlers ──
  const handleStartTrial = async () => {
    setErrorMsg(null);
    setTrialLoading(true);
    try {
      await api.post('/api/subscription/start-trial');
      if (refreshUser) await refreshUser();
      navigate('/onboarding');
    } catch (err) {
      console.error('Start trial failed:', err);
      setErrorMsg(err.response?.data?.error || 'Could not start trial. Please try again.');
    } finally {
      setTrialLoading(false);
    }
  };

  const handleChoosePlan = async (planId) => {
    if (alreadyPaid) return;
    setErrorMsg(null);
    setLoading(planId);
    try {
      const res = await api.post('/api/subscription/create-checkout', {
        plan: planId,
        cycle,
        // Bundle the 14-day trial into Stripe sub if user is still trial-eligible
        includeTrial: trialEligible,
      });
      // Persist last-selected plan so we can resume after a cancel/abandon
      try {
        localStorage.setItem('selectedPlan', JSON.stringify({ plan: planId, cycle }));
      } catch {}
      await redirectToStripeCheckout({ url: res.data.url, sessionId: res.data.sessionId });
    } catch (err) {
      // If Stripe is not configured server-side (501), fall back to manual activation
      if (err.response?.status === 501) {
        try {
          await api.post('/api/subscription/activate', { plan: planId, cycle });
          if (refreshUser) await refreshUser();
          navigate('/onboarding');
          return;
        } catch (activateErr) {
          console.error('Activation failed:', activateErr);
          setErrorMsg('Could not activate plan. Please try again.');
        }
      } else {
        console.error('Checkout failed:', err);
        setErrorMsg(err.response?.data?.error || err.message || 'Checkout failed. Please try again.');
      }
    } finally {
      setLoading(null);
    }
  };

  const handleReturnToLogin = () => {
    if (logout) logout();
    navigate('/login');
  };

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center px-3 sm:px-6 py-6 sm:py-10"
      style={{
        background:
          'linear-gradient(180deg, #d6e4ff 0%, #e7eeff 40%, #f1f5ff 100%)',
      }}
    >
      <div className="w-full max-w-[1080px] bg-[#f6f8fc] rounded-3xl border border-blue-100 shadow-[0_10px_50px_rgba(15,42,99,0.08)] px-5 sm:px-10 pt-6 sm:pt-7 pb-5 sm:pb-6">
        {/* Top: return-to-login link */}
        <button
          type="button"
          onClick={handleReturnToLogin}
          className="flex items-center gap-1 text-[13px] text-gray-500 hover:text-gray-800 transition"
        >
          <ChevronLeft size={16} />
          <span>Return to Log in</span>
        </button>

        {/* Trial banner (only if eligible) */}
        {trialEligible && (
          <div className="mt-5">
            <TrialBanner onTryNow={handleStartTrial} loading={trialLoading} />
          </div>
        )}

        {/* Header row: title/subtitle on the left, cycle toggle on the right */}
        <div className="mt-3 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h1 className="text-[26px] sm:text-[30px] font-extrabold text-[#0B1E3F] leading-tight">
              {heading}
            </h1>
            <p className="mt-1 text-[13px] sm:text-[14px] text-gray-500 max-w-xl">
              {subtitle}
            </p>
          </div>
          <div className="sm:pt-2">
            <CycleToggle cycle={cycle} onChange={setCycle} />
          </div>
        </div>

        {/* Error / status messages */}
        {alreadyPaid && (
          <div className="mt-5 max-w-xl bg-green-50 border border-green-200 text-green-700 px-4 py-2.5 rounded-lg text-sm">
            ✅ Your subscription is active. Redirecting…
          </div>
        )}
        {trialActive && !alreadyPaid && user?.trialEndsAt && (
          <div className="mt-5 max-w-xl bg-blue-50 border border-blue-200 text-blue-700 px-4 py-2.5 rounded-lg text-sm">
            Your trial ends on{' '}
            <strong>
              {new Date(user.trialEndsAt).toLocaleDateString(undefined, {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
            </strong>
            . Pick a plan now to keep your account active afterwards.
          </div>
        )}
        {errorMsg && (
          <div className="mt-5 max-w-xl bg-red-50 border border-red-200 text-red-700 px-4 py-2.5 rounded-lg text-sm">
            {errorMsg}
          </div>
        )}

        {/* Plan cards */}
        <div className="mt-7 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-7">
          {PLANS.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              cycle={cycle}
              loading={loading === plan.id}
              disabled={alreadyPaid || loading !== null}
              onChoose={handleChoosePlan}
            />
          ))}
        </div>

        {/* Footer */}
        <div className="mt-8 sm:mt-10 flex items-center justify-between text-[11px] text-gray-400">
          <span>Copyright 2021 - 2025 AuraDesk Inc. All Rights Reserved.</span>
          <button
            type="button"
            className="flex items-center gap-1.5 hover:text-gray-600 transition"
            onClick={() => window.open('mailto:support@auradesk.com', '_blank')}
          >
            <HelpCircle size={13} />
            <span>Need help?</span>
          </button>
        </div>
      </div>
    </div>
  );
}
