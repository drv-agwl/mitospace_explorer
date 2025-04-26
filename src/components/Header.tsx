import React from 'react';
import { Microscope } from 'lucide-react';
import { Link } from 'react-router-dom';

const Header: React.FC = () => {
  return (
    <header className="bg-gradient-to-r from-blue-600 to-blue-800 text-white shadow-md">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <Link to="/" className="flex items-center space-x-2">
            <Microscope size={28} className="text-blue-200" />
            <h1 className="text-xl font-bold">MitoSpace Explorer</h1>
          </Link>
          
          <nav>
            <ul className="flex space-x-6">
              <li>
                <Link to="/" className="hover:text-blue-200 transition duration-300 text-sm font-medium">
                  Dashboard
                </Link>
              </li>
              <li>
                <Link to="/about" className="hover:text-blue-200 transition duration-300 text-sm font-medium">
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

export default Header