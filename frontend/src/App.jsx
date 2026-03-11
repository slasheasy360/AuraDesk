import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import OAuthCallbackPage from './pages/OAuthCallbackPage.jsx';
import DashboardLayout from './components/DashboardLayout.jsx';
import InboxPage from './pages/InboxPage.jsx';
import ConnectionsPage from './pages/ConnectionsPage.jsx';

function FullPageSkeleton() {
  return (
    <div className="flex h-screen bg-gray-100">
      {/* Sidebar skeleton */}
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
      {/* Main content skeleton */}
      <div className="flex-1 flex">
        {/* Conversation list */}
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
        {/* Chat placeholder */}
        <div className="flex-1 bg-gray-50 flex items-center justify-center">
          <div className="w-12 h-12 rounded-full bg-gray-200 animate-pulse" />
        </div>
      </div>
    </div>
  );
}

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <FullPageSkeleton />;
  if (!user) return <Navigate to="/login" />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/dashboard" element={<OAuthCallbackPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <DashboardLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/inbox" />} />
        <Route path="inbox" element={<InboxPage />} />
        <Route path="inbox/:conversationId" element={<InboxPage />} />
        <Route path="connections" element={<ConnectionsPage />} />
      </Route>
    </Routes>
  );
}
