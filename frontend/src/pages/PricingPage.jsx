import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import api from '../services/api.js';
import { redirectToStripeCheckout } from '../services/stripe.js';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/* ─────────────── PLAN RANK ─────────────── */
// Mirrors PLAN_RANK in backend/src/utils/stripe.js.
// Used to determine which plans are upgrades vs current/lower for a given user.
const PLAN_RANK = { trial: 0, starter: 1, pro: 2, elite: 3 };

/* ─────────────── PLAN DATA ─────────────── */
const PLANS = [
  {
    id: 'starter',
    name: 'Starter',
    monthly: 29,
    yearly: 290,
    // Stack/back-card colour for the 3D effect
    stackColor: '#1787FE',
    // CTA gradient (top → bottom)
    btnGradient: 'linear-gradient(180deg, #2196FE 0%, #0f6fd8 100%)',
    btnGradientHover: 'linear-gradient(180deg, #1787FE 0%, #0a5ec0 100%)',
    features: [
      '1 social inbox (FB or IG)',
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
    features: [
      '3 social inboxes',
      'All platforms (FB, IG, WhatsApp, Gmail)',
      'Unlimited AI replies',
      'Branded invoice templates',
      'Follow-up automation (limited rules)',
      'Smart lead management',
      'Analytics dashboard (detailed)',
      'Up to 3 team members',
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
    features: [
      'Unlimited inboxes + platforms',
      'Multi-language AI replies',
      'Recurring invoices',
      'Custom follow-up rules',
      'Financial & performance reports',
      'Unlimited team members',
      'Early access to new features',
      'Premium support',
    ],
  },
];

/* ─────────────── PLAN CARD ─────────────── */
// 3D-stacked card matching the Figma mock: a colored back panel sits behind
// the white card and extends down to host the CHOOSE PLAN bar.
//
// planState: 'current' | 'upgrade' | 'locked'
//   current  → user is already on this plan (show badge, disable button)
//   upgrade  → this plan is higher than the user's current plan (show CTA)
//   locked   → this plan is lower than the user's current plan (hide / dim)
function PlanCard({ plan, cycle, loading, disabled, onChoose, planState }) {
  const price = cycle === 'monthly' ? plan.monthly : plan.yearly;
  const period = cycle === 'monthly' ? 'month' : 'year';

  const isCurrent  = planState === 'current';
  const isLocked   = planState === 'locked';

  // Locked cards are rendered faded so the user understands they can't go back
  const wrapperOpacity = isLocked ? 'opacity-40 pointer-events-none' : '';

  let btnLabel = 'CHOOSE PLAN';
  if (loading)   btnLabel = 'REDIRECTING…';
  else if (isCurrent) btnLabel = 'CURRENT PLAN';

  return (
    // `min-h` enforces taller cards across all tiers; `h-full` lets the grid
    // stretch the shorter ones to match the tallest. The wrapper is also a
    // flex column so the white card itself can grow with `flex-1`, giving
    // every white card the same (taller) height regardless of feature count.
    <div className={`relative pr-3 pb-14 h-full min-h-[500px] flex flex-col group/card ${wrapperOpacity}`}>
      {/* Stack/back card — extends right + below the white card for the 3D effect */}
      <div
        aria-hidden="true"
        className="absolute top-3 left-3 right-0 bottom-0 rounded-md"
        style={{ backgroundColor: plan.stackColor }}
      />

      {/* Front white card — content only (no CTA inside).
          `flex-1` here is what equalises the white-card heights: it stretches
          each card to fill the wrapper minus the pb-14 reserved button area,
          so Starter / Pro / Elite all show the same white surface. */}
      <div
        className="relative bg-white rounded-md border border-gray-100 flex-1"
        style={{ boxShadow: '0 10px 30px rgba(0, 0, 0, 0.08)' }}
      >
        <div className="px-6 pt-6 pb-6">
          <div className="mb-4">
            {/* Current plan badge */}
            {isCurrent && (
              <span className="inline-block mb-2 px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-[0.12em] bg-green-100 text-green-700">
                YOUR PLAN
              </span>
            )}
            <div className="flex items-baseline gap-1">
              <span className="text-[36px] leading-none font-bold text-[#0B1E3F]">${price}</span>
              <span className="text-gray-400 text-xs">/{period}</span>
            </div>
            <h3 className="mt-2 text-[20px] font-bold text-[#0B1E3F]">{plan.name}</h3>
          </div>

          <div className="border-t border-gray-200 mb-4" />

          <ul className="space-y-2.5">
            {plan.features.map((f, i) => (
              <li key={i} className="text-[12px] text-gray-500 leading-snug">
                {f}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* CHOOSE PLAN / CURRENT PLAN / UPGRADE bar */}
      <button
        type="button"
        onClick={() => !isCurrent && !isLocked && onChoose(plan.id)}
        disabled={loading || disabled || isCurrent || isLocked}
        className="absolute left-3 right-0 bottom-0 px-6 py-3.5 text-white text-[11px] font-bold tracking-[0.18em] flex items-center justify-between transition disabled:opacity-60 disabled:cursor-not-allowed rounded-b-md overflow-hidden"
      >
        {/* Hover-only gradient overlay (only shown on upgradable plans) */}
        {!isCurrent && !isLocked && (
          <span
            aria-hidden="true"
            className="absolute inset-0 opacity-0 group-hover/card:opacity-100 transition-opacity duration-200 ease-out rounded-b-md"
            style={{ background: plan.btnGradientHover }}
          />
        )}
        <span className="relative z-10">{btnLabel}</span>
        {!isCurrent && <ChevronRight size={16} strokeWidth={2.5} className="relative z-10" />}
      </button>
    </div>
  );
}

/* ─────────────── TRIAL BANNER ─────────────── */
// Shown ONLY to trial-eligible users above the plan cards. Clicking the
// button explicitly opts into the 14-day trial via includeTrial: true.
function TrialBanner({ onStartTrial, loading }) {
  return (
    <div
      className="rounded-2xl px-6 sm:px-8 py-5 sm:py-6 mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
      style={{
        background: 'linear-gradient(90deg, #cfe1ff 0%, #e3ecff 60%, #eef3ff 100%)',
        border: '1px solid #c7d8f8',
      }}
    >
      <div>
        <h2 className="text-[20px] sm:text-[24px] font-extrabold text-[#0B1E3F] leading-tight">
          14 Day Free Trial Available!
        </h2>
        <p className="mt-1.5 text-[12px] sm:text-[13px] text-[#1f3559]/75">
          Start your free trial now. Billing starts after the trial ends.
        </p>
      </div>
      <button
        type="button"
        onClick={onStartTrial}
        disabled={loading}
        className="self-start sm:self-auto px-6 py-2.5 rounded-full text-white text-[12px] font-bold tracking-[0.18em] shadow-md transition hover:shadow-lg active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
        style={{
          background: 'linear-gradient(90deg, #2A6FD4 0%, #1787FE 100%)',
        }}
      >
        {loading ? 'REDIRECTING…' : 'START FREE TRIAL'}
      </button>
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
// Default plan/cycle used by the trial banner — Starter monthly is the cheapest
// entry point so users can sample the product without committing to a tier.
const TRIAL_DEFAULT_PLAN = 'starter';
const TRIAL_DEFAULT_CYCLE = 'monthly';

export default function PricingPage() {
  const [cycle, setCycle] = useState('monthly');
  const [loading, setLoading] = useState(null);   // plan id while CHOOSE PLAN is mid-flight
  const [trialLoading, setTrialLoading] = useState(false); // trial banner mid-flight
  const [errorMsg, setErrorMsg] = useState(null);
  const { user, refreshUser, logout } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Handle ?payment=cancel callback from Stripe
  useEffect(() => {
    const payment = searchParams.get('payment');
    if (payment === 'cancel') {
      setErrorMsg('Payment was cancelled. You can try again or pick a different plan.');
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // ── Eligibility / state derivations ──
  const trialEligible = !!user && user.plan === 'trial' && !user.trialEndsAt;
  const trialExpired = !!user && (user.plan === 'expired' ||
    (user.plan === 'trial' && user.trialEndsAt && new Date(user.trialEndsAt) <= new Date()));

  // User is an active paid subscriber if they're on a paid plan with active status.
  const isActivePaidSubscriber = !!user &&
    ['starter', 'pro', 'elite'].includes(user.plan) &&
    ['active', 'trialing', 'past_due'].includes(user.subscriptionStatus);

  const userPlanRank  = PLAN_RANK[user?.plan] ?? 0;
  const userPlanCycle = user?.billingCycle || 'monthly';

  // Per-card state: 'current' | 'upgrade' | 'locked'
  const getPlanState = (planId) => {
    if (!user) return 'upgrade';
    const cardRank = PLAN_RANK[planId] ?? 0;
    if (cardRank < userPlanRank)  return 'locked';
    if (cardRank === userPlanRank) {
      // Same tier: if showing yearly and user is on monthly, it's still an upgrade
      if (cycle === 'yearly' && userPlanCycle === 'monthly') return 'upgrade';
      return 'current';
    }
    return 'upgrade';
  };

  const heading = 'Choose a plan to continue';
  const subtitle = trialExpired
    ? 'Your 14-day free trial has expired. Subscribe to continue growing your business!'
    : trialEligible
      ? 'Start with a 14-day free trial, or subscribe directly. Cancel anytime.'
      : isActivePaidSubscriber
        ? 'Upgrade your plan at any time. Unused time is prorated and credited immediately.'
        : 'Subscribe to continue growing your business!';

  // ── Handlers ──
  // Routing logic:
  //   • Active paid subscriber clicking a card  → POST /upgrade-plan (in-place or checkout)
  //   • Any other user clicking a card          → POST /create-checkout (new subscription)
  //   • Trial banner                            → POST /create-checkout (includeTrial: true)
  const startCheckout = async ({ planId, withTrial }) => {
    setErrorMsg(null);
    if (withTrial) setTrialLoading(true);
    else setLoading(planId);

    try {
      let res;

      if (!withTrial && isActivePaidSubscriber) {
        // Upgrade path for existing paid subscribers
        res = await api.post('/api/subscription/upgrade-plan', {
          plan: planId,
          cycle,
        });

        if (res.data.requiresCheckout) {
          // Trial→paid or inactive subscription — redirect to Stripe Checkout
          await redirectToStripeCheckout({ url: res.data.checkoutUrl, sessionId: res.data.sessionId });
        } else {
          // In-place upgrade completed — refresh user and go to dashboard
          if (refreshUser) await refreshUser();
          navigate('/dashboard');
        }
        return;
      }

      // New subscriber or trial flow
      res = await api.post('/api/subscription/create-checkout', {
        plan: planId,
        cycle: withTrial ? TRIAL_DEFAULT_CYCLE : cycle,
        includeTrial: withTrial,
      });
      await redirectToStripeCheckout({ url: res.data.url, sessionId: res.data.sessionId });

    } catch (err) {
      // 501 = Stripe not configured server-side (local dev fallback)
      if (err.response?.status === 501) {
        try {
          if (withTrial) {
            await api.post('/api/subscription/start-trial');
          } else {
            await api.post('/api/subscription/activate', { plan: planId, cycle });
          }
          if (refreshUser) await refreshUser();
          navigate('/onboarding?welcome=1');
          return;
        } catch (fallbackErr) {
          console.error('Stripe-less fallback failed:', fallbackErr);
          setErrorMsg('Could not start your plan. Please try again.');
        }
      } else {
        const serverMsg = err.response?.data?.message || err.response?.data?.error;
        console.error('Plan action failed:', err);
        setErrorMsg(serverMsg || err.message || 'Something went wrong. Please try again.');
      }
    } finally {
      if (withTrial) setTrialLoading(false);
      else setLoading(null);
    }
  };

  const handleChoosePlan = (planId) => startCheckout({ planId, withTrial: false });
  const handleStartTrial = () => startCheckout({ planId: TRIAL_DEFAULT_PLAN, withTrial: true });

  const handleReturnToLogin = () => {
    if (logout) logout();
    navigate('/login');
  };

  return (
    <div
      className="min-h-screen w-full flex flex-col px-5 sm:px-8 lg:px-12 py-5 sm:py-6"
      style={{
        background: 'linear-gradient(180deg, #d6e4ff 0%, #e7eeff 40%, #f1f5ff 100%)',
      }}
    >
      {/* Top bar — full page width so the link sits at the LEFT page edge,
          not centered with the cards. */}
      <button
        type="button"
        onClick={handleReturnToLogin}
        className="flex items-center gap-1 text-[12px] text-gray-500 hover:text-gray-800 transition self-start"
      >
        <ChevronLeft size={15} />
        <span>Return to Log in</span>
      </button>

      {/* Centered card section — heading, toggle, cards live inside the
          max-w container so they stay nicely aligned in the middle of the
          viewport while the top/bottom rails sit at the page edges. */}
      <div className="w-full max-w-[1140px] mx-auto mt-4 flex-1">
        {/* Header row: title/subtitle on the left, cycle toggle on the right */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <h1 className="text-[22px] sm:text-[26px] font-extrabold text-[#0B1E3F] leading-tight tracking-tight">
              {heading}
            </h1>
            <p className="mt-1 text-[12px] sm:text-[13px] text-gray-500 max-w-xl">
              {subtitle}
            </p>
          </div>
          <div className="sm:pt-1">
            <CycleToggle cycle={cycle} onChange={setCycle} />
          </div>
        </div>

        {/* Error message */}
        {errorMsg && (
          <div className="mt-3 max-w-xl bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">
            {errorMsg}
          </div>
        )}

        {/* Trial banner — only shown to brand-new, trial-eligible users.
            Clicking this button is the ONLY way to opt into the 14-day free trial. */}
        {trialEligible && (
          <div className="mt-4">
            <TrialBanner onStartTrial={handleStartTrial} loading={trialLoading} />
          </div>
        )}

        {/* Plan cards — grid stretches so every card matches the tallest one,
            keeping the CHOOSE PLAN bars on a single baseline regardless of
            how many features each tier lists. */}
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-7">
          {PLANS.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              cycle={cycle}
              loading={loading === plan.id}
              disabled={loading !== null || trialLoading}
              onChoose={handleChoosePlan}
              planState={getPlanState(plan.id)}
            />
          ))}
        </div>
      </div>

      {/* Footer — full page width, copyright pinned to the LEFT page edge,
          aligned consistently with the Return-to-Log-in link above. */}
      <div className="mt-6 text-[11px] text-gray-400 self-start">
        <span>Copyright 2021 - 2025 AuraDesk Inc. All Rights Reserved.</span>
      </div>
    </div>
  );
}
