import React, { useState, useEffect } from 'react';
import { Lock, AlertCircle } from 'lucide-react';

interface PasswordProtectionProps {
  children: React.ReactNode;
}

// Change this password to whatever you want
const SITE_PASSWORD = 'lightsheet';
const MAX_RETRIES = 3;

const PasswordProtection: React.FC<PasswordProtectionProps> = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [retriesLeft, setRetriesLeft] = useState(MAX_RETRIES);
  const [isLocked, setIsLocked] = useState(false);

  useEffect(() => {
    // Check if user is already authenticated in this session
    const authStatus = sessionStorage.getItem('site_authenticated');
    if (authStatus === 'true') {
      setIsAuthenticated(true);
      return;
    }

    // Check if user is locked out
    const storedRetries = sessionStorage.getItem('password_retries');
    if (storedRetries) {
      const retries = parseInt(storedRetries, 10);
      if (retries <= 0) {
        setIsLocked(true);
      } else {
        setRetriesLeft(retries);
      }
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (isLocked) {
      return;
    }

    if (password === SITE_PASSWORD) {
      sessionStorage.setItem('site_authenticated', 'true');
      sessionStorage.removeItem('password_retries');
      setIsAuthenticated(true);
    } else {
      const newRetries = retriesLeft - 1;
      setRetriesLeft(newRetries);
      sessionStorage.setItem('password_retries', newRetries.toString());
      
      if (newRetries <= 0) {
        setIsLocked(true);
        setError('Maximum attempts exceeded. Access denied.');
      } else {
        setError(`Incorrect password. ${newRetries} ${newRetries === 1 ? 'attempt' : 'attempts'} remaining.`);
      }
      setPassword('');
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <div className="bg-white rounded-2xl shadow-2xl p-10 w-full max-w-md mx-4 border border-gray-100">
          <div className="flex flex-col items-center mb-8">
            <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-full p-4 mb-4 shadow-lg">
              <Lock className="text-white" size={32} />
            </div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              Protected Access
            </h1>
            <p className="text-gray-600 text-center text-sm">
              This site requires authentication to continue
            </p>
          </div>

          {isLocked ? (
            <div className="text-center py-6">
              <div className="bg-red-50 border-2 border-red-200 rounded-lg p-6">
                <AlertCircle className="text-red-600 mx-auto mb-3" size={48} />
                <h3 className="text-lg font-semibold text-red-900 mb-2">
                  Access Denied
                </h3>
                <p className="text-red-700 text-sm">
                  You have exceeded the maximum number of attempts.
                </p>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label
                  htmlFor="password"
                  className="block text-sm font-semibold text-gray-700 mb-2"
                >
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError('');
                  }}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition text-gray-900 placeholder-gray-400"
                  placeholder="Enter your password"
                  autoComplete="off"
                  autoFocus
                  disabled={isLocked}
                />
              </div>

              {retriesLeft < MAX_RETRIES && !isLocked && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-amber-800 text-sm font-medium text-center">
                    {retriesLeft} {retriesLeft === 1 ? 'attempt' : 'attempts'} remaining
                  </p>
                </div>
              )}

              {error && (
                <div className="bg-red-50 border-2 border-red-200 rounded-lg p-4">
                  <p className="text-red-700 text-sm font-medium text-center">
                    {error}
                  </p>
                </div>
              )}

              <button
                type="submit"
                disabled={isLocked || !password.trim()}
                className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 disabled:from-gray-400 disabled:to-gray-500 text-white font-semibold py-3 px-4 rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 shadow-md disabled:cursor-not-allowed"
              >
                Access Site
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default PasswordProtection;
