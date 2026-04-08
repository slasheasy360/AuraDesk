import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import api from '../services/api.js';
import { Check, AlertTriangle } from 'lucide-react';

/**
 * Post-checkout landing page.
 *
 * Stripe redirects the user here after a successful Checkout Session. The
 * job of this page is to:
 *   1. Call POST /api/subscription/sync-session — pulls the subscription
 *      from Stripe immediately and persists it to the DB. This removes
 *      the race against the asynchronous webhook.
 *   2. Refresh the AuthContext user so the route guards see the new plan.
 *   3. Route the user to the next step:
 *        - onboarding incomplete → /onboarding
 *        - onboarding complete   → /  (dashboard)
 *
 * If the immediate sync fails (e.g. Stripe returns the session as not yet
 * paid because the network round-trip beat us), we fall back to polling
 * /api/subscription/status until isActive=true (or we time out).
 */
export default function PaymentSuccessPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { refreshUser } = useAuth();

  const [phase, setPhase] = useState('syncing'); // 'syncing' | 'success' | 'error'
  const [errorMsg, setErrorMsg] = useState(null);
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return; // StrictMode double-invoke guard
    ranRef.current = true;

    const sessionId = searchParams.get('session_id');

    const routeNext = (user) => {
      // Honour onboarding state — if not complete, send the user there;
      // otherwise drop them into the dashboard.
      if (user && (user.onboardingStep ?? 0) >= 4) {
        navigate('/', { replace: true });
      } else {
        navigate('/onboarding?welcome=1', { replace: true });
      }
    };

    const pollStatus = async (attemptsLeft = 8) => {
      try {
        const res = await api.get('/api/subscription/status');
        if (res.data?.isActive) {
          const user = await refreshUser();
          setPhase('success');
          // Brief success flash, then route
          setTimeout(() => routeNext(user), 600);
          return;
        }
      } catch (e) {
        // ignore — retry below
      }
      if (attemptsLeft > 0) {
        setTimeout(() => pollStatus(attemptsLeft - 1), 1500);
      } else {
        setPhase('error');
        setErrorMsg(
          'Your payment was processed, but we could not confirm your subscription yet. ' +
          'Please refresh in a moment or contact support.'
        );
      }
    };

    const run = async () => {
      try {
        if (!sessionId) {
          // No session id — try the polling fallback only
          await pollStatus();
          return;
        }

        // Primary path: sync the session immediately
        const res = await api.post('/api/subscription/sync-session', { sessionId });
        if (res.data?.isActive) {
          const user = await refreshUser();
          setPhase('success');
          setTimeout(() => routeNext(user), 600);
          return;
        }
        // Sync returned but not yet active — fall through to polling
        await pollStatus();
      } catch (err) {
        console.error('[PaymentSuccess] sync-session failed:', err);
        // Fall back to polling /status — webhook may already have written
        await pollStatus();
      }
    };

    run();
  }, [searchParams, navigate, refreshUser]);

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center px-4"
      style={{
        background: 'linear-gradient(180deg, #d6e4ff 0%, #e7eeff 40%, #f1f5ff 100%)',
      }}
    >
      <div className="w-full max-w-md bg-white rounded-2xl shadow-[0_10px_50px_rgba(15,42,99,0.08)] border border-blue-100 p-8 text-center">
        {phase === 'syncing' && (
          <>
            <div className="mx-auto mb-5 w-14 h-14 rounded-full border-4 border-blue-100 border-t-blue-500 animate-spin" />
            <h1 className="text-[20px] font-bold text-[#0B1E3F]">Confirming your payment…</h1>
            <p className="mt-2 text-sm text-gray-500">
              Hang tight — we're activating your account.
            </p>
          </>
        )}

        {phase === 'success' && (
          <>
            <div className="mx-auto mb-5 w-14 h-14 rounded-full bg-green-500 flex items-center justify-center">
              <Check size={28} className="text-white" strokeWidth={3} />
            </div>
            <h1 className="text-[20px] font-bold text-[#0B1E3F]">Payment confirmed</h1>
            <p className="mt-2 text-sm text-gray-500">Taking you to your account…</p>
          </>
        )}

        {phase === 'error' && (
          <>
            <div className="mx-auto mb-5 w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center">
              <AlertTriangle size={28} className="text-amber-600" />
            </div>
            <h1 className="text-[20px] font-bold text-[#0B1E3F]">Almost there</h1>
            <p className="mt-2 text-sm text-gray-500">{errorMsg}</p>
            <div className="mt-5 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="w-full bg-[#0B1E3F] hover:bg-[#13294d] text-white px-5 py-2.5 rounded-lg text-sm font-semibold tracking-wide transition"
              >
                Retry
              </button>
              <button
                type="button"
                onClick={() => navigate('/pricing')}
                className="w-full text-sm text-gray-500 hover:text-gray-800 transition"
              >
                Back to pricing
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
