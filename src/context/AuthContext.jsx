import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'rtd_auth_remember';
const USERNAME = 'admin';
const PASSWORD = 'Pr!nterS@rvices2024';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'true') {
      setIsAuthenticated(true);
    }
    setLoading(false);
  }, []);

  const login = useCallback((username, password, remember) => {
    if (username === USERNAME && password === PASSWORD) {
      setIsAuthenticated(true);
      if (remember) {
        localStorage.setItem(STORAGE_KEY, 'true');
      }
      return true;
    }
    return false;
  }, []);

  const logout = useCallback(() => {
    setIsAuthenticated(false);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return (
    <AuthContext.Provider value={{ isAuthenticated, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
