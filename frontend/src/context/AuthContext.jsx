import { createContext, useContext, useState, useEffect } from 'react';
import api from '../services/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // Hydrate user immediately from localStorage so UI elements (name, plan badge,
  // etc.) render without a flash on refresh. The cached value is used for
  // display only — route guards MUST wait for the /auth/me response (see loading
  // below) to avoid acting on stale data (e.g. onboardingCompleted: false).
  const [user, setUser] = useState(() => {
    try {
      const raw = localStorage.getItem('user');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  const [token, setToken] = useState(localStorage.getItem('token'));

  // loading is TRUE whenever a token exists — regardless of cached user.
  // Route guards (ProtectedRoute, RequireActivePlan, etc.) show a spinner
  // while loading is true, which prevents them from acting on the stale cache
  // value and causing incorrect redirects before /auth/me responds.
  const [loading, setLoading] = useState(!!localStorage.getItem('token'));

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }

    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;

    api
      .get('/auth/me')
      .then((res) => {
        setUser(res.data.user);
        localStorage.setItem('user', JSON.stringify(res.data.user));
      })
      .catch((err) => {
        if (err.response?.status === 401) {
          // Genuinely invalid token — wipe everything and send to login.
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          setToken(null);
          setUser(null);
        }
        // Network errors, 5xx, CORS: keep token and cached user intact.
        // /auth/me will retry on the next page load.
      })
      .finally(() => setLoading(false));
  }, [token]);

  const login = async (email, password) => {
    const res = await api.post('/auth/login', { email, password });
    const { user, token } = res.data;
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    setToken(token);
    setUser(user);
    return user;
  };

  const register = async (email, name, password) => {
    const res = await api.post('/auth/register', { email, name, password });
    const { user, token } = res.data;
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    setToken(token);
    setUser(user);
    return user;
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    delete api.defaults.headers.common['Authorization'];
    setToken(null);
    setUser(null);
  };

  // Merge partial field updates into user state + localStorage immediately.
  // Use this after API calls that change user fields (onboardingCompleted,
  // plan, etc.) so routing decisions see the update without waiting for the
  // next /auth/me round-trip. refreshUser() provides the authoritative sync.
  const updateUser = (updates) => {
    setUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...updates };
      localStorage.setItem('user', JSON.stringify(next));
      return next;
    });
  };

  // Re-fetch the full user object from the server and sync state + cache.
  // Call this after any server action that changes user fields.
  const refreshUser = async () => {
    try {
      const res = await api.get('/auth/me');
      setUser(res.data.user);
      localStorage.setItem('user', JSON.stringify(res.data.user));
      return res.data.user;
    } catch {
      return null;
    }
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout, refreshUser, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
