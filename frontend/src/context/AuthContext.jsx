import { createContext, useContext, useState, useEffect } from 'react';
import api from '../services/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // Hydrate user immediately from localStorage so the app renders on refresh
  // without a loading flash or redirect to /login.
  const [user, setUser] = useState(() => {
    try {
      const raw = localStorage.getItem('user');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  const [token, setToken] = useState(localStorage.getItem('token'));

  // Show the loading spinner only when we have a token but no cached user yet
  // (i.e. first-ever load before 'user' was ever written to localStorage).
  // If a cached user exists we render the app immediately and validate the
  // token in the background — this eliminates the refresh-logout problem.
  const [loading, setLoading] = useState(
    !!localStorage.getItem('token') && !localStorage.getItem('user')
  );

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
          // Token is genuinely invalid (expired or revoked) — wipe everything.
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          setToken(null);
          setUser(null);
        }
        // Network errors, 5xx, CORS issues: do NOT clear the token.
        // The cached user stays active and /auth/me will retry on next load.
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

  // Refresh user data from server (call after subscription/onboarding changes).
  // Also keeps the localStorage cache in sync so the next refresh is accurate.
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
    <AuthContext.Provider value={{ user, token, loading, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
