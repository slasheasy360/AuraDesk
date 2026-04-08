import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import api from '../services/api.js';
import { redirectToStripeCheckout } from '../services/stripe.js';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/* ─────────────── PLAN DATA ─────────────── */
const PLANS = [
  {
    id: 'starter',
    name: 'Starter',
    monthly: 29,
    yearly: 290,
    // Stack/back-card colour for the 3D effect (kept for legacy)
    stackColor: '#1787FE',
    // Subscribe Now CTA gradient (top → bottom)
    btnGradient: 'linear-gradient(180deg, #2196FE 0%, #0f6fd8 100%)',
    btnGradientHover: 'linear-gradient(180deg, #1787FE 0%, #0a5ec0 100%)',
    // Start Free Trial outline button color
    btnBorder: '#1787FE',
    btnBorderHoverBg: '#eff6ff',
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
    btnGradient: 'linear-gradient(180deg, #13294d 0%, #0B1E3F 100%)',
    btnGradientHover: 'linear-gradient(180deg, #1a3460 0%, #13294d 100%)',
    btnBorder: '#0B1E3F',
    btnBorderHoverBg: '#f1f5f9',
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
    btnGradient: 'linear-gradient(180deg, #0a2240 0%, #031428 100%)',
    btnGradientHover: 'linear-gradient(180deg, #102e50 0%, #0a2240 100%)',
    btnBorder: '#031428',
    btnBorderHoverBg: '#f1f5f9',
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
function PlanCard({
  plan,
  cycle,
  trialEligible,
  trialLoading,
  subscribeLoading,
  disabled,
  onStartTrial,
  onSubscribeNow,
}) {
  const price = cycle === 'monthly' ? plan.monthly : plan.yearly;
  const period = cycle === 'monthly' ? 'month' : 'year';

  return (
    <div className="relative">
      {/* Front white card — natural height, content + dual CTA inside */}
      <div
        className="relative bg-white rounded-2xl border border-gray-100 overflow-hidden flex flex-col h-full"
        style={{ boxShadow: '0 10px 30px rgba(0, 0, 0, 0.08)' }}
      >
        <div className="p-7 pb-5 flex-1">
          <div className="mb-5">
            <div className="flex items-baseline gap-1">
              <span className="text-[40px] leading-none font-bold text-[#0B1E3F]">${price}</span>
              <span className="text-gray-400 text-sm">/{period}</span>
            </div>
            <h3 className="mt-2 text-[22px] font-bold text-[#0B1E3F]">{plan.name}</h3>
          </div>

          <div className="border-t border-gray-200 mb-5" />

          <ul className="space-y-3">
            {plan.features.map((f, i) => (
              <li key={i} className="text-[13px] text-gray-500 leading-snug">
                {f}
              </li>
            ))}
          </ul>
        </div>

        {/* Dual CTA stack — Start Free Trial (if eligible) + Subscribe Now */}
        <div className="px-7 pb-6 pt-2 space-y-2.5">
          {trialEligible && (
            <button
              type="button"
              onClick={() => onStartTrial(plan.id)}
              disabled={trialLoading || subscribeLoading || disabled}
              className="w-full px-5 py-3 rounded-xl text-[12px] font-bold tracking-[0.14em] flex items-center justify-center gap-2 transition disabled:opacity-60 disabled:cursor-not-allowed border-2"
              style={{
                borderColor: plan.btnBorder,
                color: plan.btnBorder,
                backgroundColor: 'white',
              }}
              onMouseEnter={(e) => {
                if (!trialLoading && !subscribeLoading && !disabled) {
                  e.currentTarget.style.backgroundColor = plan.btnBorderHoverBg;
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'white';
              }}
            >
              <span>{trialLoading ? 'REDIRECTING…' : 'START FREE TRIAL'}</span>
              {!trialLoading && <ChevronRight size={14} strokeWidth={2.5} />}
            </button>
          )}

          <button
            type="button"
            onClick={() => onSubscribeNow(plan.id)}
            disabled={trialLoading || subscribeLoading || disabled}
            className="w-full px-5 py-3 rounded-xl text-white text-[12px] font-bold tracking-[0.14em] flex items-center justify-center gap-2 transition disabled:opacity-60 disabled:cursor-not-allowed"
            style={{ background: plan.btnGradient }}
            onMouseEnter={(e) => {
              if (!trialLoading && !subscribeLoading && !disabled) {
                e.currentTarget.style.background = plan.btnGradientHover;
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = plan.btnGradient;
            }}
          >
            <span>{subscribeLoading ? 'REDIRECTING…' : 'SUBSCRIBE NOW'}</span>
            {!subscribeLoading && <ChevronRight size={14} strokeWidth={2.5} />}
          </button>

          {trialEligible && (
            <p className="text-[10px] text-center text-gray-400 leading-snug pt-1">
              Trial: 14 days free, then ${price}/{period}. Cancel anytime.
            </p>
          )}
        </div>
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

/* ─────────────── MAIN PAGE ─────────────── */
export default function PricingPage() {
  const [cycle, setCycle] = useState('monthly');
  // Track which plan is mid-flight so the right button shows REDIRECTING…
  // and the others lock out. Two slots so trial vs subscribe stay independent.
  const [trialLoadingPlan, setTrialLoadingPlan] = useState(null);
  const [subscribeLoadingPlan, setSubscribeLoadingPlan] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const { user, refreshUser, logout } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Handle ?payment=cancel callback from Stripe
  useEffect(() => {
    const payment = searchParams.get('payment');
    if (payment === 'cancel') {
      setErrorMsg('Payment was cancelled. You can try again or pick a different option.');
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // ── Eligibility ──
  // User can start the free trial only if they're brand-new (plan === 'trial'
  // and trialEndsAt is null — i.e. the trial has never been started or used).
  const trialEligible = !!user && user.plan === 'trial' && !user.trialEndsAt;
  const trialExpired = !!user && (user.plan === 'expired' ||
    (user.plan === 'trial' && user.trialEndsAt && new Date(user.trialEndsAt) <= new Date()));

  const subtitle = trialExpired
    ? 'Your free trial has ended. Choose a plan to keep going.'
    : trialEligible
      ? 'Try any plan free for 14 days, or subscribe instantly. Cancel anytime.'
      : 'Choose a plan that fits your business.';

  const heading = trialExpired ? 'Subscribe to continue' : 'Choose a plan';

  // ── Handlers ──
  // The two flows differ ONLY in the includeTrial flag we send to the backend.
  // Same Stripe Checkout endpoint, same success/cancel URLs, same DB writes via
  // webhook. Each handler stores the user's intent in localStorage so the
  // success page can show the correct confirmation message.
  const startCheckout = async (planId, { withTrial }) => {
    if (withTrial && !trialEligible) return; // safety: can't trial twice
    const setLoading = withTrial ? setTrialLoadingPlan : setSubscribeLoadingPlan;
    setErrorMsg(null);
    setLoading(planId);
    try {
      const res = await api.post('/api/subscription/create-checkout', {
        plan: planId,
        cycle,
        includeTrial: withTrial,
      });
      try {
        localStorage.setItem(
          'selectedPlan',
          JSON.stringify({ plan: planId, cycle, withTrial }),
        );
      } catch {}
      await redirectToStripeCheckout({ url: res.data.url, sessionId: res.data.sessionId });
    } catch (err) {
      // If Stripe is not configured server-side (501), fall back to the
      // local dev paths so the flow can still complete in development.
      if (err.response?.status === 501) {
        try {
          if (withTrial) {
            await api.post('/api/subscription/start-trial');
          } else {
            await api.post('/api/subscription/activate', { plan: planId, cycle });
          }
          try {
            localStorage.setItem(
              'selectedPlan',
              JSON.stringify({ plan: planId, cycle, withTrial }),
            );
            localStorage.setItem('paymentStatus', 'success');
          } catch {}
          if (refreshUser) await refreshUser();
          navigate('/onboarding?payment=success');
          return;
        } catch (fallbackErr) {
          console.error('Stripe-less fallback failed:', fallbackErr);
          setErrorMsg('Could not start your plan. Please try again.');
        }
      } else {
        console.error('Checkout failed:', err);
        setErrorMsg(
          err.response?.data?.error || err.message || 'Checkout failed. Please try again.',
        );
      }
    } finally {
      setLoading(null);
    }
  };

  const handleStartTrial = (planId) => startCheckout(planId, { withTrial: true });
  const handleSubscribeNow = (planId) => startCheckout(planId, { withTrial: false });

  const handleReturnToLogin = () => {
    if (logout) logout();
    navigate('/login');
  };

  const anyLoading = !!trialLoadingPlan || !!subscribeLoadingPlan;

  return (
    <div className="min-h-screen w-full" style={{ backgroundColor: '#f3f5f8' }}>
      <div className="max-w-[1140px] mx-auto px-6 sm:px-10 pt-6 sm:pt-8 pb-5 min-h-screen flex flex-col">
        {/* Top: return-to-login link */}
        <button
          type="button"
          onClick={handleReturnToLogin}
          className="self-start flex items-center gap-1 text-[13px] text-gray-500 hover:text-gray-800 transition"
        >
          <ChevronLeft size={16} />
          <span>Return to Log in</span>
        </button>

        {/* Header row: title/subtitle on the left, cycle toggle on the right */}
        <div className="mt-5 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h1 className="text-[28px] sm:text-[34px] font-extrabold text-[#0B1E3F] leading-tight tracking-tight">
              {heading}
            </h1>
            <p className="mt-2 text-[13px] sm:text-[14px] text-gray-500 max-w-xl">
              {subtitle}
            </p>
          </div>
          <div className="sm:pt-2">
            <CycleToggle cycle={cycle} onChange={setCycle} />
          </div>
        </div>

        {errorMsg && (
          <div className="mt-5 max-w-xl bg-red-50 border border-red-200 text-red-700 px-4 py-2.5 rounded-lg text-sm">
            {errorMsg}
          </div>
        )}

        {/* Plan cards — each card carries its own pair of CTAs */}
        <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8 items-stretch">
          {PLANS.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              cycle={cycle}
              trialEligible={trialEligible}
              trialLoading={trialLoadingPlan === plan.id}
              subscribeLoading={subscribeLoadingPlan === plan.id}
              disabled={anyLoading}
              onStartTrial={handleStartTrial}
              onSubscribeNow={handleSubscribeNow}
            />
          ))}
        </div>

        {/* Footer pinned to the bottom of the viewport */}
        <div className="mt-auto pt-10 text-[11px] text-gray-400">
          <span>Copyright 2021 - 2025 AuraDesk Inc. All Rights Reserved.</span>
        </div>
      </div>
    </div>
  );
}
