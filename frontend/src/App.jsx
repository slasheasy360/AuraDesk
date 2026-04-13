import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import WelcomePage from './pages/WelcomePage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import ForgotPasswordPage from './pages/ForgotPasswordPage.jsx';
import ResetPasswordPage from './pages/ResetPasswordPage.jsx';
import OAuthCallbackPage from './pages/OAuthCallbackPage.jsx';
import PricingPage from './pages/PricingPage.jsx';
import PaymentSuccessPage from './pages/PaymentSuccessPage.jsx';
import OnboardingPage from './pages/OnboardingPage.jsx';
import DashboardLayout from './components/DashboardLayout.jsx';
import DashboardHome from './pages/DashboardHome.jsx';
import InboxPage from './pages/InboxPage.jsx';
import ConnectionsPage from './pages/ConnectionsPage.jsx';
import LeadsPage from './pages/LeadsPage.jsx';
import InvoiceListPage from './pages/InvoiceListPage.jsx';
import CreateInvoicePage from './pages/CreateInvoicePage.jsx';
import InvoiceDetailPage from './pages/InvoiceDetailPage.jsx';
import PublicInvoicePage from './pages/PublicInvoicePage.jsx';
import ProfileSettingsPage from './pages/ProfileSettingsPage.jsx';
import AcceptInvitePage from './pages/AcceptInvitePage.jsx';
import AITrainingPage from './pages/AITrainingPage.jsx';

function FullPageSkeleton() {
  return (
    <div className="flex h-screen bg-gray-100">
      <div className="hidden lg:flex w-64 bg-gray-800 flex-col">
        <div className="px-5 py-5 border-b border-white/10 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gray-600 animate-pulse" />
          <div className="h-5 w-24 bg-gray-600 rounded animate-pulse" />
        </div>
        <div className="px-3 py-4 space-y-2">
          <div className="h-10 bg-gray-700 rounded-lg animate-pulse" />
          <div className="h-10 bg-gray-700/50 rounded-lg animate-pulse" />
        </div>
      </div>
      <div className="flex-1 flex">
        <div className="w-80 lg:w-96 bg-white border-r border-gray-200 flex-col hidden md:flex">
          <div className="px-4 py-4 border-b border-gray-200">
            <div className="h-6 w-32 bg-gray-200 rounded animate-pulse mb-3" />
            <div className="h-10 bg-gray-100 rounded-lg animate-pulse" />
          </div>
          <div className="flex-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="px-4 py-3.5 flex items-center gap-3 border-b border-gray-100">
                <div className="w-11 h-11 rounded-full bg-gray-200 animate-pulse flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 bg-gray-200 rounded animate-pulse w-28" />
                  <div className="h-3 bg-gray-100 rounded animate-pulse w-44" />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex-1 bg-gray-50 flex items-center justify-center">
          <div className="w-12 h-12 rounded-full bg-gray-200 animate-pulse" />
        </div>
      </div>
    </div>
  );
}

/**
 * Access control — must mirror backend `requireActiveSubscription`.
 * Allows: paid plan with status active/trialing, paid plan with past_due
 * inside grace period, OR free trial that hasn't elapsed yet.
 */
function hasUsableAccess(user) {
  if (!user) return false;
  const PAID = ['starter', 'pro', 'elite'];
  const now = new Date();

  if (PAID.includes(user.plan) && ['active', 'trialing'].includes(user.subscriptionStatus)) {
    return true;
  }
  if (
    PAID.includes(user.plan) &&
    user.subscriptionStatus === 'past_due' &&
    user.gracePeriodEndsAt &&
    new Date(user.gracePeriodEndsAt) > now
  ) {
    return true;
  }
  if (user.plan === 'trial' && user.trialEndsAt && new Date(user.trialEndsAt) > now) {
    return true;
  }
  return false;
}

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <FullPageSkeleton />;
  if (!user) return <Navigate to="/welcome" />;
  if (!hasUsableAccess(user)) return <Navigate to="/pricing" />;
  // `onboardingCompleted` is the canonical flag — set as soon as the
  // organization is created. The legacy `onboardingStep` int is kept
  // around as a UI breadcrumb but is NOT used for routing.
  if (!user.onboardingCompleted) return <Navigate to="/onboarding" />;
  return children;
}

