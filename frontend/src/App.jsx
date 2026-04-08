import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import WelcomePage from './pages/WelcomePage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import ForgotPasswordPage from './pages/ForgotPasswordPage.jsx';
import ResetPasswordPage from './pages/ResetPasswordPage.jsx';
import OAuthCallbackPage from './pages/OAuthCallbackPage.jsx';
import PricingPage from './pages/PricingPage.jsx';
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
 * Access control logic:
 * 1. Not logged in → /login
 * 2. Trial expired & no paid plan → /pricing
 * 3. Paid/trial active but onboarding incomplete → /onboarding
 * 4. Fully setup → allow dashboard
 */
function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <FullPageSkeleton />;
  if (!user) return <Navigate to="/welcome" />;

  const hasActivePlan =
    (user.plan === 'trial' && user.trialEndsAt && new Date(user.trialEndsAt) > new Date()) ||
    ['starter', 'pro', 'elite'].includes(user.plan);

  // Trial expired or no plan → pricing
  if (!hasActivePlan) return <Navigate to="/pricing" />;

  // Onboarding incomplete → onboarding
  if (user.onboardingStep < 4) return <Navigate to="/onboarding" />;

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

/** Only redirect to pricing if user has no active plan (expired trial, no subscription) */
function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <FullPageLoader />;
  if (!user) return <Navigate to="/welcome" />;
  return children;
}

/** Onboarding can only be entered with an active plan/trial. Otherwise → /pricing */
function RequireActivePlan({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <FullPageLoader />;
  if (!user) return <Navigate to="/welcome" />;
  const hasActivePlan =
    (user.plan === 'trial' && user.trialEndsAt && new Date(user.trialEndsAt) > new Date()) ||
    ['starter', 'pro', 'elite'].includes(user.plan);
  if (!hasActivePlan) return <Navigate to="/pricing" replace />;
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

      {/* Pricing — accessible when logged in (trial expired or choosing plan) */}
      <Route path="/pricing" element={<RequireAuth><PricingPage /></RequireAuth>} />

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
        <Route path="ai-training" element={<div className="flex items-center justify-center h-full text-gray-400"><p className="text-lg">AI Training — Coming Soon</p></div>} />
      </Route>

      {/* Catch-all */}
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}
