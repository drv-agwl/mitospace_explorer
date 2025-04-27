import React from 'react';
import { Microscope } from 'lucide-react';
import { Link } from 'react-router-dom';

const Header: React.FC = () => {
  return (
    <header className="bg-gray-900 border-b border-gray-700 text-white shadow-sm">
      <div className="container mx-auto py-3 px-4">
        <div className="flex items-center justify-between">
          {/* Logo and Title aligned to the left */}
          <Link to="/" className="flex items-center gap-3">
            <Microscope size={24} className="text-blue-400" />
            <h1 className="text-2xl font-bold">MitoSpace Explorer</h1>
          </Link>

          {/* Navigation aligned to the right */}
          <nav>
            <ul className="flex space-x-6">
              <li>
                <Link
                  to="/"
                  className="text-gray-300 hover:text-blue-400 transition duration-300 text-sm font-medium"
                >
                  Dashboard
                </Link>
              </li>
              <li>
                <Link
                  to="/about"
                  className="text-gray-300 hover:text-blue-400 transition duration-300 text-sm font-medium"
                >
                  About
                </Link>
              </li>
            </ul>
          </nav>
        </div>
      </div>
    </header>
  );
};

export default Header;