/** Minimal full-page loader — used for auth-only routes (pricing, onboarding) to avoid dashboard skeleton flash */
function FullPageLoader() {
  return (
    <div className="flex items-center justify-center h-screen bg-[#f0f4ff]">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
    </div>
  );
}

/** Redirect authenticated users away from public-only pages (login, register) */
function PublicRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <FullPageLoader />;
  if (user) return <Navigate to="/inbox" replace />;
  return children;
}

/** Only redirect to pricing if user has no active plan (expired trial, no subscription) */
function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <FullPageLoader />;
  if (!user) return <Navigate to="/welcome" />;
  return children;
}

/**
 * Pricing-page guard. If the user already has usable access, they should
 * NEVER see the pricing page — bounce them straight into the app.
 *   - Onboarding incomplete → /onboarding
 *   - Onboarding complete   → /  (dashboard)
 *
 * The /payment/success page is exempt from this guard so it can complete
 * its sync flow without being interrupted.
 */
function RedirectIfActive({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <FullPageLoader />;
  if (!user) return <Navigate to="/welcome" />;
  if (hasUsableAccess(user)) {
    if (user.onboardingCompleted) return <Navigate to="/" replace />;
    return <Navigate to="/onboarding" replace />;
  }
  return children;
}

/**
 * Onboarding wrapper.
 *  - Must be logged in.
 *  - Must have an active plan / trial (otherwise → /pricing).
 *  - If onboarding is ALREADY complete, never show the wizard again →
 *    bounce straight to the dashboard.
 */
function RequireActivePlan({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <FullPageLoader />;
  if (!user) return <Navigate to="/welcome" />;
  if (!hasUsableAccess(user)) return <Navigate to="/pricing" replace />;
  if (user.onboardingCompleted) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      {/* Public invoice — no auth */}
      <Route path="/i/:slug" element={<PublicInvoicePage />} />
      <Route path="/invite/:token" element={<AcceptInvitePage />} />

      <Route path="/welcome" element={<WelcomePage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
      <Route path="/dashboard" element={<OAuthCallbackPage />} />

      {/* Pricing — accessible when logged in WITHOUT a usable subscription.
          Active subscribers are bounced to /onboarding or /dashboard. */}
      <Route
        path="/pricing"
        element={
          <RedirectIfActive>
            <PricingPage />
          </RedirectIfActive>
        }
      />

      {/* Post-checkout landing — runs the sync flow then routes the user. */}
      <Route
        path="/payment/success"
        element={
          <RequireAuth>
            <PaymentSuccessPage />
          </RequireAuth>
        }
      />

      {/* Onboarding — must have an active plan/trial to enter */}
      <Route
        path="/onboarding"
        element={
          <RequireActivePlan>
            <OnboardingPage />
          </RequireActivePlan>
        }
      />

      {/* Main app — requires auth + active plan + completed onboarding */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <DashboardLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardHome />} />
        <Route path="inbox" element={<InboxPage />} />
        <Route path="inbox/:conversationId" element={<InboxPage />} />
        <Route path="connections" element={<ConnectionsPage />} />
        <Route path="leads" element={<LeadsPage />} />
        <Route path="invoices" element={<InvoiceListPage />} />
        <Route path="invoices/new" element={<CreateInvoicePage />} />
        <Route path="invoices/:id" element={<InvoiceDetailPage />} />
        <Route path="settings" element={<ProfileSettingsPage />} />
        <Route path="ai-training" element={<AITrainingPage />} />
      </Route>

      {/* Catch-all */}
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}
