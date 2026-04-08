import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3001',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Attach token from localStorage on init
const token = localStorage.getItem('token');
if (token) {
  api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
}

// Subscription enforcement: when the backend returns 402 Payment Required
// from the requireActiveSubscription middleware, bounce the user to /pricing
// so they can fix billing. We don't redirect from /pricing or /onboarding
// (those need to stay reachable to complete the payment flow).
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (
      error?.response?.status === 402 &&
      typeof window !== 'undefined' &&
      !['/pricing', '/onboarding', '/login', '/welcome', '/payment'].some((p) => window.location.pathname.startsWith(p))
    ) {
      const reason = error.response.data?.reason || 'subscription_required';
      window.location.href = `/pricing?reason=${encodeURIComponent(reason)}`;
    }
    return Promise.reject(error);
  }
);

export default api;
