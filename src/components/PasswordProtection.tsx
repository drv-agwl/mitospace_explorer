import React, { useState, useEffect } from 'react';

interface PasswordProtectionProps {
  children: React.ReactNode;
}

// Change this password to whatever you want
const SITE_PASSWORD = 'lightsheet';

const PasswordProtection: React.FC<PasswordProtectionProps> = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    // Check if user is already authenticated in this session
    const authStatus = sessionStorage.getItem('site_authenticated');
    if (authStatus === 'true') {
      setIsAuthenticated(true);
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (password === SITE_PASSWORD) {
      sessionStorage.setItem('site_authenticated', 'true');
      setIsAuthenticated(true);
    } else {
      setError('Incorrect password');
      setPassword('');
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="bg-white p-8 rounded shadow-md w-full max-w-sm">
          <h2 className="text-xl font-bold mb-4 text-center">Enter Password</h2>
          <form onSubmit={handleSubmit}>
            <input
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError('');
              }}
              className="w-full px-4 py-2 border border-gray-300 rounded mb-4"
              placeholder="Password"
              autoFocus
            />
            {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
            <button
              type="submit"
              className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700"
            >
              Submit
            </button>
          </form>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default PasswordProtection;
