import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import api from '../services/api';

const AuthContext = createContext(null);

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('token'));
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('user') || 'null');
    } catch {
      return null;
    }
  });
  // While we verify a stored token we don't know yet if the user is logged in
  const [checking, setChecking] = useState(() => !!localStorage.getItem('token'));

  const saveSession = useCallback((newToken, newUser) => {
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
  }, []);

  // Validate the stored token once on app start
  useEffect(() => {
    if (!localStorage.getItem('token')) return;
    api
      .get('/auth/me')
      .then(({ data }) => setUser(data.user))
      .catch(() => logout())
      .finally(() => setChecking(false));
  }, [logout]);

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    saveSession(data.token, data.user);
  };

  // Step 1 of sign-up: creates the account and emails a 6-digit code (no session yet)
  const register = async (name, email, password) => {
    const { data } = await api.post('/auth/register', { name, email, password });
    return data.email;
  };

  // Step 2 of sign-up: the correct code activates the account and signs the user in
  const verifyEmail = async (email, otp) => {
    const { data } = await api.post('/auth/verify-email', { email, otp });
    saveSession(data.token, data.user);
  };

  return (
    <AuthContext.Provider value={{ user, token, checking, login, register, verifyEmail, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
