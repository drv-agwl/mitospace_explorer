import React, { useState, useEffect } from 'react';
import { Lock, AlertCircle } from 'lucide-react';

interface PasswordProtectionProps {
  children: React.ReactNode;
}

const SITE_PASSWORD = 'lightsheet';
const MAX_RETRIES = 3;

const PasswordProtection: React.FC<PasswordProtectionProps> = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [retriesLeft, setRetriesLeft] = useState(MAX_RETRIES);
  const [isLocked, setIsLocked] = useState(false);

  useEffect(() => {
    const authStatus = sessionStorage.getItem('site_authenticated');
    if (authStatus === 'true') {
      setIsAuthenticated(true);
      return;
    }
    const storedRetries = sessionStorage.getItem('password_retries');
    if (storedRetries) {
      const retries = parseInt(storedRetries, 10);
      if (retries <= 0) setIsLocked(true);
      else setRetriesLeft(retries);
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isLocked) return;

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
        setError('Maximum attempts exceeded.');
      } else {
        setError(`${newRetries} ${newRetries === 1 ? 'attempt' : 'attempts'} remaining.`);
      }
      setPassword('');
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black px-4">
        <div className="w-full max-w-md">
          <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-8">
            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-white/10 text-white mb-5">
                <Lock size={28} />
              </div>
              <h1 className="text-2xl font-semibold text-white mb-2">
                MitoSpace Explorer
              </h1>
              <p className="text-white/50 text-sm">
                Enter password to continue
              </p>
            </div>

            {isLocked ? (
              <div className="rounded-xl bg-red-500/10 border border-red-500/30 p-6 text-center">
                <AlertCircle className="text-red-400 mx-auto mb-3" size={40} />
                <h3 className="font-semibold text-white mb-1">Access denied</h3>
                <p className="text-red-300 text-sm">Maximum attempts exceeded.</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-white/90 mb-2">
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
                    className="input-base"
                    placeholder="Enter password"
                    autoComplete="off"
                    autoFocus
                  />
                </div>

                {retriesLeft < MAX_RETRIES && !isLocked && (
                  <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 px-4 py-2 text-center">
                    <p className="text-amber-300 text-sm font-medium">
                      {retriesLeft} {retriesLeft === 1 ? 'attempt' : 'attempts'} remaining
                    </p>
                  </div>
                )}

                {error && (
                  <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3">
                    <p className="text-red-300 text-sm font-medium text-center">{error}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isLocked || !password.trim()}
                  className="btn-primary w-full py-3 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Continue
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default PasswordProtection;
